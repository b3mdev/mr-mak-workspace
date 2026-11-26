import type { ChatSession } from './types'
import { currentDocumentLanguage, translate, type UiLanguage } from '../lib/i18n/translate'

export function chatActivityLabel(session: ChatSession, lang: UiLanguage = currentDocumentLanguage()) {
  const working = session.status === 'running' && session.activity === 'working'
  if (session.unread) return translate(lang, working ? 'activity.workingUnread' : 'activity.finishedUnread')
  if (working) return translate(lang, 'activity.working')
  if (session.status !== 'running') return translate(lang, session.status === 'starting' ? 'activity.starting' : 'activity.stopped')
  if (session.activity === 'waiting') return translate(lang, 'activity.waiting')
  return translate(lang, ['codex', 'claude', 'opencode', 'antigravity'].includes(session.agent) ? 'activity.ready' : 'activity.terminalOpen')
}
