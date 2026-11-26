import { useEffect, useState } from 'react'
import { api, onServiceEvent, useDesktop } from './client'
import { Icon } from './Icons'
import TailscaleHttpsLink from './TailscaleHttpsLink'
import { needsTailscaleHttps } from './tailscale-setup'
import './mobile-access.css'
import DictationSettings from '../components/DictationSettings'
import { useDictation } from './useDictation'
import { useT } from '../lib/i18n'

interface MobileState {
  enabled: boolean; origin: string; error: string; errorCode?: string
  devices: { id: string; name: string; connected: boolean; lastSeen: string | null }[]
  pending: { id: string; name: string; code: string; expires: number }[]
}
interface Pairing { url: string; code: string; expires: number; qr: string }

export default function MobileAccess() {
  const { t, dateTime, serviceMessage } = useT()
  const desktop = useDesktop()
  const dictation = useDictation()
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<MobileState | null>(null)
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [httpsError, setHttpsError] = useState(false)
  const [probe, setProbe] = useState<{ ready: boolean; message: string; code?: string } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!desktop.connected) return
    const load = () => api<MobileState>('/mobile').then(setState).catch(() => {})
    void load()
    return onServiceEvent(event => { if (event.type === 'mobile-state') void load() })
  }, [desktop.connected])
  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', escape)
    return () => { clearInterval(timer); window.removeEventListener('keydown', escape) }
  }, [open])
  async function action(route: string, data = {}) {
    setBusy(true); setError(''); setHttpsError(false)
    try { setState(await api<MobileState>(`/mobile/${route}`, data)); if (route === 'disable' || route === 'approve') setPairing(null) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); setHttpsError(needsTailscaleHttps(err)) }
    finally { setBusy(false) }
  }
  async function pair() {
    setBusy(true); setError(''); setHttpsError(false)
    try {
      if (!state?.enabled) setState(await api<MobileState>('/mobile/enable', {}))
      setPairing(await api<Pairing>('/mobile/pair', {})); setNow(Date.now())
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); setHttpsError(needsTailscaleHttps(err)) }
    finally { setBusy(false) }
  }
  const connected = state?.devices.filter(device => device.connected).length || 0
  const waiting = (state?.pending || []).filter(item => item.expires > now)
  const buttonTitle = connected
    ? t(connected === 1 ? 'mobileAccess.titleConnected' : 'mobileAccess.titleConnectedMany', { count: connected })
    : waiting.length ? t('mobileAccess.titleApprove') : t('mobileAccess.titleConnect')
  return <>
    <button className={`desk-icon mobile-access-button ${connected || waiting.length ? 'active' : ''}`} aria-label={t('mobileAccess.aria')} title={buttonTitle} onClick={() => setOpen(true)}><Icon name="phone" size={18} />{(connected > 0 || waiting.length > 0) && <i className={waiting.length ? 'pending' : ''} />}</button>
    {open && <div className="desk-scrim" onClick={() => setOpen(false)}><section className="desk-dialog mobile-access-dialog" role="dialog" aria-modal="true" aria-label={t('mobileAccess.aria')} onClick={event => event.stopPropagation()}>
      <div className="desk-dialog-heading"><div><span className="desk-eyebrow">{t('mobileAccess.eyebrow')}</span><h2>{t('mobileAccess.heading')}</h2></div><button className="desk-icon" aria-label={t('mobileAccess.closeAria')} onClick={() => setOpen(false)}><Icon name="close" /></button></div>
      <p className="mobile-access-intro">{t('mobileAccess.intro')}</p>
      <div className="mobile-access-status"><span className={state?.enabled ? 'online' : ''} />{connected ? t(connected === 1 ? 'mobileAccess.phonesConnectedOne' : 'mobileAccess.phonesConnectedMany', { count: connected }) : state?.enabled ? t('mobileAccess.readyForPhone') : t('mobileAccess.off')}</div>
      {waiting.map(item => <div className="mobile-pair-request" key={item.id}><strong>{t('mobileAccess.wantsToConnect', { name: item.name })}</strong><p>{t('mobileAccess.matchCodeHint')}</p><code>{item.code}</code><div><button className="desk-primary" disabled={busy} onClick={() => action('approve', { id: item.id })}>{t('mobileAccess.connectPhone')}</button><button disabled={busy} onClick={() => action('revoke', { id: item.id })}>{t('mobileAccess.decline')}</button></div></div>)}
      {pairing && pairing.expires > now && !waiting.length && <div className="mobile-qr"><img src={pairing.qr} alt={t('mobileAccess.qrAlt')} width="224" height="224" /><strong>{t('mobileAccess.scanPrompt')}</strong><span>{t('mobileAccess.orEnterCodePrefix')}<b>{pairing.code}</b>{t('mobileAccess.orEnterCodeSuffix')}</span><p>{t('mobileAccess.expiresIn', { minutes: Math.ceil((pairing.expires - now) / 60000) })}</p><button onClick={() => navigator.clipboard.writeText(pairing.url).catch(() => setError(t('mobileAccess.copyLinkFailed')))}>{t('mobileAccess.copyLink')}</button></div>}
      {!waiting.length && <button className="desk-primary" onClick={pair} disabled={busy || !desktop.connected}><Icon name="phone" size={17} />{busy ? t('mobileAccess.preparing') : pairing && pairing.expires <= now ? t('mobileAccess.newQr') : state?.enabled ? t('mobileAccess.connectAnother') : t('mobileAccess.enableAndQr')}</button>}
      {(error || state?.error) && <div className="desk-error-inline" role="alert">{serviceMessage(error || state?.error || '')}<button aria-label={t('mobileAccess.dismissError')} onClick={() => { setError(''); setHttpsError(false); setState(current => current && { ...current, error: '', errorCode: undefined }) }}><Icon name="close" size={14} /></button></div>}
      {(httpsError || needsTailscaleHttps(state?.errorCode) || needsTailscaleHttps(probe?.code)) && <TailscaleHttpsLink />}
      {!!state?.devices.length && <div className="mobile-device-list"><h3>{t('mobileAccess.yourDevices')}</h3>{state.devices.map(device => <div key={device.id}><Icon name="phone" /><span><strong>{device.name}</strong><small>{device.connected ? t('mobileAccess.connectedNow') : device.lastSeen ? t('mobileAccess.lastConnected', { time: dateTime(device.lastSeen) }) : t('mobileAccess.pairedWaiting')}</small></span><button disabled={busy} onClick={() => action('revoke', { id: device.id })}>{t('mobileAccess.disconnect')}</button></div>)}</div>}
      <details className="mobile-setup" open={!state?.enabled}><summary>{t('mobileAccess.firstConnection')}</summary><ol><li>{t('mobileAccess.step1Prefix')}<a href="https://tailscale.com/download" target="_blank" rel="noreferrer">Tailscale</a>{t('mobileAccess.step1Suffix')}</li><li>{t('mobileAccess.step2')}</li><li>{t('mobileAccess.step3')}</li><li>{t('mobileAccess.step4')}</li></ol><p>{t('mobileAccess.serveSetupPrefix')}<a href="https://tailscale.com/docs/features/tailscale-serve" target="_blank" rel="noreferrer">{t('mobileAccess.serveSetupLink')}</a>{t('mobileAccess.serveSetupSuffix')}</p><button disabled={busy} onClick={async () => { setBusy(true); try { setProbe(await api('/mobile/check')) } catch { setError(t('mobileAccess.checkTailscaleError')) } finally { setBusy(false) } }}>{t('mobileAccess.checkTailscale')}</button>{probe && <p role="status">{probe.ready ? t('mobileAccess.tailscaleReady') : serviceMessage(probe.message)}</p>}</details>
      <DictationSettings info={dictation.info} onChange={dictation.choose} disabled={!desktop.connected} />
      <footer className="mobile-access-footer"><span>{t('mobileAccess.footerNote')}</span>{state?.enabled && <button disabled={busy} onClick={() => action('disable')}>{t('mobileAccess.turnOff')}</button>}</footer>
    </section></div>}
  </>
}
