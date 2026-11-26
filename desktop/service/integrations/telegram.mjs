import path from 'node:path';
import { lstat, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { equalSecret, readJsonFile, saveJson } from '../util.mjs';
import { ownerMessage, privateChat, telegramBot, TelegramError, telegramId, telegramText } from './telegram-api.mjs';
import { jobTitle } from './telegram-work.mjs';

const minute = 60_000;
const alertStates = { completion: 'Finished', attention: 'Needs attention', question: 'Needs a reply' };
const replyMessages = {
  staleReply: 'This work item has changed. Review it in Bento.',
  localReply: 'This work item needs to be handled in Bento.',
  replyUnconfirmed: 'Bento could not confirm delivery. Check the draft in the work chat.',
  replyDelivered: 'Reply submitted to the work chat.',
};
const validOwner = owner => telegramId(owner?.botId) && telegramId(owner?.userId) && owner.userId === owner.chatId;
const initialState = () => ({ owner: null, alerts: false, inbound: false, receipts: [], cursor: null });

export class TelegramIntegration {
  constructor({ dir, fetcher = fetch, converse, reply, now = Date.now, changed = () => {} }) {
    Object.assign(this, { dir, fetcher, converse, reply, now, changed });
    this.credentialPath = path.join(dir, 'bot.token');
    this.statePath = path.join(dir, 'state.json');
    this.state = initialState();
    this.errors = {};
    this.targets = new Map();
    this.conversationMessages = new Set();
    this.pending = new Set();
    this.mutations = Promise.resolve();
    this.sends = Promise.resolve();
    this.closed = false;
  }

  async init() {
    const saved = await readJsonFile(this.statePath);
    if (saved.error || (!saved.missing && !this.validState(saved.value))) this.fail('setup', 'storage');
    else if (!saved.missing) this.state = saved.value;
    this.start();
    return this;
  }

  validState(state) {
    return state && typeof state.alerts === 'boolean' && typeof state.inbound === 'boolean' &&
      (validOwner(state.owner) || state.owner === null && !state.alerts && !state.inbound) &&
      Array.isArray(state.receipts) && state.receipts.length <= 1024 &&
      state.receipts.every(key => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key)) &&
      (state.cursor === null || Number.isSafeInteger(state.cursor?.id) && state.cursor.id >= 0 && Number.isFinite(state.cursor.at));
  }

  status() {
    const pairing = this.pairing;
    return {
      paired: !!this.state.owner, alerts: this.state.alerts, inbound: this.state.inbound,
      connected: this.connection?.verified === true, credentialPath: this.credentialPath,
      pairing: pairing ? {
        command: '/start ' + pairing.code, bot: pairing.bot.username, expires: pairing.expires,
        candidate: pairing.candidate ? { id: pairing.candidate.id, username: pairing.candidate.username } : null,
      } : null,
      errors: { ...this.errors },
    };
  }

  fail(scope, code) {
    if (this.errors[scope] === code) return;
    this.errors[scope] = code;
    this.changed();
  }

  clear(scope) {
    if (!Object.hasOwn(this.errors, scope)) return;
    delete this.errors[scope];
    this.changed();
  }

  serialize(action) {
    const task = this.mutations.then(action);
    this.mutations = task.catch(() => {});
    return task;
  }

  async store(next) {
    try { await saveJson(this.statePath, next); }
    catch { throw new TelegramError('storage'); }
    this.state = next;
  }

  async client() {
    let token;
    try {
      const info = await lstat(this.credentialPath);
      if (!info.isFile() || info.size > 256 || process.platform !== 'win32' && (info.mode & 0o077)) throw new Error();
      token = (await readFile(this.credentialPath, 'utf8')).trim();
    } catch { throw new TelegramError('credentialFile'); }
    return telegramBot(token, this.fetcher);
  }

  async bot(client, signal) {
    const bot = await client('getMe', {}, signal);
    if (bot?.is_bot !== true || !telegramId(bot.id) || !/^[A-Za-z0-9_]{5,32}$/.test(bot.username || '')) throw new TelegramError('token');
    if (bot.can_join_groups || bot.supports_inline_queries || bot.has_topics_enabled) throw new TelegramError('botSettings');
    return bot;
  }

  async verifyChat(client, id, signal) {
    const chat = await client('getChat', { chat_id: id }, signal);
    if (!privateChat(chat, id)) throw new TelegramError('destination');
  }

  async verifyPolling(client, signal) {
    const info = await client('getWebhookInfo', {}, signal);
    if (info?.url !== '') throw new TelegramError('pollConflict');
  }

  configure(action, enabled) {
    return this.serialize(async () => {
      if (this.closed) throw new TelegramError('closed');
      try {
        switch (action) {
          case 'pair': await this.beginPairing(); break;
          case 'approve': await this.approve(); break;
          case 'cancel': if (this.pairing) this.stop(); break;
          case 'disconnect':
            this.stop();
            await this.store(initialState());
            break;
          case 'alerts':
          case 'inbound': {
            if (!this.state.owner || typeof enabled !== 'boolean') throw new TelegramError('pairFirst');
            if (this.state[action] === enabled) return this.status();
            this.stop();
            await this.store({ ...this.state, [action]: enabled });
            if (!enabled && action === 'alerts') this.clear('alert');
            if (!enabled && action === 'inbound') {
              for (const scope of ['poll', 'reply', 'conversation']) this.clear(scope);
            }
            this.start();
            break;
          }
          default: throw new TelegramError('action');
        }
        this.clear('setup');
        if (!this.state.alerts && !this.state.inbound && !this.pairing)
          for (const scope of ['connection', 'poll', 'alert', 'reply', 'conversation']) this.clear(scope);
        this.changed();
        return this.status();
      } catch (error) {
        this.fail('setup', error instanceof TelegramError ? error.code : 'setup');
        return this.status();
      }
    });
  }

  stop() {
    this.connection?.controller.abort();
    this.connection = null;
    this.pairing = null;
    this.targets.clear();
    this.conversationMessages.clear();
    this.converse?.reset?.();
    clearTimeout(this.timer);
  }

  async beginPairing() {
    if (this.state.owner) throw new TelegramError('alreadyPaired');
    this.stop();
    const connection = this.connection = { controller: new AbortController() };
    const { signal } = connection.controller;
    try {
      const client = await this.client();
      const bot = await this.bot(client, signal);
      await this.verifyPolling(client, signal);
      signal.throwIfAborted();
      connection.client = client;
      this.pairing = { bot, code: randomBytes(24).toString('base64url'), expires: this.now() + 5 * minute, cursor: null };
      this.schedule(connection);
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  async approve() {
    const current = this.pairing, connection = this.connection;
    if (!current?.candidate || this.now() >= current.expires) throw new TelegramError('pairExpired');
    const { signal } = connection.controller;
    const { id } = current.candidate;
    await this.verifyChat(connection.client, id, signal);
    signal.throwIfAborted();
    if (this.now() >= current.expires) throw new TelegramError('pairExpired');
    await this.store({ ...initialState(), owner: { botId: current.bot.id, userId: id, chatId: id }, cursor: current.cursor });
    this.stop();
  }

  start() {
    if (this.closed || !this.state.owner || !this.state.alerts && !this.state.inbound) return;
    const connection = this.connection = { controller: new AbortController(), inboundSince: Math.floor(this.now() / 1000) + 1 };
    connection.ready = this.connect(connection);
  }

  async connect(connection) {
    const { signal } = connection.controller;
    try {
      const owner = this.state.owner;
      const client = await this.client();
      const bot = await this.bot(client, signal);
      if (bot.id !== owner.botId) throw new TelegramError('botChanged');
      await this.verifyChat(client, owner.chatId, signal);
      signal.throwIfAborted();
      connection.client = client;
      connection.verified = true;
      this.clear('connection');
      this.changed();
      if (this.state.inbound) this.schedule(connection);
      return true;
    } catch (error) {
      if (!signal.aborted) {
        const code = error instanceof TelegramError ? error.code : 'connection';
        this.fail('connection', code);
        if (code === 'connection' || code === 'rateLimit' || code === 'telegram') {
          this.timer = setTimeout(() => { connection.ready = this.connect(connection); }, 60_000);
          this.timer.unref();
        }
      }
      return false;
    }
  }

  schedule(connection, delay = 250) {
    if (connection.controller.signal.aborted) return;
    this.timer = setTimeout(() => void this.poll(connection), delay);
    this.timer.unref();
  }

  async poll(connection) {
    const { signal } = connection.controller;
    if (signal.aborted) return;
    const pairing = this.pairing;
    if (pairing && this.now() >= pairing.expires) {
      this.stop();
      this.fail('setup', 'pairExpired');
      return;
    }
    let delay = 250;
    try {
      const cursor = pairing ? pairing.cursor : this.state.cursor;
      const useCursor = cursor && this.now() - cursor.at < 6 * 24 * 60 * minute;
      const updates = await connection.client('getUpdates', {
        ...(useCursor ? { offset: cursor.id + 1 } : {}),
        timeout: 25, limit: 25, allowed_updates: ['message'],
      }, signal);
      if (!Array.isArray(updates)) throw new TelegramError('telegram');
      for (const update of updates) {
        if (signal.aborted) return;
        await this.handleUpdate(connection, pairing, update);
        if (pairing?.candidate) {
          this.clear('poll');
          this.timer = setTimeout(() => {
            if (this.pairing !== pairing) return;
            this.stop();
            this.fail('setup', 'pairExpired');
          }, Math.max(0, pairing.expires - this.now()));
          this.timer.unref();
          return;
        }
      }
      if (!signal.aborted) this.clear('poll');
    } catch (error) {
      if (signal.aborted) return;
      this.fail('poll', error instanceof TelegramError ? error.code : 'connection');
      delay = 60_000;
    }
    this.schedule(connection, delay);
  }

  async handleUpdate(connection, pairing, update) {
    const { signal } = connection.controller;
    const id = update?.update_id;
    if (!Number.isSafeInteger(id) || id < 0) return;
    const cursor = { id, at: this.now() };
    const duplicate = last => last && cursor.at - last.at < 6 * 24 * 60 * minute && id <= last.id;
    const message = update.message;
    const nowSeconds = Math.floor(this.now() / 1000);
    const fresh = Number.isSafeInteger(message?.date) && message.date >= nowSeconds - 5 * 60 && message.date <= nowSeconds + 30;
    if (pairing) {
      if (duplicate(pairing.cursor)) return;
      pairing.cursor = cursor;
      if (fresh && this.now() < pairing.expires && ownerMessage(message) && !message.reply_to_message &&
          equalSecret(message.text, '/start ' + pairing.code)) {
        const username = message.from.username;
        pairing.candidate = { id: message.from.id, username: /^[A-Za-z0-9_]{5,32}$/.test(username || '') ? username : null };
        this.changed();
      }
      return;
    }
    const owner = this.state.owner;
    const active = () => !signal.aborted && this.state.inbound && this.state.owner === owner;
    if (!active()) return;
    const accepted = await this.serialize(async () => {
      if (!active() || duplicate(this.state.cursor)) return false;
      // Claim before any externally visible effect. A crash may lose an action,
      // but Telegram replay cannot resubmit a reply after Bento restarts.
      await this.store({ ...this.state, cursor });
      return true;
    });
    if (!accepted || !active() || !fresh || message.date < connection.inboundSince ||
        !ownerMessage(message) || message.from.id !== owner.userId || !privateChat(message.chat, owner.chatId)) return;
    await this.receive(connection, owner, message, active);
  }

  async send(connection, owner, text, extra = {}) {
    const { signal } = connection.controller;
    if (signal.aborted || !connection.verified || !validOwner(owner) || this.state.owner !== owner) throw new TelegramError('destination');
    const result = await connection.client('sendMessage', {
      chat_id: owner.chatId, text, protect_content: true, link_preview_options: { is_disabled: true }, ...extra,
    }, signal);
    if (!privateChat(result?.chat, owner.chatId) || !telegramId(result.message_id)) throw new TelegramError('destination');
    return result.message_id;
  }

  async receive(connection, owner, message, active) {
    const raw = message.text.trim();
    if (!raw || raw.startsWith('/') || raw.length > 4000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(raw)) return;
    const parent = message.reply_to_message;
    const ownParent = parent?.from?.id === owner.botId && parent.from.is_bot === true && privateChat(parent.chat, owner.chatId);
    const conversation = !parent && !message.external_reply && !message.quote ||
      ownParent && !message.external_reply && this.conversationMessages.has(parent.message_id);
    let scope = 'reply';
    let response;
    let failed = false;
    try {
      if (!conversation) {
        const target = this.targets.get(parent?.message_id);
        const valid = target && ownParent && !message.external_reply && this.now() < target.expires;
        if (!valid) response = replyMessages.staleReply;
        else if (/^[!/]|[\p{Cc}\p{Cf}]/u.test(raw)) response = 'Send a single line of plain text, or reply in Bento.';
        else {
          this.targets.delete(parent.message_id);
          const result = await this.reply(target.proof, raw, active);
          response = replyMessages[result] || replyMessages.replyUnconfirmed;
          if (result === 'replyUnconfirmed' && active()) {
            failed = true;
            this.fail('reply', 'replyUnconfirmed');
          }
        }
      } else {
        scope = 'conversation';
        response = await this.converse(raw, connection.controller.signal);
      }
      if (typeof response !== 'string' || !response.trim()) throw new TelegramError(scope);
    } catch (error) {
      if (!active()) return;
      failed = true;
      this.fail(scope, error instanceof TelegramError ? error.code : scope);
      response = scope === 'conversation' ? 'Bento could not answer. Check Telegram settings in Bento.' : replyMessages.replyUnconfirmed;
    }
    if (!active()) return;
    try {
      const id = await this.send(connection, owner, telegramText(response, 1800), { reply_parameters: { message_id: message.message_id } });
      if (!failed && active()) this.clear(scope);
      if (active() && scope === 'conversation') {
        this.conversationMessages.add(id);
        if (this.conversationMessages.size > 50) this.conversationMessages.delete(this.conversationMessages.values().next().value);
      }
    } catch (error) {
      if (active()) this.fail(scope, error instanceof TelegramError ? error.code : scope);
    }
  }

  publish({ key, title, kind, proof }) {
    if (!this.state.alerts || !this.connection || !Object.hasOwn(alertStates, kind) ||
        typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key) || this.pending.has(key)) return Promise.resolve();
    const connection = this.connection, owner = this.state.owner;
    const { signal } = connection.controller;
    this.pending.add(key);
    const task = this.sends.then(async () => {
      try {
        if (!(await connection.ready) || signal.aborted) return;
        const claimed = await this.serialize(async () => {
          if (signal.aborted || !this.state.alerts || this.state.receipts.includes(key)) return false;
          await this.store({ ...this.state, receipts: [...this.state.receipts, key].slice(-1024) });
          return true;
        });
        if (!claimed || signal.aborted) return;
        const canReply = kind === 'question' && proof && this.state.inbound;
        const extra = canReply ? { reply_markup: { force_reply: true, input_field_placeholder: 'Reply to this work item' } } : {};
        const messageId = await this.send(connection, owner, jobTitle(title) + '\n' + alertStates[kind], extra);
        if (canReply && !signal.aborted) {
          this.targets.set(messageId, { proof, expires: this.now() + 30 * minute });
          if (this.targets.size > 100) this.targets.delete(this.targets.keys().next().value);
        }
        this.clear('alert');
      } catch (error) {
        if (!signal.aborted) this.fail('alert', error instanceof TelegramError ? error.code : 'alert');
      } finally { this.pending.delete(key); }
    });
    this.sends = task.catch(() => {});
    return task;
  }

  async close() {
    this.closed = true;
    this.stop();
    await Promise.allSettled([this.mutations, this.sends]);
  }
}
