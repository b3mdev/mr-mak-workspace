import { lazy, Suspense, useEffect } from 'react'
import App from '../App'
import { dismissError, sendEvent, startDesktop, surface, useDesktop } from './client'
import FilesRail, { FilePreview } from './FilesRail'
import VoiceDock from './VoiceDock'
import { Icon } from './Icons'
import MakLogo from '../components/MakLogo'
import { useT } from '../lib/i18n'
import './desktop.css'

const Chats = lazy(() => import('./Chats'))

export default function DesktopApp() {
  const { t, serviceMessage } = useT()
  const state = useDesktop()
  useEffect(() => {
    startDesktop()
    if (surface === 'chats') {
      document.querySelector('link[rel="icon"]')?.setAttribute('href', '/assets/bento-chats-32.png')
    }
  }, [])
  useEffect(() => {
    if (surface !== 'workspace' || !state.connected) return
    const route = () => sendEvent({ type: 'workspace-route', route: location.hash })
    route()
    window.addEventListener('hashchange', route)
    return () => window.removeEventListener('hashchange', route)
  }, [state.connected])
  const errorText = state.error ? serviceMessage(state.error) : null
  if (!state.ready) return <div className="desktop-boot"><MakLogo size={70} variant={surface} /><h1>{t('brand.name')}</h1><p>{errorText || t('desktop.openingWorkspace')}</p>{errorText && <button className="desk-secondary" onClick={() => startDesktop()}>{t('common.reconnect')}</button>}</div>
  return <div className={`desktop-root ${surface}-root`}>
    {surface === 'chats' ? <Suspense fallback={<div className="desktop-boot"><MakLogo size={50} variant="chats" /></div>}><Chats /></Suspense> : <><div className="workspace-surface"><App />{state.preview && <FilePreview file={state.preview} />}</div><FilesRail /></>}
    {errorText && <div className="desktop-error" role="alert"><span>{errorText}</span><button onClick={dismissError} aria-label={t('desktop.dismissError')}><Icon name="close" size={16} /></button></div>}
    {!state.connected && <div className="desktop-offline">{t('desktop.reconnectingService')}</div>}
    <VoiceDock />
  </div>
}
