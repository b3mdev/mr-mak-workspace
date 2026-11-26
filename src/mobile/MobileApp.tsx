import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AgentLogo, Icon, Nose } from '../desktop/Icons'
import SystemEvent, { type SystemEventData } from './SystemEvent'
import type { ChatSession, RecentProject } from '../desktop/types'
import { chatActivityLabel } from '../desktop/chatActivity'
import { chooseMobileDictation, disconnectMobile, mobileApi, mobileEvent, reconnectMobile, onMobileEvent, selectMobileChat, startMobile, useMobile } from './client'
import { installMobileBack, mobileChatPosition, saveMobileChatPosition, setMobileHistory, setMobileView, useMobileNavigation } from './app-state'
import Terminal from './Terminal'
import Composer from './Composer'
import ConversationImages from './ConversationImages'
import { spokenText, useReadAloud } from './useReadAloud'
import ReadingVoiceSettings from './ReadingVoiceSettings'
import DictationSettings from '../components/DictationSettings'
import LanguagePicker, { LanguageToggle } from '../components/LanguagePicker'
import Results from './Results'
import NetworkView from './NetworkView'
import ActivityStatus from './ActivityStatus'
import BackgroundWork, { type BackgroundCommand, type WorkingAgent } from './BackgroundWork'
import { useInstall } from './useInstall'
import NotificationSettings, { MuteChat } from './NotificationSettings'
import { visibleUserMessage } from './workspace-context'
import TerminalPrompt, { type PromptChoice, type TerminalPromptData } from '../components/TerminalPrompt'
import { useT, type MessageKey } from '../lib/i18n'
import './mobile.css'

const toolStatusKeys: Record<'running' | 'completed' | 'failed', MessageKey> = {
  running: 'conv.toolStatus.running',
  completed: 'conv.toolStatus.completed',
  failed: 'conv.toolStatus.failed',
}

interface Pending { id: string; claim: string; code: string }
interface ToolActivity { id: string; name: string; status: 'running' | 'completed' | 'failed'; at: string }
interface Message { id: string; role: 'user' | 'assistant' | 'system'; event?: SystemEventData; text: string; at: string; images?: { url?: string; name: string; unavailable?: boolean; kind?: 'image' | 'video'; type?: string }[] }
function getPairToken() {
  const token = new URLSearchParams(location.hash.slice(1)).get('pair')
  if (token) { sessionStorage.setItem('mrmak.mobile.pair', token); history.replaceState(null, '', location.pathname) }
  return sessionStorage.getItem('mrmak.mobile.pair') || ''
}
function Connect() {
  const { t, serviceMessage } = useT()
  const state = useMobile()
  const [pairToken, setPairToken] = useState(getPairToken)
  const [name, setName] = useState(() => t('mobile.defaultPhoneName')), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [code, setCode] = useState('')
  const [pending, setPending] = useState<Pending | null>(() => { try { return JSON.parse(sessionStorage.getItem('mrmak.mobile.pending') || 'null') } catch { return null } })
  useEffect(() => {
    if (!pending) return
    let stopped = false, working = false
    const poll = async () => {
      if (working || document.visibilityState === 'hidden') return
      working = true
      try {
        const result = await mobileApi<{ status: string }>('/pair/finish', pending)
        if (stopped) return
        if (result.status === 'connected') { sessionStorage.removeItem('mrmak.mobile.pending'); sessionStorage.removeItem('mrmak.mobile.pair'); setPairToken(''); setPending(null); void startMobile() }
      } catch (err) { if (!stopped) setError(err instanceof Error ? err.message : String(err)) }
      finally { working = false }
    }
    void poll(); const timer = window.setInterval(poll, 2500)
    return () => { stopped = true; clearInterval(timer) }
  }, [pending])
  async function connect(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { const result = await mobileApi<Pending>('/pair', { token: pairToken || code.replace(/\s/g, ''), name }); sessionStorage.setItem('mrmak.mobile.pending', JSON.stringify(result)); setPending(result) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }
  return <main className="mobile-connect"><div className="mobile-connect-lang"><LanguageToggle /></div><Nose size={64} /><span className="mobile-eyebrow">{t('mobile.eyebrow')}</span><h1>{t('brand.name')}<br /><span>{t('mobile.onYourPhone')}</span></h1>
    {pending ? <div className="mobile-connect-card"><Icon name="phone" size={28} /><h2>{t('mobile.confirmComputer')}</h2><p>{t('mobile.confirmComputerBody')}</p><code className="mobile-pair-code">{pending.code}</code><span className="mobile-waiting">{t('mobile.waitingConfirmation')}</span><button onClick={() => { sessionStorage.removeItem('mrmak.mobile.pending'); setPending(null); setError(t('mobile.scanNewQrRetry')) }}>{t('common.cancel')}</button></div>
    : pairToken ? <form className="mobile-connect-card" onSubmit={connect}><h2>{t('mobile.connectThisPhone')}</h2><p>{t('mobile.stayOnComputer')}</p><label>{t('mobile.deviceName')}<input autoComplete="off" maxLength={60} value={name} onChange={event => setName(event.target.value)} /></label><button className="mobile-primary" disabled={busy}>{busy ? t('mobile.connecting') : t('mobile.requestConnection')}<Icon name="arrow" size={17} /></button></form>
    : <form className="mobile-connect-card" onSubmit={connect}><h2>{t('mobile.startInChats')}</h2><p>{t('mobile.startInChatsBody')}</p><label>{t('mobile.connectionCode')}<input inputMode="numeric" autoComplete="off" maxLength={8} value={code} onChange={event => setCode(event.target.value.replace(/[^0-9]/g, ''))} placeholder={t('mobile.eightDigits')} /></label><button className="mobile-primary" disabled={busy || code.length !== 8}>{t('mobile.requestConnection')}<Icon name="arrow" size={17} /></button><button type="button" onClick={() => void startMobile()}>{t('mobile.checkExisting')}</button></form>}
    {(error || state.error) && <p className="mobile-error" role="alert">{serviceMessage(error || state.error)}</p>}<p className="mobile-connect-foot">{t('mobile.connectFootLine1')}<br />{t('mobile.connectFootLine2')}</p>
  </main>
}

function Conversation({ session, active }: { session: ChatSession; active: boolean }) {
  const { t, time, serviceMessage } = useT()
  const speech = useReadAloud(session.id), stopReading = speech.stop
  const [mode, setMode] = useState<'messages' | 'terminal'>(() => mobileChatPosition(session.id).mode || (['codex', 'claude', 'antigravity', 'opencode'].includes(session.agent) ? 'messages' : 'terminal'))
  useEffect(() => saveMobileChatPosition(session.id, { mode }), [session.id, mode])
  useEffect(() => { if (mode === 'terminal' || !active) stopReading() }, [mode, active, stopReading])
  const [messages, setMessages] = useState<Message[]>([]), [supported, setSupported] = useState(true), [error, setError] = useState('')
  let readStart = 0
  for (let index = 0; index < messages.length; index++) if (messages[index].role === 'user') readStart = index
  const readEnd = messages.length - 1, latestUserId = messages[readStart]?.role === 'user' ? messages[readStart].id : null
  useEffect(() => () => stopReading(), [latestUserId, stopReading])
  const [initialPosition] = useState(() => mobileChatPosition(session.id))
  const scroller = useRef<HTMLDivElement>(null), restored = useRef(false), follow = useRef(initialPosition.follow !== false), state = useMobile()
  const [activity, setActivity] = useState<ToolActivity[]>([]), [background, setBackground] = useState<{ agents?: WorkingAgent[]; commands?: BackgroundCommand[] }>({})
  const reloadConversation = useRef<(() => Promise<void>) | null>(null)
  const [prompt, setPrompt] = useState<TerminalPromptData | null>(null), [answering, setAnswering] = useState(false)
  const [showJump, setShowJump] = useState(false)
  function jumpToLatest() { follow.current = true; setShowJump(false); const box = scroller.current; if (box) box.scrollTop = box.scrollHeight }
  function showConversation() { if (mode !== 'messages') restored.current = false; setMode('messages'); void reloadConversation.current?.() }
  const modeGesture = useRef<{ x: number; y: number; id: number } | null>(null), suppressModeClick = useRef(false)
  const [checkedAt, setCheckedAt] = useState(0), [changedAt, setChangedAt] = useState(() => Date.now()), [readFailed, setReadFailed] = useState(false), [now, setNow] = useState(() => Date.now())
  const transcriptFingerprint = useRef('')
  useEffect(() => {
    if (!active) return
    let stopped = false, working = false
    const load = async () => {
      if (working || document.visibilityState === 'hidden') return
      working = true
      try {
        const result = await mobileApi<{ messages: Message[]; supported: boolean; activity?: ToolActivity[]; agents?: WorkingAgent[]; commands?: BackgroundCommand[]; prompt?: TerminalPromptData | null }>(`/sessions/${session.id}/messages`)
        if (!stopped) {
          const at = Date.now(), fingerprint = JSON.stringify(result.messages)
          if (fingerprint !== transcriptFingerprint.current) { transcriptFingerprint.current = fingerprint; setChangedAt(at) }
          setMessages(result.messages); setPrompt(result.prompt || null); setActivity(result.activity || []); setBackground({ agents: result.agents, commands: result.commands }); setSupported(result.supported); setCheckedAt(at); setNow(at); setReadFailed(false)
        }
      } catch { if (!stopped) { setReadFailed(true); setNow(Date.now()) } }
      finally { working = false }
    }
    reloadConversation.current = load
    void load(); const timer = window.setInterval(load, 2200)
    const seen = () => { mobileEvent({ type: 'subscribe', id: session.id }); if (document.visibilityState === 'visible') mobileEvent({ type: 'seen', id: session.id, completionVersion: session.completionVersion }) }
    seen(); const visible = () => { if (document.visibilityState === 'visible') { seen(); void load() } }
    document.addEventListener('visibilitychange', visible)
    const off = onMobileEvent(event => { if (event.type === 'connected') { seen(); void load() } else if (event.type === 'transcript-changed' && event.id === session.id) void load() })
    return () => { stopped = true; reloadConversation.current = null; clearInterval(timer); off(); document.removeEventListener('visibilitychange', visible) }
  }, [session.id, session.completionVersion, active])
  useLayoutEffect(() => {
    const box = scroller.current
    if (!active || mode !== 'messages' || !box || !messages.length) return
    if (!restored.current) {
      const saved = mobileChatPosition(session.id); follow.current = saved.follow !== false
      box.scrollTop = follow.current ? box.scrollHeight : saved.top || 0; restored.current = true
      requestAnimationFrame(() => { if (scroller.current === box) { const nearEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 100; follow.current = nearEnd; setShowJump(!nearEnd) } })
    }
    else if (follow.current) box.scrollTop = box.scrollHeight
  }, [messages, prompt?.id, mode, active, session.id])
  const running = session.status === 'running'
  const readError = readFailed ? t('mobile.convRefreshError') : ''
  async function answer(choice: PromptChoice) {
    if (!prompt || answering) return
    setAnswering(true)
    try { await mobileApi(`/sessions/${session.id}/prompt`, { id: prompt.id, choice }); follow.current = true; setError('') }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setAnswering(false); void reloadConversation.current?.() }
  }
  return <>
    <div className="mobile-chat-tools"><div className="mobile-segment" role="group" aria-label={t('mobile.convViewAria')}
      onPointerDown={event => { suppressModeClick.current = false; modeGesture.current = event.isPrimary ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null }}
      onPointerCancel={() => { modeGesture.current = null }}
      onPointerUp={event => {
        const start = modeGesture.current; modeGesture.current = null
        if (!start || start.id !== event.pointerId) return
        const dx = event.clientX - start.x, dy = event.clientY - start.y
        if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return
        suppressModeClick.current = true
        if (dx < 0) setMode('terminal'); else showConversation()
      }}
      onClickCapture={event => { if (suppressModeClick.current) { event.preventDefault(); event.stopPropagation(); suppressModeClick.current = false } }}
    ><button className={mode === 'messages' ? 'active' : ''} onClick={showConversation}>{t('chats.viewConversation')}</button><button className={mode === 'terminal' ? 'active' : ''} onClick={() => { speech.stop(); setMode('terminal') }}>{t('chats.viewTerminal')}</button></div><MuteChat id={session.id} onError={setError} /><ActivityStatus session={session} connected={state.connected} /></div>
    {mode === 'terminal' ? <Terminal id={session.id} /> : <div className="mobile-message-pane"><div className="mobile-messages" ref={scroller} onScroll={() => { const box = scroller.current; if (box) { const nearEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 100; if (!restored.current) return; follow.current = nearEnd; saveMobileChatPosition(session.id, { top: box.scrollTop, follow: nearEnd }); setShowJump(!nearEnd) } }}>
      <div className="mobile-history-note">{checkedAt ? t('mobile.transcriptChecked', { time: time(checkedAt) }) : t('conv.loadingConversation')}{messages[messages.length - 1]?.at && t('mobile.lastMessage', { time: time(messages[messages.length - 1].at) })}</div>
      {(readError || (session.activity === 'working' && now - changedAt >= 45000)) && <div className="mobile-transcript-status" role="status"><p>{readError || t('mobile.staleConversation')}</p><button onClick={() => { speech.stop(); setMode('terminal') }}>{t('conv.openTerminal')}<Icon name="arrow" size={15} /></button></div>}
      {messages.map((message, index) => message.role === 'system' ? message.event && <SystemEvent key={message.id} event={message.event} time={message.at ? time(message.at) : undefined} /> : <article className={`mobile-message ${message.role}`} key={message.id}><header>{message.role === 'user' ? t('common.you') : <><AgentLogo agent={session.agent} size={15} />{session.agent === 'claude' ? 'Claude' : session.agent === 'antigravity' ? 'Antigravity' : session.agent === 'opencode' ? 'OpenCode' : 'Codex'}</>}{message.at && <time>{time(message.at)}</time>}</header><div className="mobile-message-copy"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: () => null, a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>{message.role === 'user' ? visibleUserMessage(message.text) : message.text}</ReactMarkdown></div><ConversationImages images={message.images} />{index === readEnd && message.role === 'assistant' && messages.slice(readStart).some(item => item.text.trim()) && <div className="mobile-read-aloud"><button type="button" disabled={!speech.supported} aria-label={speech.activeId ? speech.paused ? t('conv.resumeReading') : t('conv.pauseReading') : t('conv.readAloud')} title={!speech.supported ? t('mobile.readAloudUnavailable') : speech.activeId ? speech.paused ? t('conv.resumeReading') : t('conv.pauseReading') : t('mobile.readFromLast')} onClick={() => { if (speech.activeId) speech.togglePause(); else speech.read(message.id, Array.from(scroller.current?.querySelectorAll<HTMLElement>('.mobile-message-copy') || []).slice(readStart, readEnd + 1).map(spokenText).filter(Boolean).join('\n\n')) }}><Icon name={speech.activeId ? speech.paused ? 'play' : 'pause' : 'speaker'} size={19} /></button>{speech.activeId && <button type="button" aria-label={t('conv.stopReading')} title={t('conv.stopReading')} onClick={speech.stop}><Icon name="stop" size={17} /></button>}{speech.loading && <span role="status">{t('conv.preparingAudio')}</span>}</div>}</article>)}
      {!messages.length && <div className="mobile-chat-empty"><Icon name="chats" size={30} /><h2>{supported ? t('mobile.readyNextThought') : t('mobile.chatInTerminal')}</h2><p>{supported ? t('mobile.emptySupportedDesc') : t('mobile.emptyUnsupportedDesc')}</p><button onClick={() => { speech.stop(); setMode('terminal') }}>{t('conv.openTerminal')}<Icon name="arrow" size={15} /></button></div>}
      {!!activity.length && <details className="mobile-tool-activity" aria-label={t('conv.recentToolActivity')}><summary>{t('mobile.recentActivity')}</summary>{activity.map(item => <div key={item.id}><Icon name={item.status === 'running' ? 'terminal' : item.status === 'failed' ? 'bell' : 'history'} size={14} /><span>{item.name}</span><small>{item.status === 'running' && !running ? t('mobile.interrupted') : t(toolStatusKeys[item.status])}{item.at && ` · ${time(item.at)}`}</small></div>)}</details>}
      {prompt && <TerminalPrompt prompt={prompt} answering={answering} onAnswer={choice => void answer(choice)} onOpenTerminal={() => { speech.stop(); setMode('terminal') }} />}
      {session.activity === 'working' && <p className="mobile-agent-working"><i />{t('mobile.agentWorkingComputer')}</p>}
    </div>{showJump && <button className="mobile-jump-latest" onClick={jumpToLatest}><Icon name="down" size={16} />{t('mobile.jumpToLatest')}</button>}</div>}
    {mode === 'messages' && <BackgroundWork agents={background.agents} commands={background.commands} now={now} />}
    {!running && <div className="mobile-resume"><span>{t('mobile.conversationSaved')}</span><button disabled={!state.connected} onClick={async () => { try { await mobileApi(`/sessions/${session.id}/resume`, {}); setError('') } catch (err) { setError(err instanceof Error ? err.message : String(err)) } }}>{t('mobile.resumeChat')}</button></div>}
    {speech.error && <p className="mobile-error" role="alert">{serviceMessage(speech.error)}</p>}
    {error && <p className="mobile-error" role="alert">{serviceMessage(error)}</p>}
    <Composer key={session.id} id={session.id} connected={state.connected} running={running} active={active} />
  </>
}

function NewChat({ close, opened }: { close: () => void; opened: (id: string) => void }) {
  const { t, serviceMessage } = useT()
  const state = useMobile(), available = state.agents.filter(item => item.available)
  const [agent, setAgent] = useState(available.some(item => item.id === state.defaultAgent) ? state.defaultAgent! : available[0]?.id || '')
  const [name, setName] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [projects, setProjects] = useState<RecentProject[]>([]), [cwd, setCwd] = useState('')
  useEffect(() => { let alive = true; mobileApi<RecentProject[]>('/projects').then(value => { if (alive) { setProjects(value); setCwd(current => current || value[0]?.path || '') } }).catch(() => {}); return () => { alive = false } }, [])
  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { const session = await mobileApi<ChatSession>('/sessions', { agent, name, ...(cwd ? { cwd } : {}) }); await startMobile(); opened(session.id); close() }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }
  return <div className="mobile-modal-backdrop"><form className="mobile-modal" onSubmit={create}><header><h2>{t('chats.newChat')}</h2><button type="button" className="mobile-icon" aria-label={t('mobile.closeNewChat')} onClick={close}><Icon name="close" /></button></header><label>{t('mcp.agentLabel')}<select value={agent} onChange={event => setAgent(event.target.value)}>{available.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>{t('mobile.chatNameEnglish')}<input value={name} onChange={event => setName(event.target.value)} maxLength={100} required placeholder={t('mobile.chatNameExample')} /></label>{projects.length > 1 && <label>{t('mobile.projectLabel')}<select value={cwd} onChange={event => setCwd(event.target.value)}>{projects.map(item => <option key={item.path} value={item.path}>{item.name} · {item.path}</option>)}</select></label>}<p>{projects.length > 1 ? t('mobile.projectsHint') : t('mobile.workspaceFolderHint')} {state.defaultBypass ? t('mobile.bypassAllowedHint') : t('mobile.defaultPermsHint')}</p>{error && <p className="mobile-error" role="alert">{serviceMessage(error)}</p>}<button className="mobile-primary" disabled={busy || !agent || !state.connected}>{busy ? t('chats.opening') : t('chats.openChat')}<Icon name="plus" size={17} /></button></form></div>
}

export default function MobileApp() {
  const { lang, t, serviceMessage } = useT()
  const installation = useInstall()
  const [resultsHeader, setResultsHeader] = useState<HTMLDivElement | null>(null)
  const { view, history } = useMobileNavigation()
  const state = useMobile(), [query, setQuery] = useState(''), [creating, setCreating] = useState(false), [settings, setSettings] = useState(false)
  const [closing, setClosing] = useState(false), [closeError, setCloseError] = useState('')
  const [refreshing, setRefreshing] = useState(false), refreshTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(refreshTimer.current), [])
  function refreshPage() {
    if (refreshTimer.current !== undefined) return
    setRefreshing(true)
    void reconnectMobile()
    refreshTimer.current = window.setTimeout(() => { setRefreshing(false); refreshTimer.current = undefined }, 500)
  }
  useEffect(() => { document.title = t('brand.mobileTitle') }, [t])
  useEffect(() => {
    document.documentElement.dataset.makTheme = 'dark'
    const manifest = document.createElement('link'); manifest.rel = 'manifest'; manifest.href = '/mobile/manifest.webmanifest'; document.head.append(manifest)
    const icon = document.createElement('link'); icon.rel = 'apple-touch-icon'; icon.href = '/assets/bento-icon-192.png'; document.head.append(icon)
    const theme = document.createElement('meta'); theme.name = 'theme-color'; theme.content = '#0d0e12'; document.head.append(theme)
    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]'), previousViewport = viewport?.content
    if (viewport) viewport.content = 'width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content'
    // Keep the composer above iOS/Android keyboards without changing desktop geometry.
    const resize = () => document.documentElement.style.setProperty('--mobile-height', `${window.visualViewport?.height || innerHeight}px`)
    resize(); window.visualViewport?.addEventListener('resize', resize); window.addEventListener('resize', resize)
    void startMobile()
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/mobile/sw.js', { scope: '/mobile/' }).catch(() => {})
    return () => { manifest.remove(); icon.remove(); theme.remove(); if (viewport && previousViewport) viewport.content = previousViewport; window.visualViewport?.removeEventListener('resize', resize); window.removeEventListener('resize', resize); document.documentElement.style.removeProperty('--mobile-height') }
  }, [])
  const session = state.sessions.find(item => item.id === state.selectedId)
  useEffect(() => { if (state.ready && state.authenticated && view === 'chat' && !session) setMobileView('list') }, [state.ready, state.authenticated, view, session])
  useEffect(() => state.authenticated ? installMobileBack() : undefined, [state.authenticated])
  function open(id: string) { selectMobileChat(id); setCloseError(''); setMobileView('chat') }
  const openRef = useRef(open)
  useEffect(() => { openRef.current = open })
  // A tapped notification opens its chat: a new window by its address, an open one by message.
  useEffect(() => {
    const chat = new URLSearchParams(location.hash.slice(1)).get('chat')
    if (chat) { window.history.replaceState(null, '', location.pathname); openRef.current(chat) }
    const message = (event: MessageEvent) => { if (event.data?.type === 'open-chat' && typeof event.data.chat === 'string') openRef.current(event.data.chat) }
    navigator.serviceWorker?.addEventListener('message', message)
    return () => navigator.serviceWorker?.removeEventListener('message', message)
  }, [])
  // The service skips a notification for the chat a visible phone shows.
  const viewingId = view === 'chat' ? session?.id ?? null : null
  useEffect(() => {
    const report = () => mobileEvent({ type: 'viewing', id: document.visibilityState === 'visible' ? viewingId : null })
    report()
    document.addEventListener('visibilitychange', report)
    const off = onMobileEvent(event => { if (event.type === 'connected') report() })
    return () => { document.removeEventListener('visibilitychange', report); off() }
  }, [viewingId])
  async function closeChat() {
    if (!session || closing || !state.connected) return
    if (!window.confirm(t('mobile.closeChatConfirm', { name: session.name }))) return
    setClosing(true); setCloseError('')
    try { await mobileApi(`/sessions/${session.id}/close`, {}); setMobileView('list') }
    catch (err) { setCloseError(err instanceof Error ? err.message : String(err)) }
    finally { setClosing(false) }
  }
  if (!state.ready) return <div className="mobile-app mobile-loading"><Nose size={52} /><p>{t('mobile.connectingBento')}</p></div>
  if (!state.authenticated) return <div className="mobile-app"><Connect /></div>
  const items = [...state.sessions].filter(item => (history || item.open) && `${item.name} ${item.agent}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => Number(b.pinned) - Number(a.pinned) || (history ? b.updatedAt.localeCompare(a.updatedAt) : a.tabOrder - b.tabOrder))
  const title = view === 'chat' && session ? session.name : view === 'results' ? t('workspace.title') : view === 'network' ? t('network.title') : history ? t('chats.history') : t('brand.chatsWord')
  return <div className="mobile-app"><header className={`mobile-header ${view === 'chat' ? 'mobile-header-chat' : ''}`}>
    {view === 'chat' && <button className="mobile-icon" aria-label={t('mobile.backToChats')} onClick={() => setMobileView('list')}><Icon name="back" /></button>}
    <button className={`mobile-nose-refresh ${refreshing ? 'refreshing' : ''}`} aria-label={t('common.reconnect')} title={t('mobile.reconnectTitle')} onClick={refreshPage} disabled={refreshing}><span className={`mobile-connection-logo ${state.connected ? 'online' : ''}`} role="status" aria-label={state.connected ? t('mobile.connectedComputer') : t('mobile.reconnectingAgentsWork')} title={state.connected ? t('mobile.connectedComputer') : t('mobile.reconnectingAgentsWork')}><Nose size={26} /></span></button>
    <div className="mobile-header-title" ref={setResultsHeader} id={view === 'results' ? 'mobile-results-header' : undefined}>{view !== 'results' && <h1>{title}</h1>}{view === 'list' && <span className="mobile-header-count" aria-label={t('mobile.chatCountAria', { count: items.length, noun: items.length === 1 ? t('tabs.chatOne') : t('tabs.chatMany') })}>· {items.length}</span>}</div>
    {view === 'chat' && session?.open && <button className="mobile-icon" aria-label={t('mobile.closeChat')} title={t('mobile.closeChat')} disabled={!state.connected || closing} onClick={() => void closeChat()}><Icon name="trash" size={19} /></button>}
    <nav className="mobile-main-nav" aria-label={t('mobile.sectionsAria')}>
      {view === 'list' && <><button className="mobile-icon" aria-label={t('chats.newChat')} title={t('chats.newChat')} onClick={() => setCreating(true)} disabled={!state.connected}><Icon name="plus" size={19} /></button><button className={`mobile-icon ${history ? 'active' : ''}`} aria-label={t('chats.history')} title={history ? t('mobile.showActiveChats') : t('chats.historyAria')} aria-pressed={history} onClick={() => setMobileHistory(!history)}><Icon name="history" size={19} /></button></>}
      <button className={`mobile-icon ${view === 'chat' || (view === 'list' && !history) ? 'active' : ''}`} aria-label={t('brand.chatsWord')} title={t('brand.chatsWord')} aria-current={view === 'chat' || (view === 'list' && !history) ? 'page' : undefined} onClick={() => { setMobileHistory(false); setMobileView(session ? 'chat' : 'list') }}><Icon name="chats" size={19} /></button>
      <button className={`mobile-icon ${view === 'results' ? 'active' : ''}`} aria-label={t('mobile.resultsAria')} title={t('workspace.title')} aria-current={view === 'results' ? 'page' : undefined} onClick={() => setMobileView('results')}><Icon name="workspace" size={19} /></button>
      <button className={`mobile-icon ${view === 'network' ? 'active' : ''}`} aria-label={t('network.railLabel')} title={t('network.title')} aria-current={view === 'network' ? 'page' : undefined} onClick={() => setMobileView('network')}><Icon name="network" size={19} /></button>
    </nav>
    <button className="mobile-icon" aria-label={t('mobile.phoneSettings')} title={t('mobile.phoneSettings')} onClick={() => setSettings(!settings)}><Icon name="phone" size={19} /></button>
  </header>
    {installation.available && !installation.dismissed && <aside className="mobile-install" aria-label={t('mobile.installAria')}><div><strong>{t('mobile.installHeading')}</strong><p>{t('mobile.installBody')}</p></div><button onClick={() => void installation.install()} disabled={installation.busy}>{t('mobile.installButton')}</button><button className="mobile-icon" aria-label={t('mobile.notNow')} title={t('mobile.notNow')} onClick={installation.dismiss}><Icon name="close" size={17} /></button></aside>}
    {installation.error && <p className="mobile-error" role="alert">{serviceMessage(installation.error)}</p>}
    {!state.connected && <div className="mobile-offline" role="status">{state.error ? serviceMessage(state.error) : t('mobile.offlineBanner')}</div>}
    {closeError && <div className="mobile-error" role="alert">{serviceMessage(closeError)}<button className="mobile-icon" aria-label={t('mobile.dismissCloseError')} onClick={() => setCloseError('')}><Icon name="close" size={15} /></button></div>}
    {settings && <div className="mobile-device-settings"><strong>{state.device?.name}</strong><p>{t('mobile.settingsRunsOnComputer')}</p><fieldset className="mobile-reading-settings"><legend>{t('lang.section')}</legend><LanguagePicker compact /></fieldset>{installation.installed ? <p>{t('mobile.installedOnPhone')}</p> : installation.available ? <button onClick={() => void installation.install()} disabled={installation.busy}>{t('mobile.installOnPhoneButton')}</button> : <p>{t('mobile.installManualHint')}</p>}<ReadingVoiceSettings /><NotificationSettings disabled={!state.connected} /><DictationSettings info={state.dictation} onChange={chooseMobileDictation} disabled={!state.connected} /><button onClick={() => { if (window.confirm(t('mobile.disconnectConfirm'))) void disconnectMobile() }}>{t('mobile.disconnectButton')}</button></div>}
    <div className="mobile-view-host">{view === 'network' && <NetworkView openTask={open} />}<div className="mobile-persistent-view" aria-hidden={view !== 'results'} inert={view !== 'results'}><Results header={view === 'results' ? resultsHeader : null} active={view === 'results'} /></div>{session && <div className="mobile-persistent-view" aria-hidden={view !== 'chat'} inert={view !== 'chat'}><Conversation key={session.id} session={session} active={view === 'chat'} /></div>}{view === 'list' && <main className="mobile-chat-list"><label className="mobile-search"><Icon name="search" size={17} /><input aria-label={t('chats.findChat')} placeholder={t('chats.findConversationPlaceholder')} value={query} onChange={event => setQuery(event.target.value)} /></label><div className="mobile-chat-cards">{items.map(item => <button className={`mobile-chat-card ${item.activity === 'working' ? 'working' : ''}`} key={item.id} onClick={() => open(item.id)} style={{ '--chat-color': item.tabColor || state.agents.find(agent => agent.id === item.agent)?.color || '#d7aabd' } as React.CSSProperties}><span className="mobile-agent-icon"><AgentLogo agent={item.agent} size={24} />{item.unread && <i />}</span><span className="mobile-card-copy"><strong>{item.name}{item.pinned && <Icon name="pin" size={12} />}</strong><small>{state.agents.find(agent => agent.id === item.agent)?.label || item.agent} · {chatActivityLabel(item, lang)}</small>{item.preview && <p>{item.preview}</p>}</span><Icon name="arrow" size={15} /></button>)}{!items.length && <p className="mobile-list-empty">{query ? t('chats.noMatchingChats') : t('mobile.emptyList')}</p>}</div><p className="mobile-list-foot">{t('mobile.listFootLine1')}<br />{t('mobile.listFootLine2')}</p></main>}</div>
    {creating && <NewChat close={() => setCreating(false)} opened={open} />}
  </div>
}
