import { useEffect, useState } from 'react'
import { Icon } from '../desktop/Icons'
import { mobileApi, muteMobileChat, useMobile } from './client'
import { useT } from '../lib/i18n'

interface PushStatus { publicKey: string; enabled: boolean }

// The push service takes the key as raw bytes; Bento Workspace sends it as base64url.
const keyBytes = (key: string) => Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(key.length / 4) * 4, '=')), char => char.charCodeAt(0))
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

// Notifications when a chat waits for you. iPhone offers them only to the installed app.
export default function NotificationSettings({ disabled }: { disabled: boolean }) {
  const { t, serviceMessage } = useT()
  const [info, setInfo] = useState<PushStatus | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [readFailed, setReadFailed] = useState(false)
  useEffect(() => {
    if (!supported()) return
    let active = true
    void (async () => {
      const value = await mobileApi<PushStatus>('/push')
      // This browser may have dropped its subscription while the computer still had it.
      const local = await (await navigator.serviceWorker.ready).pushManager.getSubscription()
      if (active) { setInfo({ publicKey: value.publicKey, enabled: value.enabled && !!local }); setReadFailed(false) }
    })().catch(() => { if (active) setReadFailed(true) })
    return () => { active = false }
  }, [])
  async function toggle() {
    if (!info) return
    setBusy(true); setError(''); setReadFailed(false)
    try {
      const registration = await navigator.serviceWorker.ready
      const current = await registration.pushManager.getSubscription()
      if (info.enabled) {
        await current?.unsubscribe()
        const value = await mobileApi<PushStatus>('/push', { subscription: null })
        setInfo({ publicKey: value.publicKey, enabled: value.enabled })
      } else {
        if (await Notification.requestPermission() !== 'granted') { setError(t('notif.allowInBrowser')); return }
        const subscription = current || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(info.publicKey) })
        const value = await mobileApi<PushStatus>('/push', { subscription: subscription.toJSON() })
        setInfo({ publicKey: value.publicKey, enabled: value.enabled })
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  const errorText = error ? serviceMessage(error) : readFailed ? t('notif.readError') : ''
  return <fieldset className="mobile-reading-settings"><legend>{t('notif.legend')}</legend>
    {!supported() ? <p>{t('notif.iphoneHint')}</p>
      : <><p>{info?.enabled ? t('notif.enabledDesc') : t('notif.disabledDesc')}</p><button onClick={() => void toggle()} disabled={disabled || busy || !info}>{info?.enabled ? t('notif.turnOff') : t('notif.turnOn')}</button></>}
    {errorText && <p role="alert">{errorText}</p>}
  </fieldset>
}

// The bell beside a chat's views: a muted chat sends no notification to any paired phone.
export function MuteChat({ id, onError }: { id: string; onError: (message: string) => void }) {
  const { t } = useT()
  const state = useMobile(), muted = !!state.mutedChats?.includes(id), [busy, setBusy] = useState(false)
  async function toggle() {
    setBusy(true)
    try { await muteMobileChat(id, !muted); onError('') }
    catch (failure) { onError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  return <button type="button" className={`mobile-icon mobile-chat-mute ${muted ? 'muted' : ''}`} aria-label={t('notif.muteAria')} aria-pressed={muted} title={muted ? t('notif.mutedTitle') : t('notif.unmutedTitle')} disabled={!state.connected || busy} onClick={() => void toggle()}><Icon name={muted ? 'bell-off' : 'bell'} size={17} /></button>
}
