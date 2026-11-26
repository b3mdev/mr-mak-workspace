import { useCallback, useEffect, useRef, useState } from 'react'
import { api, useDesktop } from '../desktop/client'
import { AgentLogo, Icon } from '../desktop/Icons'
import { useT } from '../lib/i18n'
import './agent-usage.css'

const agents = { codex: 'Codex', claude: 'Claude', antigravity: 'Antigravity' } as const
type UsageAgent = keyof typeof agents

interface Quota {
  key: string
  label: string | null
  minutes: number | null
  percent: number | null
  remaining: number | null
  resetsAt: number | null
}
type UsageSnapshot = Record<UsageAgent, { total: number | null; at: number | null; quotas: Quota[] }> & { checkedAt: number }

function QuotaRow({ quota, expired, compact = false }: { quota: Quota; expired: boolean; compact?: boolean }) {
  const { t, number, dateTime } = useT()
  const minutes = quota.minutes
  const duration = minutes === null ? null
    : minutes >= 1440 && minutes % 1440 === 0 ? t('usage.days', { count: minutes / 1440 })
    : minutes >= 60 && minutes % 60 === 0 ? t('usage.hours', { count: minutes / 60 })
    : t('usage.minutes', { count: minutes })
  const label = [quota.label, duration].filter(Boolean).join(' · ') || t(quota.key === 'spend_limit' ? 'usage.spendLimit' : 'usage.window')
  const percent = quota.percent
  return <li className="agent-usage-row">
    <div className="agent-usage-row-label">
      <span>{label}</span>
      {!expired && (percent !== null
        ? <strong>{t('usage.percentUsed', { percent: number(percent / 100, { style: 'percent', maximumFractionDigits: 1 }) })}</strong>
        : quota.remaining !== null && <strong>{t('usage.remaining', { count: number(quota.remaining) })}</strong>)}
    </div>
    {!expired && percent !== null && <meter min={0} max={100} value={Math.min(percent, 100)} aria-label={label} data-near-limit={percent >= 90} />}
    {!compact && quota.resetsAt !== null && <small>{expired
      ? t('usage.awaitingUpdate')
      : t('usage.resets', { time: dateTime(quota.resetsAt) })}</small>}
  </li>
}

export default function AgentUsage() {
  const { connected, sessions } = useDesktop()
  const { t, dateTime, number } = useT()
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const pending = useRef(false)
  const refresh = useCallback(async () => {
    if (pending.current) return
    pending.current = true
    setLoading(true)
    try {
      setSnapshot(await api<UsageSnapshot>('/workspace/agent-usage'))
      setFailed(false)
    } catch { setFailed(true) }
    finally { pending.current = false; setLoading(false) }
  }, [])

  useEffect(() => {
    if (!connected) return
    const whenVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
    window.addEventListener('focus', whenVisible)
    const timer = window.setInterval(whenVisible, 60_000)
    return () => {
      window.removeEventListener('focus', whenVisible)
      window.clearInterval(timer)
    }
  }, [connected, refresh])

  const status = !connected ? t('usage.disconnected')
    : failed ? t('usage.refreshFailed')
    : loading ? t('usage.loading')
    : snapshot ? t('usage.checked', { time: dateTime(snapshot.checkedAt) }) : ''
  const isExpired = (quota: Quota) => quota.resetsAt !== null && quota.resetsAt <= (snapshot?.checkedAt ?? 0)
  return <section className="project-section agent-usage" aria-labelledby="agent-usage-title">
    <div className="project-section-header">
      <h2 id="agent-usage-title">{t('usage.title')}</h2>
      <div className="agent-usage-actions">
        <small role="status">{status}</small>
        <button type="button" className="project-icon-button" disabled={!connected || loading} onClick={() => void refresh()} title={t('usage.refresh')} aria-label={t('usage.refresh')}>
          <Icon name="refresh" size={17} />
        </button>
        <button type="button" className="project-icon-button agent-usage-toggle" aria-expanded={expanded} aria-controls="agent-usage-grid" onClick={() => setExpanded(value => !value)}>
          {t(expanded ? 'usage.collapse' : 'usage.expand')}
          <Icon name={expanded ? 'up' : 'down'} size={15} />
        </button>
      </div>
    </div>
    <div id="agent-usage-grid" className={`agent-usage-grid${expanded ? '' : ' agent-usage-grid-compact'}`}>
      {(Object.keys(agents) as UsageAgent[]).map(agent => {
        const report = snapshot?.[agent]
        if (!expanded) {
          const quotas = report?.quotas.filter(quota => !isExpired(quota)) ?? []
          const highestUsage = quotas.reduce<Quota | undefined>((highest, quota) => {
            if (quota.percent === null) return highest
            return highest?.percent == null || quota.percent > highest.percent ? quota : highest
          }, undefined)
          const quota = highestUsage ?? quotas.find(quota => quota.remaining !== null)
          return <article className="agent-usage-card" data-agent={agent} key={agent}>
            <h3><AgentLogo agent={agent} size={17} />{agents[agent]}</h3>
            {quota
              ? <ul className="agent-usage-summary" aria-label={t('usage.quotas')}><QuotaRow quota={quota} expired={false} compact /></ul>
              : (!loading || report) && <p className="agent-usage-missing">{t('usage.unavailable')}</p>}
          </article>
        }
        const chats = sessions.filter(chat => chat.agent === agent && chat.open)
        const working = chats.filter(chat => chat.status === 'running' && chat.activity === 'working').length
        return <article className="agent-usage-card" data-agent={agent} key={agent}>
          <h3><AgentLogo agent={agent} size={22} />{agents[agent]}</h3>
          {connected && <p className="agent-usage-activity">{t('usage.activity', { open: number(chats.length), working: number(working) })}</p>}
          <div className="agent-usage-tokens">
            <small>{t(agent === 'codex' ? 'usage.accountTokens' : 'usage.sessionTokens')}</small>
            <strong>{report?.total != null ? number(report.total) : <span className="agent-usage-missing">{t('usage.unavailable')}</span>}</strong>
          </div>
          <div className="agent-usage-quotas">
            <h4>{t('usage.quotas')}</h4>
            {report?.quotas.length
              ? <ul>{report.quotas.map(quota => <QuotaRow key={quota.key} quota={quota} expired={isExpired(quota)} />)}</ul>
              : <p className="agent-usage-missing">{t('usage.unavailable')}</p>}
          </div>
          {report?.at != null && (report.total !== null || report.quotas.length > 0) && <small className="agent-usage-timestamp">{t('usage.reported', { time: dateTime(report.at) })}</small>}
        </article>
      })}
    </div>
  </section>
}
