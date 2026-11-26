import { createHash } from 'node:crypto';
import { switchingModel } from '../chat-models.mjs';
import { composerText, terminalPrompt } from '../terminal-prompt.mjs';
import { telegramText } from './telegram-api.mjs';

const eventKey = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const sensitiveTitle = /(?:https?:\/\/|(?:^|\s)(?:[A-Z]:\\|~?\/)|\d{4,}:[\w-]{20,}|(?:sk-|gh[pousr]_|github_pat_|xox[baprs]-)[\w-]{8,}|(?:password|senha|token|api[_ -]?key|secret)\s*[:=]|\S{32,})/i;
export const jobTitle = value => {
  const title = typeof value === 'string' ? telegramText(value, value.length) : '';
  return title && !sensitiveTitle.test(title) ? telegramText(title, 140) : 'Bento work';
};

const replyAgents = new Set(['claude', 'codex', 'antigravity']);
const manualPrompt = /(?:sign|log)[ -]?in|(?:enter|provide|paste|share|type).{0,30}(?:password|passphrase|api key|access token|verification code)|permission required|allow (?:this |the )?(?:command|tool)/i;

function composerReady(agent, screen, expected = '') {
  if (!screen || terminalPrompt(screen)) return false;
  const lines = screen.trimEnd().split('\n').slice(-7);
  if (lines.some(line => /esc to (?:interrupt|cancel)/i.test(line) || manualPrompt.test(line))) return false;
  if (agent === 'claude') return composerText(lines.join('\n')) === expected;
  if (agent === 'antigravity') {
    const rule = value => /^[─━═▔ ]{8,}$/.test(value || '');
    const index = lines.findLastIndex((line, i) => /^\s*>(?:\s|$)/.test(line) && rule(lines[i - 1]) && rule(lines[i + 1]));
    return index >= 0 && lines[index].replace(/^\s*>\s*/, '').trim() === expected;
  }
  // Codex's composer must be adjacent to its live status line. Ignore the
  // matching glyph in scrollback and the placeholder in an empty composer.
  if (agent !== 'codex') return false;
  const index = lines.findIndex(line => /(?:context left|(?:gpt-|o[134]-)[\w. -]+ · \S.*)$/i.test(line.trim()));
  if (index < 1) return false;
  const draft = /^\s*›(?:\s+(.*))?\s*$/.exec(lines.slice(0, index).filter(line => line.trim()).at(-1) || '');
  const value = (draft?.[1] || '').trim();
  return !!draft && (value === expected || !expected && /^Ask Codex to do anything\.?$/i.test(value));
}

export function workReply(sessions, allowBypass) {
  return async (proof, text, current) => {
    const session = sessions.items.get(proof.chatId);
    const valid = delta => current() && session?.open && session.status === 'running' &&
      session.process === proof.process && session.nativeId === proof.nativeId &&
      session.agent === proof.agent && session.activity === 'idle' &&
      session.completionVersion === proof.completion && session.turnEpoch === proof.turn &&
      session.inputVersion === proof.input + delta && !switchingModel(session.id) &&
      (!session.bypass || allowBypass());
    if (!valid(0)) return 'staleReply';
    const ready = (view, value) => view && view.process === session.process &&
      view.screenVersion === session.screenVersion && composerReady(session.agent, view.screen, value);
    const view = await sessions.terminalView(proof.chatId);
    if (!valid(0)) return 'staleReply';
    if (!ready(view, '') || Date.now() - Date.parse(session.lastInputAt || 0) < 2500) return 'localReply';
    return sessions.input(proof.chatId, text, { coordinator: true, submit: true, guardedSubmit: async submit => {
      const pasted = await sessions.terminalView(proof.chatId);
      return valid(1) && ready(pasted, text) && submit() ? 'replyDelivered' : 'replyUnconfirmed';
    } });
  };
}

// The baseline emits native session changes and explicit attention notices.
// This adapter can be replaced by a Notification Center publisher at merge.
export function watchTelegramWork(sessions, publish) {
  const known = new Map(sessions.list().map(item => [item.id, item.completionVersion]));
  const waiting = new Map();
  const changed = item => {
    const previous = known.get(item.id) ?? 0;
    known.set(item.id, item.completionVersion);
    const live = sessions.items.get(item.id);
    if (!live || item.agent === 'shell') return;
    if (item.open && live.process && item.activity === 'waiting') {
      if (!waiting.has(item.id)) {
        const key = eventKey(item.id, 'attention', live.notificationAttention);
        waiting.set(item.id, key);
        publish({ key, title: item.name, kind: 'attention' });
      }
    } else waiting.delete(item.id);
    if (item.completionVersion <= previous) return;
    const key = eventKey(item.id, item.nativeId, item.lastCompletedId || item.completionVersion);
    const question = /\?\s*$/.test(live.completionPreview || '');
    const manual = question && manualPrompt.test(live.completionPreview);
    const canReply = question && !manual && item.open && live.process && live.nativeId &&
      replyAgents.has(item.agent) && live.inputVersion === live.telegramCompletionInputVersion;
    const proof = canReply ? {
      chatId: item.id, process: live.process, nativeId: live.nativeId, agent: item.agent,
      completion: item.completionVersion, turn: live.turnEpoch, input: live.inputVersion,
    } : null;
    publish({ key, title: item.name, kind: manual ? 'attention' : question ? 'question' : 'completion', proof });
  };
  const notice = ({ kind, sessionId, name, id }) => {
    if (kind === 'attention' && sessions.items.get(sessionId)?.agent !== 'shell' && !waiting.has(sessionId)) {
      publish({ key: eventKey(sessionId, 'manual', id), title: name, kind: 'attention' });
    }
  };
  sessions.on('session', changed);
  sessions.on('notice', notice);
  return () => { sessions.off('session', changed); sessions.off('notice', notice); };
}
