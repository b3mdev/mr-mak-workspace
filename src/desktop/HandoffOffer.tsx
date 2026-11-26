import { useEffect, useState } from 'react'
import { api, onServiceEvent, reportError, selectChat } from './client'
import type { ChatSession, Handoff } from './types'
import { Icon } from './Icons'
import { useT } from '../lib/i18n'

interface Stats { supported: boolean; handoff: Handoff | null }

// How full the context is, from the agent's own latest report. Message counts and
// transcript size say little: a few long tool results can fill a window, many short
// replies cannot.
function contextShare(session: ChatSession) {
  const used = session.contextUsage?.usedTokens, limit = session.contextUsage?.limitTokens
  return used != null && limit != null && limit > 0 ? used / limit : null
}

// Long chats resend their whole context every turn. When it passes the chosen share
// of the window, offer a summary and a fresh chat in the same project.
export default function HandoffOffer({ session, threshold, agentLabel }: { session: ChatSession; threshold: number; agentLabel: string }) {
  const { t, compactNumber, serviceMessage } = useT()
  const [stats, setStats] = useState<Stats | null>(null)
  const [starting, setStarting] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let alive = true
    api<Stats>(`/sessions/${session.id}/stats`).then(value => { if (alive) setStats(value) }).catch(() => {})
    return () => { alive = false }
  }, [session.id, session.completionVersion])
  useEffect(() => onServiceEvent(event => { if (event.type === 'handoff' && event.id === session.id && event.handoff) { const handoff = event.handoff; setStats(current => current && { ...current, handoff }) } }), [session.id])
  const snooze = session.handoffSnooze
  const until = snooze?.until ? Date.parse(snooze.until) : 0
  // A day-long "Later" ends while the chat may stay open, so check again when it does.
  useEffect(() => {
    if (until <= now) return
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(until - now + 1000, 2 ** 31 - 1))
    return () => clearTimeout(timer)
  }, [until, now])
  const dismiss = (value: 'later' | 'never') => api(`/sessions/${session.id}`, { handoffSnooze: value }, 'PATCH').catch(reportError)
  const job = stats?.handoff
  if (job?.status === 'summarizing' || job?.status === 'opening') return <div className="handoff-offer working" role="status"><i /><span>{job.status === 'summarizing' ? t('handoff.summarizing', { agent: agentLabel }) : t('handoff.opening')}</span></div>
  if (job?.status === 'failed') return <div className="handoff-offer failed" role="alert"><Icon name="bell" size={14} /><span>{job.error ? serviceMessage(job.error) : t('handoff.failed')}</span><button onClick={() => { setStats(current => current && { ...current, handoff: null }) }}>{t('common.dismiss')}</button></div>
  if (job?.status === 'done' && !snooze?.never) return <div className="handoff-offer" role="status"><Icon name="chats" size={14} /><span>{t('handoff.done')}</span>{job.sessionId && <button onClick={() => selectChat(job.sessionId!)}>{t('handoff.openNewChat')}</button>}<button onClick={() => void dismiss('never')}>{t('common.dismiss')}</button></div>
  const share = contextShare(session)
  const due = threshold > 0 && !!stats?.supported && share !== null && share >= threshold / 100 && !snooze?.never && until <= now
  if (!due) return null
  async function start() {
    setStarting(true)
    try { const handoff = await api<Handoff>(`/sessions/${session.id}/handoff`, {}); setStats(current => current && { ...current, handoff }) }
    catch (error) { reportError(error) } finally { setStarting(false) }
  }
  const working = session.activity === 'working'
  const usage = session.contextUsage!
  return <div className="handoff-offer" role="status">
    <Icon name="history" size={14} />
    <span><strong>{t('handoff.fullBannerStrong', { percent: Math.round(share * 100) })}</strong>{t('handoff.fullBannerRest', { used: compactNumber(usage.usedTokens!), limit: compactNumber(usage.limitTokens!) })}</span>
    <button className="primary" disabled={starting || working || session.status !== 'running'} title={working ? t('handoff.workingTitle') : t('handoff.readyTitle', { agent: agentLabel })} onClick={() => void start()}>{t('handoff.summarizeContinue')}</button>
    <button title={t('handoff.laterTitle')} onClick={() => void dismiss('later')}>{t('handoff.later')}</button>
    <button onClick={() => void dismiss('never')}>{t('handoff.never')}</button>
  </div>
}
