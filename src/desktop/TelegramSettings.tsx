import { useEffect, useState } from 'react'
import { useT, type MessageKey } from '../lib/i18n'
import { api, onServiceEvent } from './client'

type TelegramStatus = {
  paired: boolean
  alerts: boolean
  inbound: boolean
  connected: boolean
  credentialPath: string
  pairing: { bot: string; command: string; candidate: { id: number; username: string | null } | null } | null
  errors: Record<string, string>
}

const errorKeys: Record<string, MessageKey> = {
  pairExpired: 'telegram.pairExpired',
  pairFirst: 'telegram.pairFirst',
  alreadyPaired: 'telegram.alreadyPaired',
  credentialFile: 'telegram.credentialFile',
  token: 'telegram.token',
  destination: 'telegram.destination',
  botChanged: 'telegram.botChanged',
  botSettings: 'telegram.botSettings',
  pollConflict: 'telegram.pollConflict',
  rateLimit: 'telegram.rateLimit',
  storage: 'telegram.storage',
  connection: 'telegram.connection',
  conversation: 'telegram.conversation',
  conversationConfig: 'telegram.conversationConfig',
  replyUnconfirmed: 'telegram.replyUnconfirmed',
}

export default function TelegramSettings() {
  const { t } = useT()
  const [status, setStatus] = useState<TelegramStatus>()
  const [busy, setBusy] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [refreshVersion, setRefreshVersion] = useState(0)

  useEffect(() => {
    let current = true
    let request = 0
    const refresh = () => {
      const latest = ++request
      void api<TelegramStatus>('/telegram').then(value => {
        if (current && latest === request) { setStatus(value); setUnavailable(false) }
      }).catch(() => { if (current && latest === request) setUnavailable(true) })
    }
    refresh()
    const unsubscribe = onServiceEvent(event => {
      if (event.type === 'telegram-state' || event.type === 'connected') refresh()
    })
    return () => { current = false; unsubscribe() }
  }, [refreshVersion])

  async function configure(action: string, enabled?: boolean) {
    setBusy(true)
    try {
      await api('/telegram', { action, enabled })
      setRefreshVersion(version => version + 1)
    }
    catch { setUnavailable(true) }
    finally { setBusy(false) }
  }

  const pairing = status?.pairing
  const candidate = pairing?.candidate
  const errors = [...new Set(Object.values(status?.errors || {}))]
  return <section>
    <h3>Telegram</h3>
    {!status?.paired && <p>{t('telegram.statusOff')}</p>}
    {status && !status.paired && !pairing && <>
      <p>{t('telegram.tokenPath')}</p><p className="settings-repo">{status.credentialPath}</p>
      <button className="desk-primary" disabled={busy} onClick={() => void configure('pair')}>{t('telegram.pair')}</button>
    </>}
    {pairing && <>
      {candidate ? <>
        <p>{t('telegram.approveHint')}</p>
        <p>{candidate.username ? '@' + candidate.username + ' · ' : ''}{candidate.id}</p>
        <button className="desk-primary" disabled={busy} onClick={() => void configure('approve')}>{t('telegram.approve')}</button>
      </> : <><p>{t('telegram.pairHint', { bot: pairing.bot })}</p><p className="settings-repo">{pairing.command}</p></>}
      <button className="desk-secondary" disabled={busy} onClick={() => void configure('cancel')}>{t('common.cancel')}</button>
    </>}
    {status?.paired && <>
      {(['alerts', 'inbound'] as const).map(channel => <label key={channel} className="setting-toggle">
        <span>{t(channel === 'alerts' ? 'telegram.alerts' : 'telegram.inbound')}
          <small>{t(channel === 'alerts' ? 'telegram.alertsHint' : 'telegram.inboundHint')}</small></span>
        <input type="checkbox" checked={status[channel]} disabled={busy} onChange={event => void configure(channel, event.target.checked)} />
      </label>)}
      {(status.alerts || status.inbound) && <p role="status">{t(status.connected ? 'telegram.ready' : 'telegram.checking')}</p>}
      <button className="desk-primary" disabled={busy} onClick={() => void configure('disconnect')}>{t('telegram.disconnect')}</button>
    </>}
    {unavailable && <p className="desk-error-inline" role="alert">{t('telegram.failure')}</p>}
    {errors.map(code => <p key={code} className="desk-error-inline" role="alert">{t(errorKeys[code] ?? 'telegram.failure')}</p>)}
  </section>
}
