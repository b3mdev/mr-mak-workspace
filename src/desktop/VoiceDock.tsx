import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { api, applyCoordinatorConversation, clientId, desktopState, onServiceEvent, reportError, surface, useDesktop } from './client'
import { liveVoice } from './live'
import { Icon, ListeningEar, Nose } from './Icons'
import CoordinatorContext from './CoordinatorContext'
import MakComposer from './MakComposer'
import MakImages from './MakImages'
import type { BentoNotification, Operation, ServiceEvent } from './types'
import { localizeEffort, useT } from '../lib/i18n'

type ConversationAction = 'stop' | 'reset' | 'new'
const actionLabels = {
  stop: { label: 'voice.stopRequest', hint: 'voice.stopRequestHint', feedback: 'voice.requestStopped' },
  reset: { label: 'voice.resetContext', hint: 'voice.resetContextHint', feedback: 'voice.contextReset' },
  new: { label: 'voice.newConversation', hint: 'voice.newConversationHint', feedback: 'voice.conversationStarted' },
} as const

export default function VoiceDock() {
  const { lang, t, time, serviceMessage } = useT()
  const state = useDesktop()
  const live = useSyncExternalStore(liveVoice.subscribe, liveVoice.snapshot)
  const [panel, setPanel] = useState(false)
  const [tab, setTab] = useState<'conversation' | 'notifications' | 'context'>('conversation')
  const [sending, setSending] = useState(false)
  const [controlling, setControlling] = useState(false)
  const [feedback, setFeedback] = useState<ConversationAction | null>(null)
  const [controlError, setControlError] = useState('')
  const pending = useRef<{ controller: AbortController; revision: number } | null>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const focusAfterReview = useRef(false)
  const { conversationId, contextRevision } = state.coordinatorConversation
  const previousVoice = state.voiceHistory[state.voiceHistory.length - 1]
  const active = ['live', 'connecting', 'closing'].includes(live.status)
  const listening = live.status === 'live'
  const connecting = live.status === 'connecting'
  const closing = live.status === 'closing'
  const working = sending || ['working', 'connecting'].includes(state.coordinator)
  const otherVoice = state.voice.owner && state.voice.owner.clientId !== clientId
  const otherSurface = state.voice.owner?.surface === 'chats' ? t('voice.surfaceChats') : t('voice.surfaceWorkspace')
  const status = listening ? t('voice.listening') : connecting ? t('voice.connecting') : closing ? t('voice.finishing')
    : working ? t('voice.working') : state.coordinator === 'offline' ? t('voice.coordinatorOffline') : t('voice.atYourService')

  useEffect(() => onServiceEvent(event => {
    if (event.type === 'disconnected') liveVoice.disconnect()
    if (event.type === 'coordinator-stopped') pending.current?.controller.abort()
    if (['session', 'selection', 'connected'].includes(event.type)) liveVoice.context()
  }), [])
  useEffect(() => {
    liveVoice.syncConversation(state.coordinatorConversation)
    if (pending.current && pending.current.revision !== contextRevision) pending.current.controller.abort()
  }, [state.coordinatorConversation, contextRevision])
  useEffect(() => {
    if (panel && tab === 'conversation') bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [live.captions, state.operations, panel, tab])

  useEffect(() => {
    if (focusAfterReview.current && panel && tab === 'conversation' && !sending) {
      focusAfterReview.current = false
      composer.current?.focus()
    }
  }, [panel, tab, sending])

  function toggle() {
    if (active) liveVoice.stop()
    else { setPanel(true); setTab('conversation'); void liveVoice.start() }
  }
  async function send(text: string, images: string[], itemId?: string) {
    const controller = new AbortController()
    pending.current = { controller, revision: contextRevision }
    setSending(true); setFeedback(null)
    try {
      const result = await api<Operation>(itemId ? '/notifications/review' : '/coordinator', { id: crypto.randomUUID(), text, images, itemId, selectedId: state.selectedId, contextRevision }, undefined, { signal: controller.signal })
      if (result.status !== 'completed') throw new Error(result.result || t('voice.requestFailed'))
    } finally {
      if (pending.current?.controller === controller) { pending.current = null; setSending(false) }
    }
  }
  async function review(item: BentoNotification) {
    focusAfterReview.current = true
    setTab('conversation'); setControlError('')
    try { await send(t('notifications.review', { number: item.ref }), [], item.id) }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setControlError(String(error instanceof Error ? error.message : error)) }
  }
  async function control(action: ConversationAction) {
    setControlling(true); setControlError(''); setFeedback(null)
    try {
      const snapshot = await api<ServiceEvent>('/coordinator/conversation', { action, contextRevision })
      applyCoordinatorConversation(snapshot)
      liveVoice.syncConversation(desktopState().coordinatorConversation)
      pending.current?.controller.abort()
      setTab('conversation')
      setFeedback(action)
    } catch (error) { setControlError(error instanceof Error ? error.message : String(error)) }
    finally { setControlling(false) }
  }

  return <div className={`voice-dock ${surface} ${active ? 'is-live' : ''} ${listening ? 'is-listening' : ''} ${connecting ? 'is-connecting' : ''} ${closing ? 'is-closing' : ''} ${panel ? 'panel-open' : ''}`} data-voice-status={live.status}>
    <section className="voice-panel" hidden={!panel} aria-label={t('voice.panelAria')}>
      <header>
        <span><Nose size={24} /><strong>{t('brand.name')}</strong><small className={listening ? 'voice-status-listening' : ''}>{listening && <ListeningEar size={13} />}{status}</small></span>
        <button className="desk-icon" title={t('voice.hidePanelTitle')} aria-label={t('voice.hidePanelTitle')} onClick={() => setPanel(false)}><Icon name="close" size={16} /></button>
      </header>
      <div className="voice-tabs">
        <button className={tab === 'conversation' ? 'selected' : ''} aria-pressed={tab === 'conversation'} onClick={() => setTab('conversation')}>{t('voice.tabConversation')}</button>
        <button className={tab === 'context' ? 'selected' : ''} aria-pressed={tab === 'context'} onClick={() => setTab('context')}>{t('voice.tabContext')}</button>
        <button className={tab === 'notifications' ? 'selected' : ''} aria-pressed={tab === 'notifications'} onClick={() => setTab('notifications')}>{t('notifications.title')}{state.notifications.length > 0 && <span>{state.notifications.length}</span>}</button>
      </div>
      <div className="coordinator-actions">
        {(['new', 'reset', ...(working ? ['stop'] as const : [])] as const).map(action =>
          <button className="desk-secondary" key={action} title={t(actionLabels[action].hint)} disabled={!state.connected || controlling} onClick={() => void control(action)}>{t(actionLabels[action].label)}</button>)}
      </div>
      <div className="voice-settings">
        <label>Codex<select aria-label={t('settings.coordinatorReasoning')} value={state.settings.coordinatorEffort || 'medium'} onChange={event => api('/settings', { coordinatorEffort: event.target.value }).catch(reportError)}>
          <option value="medium">{localizeEffort(lang, 'medium')}</option><option value="high">{localizeEffort(lang, 'high')}</option>
        </select></label><span>{t('voice.codexSubscription')}</span>
      </div>
      {feedback && <p className="coordinator-feedback" role="status">{t(actionLabels[feedback].feedback)}</p>}
      {controlError && <div className="voice-error" role="alert"><span>{serviceMessage(controlError)}</span><button className="desk-icon" aria-label={t('voice.dismissError')} onClick={() => setControlError('')}><Icon name="close" size={14} /></button></div>}
      <div className="voice-messages" aria-live={tab === 'conversation' ? 'polite' : undefined}>
        {tab === 'context' && panel && <CoordinatorContext />}
        {tab === 'conversation' && <>
          {live.captions.length === 0 && state.operations.length === 0 && <div className="voice-welcome">
            <p>{t('voice.welcomeLine1')}<br />{t('voice.welcomeLine2')}</p><span>{t('voice.welcomeEx1')}<br />{t('voice.welcomeEx2')}</span>
          </div>}
          {state.operations.slice(-15).map(operation => <div key={operation.id} className="mak-exchange">
            <p className="caption user"><span>{t('common.you')}</span>{operation.text}</p>
            {!!operation.images?.length && <MakImages paths={operation.images} />}
            <p className={`caption assistant ${operation.status !== 'completed' ? 'failed' : ''}`}><span>{t('brand.name')}</span>{operation.result ? serviceMessage(operation.result) : t('voice.working')}</p>
            {operation.notificationDetail && <blockquote className="notification-detail"><small>{t('notifications.origin')}</small><span>{operation.notificationDetail}</span></blockquote>}
          </div>)}
          {!live.captions.length && previousVoice && <details className="previous-voice"><summary>{t('voice.previousVoice')}</summary>{previousVoice.captions.map((caption, index) =>
            <p key={index} className={`caption ${caption.role}`}><span>{caption.role === 'user' ? t('common.you') : t('brand.name')}</span>{caption.text}</p>)}</details>}
          {live.captions.map((caption, index) => <p key={`${caption.start}-${index}`} className={`caption ${caption.role}`}><span>{caption.role === 'user' ? t('common.you') : t('brand.name')}</span>{caption.text}</p>)}
          {working && <p className="voice-working"><i /><i /><i />{t('voice.checkingWorkspace')}</p>}
          <div ref={bottom} />
        </>}
        {tab === 'notifications' && <section aria-label={t('notifications.title')}>
          <p className="notification-hint">{t('notifications.hint')}</p>
          {state.notifications.length === 0 && <p className="desk-muted">{t('notifications.empty')}</p>}
          <ul className="notification-list">
            {state.notifications.map(item => <li key={item.id}>
              <button className="activity-item" disabled={!state.connected || sending || controlling} onClick={() => void review(item)}>
                <Icon name="bell" size={16} />
                <span><strong>{item.ref}. {item.title || t('notifications.untitled')}</strong><small>{item.app} · {t(`notifications.${item.kind}`)}</small></span>
                {item.at && <time dateTime={item.at}>{time(item.at)}</time>}
              </button>
            </li>)}
          </ul>
          {!!state.notices.length && <details className="notification-recent"><summary>{t('voice.tabActivity')}</summary>
            {[...state.notices].reverse().map(notice => <button className="activity-item" key={notice.id} onClick={() => api(`/sessions/${notice.sessionId}/focus`, {}).catch(reportError)}>
              <Icon name="bell" size={16} /><span><strong>{notice.name}</strong><small>{notice.text}</small></span><time>{time(notice.at)}</time>
            </button>)}
          </details>}
        </section>}
      </div>
      {live.error && <div className="voice-error" role="alert"><span>{serviceMessage(live.error)}</span><button className="desk-icon" aria-label={t('voice.dismissError')} onClick={() => liveVoice.dismissError()}><Icon name="close" size={14} /></button></div>}
      {!live.audible && <button className="desk-secondary" onClick={() => liveVoice.enablePlayback()}>{t('voice.enableSpeaker')}</button>}
      {otherVoice && <div className="voice-hint">{t('voice.activeElsewhere', { surface: otherSurface })}</div>}
      <div hidden={tab !== 'conversation'}><MakComposer key={conversationId} connected={state.connected} sending={sending || controlling} onSend={send} inputRef={composer} /></div>
    </section>
    <div className="voice-controls">
      <button className="voice-nose" title={active ? t('voice.stopVoiceTitle') : t('voice.talkToBento')} aria-label={active ? t('voice.stopVoiceAria') : t('voice.startVoiceAria')} aria-pressed={active} onClick={toggle} disabled={!!otherVoice || !state.connected || controlling || closing}>
        <span className="voice-avatar"><Nose size={35} />{listening && <span className="voice-ear-badge" aria-hidden="true"><ListeningEar size={surface === 'chats' ? 14 : 15} /></span>}</span>
        <span className="voice-label">{listening ? t('voice.listening') : connecting ? t('voice.connectingShort') : closing ? t('voice.finishingShort') : t('voice.talkToBento')}</span>
        {listening && <div className="voice-wave" aria-hidden="true"><i /><i /><i /><i /></div>}
      </button>
      <button className={`voice-caption-toggle ${panel ? 'selected' : ''}`} title={panel ? t('voice.hideConversation') : t('voice.conversationAndActivity')} onClick={() => setPanel(value => !value)} aria-label={t('voice.toggleConversation')} aria-description={state.notifications.length ? t('notifications.badge', { count: state.notifications.length }) : undefined}><Icon name="chats" size={17} />{state.notifications.length > 0 && <span className="voice-notification-count" aria-hidden="true">{state.notifications.length > 99 ? '99+' : state.notifications.length}</span>}</button>
    </div>
  </div>
}
