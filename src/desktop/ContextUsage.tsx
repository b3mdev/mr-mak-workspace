import type { ChatSession } from './types'
import { useT } from '../lib/i18n'

export default function ContextUsage({ session, connected }: { session: ChatSession; connected: boolean }) {
  const { t, number } = useT()
  const usage = session.contextUsage
  const used = connected ? usage?.usedTokens ?? null : null
  const limit = connected ? usage?.limitTokens ?? null : null
  const percent = used !== null && limit !== null && limit > 0 ? Math.round(used / limit * 100) : null
  const estimatedLimit = usage?.source === 'claude' && limit !== null
  const detail = !connected ? t('context.unknownDisconnected')
    : used !== null ? limit === null ? t('context.tokensLimitUnknown', { used: number(used) }) : t('context.percentUsed', { percent: percent ?? 0, used: number(used), limit: number(limit) })
    : usage?.reason === 'unavailable' || !['codex', 'claude', 'opencode', 'antigravity'].includes(session.agent) ? t('context.unavailable')
    : usage?.reason === 'compacted' ? t('context.afterCompact')
    : limit !== null ? t('context.unknownLimit', { limit: number(limit) })
    : t('context.waitingNative')
  const label = estimatedLimit && connected ? t('context.estimatedLimit', { detail }) : detail
  const title = [
    t('context.tipBase'),
    usage?.source === 'claude' ? t('context.tipClaude') : '',
    usage?.source === 'antigravity' ? t('context.tipAntigravity') : '',
    usage?.source === 'opencode' ? t('context.tipOpenCode') : '',
    usage?.updatedAt ? t('context.tipReported', { time: usage.updatedAt }) : '',
  ].filter(Boolean).join(' ')
  return <div className="chat-context-usage" role="status" aria-label={t('context.ariaStatus')} title={title}>
    <span>{t('context.label')} <strong>{label}</strong></span>
    {percent !== null && <meter min={0} max={100} value={Math.min(100, percent)} aria-label={t('context.ariaMeter')} />}
  </div>
}
