import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, pickFiles, reportError, speakDesktopText, transcribeDesktopAudio, uploadImage } from './client'
import type { ChatSession, SystemEventsMode } from './types'
import SystemEvent, { type SystemEventData } from '../mobile/SystemEvent'
import BackgroundWork, { type BackgroundCommand, type WorkingAgent } from '../mobile/BackgroundWork'
import { AgentLogo, Icon } from './Icons'
import { useDictation } from './useDictation'
import ConversationImages from '../mobile/ConversationImages'
import type { ConversationImage } from '../mobile/ImageViewer'
import VoiceInput from '../mobile/VoiceInput'
import { visibleUserMessage } from '../mobile/workspace-context'
import { spokenText, useReadAloud } from '../mobile/useReadAloud'
import { readingVoiceChanged, readingVoices, readingVoiceLabelKeys, saveReadingVoice, savedReadingVoice } from '../mobile/readingVoices'
import { commandToken, completeCommand, matchingCommands, terminalCommand, type ChatCommand } from './commandSuggestions'
import TerminalPrompt, { type PromptChoice, type TerminalPromptData } from '../components/TerminalPrompt'
import './conversation.css'
import { keepUrl, linkTarget } from '../components/messageLinks'
import { useT, type MessageKey } from '../lib/i18n'

interface ToolActivity { id: string; name: string; status: 'running' | 'completed' | 'failed'; at: string }
interface Message { id: string; role: 'user' | 'assistant' | 'system'; text: string; at: string; images?: ConversationImage[]; event?: SystemEventData }
interface Transcript { supported: boolean; messages: Message[]; activity?: ToolActivity[]; agents?: WorkingAgent[]; commands?: BackgroundCommand[]; hasOlder?: boolean; historyLoaded?: boolean; nativeId?: string | null; prompt?: TerminalPromptData | null }
interface EarlierPage { messages: Message[]; hasOlder: boolean; replace?: boolean; stale?: boolean }
interface Draft { text: string; paths: string[] }

const toolStatusKeys: Record<ToolActivity['status'] | 'interrupted', MessageKey> = {
  running: 'conv.toolStatus.running',
  completed: 'conv.toolStatus.completed',
  failed: 'conv.toolStatus.failed',
  interrupted: 'conv.toolStatus.interrupted',
}
const draftKey = (id: string) => `mrmak.chatDraft.${id}`
const fileName = (file: string) => file.split(/[\\/]/).filter(Boolean).pop() || file
function savedDraft(id: string): Draft {
  try {
    const value = JSON.parse(localStorage.getItem(draftKey(id)) || '')
    return { text: typeof value.text === 'string' ? value.text : '', paths: Array.isArray(value.paths) ? value.paths.filter((item: unknown) => typeof item === 'string') : [] }
  } catch { return { text: '', paths: [] } }
}
function saveDraft(id: string, draft: Draft) {
  try { localStorage.setItem(draftKey(id), JSON.stringify(draft)) } catch { /* The draft stays in memory. */ }
}

function MessageLink({ href, sessionId, children }: { href?: string; sessionId: string; children: React.ReactNode }) {
  const { t } = useT()
  const target = linkTarget(href)
  if (target.kind === 'web') return <a href={href} target="_blank" rel="noreferrer">{children}</a>
  if (target.kind === 'text') return <span className="conversation-link-text">{children}</span>
  return <a href={href} title={t('conv.openPath', { path: target.path })} onClick={event => { event.preventDefault(); api('/preview/show', { path: target.path, sessionId }).catch(reportError) }}>{children}</a>
}

// Draft edits and transcript polls must not parse every old Markdown message
// again. Primitive props stay equal when the API returns new message objects.
const MessageMarkdown = memo(function MessageMarkdown({ text, role, sessionId }: { text: string; role: Message['role']; sessionId: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={keepUrl} components={{ img: () => null, a: ({ href, children }) => <MessageLink href={href} sessionId={sessionId}>{children}</MessageLink> }}>{role === 'user' ? visibleUserMessage(text) : text}</ReactMarkdown>
})

function CopyButton({ text }: { text: string }) {
  const { t } = useT()
  const [copied, setCopied] = useState(false)
  return <button type="button" className="conversation-copy" title={t('conv.copyMessage')} aria-label={copied ? t('common.copied') : t('conv.copyMessage')} onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1400) }).catch(reportError)}><Icon name="copy" size={14} />{copied && <span>{t('common.copied')}</span>}</button>
}

export default function Conversation({ session, connected, agentLabel, openTerminal, systemEvents = 'compact' }: { session: ChatSession; connected: boolean; agentLabel: string; openTerminal?: () => void; systemEvents?: SystemEventsMode }) {
  const { t, time, serviceMessage } = useT()
  const readOnly = !openTerminal
  const [transcript, setTranscript] = useState<Transcript | null>(null)
  const [historyBusy, setHistoryBusy] = useState(false), [historyError, setHistoryError] = useState('')
  const scrollAnchor = useRef<{ height: number; top: number } | null>(null)
  const firstVisible = useRef<string | undefined>(undefined)
  const [readFailed, setReadFailed] = useState(false)
  const [changedAt, setChangedAt] = useState(() => Date.now()), [now, setNow] = useState(() => Date.now())
  const fingerprint = useRef('')
  const scroller = useRef<HTMLDivElement>(null), area = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null)
  const follow = useRef(true), [showJump, setShowJump] = useState(false)
  const [draft, setDraft] = useState(() => savedDraft(session.id))
  const [sending, setSending] = useState(false), [uploading, setUploading] = useState(false), [voiceBusy, setVoiceBusy] = useState(false), [status, setStatus] = useState('')
  const [dragging, setDragging] = useState(false)
  const { info: dictation } = useDictation()
  const running = !readOnly && session.status === 'running', working = running && session.activity === 'working'
  const reload = useRef<() => Promise<void>>(async () => {})
  const speech = useReadAloud(session.id, speakDesktopText), stopReading = speech.stop
  const [voice, setVoice] = useState(savedReadingVoice)
  const [answering, setAnswering] = useState(false)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null), [rewinding, setRewinding] = useState(false), [editError, setEditError] = useState('')
  const [commands, setCommands] = useState<ChatCommand[]>([]), [caret, setCaret] = useState(0), [picked, setPicked] = useState(0), [dismissed, setDismissed] = useState('')
  useEffect(() => { if (!readOnly) api<{ commands: ChatCommand[] }>(`/sessions/${session.id}/commands`).then(value => setCommands(value.commands)).catch(() => setCommands([])) }, [session.id, readOnly])
  const token = commandToken(draft.text, caret, session.agent === 'codex')
  const tokenKey = token ? `${token.start}:${token.trigger}${token.query}` : ''
  const suggestions = token && tokenKey !== dismissed ? matchingCommands(commands, token) : []
  const highlighted = suggestions[Math.min(picked, suggestions.length - 1)]
  function complete(command: ChatCommand) {
    if (!token) return
    const next = completeCommand(draft.text, token, command)
    setDraft(current => ({ ...current, text: next.text })); setCaret(next.caret); setPicked(0)
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(next.caret, next.caret) })
  }

  useEffect(() => { if (!readOnly) saveDraft(session.id, draft) }, [draft, session.id, readOnly])
  useEffect(() => {
    let stopped = false, busy = false
    const load = async () => {
      if (busy || document.visibilityState === 'hidden') return
      busy = true
      try {
        const result = await api<Transcript>(`/sessions/${session.id}/messages`)
        if (stopped) return
        const at = Date.now(), next = JSON.stringify(result.messages)
        if (next !== fingerprint.current) { fingerprint.current = next; setChangedAt(at) }
        setTranscript(current => {
          const recent = { ...result, nativeId: session.nativeId }
          if (!current?.historyLoaded || current.nativeId !== session.nativeId) return recent
          if (!result.messages.length) {
            return result.hasOlder ? { ...recent, messages: current.messages, historyLoaded: true, hasOlder: current.hasOlder } : recent
          }
          const overlap = current.messages.findIndex(message => message.id === result.messages[0].id)
          if (overlap < 0) return recent
          return { ...recent, messages: [...current.messages.slice(0, overlap), ...result.messages], historyLoaded: true, hasOlder: current.hasOlder }
        })
        setReadFailed(false); setNow(at)
      } catch { if (!stopped) { setReadFailed(true); setNow(Date.now()) } }
      finally { busy = false }
    }
    reload.current = load
    void load()
    const timer = window.setInterval(load, 2000)
    const visible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', visible)
    return () => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [session.id, session.nativeId, session.completionVersion, session.activity])
  const messages = transcript?.messages || []
  async function loadEarlier() {
    const before = messages[0]?.id
    if (historyBusy) return
    setHistoryBusy(true); setHistoryError('')
    try {
      const cursor = before ? `?before=${encodeURIComponent(before)}` : ''
      const page = await api<EarlierPage>(`/sessions/${session.id}/earlier${cursor}`)
      if (page.stale) throw new Error(t('conv.historyUnavailable'))
      if (firstVisible.current !== before) return
      const box = scroller.current
      if (box && page.messages.length && !page.replace) scrollAnchor.current = { height: box.scrollHeight, top: box.scrollTop }
      follow.current = false
      setTranscript(current => {
        if (!current || current.messages[0]?.id !== before) return current
        return { ...current, messages: page.replace ? page.messages : [...page.messages, ...current.messages], hasOlder: page.hasOlder, historyLoaded: true }
      })
    } catch (error) {
      setHistoryError(serviceMessage(error instanceof Error ? error.message : String(error)))
    } finally { setHistoryBusy(false) }
  }
  let readStart = 0
  for (let index = 0; index < messages.length; index++) if (messages[index].role === 'user') readStart = index
  const latestUserId = messages[readStart]?.role === 'user' ? messages[readStart].id : null
  useEffect(() => () => stopReading(), [latestUserId, session.id, stopReading])
  // A message rewound from the terminal no longer has an open editor.
  const openEdit = editing && (rewinding || messages.some(message => message.id === editing.id)) ? editing : null
  function readAloud(id: string) {
    if (speech.activeId) { speech.togglePause(); return }
    const parts = Array.from(scroller.current?.querySelectorAll<HTMLElement>('.conversation-message.assistant') || []).filter(node => Number(node.dataset.index) > readStart)
    speech.read(id, parts.map(node => spokenText(node.querySelector<HTMLElement>('.conversation-copy-text'))).filter(Boolean).join('\n\n'))
  }
  async function answer(prompt: TerminalPromptData, choice: PromptChoice) {
    if (answering) return
    setAnswering(true)
    try { await api(`/sessions/${session.id}/prompt`, { id: prompt.id, choice }); follow.current = true }
    catch (error) { reportError(error) }
    finally { setAnswering(false); void reload.current() }
  }
  useLayoutEffect(() => {
    const box = scroller.current
    firstVisible.current = transcript?.messages[0]?.id
    const anchor = scrollAnchor.current
    scrollAnchor.current = null
    if (box && anchor) box.scrollTop = anchor.top + box.scrollHeight - anchor.height
    else if (box && follow.current) box.scrollTop = box.scrollHeight
  }, [transcript, working, historyBusy])
  useEffect(() => { input.current?.focus() }, [session.id])
  useLayoutEffect(() => {
    const box = input.current
    if (!box) return
    box.style.height = 'auto'; box.style.height = `${Math.min(box.scrollHeight, 260)}px`
  }, [draft.text])

  function addPaths(paths: string[]) {
    if (!paths.length) return
    setDraft(current => ({ ...current, paths: [...new Set([...current.paths, ...paths])].slice(0, 100) }))
    input.current?.focus()
  }
  async function addImages(files: File[]) {
    if (!files.length || uploading) return
    if (files.length > 12) { setStatus(t('conv.maxImages')); return }
    setUploading(true); setStatus(t('conv.savingImagesInbox'))
    try { const paths: string[] = []; for (const file of files) paths.push((await uploadImage(file)).path); addPaths(paths); setStatus('') }
    catch (error) { setStatus(serviceMessage(error instanceof Error ? error.message : String(error))) }
    finally { setUploading(false) }
  }
  const addPathsRef = useRef(addPaths)
  useEffect(() => { addPathsRef.current = addPaths })
  useEffect(() => {
    if (readOnly) return
    let choosing = false
    const pick = async () => {
      if (choosing) return
      choosing = true
      try { addPathsRef.current(await pickFiles()) } catch (error) { reportError(error) } finally { choosing = false }
    }
    const nativeDrop = (event: Event) => {
      const detail = (event as CustomEvent<{ phase: string; paths?: string[]; x?: number; y?: number }>).detail
      if (!detail) return
      if (detail.phase === 'leave') { setDragging(false); return }
      if (!Number.isFinite(detail.x) || !Number.isFinite(detail.y)) return
      const target = document.elementFromPoint(detail.x!, detail.y!)
      const inside = !!target && !!area.current?.contains(target)
      setDragging(detail.phase !== 'drop' && inside)
      if (detail.phase === 'drop' && inside) addPathsRef.current(detail.paths || [])
    }
    window.addEventListener('mrmak-attach-file', pick)
    window.addEventListener('mrmak-file-drop', nativeDrop)
    return () => { window.removeEventListener('mrmak-attach-file', pick); window.removeEventListener('mrmak-file-drop', nativeDrop) }
  }, [readOnly])

  async function send() {
    const text = draft.text.trimEnd()
    if (sending || uploading || voiceBusy || !connected || !running || (!text.trim() && !draft.paths.length)) return
    setSending(true); setStatus('')
    try {
      await api(`/sessions/${session.id}/send`, { text, paths: draft.paths })
      // A picker command unmounts this view immediately, before its draft effect
      // can run. Clear the saved draft now so returning cannot resend it.
      saveDraft(session.id, { text: '', paths: [] })
      setDraft({ text: '', paths: [] }); setCaret(0); follow.current = true; setShowJump(false)
      if (terminalCommand(commands, text)) openTerminal?.()
      void reload.current()
    } catch (error) { setStatus(t('conv.draftKept', { error: serviceMessage(error instanceof Error ? error.message : String(error)) })) }
    finally { setSending(false); input.current?.focus() }
  }
  const stop = () => api(`/sessions/${session.id}/input`, { text: '\x1b', paste: false, submit: false }).catch(reportError)
  // Claude Code rewinds to before the message (files stay as they are), then the edited text is sent.
  const canEdit = session.agent === 'claude' && connected && running && !working && !transcript?.prompt
  async function sendEdit() {
    const target = editing, text = target?.text.trimEnd() || ''
    if (!target || rewinding || !canEdit || !text.trim()) return
    setRewinding(true); setEditError('')
    try { await api(`/sessions/${session.id}/rewind`, { messageId: target.id }) }
    catch (error) { setEditError(error instanceof Error ? error.message : String(error)); setRewinding(false); return }
    try {
      await api(`/sessions/${session.id}/send`, { text, paths: [] })
      follow.current = true; setShowJump(false)
    } catch (error) {
      // The conversation is already rewound, so keep the edited text in the composer.
      setDraft(current => ({ ...current, text: current.text ? `${text}\n\n${current.text}` : text }))
      setStatus(t('conv.editedInComposer', { error: serviceMessage(error instanceof Error ? error.message : String(error)) }))
    } finally { setEditing(null); setRewinding(false); void reload.current() }
  }

  const readError = readFailed ? t('conv.refreshError') : ''
  const stale = working && now - changedAt >= 45000
  const unreadable = transcript && !transcript.supported && session.hasConversation
  return <div ref={area} className="desk-conversation">
    <div className="conversation-scroll" ref={scroller} onScroll={() => { const box = scroller.current; if (!box) return; const nearEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 120; follow.current = nearEnd; setShowJump(!nearEnd) }}>
      <div className="conversation-column">
        {transcript?.hasOlder && <div className="conversation-history">
          <button type="button" disabled={historyBusy} onClick={() => void loadEarlier()}><Icon name="up" size={14} />{t(historyBusy ? 'conv.loadingHistory' : 'conv.loadHistory')}</button>
          {historyError && <p role="alert">{historyError}</p>}
        </div>}
        {messages.map((message, index) => message.role === 'system' ? systemEvents !== 'hidden' && message.event && <SystemEvent key={`${message.id}:${systemEvents}`} event={message.event} time={message.at ? time(message.at) : undefined} expanded={systemEvents === 'full'}
          components={{ a: ({ href, children }) => <MessageLink href={href} sessionId={session.id}>{children}</MessageLink> }} fileLink={(file, label) => <MessageLink href={file} sessionId={session.id}>{label}</MessageLink>} />
        : <article key={message.id} data-index={index} className={`conversation-message ${message.role}`}>
          <header>{message.role === 'user' ? <span>{t('common.you')}</span> : <span className="conversation-agent"><AgentLogo agent={session.agent} size={15} />{agentLabel}</span>}{message.at && <time>{time(message.at)}</time>}{message.role === 'assistant' && message.text.trim() && <CopyButton text={message.text} />}
            {message.role === 'user' && canEdit && !openEdit && message.text.trim() && <button type="button" className="conversation-copy" title={t('conv.editAndSendAgain')} aria-label={t('conv.editMessage')} onClick={() => { setEditError(''); setEditing({ id: message.id, text: visibleUserMessage(message.text) }) }}><Icon name="edit" size={14} /></button>}</header>
          {openEdit?.id === message.id ? <form className="conversation-edit" onSubmit={event => { event.preventDefault(); void sendEdit() }}>
            <textarea autoFocus aria-label={t('conv.editMessage')} value={openEdit.text} disabled={rewinding} rows={Math.min(12, openEdit.text.split('\n').length + 1)} onChange={event => setEditing({ id: message.id, text: event.target.value })}
              onKeyDown={event => {
                // WebKit may clear isComposing before the IME-confirming Enter.
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
                if (event.key === 'Escape' && !rewinding) { event.preventDefault(); event.stopPropagation(); setEditing(null) }
                if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendEdit() }
              }} />
            {editError && <p role="alert">{serviceMessage(editError)}</p>}
            <footer><span>{rewinding ? t('conv.rewinding') : t('conv.rewindHint')}</span>
              <button type="button" disabled={rewinding} onClick={() => setEditing(null)}>{t('common.cancel')}</button>
              <button type="submit" disabled={rewinding || !canEdit || !openEdit.text.trim()}>{t('common.send')}</button></footer>
          </form>
          : message.text.trim() && <div className="conversation-copy-text"><MessageMarkdown text={message.text} role={message.role} sessionId={session.id} /></div>}
          <ConversationImages images={message.images} />
          {index === messages.length - 1 && message.role === 'assistant' && index > readStart && <div className="conversation-read-aloud">
            <button type="button" onClick={() => readAloud(message.id)} aria-label={speech.activeId ? speech.paused ? t('conv.resumeReading') : t('conv.pauseReading') : t('conv.readAloud')} title={speech.activeId ? speech.paused ? t('conv.resumeReading') : t('conv.pauseReading') : t('conv.readReplyTitle')}><Icon name={speech.activeId ? speech.paused ? 'play' : 'pause' : 'speaker'} size={15} />{speech.activeId ? speech.paused ? t('conv.resume') : t('conv.pause') : t('conv.readAloud')}</button>
            {speech.activeId && <button type="button" onClick={speech.stop} aria-label={t('conv.stopReading')} title={t('conv.stopReading')}><Icon name="stop" size={13} /></button>}
            <select aria-label={t('conv.readingVoiceAria')} value={voice} onChange={event => { setVoice(event.target.value); saveReadingVoice(event.target.value); window.dispatchEvent(new Event(readingVoiceChanged)) }}>{readingVoices.map(item => <option key={item.id} value={item.id}>{t(readingVoiceLabelKeys[item.id])}</option>)}</select>
            {speech.loading && <span role="status">{t('conv.preparingAudio')}</span>}
            {speech.error && <span role="alert">{serviceMessage(speech.error)}</span>}
          </div>}
        </article>)}
        {!messages.length && <div className="conversation-empty">
          <AgentLogo agent={session.agent} size={34} />
          <h2>{!transcript ? t('conv.loadingConversation') : unreadable ? t('conv.inTerminalTitle') : t('conv.readyTitle')}</h2>
          <p>{unreadable ? t('conv.unreadableDesc') : t('conv.emptyDesc', { agent: agentLabel })}</p>
          {openTerminal && <button type="button" onClick={openTerminal}><Icon name="terminal" size={15} />{t('conv.openTerminal')}</button>}
        </div>}
        {!!transcript?.activity?.length && <details className="conversation-activity"><summary>{t('conv.recentToolActivity')}</summary>{transcript.activity.map(item => <div key={item.id}><Icon name={item.status === 'running' ? 'terminal' : item.status === 'failed' ? 'bell' : 'history'} size={13} /><span>{item.name}</span><small>{t(toolStatusKeys[item.status === 'running' && !running ? 'interrupted' : item.status])}{item.at && ` · ${time(item.at)}`}</small></div>)}</details>}
        {openTerminal && transcript?.prompt && <TerminalPrompt prompt={transcript.prompt} answering={answering} onAnswer={choice => void answer(transcript.prompt!, choice)} onOpenTerminal={openTerminal} />}
        {working && <p className="conversation-working"><i />{t('conv.agentWorking', { agent: agentLabel })}</p>}
        {readError && readOnly && <p className="conversation-notice" role="status">{readError}</p>}
        {openTerminal && !transcript?.prompt && (session.activity === 'waiting' || stale || readError) && <div className="conversation-notice" role="status"><p>{readError || (session.activity === 'waiting' ? t('conv.agentWaiting', { agent: agentLabel }) : t('conv.staleNotice'))}</p><button type="button" onClick={openTerminal}><Icon name="terminal" size={14} />{t('conv.openTerminal')}</button></div>}
      </div>
    </div>
    {showJump && <button type="button" className="conversation-jump" onClick={() => { follow.current = true; setShowJump(false); const box = scroller.current; if (box) box.scrollTop = box.scrollHeight }}><Icon name="down" size={15} />{t('conv.latest')}</button>}
    {dragging && <div className="terminal-drop"><Icon name="attach" size={30} /><strong>{t('conv.dropToAttach')}</strong><span>{t('conv.filesFoldersImages')}</span></div>}
    {!readOnly && <BackgroundWork agents={transcript?.agents} commands={transcript?.commands} now={now} />}
    {!readOnly && <form className="conversation-composer" onSubmit={event => { event.preventDefault(); void send() }}>
      {!!suggestions.length && <ul className="conversation-commands" id="conversation-commands" role="listbox" aria-label={t('conv.commandsAria')}>{suggestions.map((command, index) => <li key={`${command.trigger}${command.name}`} id={`conversation-command-${index}`} role="option" aria-selected={command === highlighted}
        onMouseDown={event => { event.preventDefault(); complete(command) }} onMouseEnter={() => setPicked(index)}>
        <strong>{command.trigger}{command.name}</strong><span>{command.description}</span>{command.terminal && <Icon name="terminal" size={12} />}<small>{command.source}</small>
      </li>)}</ul>}
      {!!draft.paths.length && <div className="conversation-chips">{draft.paths.map(file => <span key={file} title={file}><Icon name="attach" size={12} /><span>{fileName(file)}</span><button type="button" aria-label={t('conv.removeNamed', { name: fileName(file) })} onClick={() => setDraft(current => ({ ...current, paths: current.paths.filter(item => item !== file) }))}>×</button></span>)}</div>}
      <textarea ref={input} rows={1} value={draft.text} aria-label={t('conv.messageAgentAria', { agent: agentLabel })} placeholder={running ? t('conv.messageAgentPlaceholder', { agent: agentLabel }) : t('conv.reconnectToSend')} onChange={event => { setDraft(current => ({ ...current, text: event.target.value })); setCaret(event.target.selectionStart); setPicked(0) }}
        onSelect={event => setCaret(event.currentTarget.selectionStart)}
        role="combobox" aria-autocomplete="list" aria-expanded={!!suggestions.length} aria-controls="conversation-commands" aria-activedescendant={highlighted ? `conversation-command-${suggestions.indexOf(highlighted)}` : undefined}
        onKeyDown={event => {
          // WebKit may clear isComposing before the IME-confirming Enter.
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
          if (suggestions.length && highlighted) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setPicked((suggestions.indexOf(highlighted) + (event.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length); return }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissed(tokenKey); return }
            // Enter on a fully typed name sends it; otherwise Tab or Enter completes the highlighted one.
            if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey && token?.query !== highlighted.name.toLowerCase())) { event.preventDefault(); complete(highlighted); return }
          }
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() }
        }}
        onPaste={event => { const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); void addImages(files) } }} />
      <div className="conversation-actions">
        <button type="button" className="desk-icon" title={t('conv.attachFilesOrFolders')} aria-label={t('chats.attachFilesAria')} onClick={() => window.dispatchEvent(new Event('mrmak-attach-file'))}><Icon name="attach" size={16} /></button>
        <div className="terminal-dictation"><VoiceInput id={`desktop-conversation-${session.id}`} connected={connected} disabled={sending} config={dictation} hotkey transcriber={transcribeDesktopAudio} onBusy={setVoiceBusy} onText={text => setDraft(current => ({ ...current, text: current.text ? `${current.text}${/\s$/.test(current.text) ? '' : '\n'}${text}` : text }))} /></div>
        <span className="conversation-status" role="status">{status ? serviceMessage(status) : (uploading ? t('conv.savingImages') : t('conv.composerHint'))}</span>
        {working && <button type="button" className="conversation-stop" onClick={stop} title={t('conv.interruptTitle')}><Icon name="stop" size={14} />{t('conv.stop')}</button>}
        <button type="submit" className="conversation-send" aria-label={sending ? t('common.sending') : t('common.send')} title={t('common.send')} disabled={!connected || !running || sending || uploading || voiceBusy || (!draft.text.trim() && !draft.paths.length)}><Icon name="send" size={16} /></button>
      </div>
    </form>}
  </div>
}
