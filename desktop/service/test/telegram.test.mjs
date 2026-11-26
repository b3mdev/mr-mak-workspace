import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';
import { createService } from '../server.mjs';
import { nativeActivity } from '../native-events.mjs';
import { telegramConversation } from '../integrations/telegram-conversation.mjs';
import { TelegramIntegration } from '../integrations/telegram.mjs';

const owner = 4242424242, stranger = 112233, botId = 7654321;
const fakeToken = botId + ':' + randomBytes(30).toString('base64url');
const chat = id => ({ id, type: 'private' });
const ok = result => Response.json({ ok: true, result });

async function eventually(read, expected) {
  for (let i = 0; i < 160; i++) {
    const result = await read();
    if (result) return result;
    await sleep(25);
  }
  assert.fail('Timed out waiting for ' + expected);
}

function fakeBot() {
  const calls = [], sent = [], updates = [];
  let updateId = 0, messageId = 300, clock = Date.now();
  const bot = {
    calls, sent, updates,
    now: () => clock,
    advance: ms => { clock += ms; },
    destination: chat(owner),
    botId,
    botSettings: {},
    webhook: '',
    failSend: false,
    fetcher: async (url, options) => {
      assert.equal(new URL(url).origin, 'https://api.telegram.org');
      assert.equal(options.redirect, 'error');
      assert.equal(options.method, 'POST');
      const method = new URL(url).pathname.split('/').at(-1), data = JSON.parse(options.body);
      calls.push({ method, data });
      if (method === 'getMe') return ok({ id: bot.botId, is_bot: true, username: 'BentoFixtureBot', ...bot.botSettings });
      if (method === 'getWebhookInfo') return ok({ url: bot.webhook });
      if (method === 'getChat') return ok(bot.destination);
      if (method === 'getUpdates') {
        assert.deepEqual(data.allowed_updates, ['message']);
        return ok(updates.filter(update => update.update_id >= (data.offset ?? 0)).slice(0, data.limit));
      }
      assert.equal(method, 'sendMessage');
      if (bot.failSend) throw new Error('Synthetic failure echoing ' + url + ' and ' + data.text);
      assert.equal(data.chat_id, owner);
      assert.equal(data.protect_content, true);
      assert.equal(data.link_preview_options.is_disabled, true);
      assert.equal(data.parse_mode, undefined);
      const message = { ...data, chat: chat(data.chat_id), from: { id: botId, is_bot: true }, message_id: ++messageId };
      sent.push(message);
      return ok(message);
    },
  };
  bot.update = (text, override = {}) => {
    const message = { text, message_id: ++messageId, date: Math.floor(clock / 1000),
      from: { id: owner, is_bot: false, username: 'BentoOwner' }, chat: chat(owner), ...override };
    const update = { update_id: ++updateId, message };
    updates.push(update);
    return update;
  };
  return bot;
}

async function tokenFile(dir) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'bot.token'), fakeToken, { mode: 0o600 });
}

async function addChat(service, title, agent = 'codex') {
  const { sessions } = service;
  const session = sessions.make({ id: randomUUID(), agent, name: title, nativeId: randomUUID(),
    cwd: sessions.repo, open: true, status: 'running', cols: 120, rows: 24, createdAt: new Date().toISOString() });
  await sessions.hydrate(session);
  const writes = [];
  const screen = async data => {
    session.screenVersion++;
    session.terminal.reset();
    await new Promise(resolve => session.terminal.write(data, resolve));
  };
  const idle = (draft = '') => screen(agent === 'claude' ? '────────────\r\n❯ ' + draft + '\r\n────────────' :
    agent === 'antigravity' ? '────────────\r\n> ' + draft + '\r\n────────────' :
      '› ' + (draft || 'Ask Codex to do anything') + '\r\n\r\n  100% context left');
  const fixture = {
    session, writes, screen, idle, onPaste: null,
    complete(text, id = randomUUID()) {
      sessions.nativeEvent(session, { kind: 'turn-started' });
      const record = agent === 'claude' ? { type: 'assistant', message: {
        id, stop_reason: 'end_turn', content: [{ type: 'text', text }],
      } } : agent === 'antigravity' ? { type: 'PLANNER_RESPONSE', content: text, step_index: id } :
        { type: 'event_msg', payload: { type: 'task_complete', turn_id: id, last_agent_message: text } };
      sessions.nativeEvent(session, nativeActivity(record, agent));
    },
  };
  session.process = {
    write(text) {
      writes.push(text);
      if (text.startsWith('\x1b[200~')) {
        if (fixture.onPaste) fixture.onPaste();
        else void idle(text.slice(6, -6));
      } else if (text === '\r') void idle();
    },
    onExit(callback) { queueMicrotask(callback); return { dispose() {} }; },
    kill() {},
  };
  sessions.items.set(session.id, session);
  await idle();
  sessions.changed(session);
  return fixture;
}

async function pairing(api, bot) {
  const start = await api({ action: 'pair' });
  assert.ok(start.pairing?.command);
  bot.update(start.pairing.command, { from: { id: stranger, is_bot: false }, chat: { id: stranger, type: 'group' } });
  bot.update(start.pairing.command, { from: { id: stranger, is_bot: false } });
  bot.update(start.pairing.command, { forward_origin: {} });
  bot.update(start.pairing.command);
  const candidate = await eventually(async () => (await api()).pairing?.candidate, 'verified private sender');
  assert.equal(candidate.id, owner);
  return { paired: await api({ action: 'approve' }), command: start.pairing.command };
}

test('desktop Telegram endpoints verify pairing and round-trip text and exact work replies', async t => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'bento-telegram-test-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  const dir = path.join(repo, '.mrmak', 'telegram');
  await tokenFile(dir);
  const bot = fakeBot(), model = [];
  const converse = telegramConversation({
    key: async () => 'synthetic-openai-key',
    fetcher: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(options.redirect, 'error');
      const body = JSON.parse(options.body);
      assert.deepEqual(body.tools, []);
      assert.equal(body.store, false);
      model.push(body.input);
      return okResponse('Bento text response');
    },
  });
  const service = await createService({ repo, uiDir: repo, telegramOptions: { fetcher: bot.fetcher, now: bot.now, converse } });
  t.after(() => service.close());
  const url = service.origin + '/api/telegram';
  const api = async data => {
    const response = await fetch(url, {
      method: data ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + service.token, 'Content-Type': 'application/json' },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { Authorization: 'Bearer ' + service.token, Origin: 'https://external.invalid' } })).status, 403);

  const atlas = await addChat(service, 'Atlas Layout');
  const map = await addChat(service, 'Map Review', 'antigravity');
  atlas.complete('This synthetic private transcript stays local.');
  assert.equal((await api()).connected, false);
  assert.equal((await api({ action: 'inbound', enabled: true })).errors.setup, 'pairFirst');
  assert.equal(bot.calls.length, 0);

  const { paired, command } = await pairing(api, bot);
  assert.equal(paired.paired, true);
  assert.equal(paired.alerts, false);
  assert.equal(paired.inbound, false);
  assert.equal(bot.sent.length, 0);
  const pairingCalls = bot.calls.length;
  bot.update('Do not replay this text when enabling');
  await sleep(300);
  assert.equal(bot.calls.length, pairingCalls);

  await api({ action: 'alerts', enabled: true });
  await eventually(async () => (await api()).connected, 'verified alert destination');
  atlas.complete('Result transcript is private.');
  const completed = await eventually(() => bot.sent.find(message => message.text === 'Atlas Layout\nFinished'), 'completion alert');
  assert.equal(completed.reply_markup, undefined);
  assert.equal(model.length, 0);
  assert.equal(bot.calls.filter(call => call.method === 'getUpdates').length,
    bot.calls.slice(0, pairingCalls).filter(call => call.method === 'getUpdates').length);

  await api({ action: 'inbound', enabled: true });
  const pollCount = () => bot.calls.filter(call => call.method === 'getUpdates').length;
  const oldPollCount = pollCount();
  await eventually(() => pollCount() > oldPollCount, 'inbound polling');
  bot.advance(2000);
  service.sessions.nativeEvent(map.session, { kind: 'attention', text: 'Synthetic credential prompt' });
  await eventually(() => bot.sent.find(message => message.text === 'Map Review\nNeeds attention'), 'attention alert');

  await atlas.idle();
  atlas.complete('Private transcript: do you want me to keep the columns?');
  map.complete('Private transcript: should I move the labels?');
  const atlasAlert = await eventually(() => bot.sent.find(message => message.text === 'Atlas Layout\nNeeds a reply'), 'Atlas alert');
  const mapAlert = await eventually(() => bot.sent.find(message => message.text === 'Map Review\nNeeds a reply'), 'Map alert');
  assert.equal(atlasAlert.reply_markup.force_reply, true);
  assert.equal(mapAlert.reply_markup.force_reply, true);

  bot.update('Unauthenticated', { from: { id: stranger, is_bot: false }, chat: chat(stranger), reply_to_message: atlasAlert });
  bot.update('Group', { chat: { id: owner, type: 'supergroup' }, reply_to_message: atlasAlert });
  bot.update('Forwarded', { forward_origin: {}, reply_to_message: atlasAlert });
  bot.update('/exec fake', { reply_to_message: atlasAlert });
  bot.update('!fake', { reply_to_message: atlasAlert });
  const reply = bot.update('Keep the columns.', { reply_to_message: atlasAlert });
  bot.updates.push(reply);
  const delivered = await eventually(() => bot.sent.find(message => message.text === 'Reply submitted to the work chat.'), 'work receipt');
  assert.equal(delivered.reply_parameters.message_id, reply.message.message_id);
  assert.deepEqual(atlas.writes, ['\x1b[200~Keep the columns.\x1b[201~', '\r']);
  assert.deepEqual(map.writes, []);

  const ordinary = bot.update('Help me phrase a note.');
  const response = await eventually(() => bot.sent.find(message => message.reply_parameters?.message_id === ordinary.message.message_id), 'conversation reply');
  assert.equal(response.text, 'Bento text response');
  bot.update('Make it friendlier.', { reply_to_message: response });
  await eventually(() => model.length === 2, 'conversation follow-up');
  assert.equal(model[0][0].content, 'Help me phrase a note.');
  assert.deepEqual(model[1].map(item => item.role), ['user', 'assistant', 'user']);

  map.session.bypass = true;
  bot.update('Move the labels.', { reply_to_message: mapAlert });
  await eventually(() => bot.sent.find(message => message.text === 'This work item has changed. Review it in Bento.'), 'blocked by current bypass policy');
  assert.deepEqual(map.writes, []);

  map.session.bypass = false;
  map.complete('Can you choose another label?');
  const staleMap = await eventually(() => bot.sent.filter(message => message.text === 'Map Review\nNeeds a reply').at(1), 'second Map alert');
  map.session.nativeId = randomUUID();
  const staleReply = bot.update('Choose the short label.', { reply_to_message: staleMap });
  await eventually(() => bot.sent.find(message => message.reply_parameters?.message_id === staleReply.message.message_id &&
    message.text === 'This work item has changed. Review it in Bento.'), 'stale native conversation');
  assert.deepEqual(map.writes, []);

  const brief = await addChat(service, 'Brief Review', 'claude');
  brief.complete('Should I keep the original heading?');
  const briefAlert = await eventually(() => bot.sent.find(message => message.text === 'Brief Review\nNeeds a reply'), 'Claude alert');
  const briefReply = bot.update('Keep the heading.', { reply_to_message: briefAlert });
  await eventually(() => bot.sent.find(message => message.reply_parameters?.message_id === briefReply.message.message_id &&
    message.text === 'Reply submitted to the work chat.'), 'Claude receipt');
  assert.deepEqual(brief.writes, ['\x1b[200~Keep the heading.\x1b[201~', '\r']);

  atlas.complete('Can you confirm my next change?');
  const next = await eventually(() => bot.sent.filter(message => message.text === 'Atlas Layout\nNeeds a reply').at(1), 'second Atlas alert');
  atlas.onPaste = () => {
    void atlas.screen('Allow command?\r\n› 1. Yes, proceed\r\n  2. No\r\nPress enter to confirm');
  };
  bot.update('Confirm the draft.', { reply_to_message: next });
  await eventually(() => bot.sent.find(message => message.text.startsWith('Bento could not confirm delivery.')), 'blocked Enter after a prompt replaced the draft');
  assert.equal(atlas.writes.filter(text => text === '\r').length, 1);
  assert.equal((await api()).errors.reply, 'replyUnconfirmed');

  const state = await readFile(path.join(dir, 'state.json'), 'utf8');
  for (const value of [fakeToken, 'synthetic-openai-key', 'Private transcript', 'Keep the columns.', 'Help me phrase a note.', command])
    assert.ok(!state.includes(value));
  assert.ok(!bot.sent.some(message => /private transcript|synthetic credential/i.test(message.text)));

  await api({ action: 'disconnect' });
  const networkBefore = bot.calls.length;
  bot.update('After disconnect');
  atlas.complete('After disconnect.');
  await sleep(350);
  assert.equal(bot.calls.length, networkBefore);
  assert.equal((await api()).paired, false);
});

function okResponse(text) {
  return Response.json({ status: 'completed', output: [
    { type: 'reasoning' },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
  ] });
}

test('Telegram fails closed for invalid destinations, changed bots and provider errors', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bento-telegram-policy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bot = fakeBot();
  const make = () => new TelegramIntegration({ dir, fetcher: bot.fetcher, now: bot.now }).init();
  const integration = await make();
  t.after(() => integration.close());
  const api = data => data ? integration.configure(data.action, data.enabled) : integration.status();
  assert.equal(bot.calls.length, 0);
  assert.equal((await api({ action: 'pair' })).errors.setup, 'credentialFile');
  await tokenFile(dir);
  bot.botSettings = { can_join_groups: true };
  assert.equal((await api({ action: 'pair' })).errors.setup, 'botSettings');
  bot.botSettings = {};
  bot.webhook = 'https://secret-hook.invalid';
  assert.equal((await api({ action: 'pair' })).errors.setup, 'pollConflict');
  assert.ok(!JSON.stringify(await api()).includes(bot.webhook));
  bot.webhook = '';
  bot.destination = { id: owner, type: 'group' };
  const { paired: invalid } = await pairing(api, bot);
  assert.equal(invalid.paired, false);
  assert.equal(invalid.errors.setup, 'destination');
  assert.deepEqual(bot.sent, []);
  bot.destination = chat(stranger);
  assert.equal((await api({ action: 'approve' })).errors.setup, 'destination');
  bot.destination = chat(owner);
  assert.equal((await api({ action: 'approve' })).paired, true);
  await api({ action: 'alerts', enabled: true });
  await eventually(() => integration.status().connected, 'verified connection');
  const event = { key: 'a'.repeat(64), title: fakeToken, kind: 'completion' };
  await Promise.all([integration.publish(event), integration.publish(event)]);
  await integration.publish(event);
  assert.deepEqual(bot.sent.map(message => message.text), ['Bento work\nFinished']);

  bot.failSend = true;
  const failure = { key: 'b'.repeat(64), title: 'Sanitized test', kind: 'completion' };
  await integration.publish(failure);
  assert.equal(integration.status().errors.alert, 'connection');
  assert.ok(!JSON.stringify(integration.status()).includes(fakeToken));
  bot.failSend = false;
  await integration.close();

  const restarted = await make();
  t.after(() => restarted.close());
  await eventually(() => restarted.status().connected, 'fixture reconnection');
  await restarted.publish(event);
  await restarted.publish(failure);
  assert.equal(bot.sent.length, 1);
  await restarted.close();

  bot.botId = stranger;
  const changed = await make();
  t.after(() => changed.close());
  await eventually(() => changed.status().errors.connection === 'botChanged', 'wrong bot rejected');
  await changed.publish({ ...event, key: 'c'.repeat(64) });
  assert.equal(bot.sent.length, 1);
});
