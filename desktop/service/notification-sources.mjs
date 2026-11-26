import { createHash, randomUUID } from 'node:crypto';
import { switchingModel } from './chat-models.mjs';
import { terminalPrompt } from './terminal-prompt.mjs';

export const notificationKey = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const apps = { codex: 'Codex', claude: 'Claude Code', antigravity: 'Antigravity', opencode: 'OpenCode', kimi: 'Kimi', shell: 'Shell' };
const credential = /\b(?:password|passphrase|senha|api[_ -]?key|chave (?:de|da) api|access[_ -]?token|refresh[_ -]?token|private[_ -]?key|secret|segredo|bearer|otp|verification code|device code|c[oó]digo de (?:verifica[cç][aã]o|acesso)|authorization)\b|\b(?:sk-[\w-]{8,}|gh[pousr]_[\w-]{8,}|github_pat_[\w-]{8,}|xox[baprs]-[\w-]+|AKIA[A-Z0-9]{16}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/i;
export const sensitive = text => credential.test(text) || /[A-Za-z0-9+/_=-]{32,}|https?:\/\/\S+/i.test(text);
// Only short plain wording travels into the local notification exchange. Full
// output, commands, links and secrets stay in the originating terminal.
export function excerpt(text) {
  const value = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  return value && !sensitive(value) && !/[<>{}`\p{C}]/u.test(value) ? value.slice(0, 350) : '';
}

const manualFooter = /^\s*(?:[│┃║|>❯›]\s*)?(?:please\s+)?(?:sign\s*in|log\s*in|login|authenticate|enter (?:your |an? )?(?:api key|password|verification code)|paste (?:your |the )?(?:api key|code)|trust (?:this|the) (?:folder|workspace)|allow (?:this |the )?(?:command|tool)|permission required|authorization required)\b[^\n]*/im;
const shellFooter = /^\s*(?:(?:PS\s+)?[A-Z]:[^\n]*>|[\w@.-]+(?::[~\/][^\n]*)?[#$])\s*$/i;
const nonEmptyLines = screen => screen.split('\n').filter(line => line.trim());

function visibleBlock(screen, shell = false) {
  if (!screen) return null;
  const prompt = terminalPrompt(screen);
  if (prompt) return prompt.id;
  const lines = nonEmptyLines(screen);
  const reason = manualFooter.exec(lines.slice(-9).join('\n'))?.[0].trim();
  if (reason) return notificationKey(reason);
  return !shell && shellFooter.test(lines.at(-1)) ? 'shell' : null;
}

export const blockingScreen = screen => !!visibleBlock(screen);

// Positive evidence of a visible composer. Unknown TUI layouts, existing
// drafts and selectable menus all require the original chat's controls.
export function composerReady(agent, screen, expected = '') {
  if (!screen || blockingScreen(screen)) return false;
  const lines = screen.split('\n').map(line => line.trim());
  if (lines.slice(-5).some(line => /(?:esc to interrupt|press esc to cancel)/i.test(line))) return false;
  const mark = { codex: '›', claude: '❯', antigravity: '>', opencode: '│' }[agent];
  if (!mark) return false;
  const rule = line => /^[─━═▔╰╯└┘╭╮┌┐ ]{8,}$/.test(line || '');
  const index = lines.findLastIndex((line, at) => (line === mark || line.startsWith(mark + ' ')) &&
    (agent === 'codex' ? lines.slice(at + 1).some(footer => /(?:context left|(?:gpt-|o[134]-)[\w. -]+ · [\w.~:/\\ -]+)$/i.test(footer)) : rule(lines[at - 1]) && rule(lines[at + 1])));
  if (index < 0 || lines.length - index > 7) return false;
  const draft = lines[index].slice(mark.length).replace(/\s*[│┃║]$/, '').trim();
  if (!expected && agent === 'codex' && /^Ask Codex to do anything\.?$/i.test(draft)) return true;
  return draft === expected;
}

const question = text => /\?\s*$/.test(text) && !sensitive(text) && !!excerpt(text);

// A source exposes a snapshot and a change subscription. Only this managed
// adapter owns a reply path. External source records are metadata-only.
export class ManagedNotificationSource {
  constructor(sessions, readCompletion) {
    this.sessions = sessions;
    this.readCompletion = readCompletion;
    this.manual = new Map();
    this.timers = new Map();
  }

  subscribe(changed) {
    const refresh = id => {
      clearTimeout(this.timers.get(id));
      const timer = setTimeout(async () => {
        this.timers.delete(id);
        try {
          const session = this.sessions.get(id);
          const view = await this.sessions.terminalView(id);
          if (!view || session.screenVersion !== view.screenVersion || session.process !== view.process) return;
          const signature = visibleBlock(view.screen, session.agent === 'shell');
          const previous = this.manual.get(id);
          if ((!previous && !signature) || (previous?.signature === signature && previous?.process === view.process)) return;
          if (signature) this.manual.set(id, { id: randomUUID(), signature, process: view.process });
          else this.manual.delete(id);
          changed();
        } catch { /* A stopped or inaccessible terminal has no visible prompt. */ }
      }, 150);
      this.timers.set(id, timer);
    };
    const sessionChanged = session => {
      if (!session.open || session.status !== 'running') this.manual.delete(session.id);
      changed();
    };
    const screenChanged = ({ id }) => refresh(id);
    const notice = ({ sessionId, kind }) => {
      if (kind === 'attention') changed(sessionId);
    };
    this.sessions.on('session', sessionChanged);
    this.sessions.on('output', screenChanged);
    this.sessions.on('screen-cleared', screenChanged);
    this.sessions.on('terminal-resized', screenChanged);
    this.sessions.on('notice', notice);
    return () => {
      this.sessions.off('session', sessionChanged);
      this.sessions.off('output', screenChanged);
      this.sessions.off('screen-cleared', screenChanged);
      this.sessions.off('terminal-resized', screenChanged);
      this.sessions.off('notice', notice);
      for (const timer of this.timers.values()) clearTimeout(timer);
    };
  }

  item(session) {
    const { id: chatId, agent, name: title, open, process, nativeId, completionVersion, lastCompletedId } = session;
    if (!apps[agent]) return null;
    const base = { chatId, app: apps[agent], title, at: session.updatedAt || session.createdAt };
    const viewport = this.manual.get(chatId);
    const manual = open && process && viewport?.process === process ? viewport.id : '';
    if (manual || open && (session.activity === 'waiting' || session.notificationAttention || session.attention && !session.unread)) {
      return { ...base, key: notificationKey(chatId, 'manual', session.notificationAttention || manual || session.turnEpoch), kind: 'manual' };
    }
    if (!session.unread) return null;
    const current = this.currentTurn(session);
    const kind = current && question(session.completionPreview) ? 'question' : completionVersion ? 'completion' : 'unread';
    const completedIn = session.completionNativeId === undefined ? nativeId : session.completionNativeId;
    return { ...base, key: notificationKey(chatId, completedIn, completionVersion, lastCompletedId), kind };
  }

  snapshot() {
    return [...this.sessions.items.values()].map(session => this.item(session)).filter(Boolean);
  }

  currentTurn(session) {
    return session.agent !== 'shell' && session.open && session.process && session.activity === 'idle' &&
      !!session.lastCompletedId && session.completionNativeId === session.nativeId && session.completionProcess === session.process && session.completionInputVersion === session.inputVersion &&
      session.completionTurnEpoch === session.turnEpoch;
  }

  async inspect(item, allowBypass) {
    const session = this.sessions.get(item.chatId);
    const turn = session.inputVersion;
    const output = session.completionPreview || (session.agent === 'opencode' && this.currentTurn(session)
      ? await this.readCompletion(session, session.lastCompletedId) : '');
    const view = await this.sessions.terminalView(item.chatId);
    if (item.key !== this.item(session)?.key || turn !== session.inputVersion) return { kind: 'stale' };
    if (item.kind === 'manual' || blockingScreen(view?.screen)) return { kind: 'manual' };
    if (!this.currentTurn(session) || !question(output)) return { kind: item.kind === 'question' ? 'completion' : item.kind, detail: excerpt(output) };
    if (!view || view.process !== session.process || !composerReady(session.agent, view.screen) ||
      switchingModel(session.id) || session.bypass && !allowBypass) return { kind: 'manual', detail: excerpt(output) };
    return { kind: 'question', detail: excerpt(output), proof: { process: session.process, nativeId: session.nativeId, input: turn, turn: session.turnEpoch } };
  }

  async deliver(item, proof, text, current, allowBypass) {
    const session = this.sessions.get(item.chatId);
    const valid = delta => current() && session.open && session.process === proof.process && session.nativeId === proof.nativeId &&
      session.inputVersion === proof.input + delta && session.turnEpoch === proof.turn && session.activity === 'idle' &&
      !switchingModel(session.id) && (!session.bypass || allowBypass());
    const ready = (view, draft) => view && view.screenVersion === session.screenVersion && composerReady(session.agent, view.screen, draft);
    const view = await this.sessions.terminalView(item.chatId);
    if (!valid(0) || item.key !== this.item(session)?.key) return 'stale';
    if (!ready(view, '') || session.lastInputAt && Date.now() - Date.parse(session.lastInputAt) < 2500) return 'manual';
    // Same paste path as the native chat composer. Enter is conditional on the
    // reviewed turn, process and exact draft still being present after redraw.
    return this.sessions.input(item.chatId, text, { coordinator: true, submit: true, guardedSubmit: async submit => {
      const pasted = await this.sessions.terminalView(item.chatId);
      return valid(1) && ready(pasted, text) && submit() ? 'delivered' : 'unconfirmed';
    } });
  }
}
