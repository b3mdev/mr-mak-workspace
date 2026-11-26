import { useEffect, useState } from 'react'
import { api, reportError } from './client'
import { Icon } from './Icons'
import TailscaleHttpsLink from './TailscaleHttpsLink'
import { needsTailscaleHttps } from './tailscale-setup'
import NetworkBoard, { type NetworkSnapshot } from '../components/NetworkBoard'
import { useNetwork } from '../components/useNetwork'
import { useT } from '../lib/i18n'

const load = () => api<NetworkSnapshot>('/network')
type Invitation = { url: string; expires: number }

export default function NetworkPanel({ onClose }: { onClose: () => void }) {
  const { t, serviceMessage } = useT()
  const board = useNetwork(load)
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [actionError, setActionError] = useState('')
  const [httpsError, setHttpsError] = useState(false)
  useEffect(() => {
    if (!invitation) return
    const timer = window.setTimeout(() => setInvitation(null), Math.max(0, invitation.expires - Date.now()))
    return () => window.clearTimeout(timer)
  }, [invitation])
  const change = async (work: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true); setActionError(''); setMessage(''); setHttpsError(false)
    try { await work(); board.refresh() }
    catch (error) { setActionError(error instanceof Error ? error.message : String(error)); setHttpsError(needsTailscaleHttps(error)) }
    finally { setBusy(false) }
  }
  const generate = () => change(async () => {
    if (!board.value?.mobileEnabled) await api('/mobile/enable', {})
    setInvitation(await api<Invitation>('/network/invite', {}))
    setMessage(t('network.inviteCreated'))
  })
  const join = () => change(async () => {
    await api('/network/join', { invitation: code })
    setCode(''); setInvitation(null); setMessage(t('network.computerConnected'))
  })
  const disconnect = () => change(async () => {
    await api('/network/disconnect', {}); setMessage(t('network.sharingStopped'))
  })
  const remove = (id: string) => void change(() => api('/network/revoke', { id }))
  const hub = board.value?.hub
  const hasComputers = (board.value?.computers.length ?? 0) > 1

  return <div className="files-panel desktop-network"><header><h2>{t('network.title')}</h2><button type="button" className="desk-icon" aria-label={t('network.closeAria')} onClick={onClose}><Icon name="close" size={17} /></button></header>
    <div className="settings-scroll">
      {board.value && <section className="network-settings"><h3>{t('network.connectionsHeading')}</h3>
        {hub ? <><p className="network-message">{t('network.hubStatus')} <strong>{hub.name}</strong> · {hub.online ? t('network.hubConnected') : t('network.hubDisconnected')}</p><button type="button" className="desk-secondary" disabled={busy} onClick={() => void disconnect()}>{t('network.disconnectHub')}</button></> : <>
          <p>{t('network.intro')}</p>
          <div>
            <button type="button" className="desk-secondary" disabled={busy} onClick={() => void generate()}>{board.value.mobileEnabled ? t('network.generateInvite') : t('network.enableAndInvite')}</button>
            {invitation && <><label>{t('network.inviteLabel')}<input readOnly value={invitation.url} onFocus={event => event.currentTarget.select()} /></label><button type="button" className="desk-secondary" onClick={() => navigator.clipboard.writeText(invitation.url).then(() => setMessage(t('network.inviteCopied'))).catch(() => setActionError(t('network.copyInviteFallback')))}>{t('network.copyInvite')}</button><p>{t('network.inviteExpiryHint')}</p></>}
          </div>
          {!hasComputers && <form onSubmit={event => { event.preventDefault(); void join() }}><label>{t('network.receivedInviteLabel')}<input value={code} onChange={event => setCode(event.target.value)} placeholder={t('network.receivedInvitePlaceholder')} autoComplete="off" maxLength={450} /></label><button type="submit" className="desk-secondary" disabled={busy || !code.trim()}>{t('network.connectHub')}</button></form>}
          <p>{t('network.mobileHint')}</p>
        </>}
        {message && <p role="status">{message}</p>}{actionError && <p className="desk-error-inline" role="alert">{serviceMessage(actionError)}</p>}{httpsError && <TailscaleHttpsLink />}
      </section>}
      <section><h3>{t('network.tasksHeading')}</h3><NetworkBoard {...board} openTask={id => { void api(`/sessions/${encodeURIComponent(id)}/focus`, {}).catch(reportError) }} removeComputer={hub || busy ? undefined : remove} /></section>
    </div>
  </div>
}
