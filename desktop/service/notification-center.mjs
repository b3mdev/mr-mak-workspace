import path from 'node:path';
import { readJsonFile, saveJson } from './util.mjs';
import { resolveUiLanguage } from './language.mjs';
import { excerpt, notificationKey, sensitive } from './notification-sources.mjs';

const normalize = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const names = {
  en: { manual: 'manual attention', question: 'agent question', completion: 'unread result', unread: 'unread message', external: 'external notice' },
  'pt-BR': { manual: 'atenção manual', question: 'pergunta do agente', completion: 'resultado não lido', unread: 'mensagem não lida', external: 'aviso externo' },
};

export function notificationCommand(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/^(?:(?:bento|please|por favor)[,\s]+)+/i, '');
  const plain = normalize(text);
  if (/^(?:(?:list|show|check|read|quais sao as|liste|mostre|ver|veja) (?:as )?)?(?:pending notifications|notifications|pending items|pending work|notificacoes(?: pendentes)?|pendencias|central de notificacoes)$/.test(plain) ||
    /^(?:what(?: s| is) pending|what needs my attention|o que esta pendente|o que precisa da minha atencao|tem (?:alguma )?pendencia|any notifications)$/.test(plain)) return { type: 'list' };
  if (/^(?:next notification|review next notification|proxima notificacao|revisar (?:a )?proxima notificacao|proxima pendencia)$/.test(plain)) return { type: 'next' };
  if (/^(?:clear (?:notification )?selection|cancel reply|limpar selecao|cancelar resposta)$/.test(plain)) return { type: 'clear' };
  const review = /^(?:(?:review|read|select) (?:notification|pending item)|(?:revise|revisar|leia|ler|selecione) (?:a )?(?:notifica[çc][ãa]o|pend[êe]ncia))\s+(.+?)\s*$/iu.exec(text);
  if (review) return { type: 'review', target: review[1] };
  const send = /^(?:(?:send (?:a |the )?reply|reply) to|(?:envi(?:e|ar) (?:uma |a )?resposta|respond(?:a|er)) (?:para|ao|à))\s+(.+?)(?:\s*:\s*|[, ]+\s*(?:saying|dizendo)\s+)([\s\S]+)$/iu.exec(text);
  if (send) return { type: 'send', target: send[1], reply: send[2].trim() };
  if (/^(?:yes|no|sim|nao|reply to (?:it|that|this)|reply (?:that|this)|respond to (?:it|that|this)|respond(?:a|e|er) (?:isso|isto|aquilo)|envie (?:isso|isto)|send (?:it|that|this))(?: (?:please|por favor))?$/.test(plain) ||
    /^(?:yes|no|sim|nao) (?:please |por favor )?(?:send|reply|respond|envie|responda|responde)\b/.test(plain) ||
    /^(?:send (?:a |the )?reply|reply to|envi(?:e|ar) (?:uma |a )?resposta|respond(?:a|er) (?:para|ao|a))\b/.test(plain) ||
    /^(?:(?:list|show|check|read|review|select|next|dismiss|what|open)\b.*\b(?:notification|notifications|pending items)\b|(?:liste|mostre|leia|revise|revisar|abra|quais|veja|o que)\b.*\b(?:notificacoes|notificacao|pendencias|pendencia)\b)/.test(plain)) return { type: 'help' };
  return null;
}

export function notificationReplyCaption(text, replacement) {
  // Also recognize unfinished streamed commands before an exact reply parses.
  return /(?:^|[.!?\n]\s*)(?:(?:bento|please|por favor)[,\s]+)*(?:send (?:a |the )?reply|reply to|envi(?:e|ar) (?:uma |a )?resposta|respond(?:a|er) (?:para|ao|à))\b/iu.test(text) ? replacement : text;
}

const digits = {
  one: 1, first: 1, um: 1, uma: 1, primeiro: 1, primeira: 1, two: 2, second: 2, dois: 2, duas: 2, segundo: 2, segunda: 2,
  three: 3, third: 3, tres: 3, terceiro: 3, terceira: 3, four: 4, quatro: 4, five: 5, cinco: 5, six: 6, seis: 6,
  seven: 7, sete: 7, eight: 8, oito: 8, nine: 9, nove: 9, ten: 10, dez: 10,
};

function matching(items, target) {
  const query = normalize(target).replace(/^(?:notifications?|notificacoes|notificacao|number|numero|item) /, '');
  if (!query || /^(?:it|this|that|current|isso|isto|atual|essa|esta)$/.test(query)) return [];
  if (/^\d+$/.test(query) || Object.hasOwn(digits, query)) return items.filter(item => item.ref === (digits[query] || Number(query)));
  const values = item => [item.title, item.app, `${item.app} ${item.title}`, `${item.title} ${item.app}`].map(normalize);
  const exact = items.filter(item => values(item).includes(query));
  return exact.length ? exact : items.filter(item => values(item).some(value => value.includes(query)));
}

export class NotificationCenter {
  constructor({ managed, sources = [], stateDir, changed, settings, revision }) {
    Object.assign(this, { managed, changed, settings, revision });
    this.sources = new Map([['managed', managed]]);
    for (const source of sources) {
      if (source.enabled === true && typeof source.id === 'string' && /^[\w-]{1,64}$/.test(source.id) && !this.sources.has(source.id)) this.sources.set(source.id, source);
    }
    this.file = path.join(stateDir, 'notification-deliveries.json');
    this.receipts = new Map();
    this.receiptsByItem = new Set();
    this.operations = new Map();
    this.pending = new Map();
    this.refs = new Map();
    this.reviewed = new Set();
    this.queue = Promise.resolve();
    this.items = [];
    this.selection = null;
    this.nextRef = 1;
  }

  async init() {
    const stored = await readJsonFile(this.file);
    this.receiptsAvailable = stored.missing || Array.isArray(stored.value);
    for (const receipt of Array.isArray(stored.value) ? stored.value : []) {
      if (typeof receipt?.request !== 'string' || typeof receipt.item !== 'string' || !['delivered', 'sending', 'unconfirmed', 'manual', 'stale'].includes(receipt.status)) {
        this.receiptsAvailable = false;
        continue;
      }
      this.receipts.set(receipt.request, receipt);
      if (!['manual', 'stale'].includes(receipt.status)) this.receiptsByItem.add(receipt.item);
    }
    this.unsubscribes = [];
    for (const [id, source] of this.sources) {
      try {
        const unsubscribe = source.subscribe(() => this.refresh());
        if (typeof unsubscribe === 'function') this.unsubscribes.push(unsubscribe);
      } catch (error) {
        if (source === this.managed) throw error;
        this.sources.delete(id);
      }
    }
    this.refresh();
    return this;
  }

  close() {
    for (const unsubscribe of this.unsubscribes) {
      try { unsubscribe(); } catch { /* An optional adapter cannot block shutdown. */ }
    }
    return this.queue;
  }

  reset() {
    this.selection = null;
    this.refresh();
  }

  refresh() {
    const entries = new Map();
    for (const [sourceId, source] of this.sources) {
      let snapshot;
      try { snapshot = source.snapshot(); } catch { continue; }
      if (!Array.isArray(snapshot)) continue;
      for (const record of snapshot) {
        if (typeof record?.key !== 'string' || !record.key || record.key.length > 200) continue;
        const id = notificationKey(sourceId, record.key);
        if (entries.has(id) || this.reviewed.has(id) || this.receiptsByItem.has(id)) continue;
        const isManaged = source === this.managed;
        if (!this.refs.has(id)) this.refs.set(id, this.nextRef++);
        entries.set(id, {
          id, ref: this.refs.get(id), source: sourceId, kind: isManaged ? record.kind : 'external',
          app: excerpt(record.app).slice(0, 60) || 'App', title: excerpt(record.title).slice(0, 120),
          at: typeof record.at === 'string' && Number.isFinite(Date.parse(record.at)) ? new Date(record.at).toISOString() : null,
          ...(isManaged ? { chatId: record.chatId } : {}),
          key: record.key,
        });
      }
    }
    const items = [...entries.values()].sort((a, b) => a.ref - b.ref);
    const changed = JSON.stringify(items) !== JSON.stringify(this.items);
    this.items = items;
    if (changed) this.changed(this.publicItems());
  }

  publicItems() { return this.items.map(({ key: _key, ...item }) => item); }

  // Keep review details and reply bodies out of saved operations and coordinator
  // context. The in-memory exchange belongs to the current Talk to Bento UI.
  ask(request, signal, reviewId, notify) {
    const action = reviewId ? { type: 'review', id: reviewId } : notificationCommand(request.text);
    if (!action) return null;
    if (typeof request.id !== 'string' || !request.id || request.id.length > 200 || typeof request.text !== 'string' || request.text.length > 30000) throw new Error('A request ID and a short message are required.');
    const key = notificationKey(request.conversationId, request.contextRevision, request.id);
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.operations.has(key)) return Promise.resolve(this.operations.get(key));
    const run = this.queue.then(async () => {
      const lang = resolveUiLanguage(this.settings().uiLanguage);
      const pt = lang === 'pt-BR';
      const label = item => `${item.ref}. ${item.title || (pt ? 'Trabalho sem título' : 'Untitled work')} · ${item.app}`;
      const help = pt ? 'Para responder, revise uma notificação e diga “envie resposta para [número] dizendo [mensagem]”.' : 'To reply, review a notification and say “send reply to [number] saying [message]”.';
      const manual = pt ? 'Atenção manual. Confira o terminal de origem.' : 'Manual attention. Check the original terminal.';
      const stale = pt ? 'A notificação mudou. Liste as pendências e revise o destino novamente.' : 'The notification changed. List pending items and review the destination again.';
      const current = () => !signal.aborted && this.revision() === request.contextRevision;
      const operation = {
        id: request.id, conversationId: request.conversationId, contextRevision: request.contextRevision,
        text: notificationReplyCaption(request.text, pt ? 'Enviar resposta' : 'Send reply'),
        at: new Date().toISOString(), route: 'notification', status: 'completed',
      };
      const finish = result => {
        operation.result = result;
        this.operations.set(key, operation);
        if (this.operations.size > 60) this.operations.delete(this.operations.keys().next().value);
        if (current()) notify(operation);
        return operation;
      };
      const attempt = (status, itemLabel) => {
        operation.delivery = status;
        const outcome = {
          delivered: pt ? 'Resposta enviada ao terminal' : 'Reply submitted to the terminal',
          unconfirmed: pt ? 'Envio não confirmado. Confira o terminal antes de tentar novamente.' : 'Delivery unconfirmed. Check the terminal before trying again.',
          manual,
          stale,
        }[status];
        return finish(itemLabel ? `${itemLabel}\n${outcome}` : outcome);
      };
      if (!current()) { operation.status = 'interrupted'; return finish(stale); }
      if (request.images?.length) return finish(help);
      const receipt = this.receipts.get(key);
      if (receipt) return attempt(receipt.status === 'sending' ? 'unconfirmed' : receipt.status);
      if (action.type === 'list') {
        const shown = this.items.slice(0, 10);
        const lines = shown.map(item => `${label(item)} — ${names[lang][item.kind]}`);
        const more = this.items.length - shown.length;
        operation.voiceResult = shown.length ? `${this.items.length} ${pt ? 'pendências.' : 'pending.'} ${lines.slice(0, 3).join(' · ')}${this.items.length > 3 ? pt ? ' Peça a próxima para continuar.' : ' Ask for the next notification to continue.' : ''}` : undefined;
        return finish(lines.length ? [`${this.items.length} ${pt ? 'pendências' : 'pending notifications'}`, ...lines, ...(more ? [pt ? `Mais ${more} na lista visual.` : `${more} more in the visual queue.`] : [])].join('\n') : pt ? 'Nenhuma notificação pendente.' : 'No pending notifications.');
      }
      if (action.type === 'clear') { this.reset(); return finish(pt ? 'Seleção limpa.' : 'Selection cleared.'); }
      if (action.type === 'help') return finish(help);

      const previous = this.selection;
      const candidates = action.id ? this.items.filter(item => item.id === action.id)
        : action.type === 'next' ? this.items.filter(item => item.ref > (previous?.item.ref || 0)).slice(0, 1)
        : matching(this.items, action.target);
      if (action.type !== 'send') this.selection = null;
      if (candidates.length > 1) return finish(`${pt ? 'Qual notificação?' : 'Which notification?'}\n${candidates.slice(0, 5).map(label).join('\n')}`);
      const item = candidates[0];
      if (!item) {
        if (action.id) return finish(stale);
        if (action.type === 'send' && previous) return attempt('stale', label(previous.item));
        return finish(action.type === 'next' ? pt ? 'Não há outra notificação na sequência.' : 'There is no next notification.'
          : pt ? 'Qual notificação? Liste as pendências e use o número.' : 'Which notification? List pending items and use its number.');
      }
      if (action.type !== 'send') {
        const reviewed = item.source === 'managed'
          ? await this.managed.inspect(item, this.settings().defaultBypass === true).catch(() => ({ kind: 'stale' }))
          : { kind: 'external' };
        if (!current() || reviewed.kind === 'stale' || !this.items.some(entry => entry.id === item.id)) return finish(stale);
        this.selection = { item, proof: reviewed.proof };
        operation.notificationDetail = reviewed.detail;
        if (!['question', 'manual'].includes(reviewed.kind)) { this.reviewed.add(item.id); this.refresh(); }
        const description = reviewed.kind === 'manual' ? manual : names[lang][reviewed.kind];
        const result = `${label(item)} — ${description}`;
        return finish(reviewed.kind === 'question' ? `${result}\n${help}` : result);
      }

      if (!previous || previous.item.id !== item.id) return finish(`${label(item)}\n${help}`);
      if (!previous.proof || item.source !== 'managed') return attempt('manual', label(item));
      if (!this.receiptsAvailable) return attempt('unconfirmed', label(item));
      // Terminal replies are plain single lines. Reject shell/slash commands,
      // paste controls, credential-like content and URLs before any write.
      if (!action.reply || action.reply.length > 500 || /^[!/]/.test(action.reply) || /\p{C}/u.test(action.reply) || /^\d{6,8}$/.test(action.reply) || sensitive(action.reply)) {
        return finish(pt ? 'Use uma resposta curta em uma linha, sem comandos, links ou credenciais.' : 'Use a short, single-line reply without commands, links or credentials.');
      }
      const next = { request: key, item: item.id, status: 'sending' };
      this.receipts.set(key, next);
      this.receiptsByItem.add(item.id);
      try {
        await this.saveReceipts();
        next.status = await this.managed.deliver(item, previous.proof, action.reply,
          () => current() && this.selection === previous, () => this.settings().defaultBypass === true);
        await this.saveReceipts();
      } catch { next.status = 'unconfirmed'; }
      if (['manual', 'stale'].includes(next.status)) this.receiptsByItem.delete(item.id);
      if (this.selection === previous) this.selection = null;
      this.refresh();
      return attempt(next.status, label(item));
    });
    this.pending.set(key, run);
    this.queue = run.catch(() => {});
    return run.finally(() => this.pending.delete(key));
  }

  saveReceipts() { return saveJson(this.file, [...this.receipts.values()]); }
}
