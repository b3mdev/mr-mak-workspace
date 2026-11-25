import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { api, clientId, onServiceEvent, reportError, surface, useDesktop } from './client'
import { liveVoice } from './live'
import { Icon, ListeningEar, Nose } from './Icons'
import MakComposer from './MakComposer'
import MakImages from './MakImages'
import type { Operation } from './types'
import { localizeEffort, useT } from '../lib/i18n'

export default function VoiceDock() {
  const { lang, t, time, serviceMessage } = useT()
  const state = useDesktop()
  const live = useSyncExternalStore(liveVoice.subscribe, liveVoice.snapshot)
  const [panel, setPanel] = useState(false)
  const [tab, setTab] = useState<'conversation' | 'activity'>('conversation')
  const [sending, setSending] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const active = ['live', 'connecting', 'closing'].includes(live.status)
  const listening = live.status === 'live'
  const connecting = live.status === 'connecting'
  const closing = live.status === 'closing'
  const otherVoice = state.voice.owner && state.voice.owner.clientId !== clientId
  const otherSurface = state.voice.owner?.surface === 'workspace' ? t('voice.surfaceWorkspace') : state.voice.owner?.surface === 'chats' ? t('voice.surfaceChats') : (state.voice.owner?.surface || '')
  useEffect(() => onServiceEvent(event => {
    if (event.type === 'disconnected') liveVoice.disconnect()
    if (event.type === 'notice' && event.notice) liveVoice.announce(`Verified terminal event: ${event.notice.text}. This does not by itself confirm that the project task succeeded.`)
    if (['session', 'navigate', 'connected'].includes(event.type)) liveVoice.context()
  }), [])
  useEffect(() => { if (panel) bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [live.captions, state.operations, panel])
  const toggle = () => { if (active) liveVoice.stop(); else { setPanel(true); liveVoice.start() } }
  async function send(text: string, images: string[]) {
    setSending(true)
    try {
      const result = await api<Operation>('/coordinator', { id: crypto.randomUUID(), text, images, selectedId: state.selectedId })
      if (result.status !== 'completed') throw new Error(result.result || t('voice.requestFailed'))
    } finally { setSending(false) }
  }
  return <div className={`voice-dock ${surface} ${active ? 'is-live' : ''} ${listening ? 'is-listening' : ''} ${connecting ? 'is-connecting' : ''} ${closing ? 'is-closing' : ''} ${panel ? 'panel-open' : ''}`} data-voice-status={live.status}>
    <section className="voice-panel" hidden={!panel} style={{ display: panel ? undefined : 'none' }} aria-label={t('voice.panelAria')}><header><span><Nose size={24} /><strong>{t('brand.name')}</strong><small className={listening ? 'voice-status-listening' : ''}>{listening && <ListeningEar size={13} />}{live.status === 'live' ? t('voice.listening') : live.status === 'connecting' ? t('voice.connecting') : live.status === 'closing' ? t('voice.finishing') : state.coordinator === 'working' ? t('voice.working') : t('voice.atYourService')}</small></span><button className="desk-icon" title={t('voice.hidePanelTitle')} onClick={() => setPanel(false)}><Icon name="close" size={16} /></button></header><div className="voice-tabs"><button className={tab === 'conversation' ? 'selected' : ''} onClick={() => setTab('conversation')}>{t('voice.tabConversation')}</button><button className={tab === 'activity' ? 'selected' : ''} onClick={() => setTab('activity')}>{t('voice.tabActivity')}{state.notices.length > 0 && <span>{state.notices.length}</span>}</button></div><div className="voice-settings"><label>Codex<select aria-label={t('settings.coordinatorReasoning')} value={state.settings.coordinatorEffort || 'medium'} onChange={event => api('/settings', { coordinatorEffort: event.target.value }).catch(reportError)}><option value="medium">{localizeEffort(lang, 'medium')}</option><option value="high">{localizeEffort(lang, 'high')}</option></select></label><span>{t('voice.codexSubscription')}</span></div><div className="voice-messages" aria-live="polite">
      {tab === 'conversation' ? <>{live.captions.length === 0 && state.operations.length === 0 && <div className="voice-welcome"><p>{t('voice.welcomeLine1')}<br />{t('voice.welcomeLine2')}</p><span>{t('voice.welcomeEx1')}<br />{t('voice.welcomeEx2')}</span></div>}{state.operations.slice(-15).map(operation => <div key={operation.id} className="mak-exchange"><p className="caption user"><span>{t('common.you')}</span>{operation.text}</p>{!!operation.images?.length && <MakImages paths={operation.images} />}<p className={`caption assistant ${operation.status !== 'completed' ? 'failed' : ''}`}><span>{t('brand.name')}</span>{operation.result || t('voice.working')}</p></div>)}{!live.captions.length && state.voiceHistory.length > 0 && <details className="previous-voice"><summary>{t('voice.previousVoice')}</summary>{state.voiceHistory[state.voiceHistory.length - 1].captions.map((caption, index) => <p key={index} className={`caption ${caption.role}`}><span>{caption.role === 'user' ? t('common.you') : t('brand.name')}</span>{caption.text}</p>)}</details>}{live.captions.map((caption, index) => <p key={`${caption.start}-${index}`} className={`caption ${caption.role}`}><span>{caption.role === 'user' ? t('common.you') : t('brand.name')}</span>{caption.text}</p>)}{(sending || state.coordinator === 'working') && <p className="voice-working"><i /><i /><i />{t('voice.checkingWorkspace')}</p>}<div ref={bottom} /></> : <>{state.notices.length === 0 && <p className="desk-muted">{t('voice.activityEmpty')}</p>}{[...state.notices].reverse().map(notice => <button className="activity-item" key={notice.id} onClick={() => api(`/sessions/${notice.sessionId}/focus`, {}).catch(reportError)}><Icon name="bell" size={16} /><span><strong>{notice.name}</strong><small>{notice.text}</small></span><time>{time(notice.at)}</time></button>)}</>}
    </div>{live.error && <div className="voice-error" role="alert"><span>{serviceMessage(live.error)}</span><button className="desk-icon" aria-label={t('voice.dismissError')} onClick={() => liveVoice.dismissError()}><Icon name="close" size={14} /></button></div>}{!live.audible && <button className="desk-secondary" onClick={() => liveVoice.enablePlayback()}>{t('voice.enableSpeaker')}</button>}{otherVoice && <div className="voice-hint">{t('voice.activeElsewhere', { surface: otherSurface })}</div>}<MakComposer connected={state.connected} sending={sending} onSend={send} /></section>
    <div className="voice-controls"><button className="voice-nose" title={active ? t('voice.stopVoiceTitle') : t('voice.talkToBento')} aria-label={active ? t('voice.stopVoiceAria') : t('voice.startVoiceAria')} aria-pressed={active} onClick={toggle} disabled={!!otherVoice || !state.connected || live.status === 'closing'}><span className="voice-avatar"><Nose size={35} />{listening && <span className="voice-ear-badge" aria-hidden="true"><ListeningEar size={surface === 'chats' ? 14 : 15} /></span>}</span><span className="voice-label">{live.status === 'live' ? t('voice.listening') : live.status === 'connecting' ? t('voice.connectingShort') : live.status === 'closing' ? t('voice.finishingShort') : t('voice.talkToBento')}</span>{listening && <div className="voice-wave" aria-hidden="true"><i /><i /><i /><i /></div>}</button><button className={`voice-caption-toggle ${panel ? 'selected' : ''}`} title={panel ? t('voice.hideConversation') : t('voice.conversationAndActivity')} onClick={() => setPanel(value => !value)} aria-label={t('voice.toggleConversation')}><Icon name="chats" size={17} />{state.notices.some(notice => state.sessions.find(item => item.id === notice.sessionId)?.attention) && <i />}</button></div>
  </div>
}
