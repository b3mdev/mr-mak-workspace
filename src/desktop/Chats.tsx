import ContextUsage from './ContextUsage'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, onServiceEvent, reportError, selectChat, sendEvent, useDesktop, windowAction } from './client'
import type { AgentId, ChatSession, Effort } from './types'
import { defaultEffort, effortAgents, efforts } from './effort'
import { Icon } from './Icons'
import MakLogo from '../components/MakLogo'
import TerminalPane from './TerminalPane'
import BrowserSettings from '../components/BrowserSettings'
import BrowserOsSplit from './BrowserOsSplit'
import SessionLogo from './SessionLogo'
import { chatActivityLabel } from './chatActivity'
import ChatTabs from './ChatTabs'
import { groupCounts, groupNames, orderedChats, projectGrouped, projectKey, projectName, tabColors } from './chatOrder'
import HandoffOffer from './HandoffOffer'
import MobileAccess from './MobileAccess'
import DictationComposer from './DictationComposer'
import ProjectPicker from './ProjectPicker'
import AgentSelect from './AgentSelect'
import Conversation from './Conversation'
import ConversationTransfer from './ConversationTransfer'
import ChatSkillRail from './ChatSkillRail'
import { useChatStats } from './chatModel'
import ModelMenu from './ModelMenu'
import { chatView, hasConversationView, saveChatView, type ChatView } from './chatView'
import { isMac, isWindows, modKey, modLabel, shortcutLabel } from './platform'
import { localizeEffort, localizeTabColor, useT } from '../lib/i18n'

function GroupPicker({ value, groups, onChange }: { value: string | null; groups: string[]; onChange: (group: string | null) => void }) {
  const { t } = useT()
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const options = value && !groups.includes(value) ? [value, ...groups] : groups
  const commit = () => { const name = draft.trim(); if (!name) return; onChange(name); setCreating(false); setDraft('') }
  return <div className="group-picker">
    <select aria-label={t('chats.groupAria')} value={creating ? '__new' : value || ''} onChange={event => { if (event.target.value === '__new') { setCreating(true); setDraft('') } else { setCreating(false); onChange(event.target.value || null) } }}>
      <option value="">{t('chats.noGroup')}</option>
      {options.map(name => <option key={name} value={name}>{name}</option>)}
      <option value="__new">{t('chats.newGroupOption')}</option>
    </select>
    {creating && <div className="group-new"><input autoFocus placeholder={t('chats.groupNamePlaceholder')} aria-label={t('chats.newGroupNameAria')} value={draft} maxLength={60} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit() } if (event.key === 'Escape') { event.stopPropagation(); setCreating(false) } }} /><button type="button" onClick={commit} disabled={!draft.trim()}>{t('common.add')}</button></div>}
  </div>
}

function NewChat({ close }: { close: () => void }) {
  const { lang, t, serviceMessage } = useT()
  const state = useDesktop()
  const [agent, setAgent] = useState<AgentId>(state.settings.defaultAgent)
  const [name, setName] = useState('')
  const [cwd, setCwd] = useState(state.repo)
  const [bypass, setBypass] = useState(state.settings.defaultBypass)
  const [effort, setEffort] = useState<Effort>(state.settings.defaultEffort || defaultEffort)
  const [resumeId, setResumeId] = useState('')
  const [group, setGroup] = useState<string | null>(() => state.sessions.find(item => item.id === state.selectedId)?.group || null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function launch(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const session = await api<ChatSession>('/sessions', { agent, name: name.trim() || undefined, cwd, bypass, effort: effortAgents.includes(agent) ? effort : undefined, resumeId: resumeId.trim() || undefined, group: group || undefined })
      await api('/settings', { defaultAgent: agent, defaultBypass: bypass, defaultEffort: effort })
      selectChat(session.id); close()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); setBusy(false) }
  }
  const effortName = localizeEffort(lang, effort)
  const os = isMac ? 'macOS' : isWindows ? 'Windows' : t('platform.user')
  const options = [projectName(cwd), group, effortAgents.includes(agent) ? effortName : null, resumeId.trim() ? t('chats.resumeTag') : null].filter(Boolean).join(' · ')
  return <div className="desk-scrim" onClick={close}><form className="desk-dialog new-chat-dialog" onClick={event => event.stopPropagation()} onSubmit={launch}>
    <div className="desk-dialog-heading"><h2>{t('chats.newChat')}</h2><button type="button" className="desk-icon" onClick={close} aria-label={t('common.close')}><Icon name="close" /></button></div>
    <input className="new-chat-name" autoFocus aria-label={t('chats.chatNameAria')} placeholder={t('chats.chatNamePlaceholder')} value={name} onChange={event => setName(event.target.value)} maxLength={100} />
    <AgentSelect agents={state.agents} value={agent} onChange={setAgent} />
    {agent !== 'shell' && <label className="desk-check"><input type="checkbox" checked={bypass} onChange={event => setBypass(event.target.checked)} /><span>{agent === 'opencode' ? t('chats.autoApproveOpenCode') : t('chats.bypassPrompts')}<small>{agent === 'opencode' ? t('chats.openCodeDenyHint') : t('chats.sameAccountHint', { os })}</small></span></label>}
    <details className="desk-details new-chat-advanced">
      <summary><span>{t('chats.moreOptions')}</span><small title={cwd}>{options}</small></summary>
      <ProjectPicker cwd={cwd} choose={setCwd} />
      <label className="desk-field">{t('chats.workingFolder')}<input value={cwd} onChange={event => setCwd(event.target.value)} onInvalid={event => { const advanced = event.currentTarget.closest('details'); if (advanced) advanced.open = true }} required spellCheck={false} /></label>
      <div className="desk-field group-field"><span>{t('chats.groupLabel')} <small>{t('chats.groupHint')}</small></span><GroupPicker value={group} groups={groupNames(state.sessions)} onChange={setGroup} /></div>
      {effortAgents.includes(agent) && <label className="desk-field">{t('chats.reasoningEffort')} <small>{t('chats.defaultForNewChats')}</small><select value={effort} onChange={event => setEffort(event.target.value as Effort)}>{efforts.map(([value]) => <option key={value} value={value}>{localizeEffort(lang, value)}</option>)}</select></label>}
      {agent === 'antigravity' && <p className="desk-muted">{t('chats.antigravityHint')}</p>}
      {agent !== 'shell' && <details className="desk-details"><summary>{t('chats.resumeExisting')}</summary><p>{t('chats.resumeExistingHint')}</p><label className="desk-field">{t('chats.nativeSessionId')}<input value={resumeId} onChange={event => setResumeId(event.target.value)} placeholder={t('chats.optionalSessionId')} /></label></details>}
    </details>
    {error && <p className="desk-error-inline" role="alert">{serviceMessage(error)}</p>}
    <button className="desk-primary" disabled={busy || !state.connected}>{busy ? t('chats.opening') : t('chats.openChat')}<Icon name="arrow" size={16} /></button>
  </form></div>
}

function History({ close, choose, read }: { close: () => void; choose: (id: string) => void; read: (id: string) => void }) {
  const { lang, t, date } = useT()
  const state = useDesktop()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const [project, setProject] = useState('')
  const projects = [...new Map(state.sessions.map(item => [projectKey(item.cwd), item.cwd])).entries()].map(([key, folder]) => ({ key, folder, name: projectName(folder) })).sort((a, b) => a.name.localeCompare(b.name))
  // Group filters list every group, including one that only History chats still carry, so an old group can be found and deleted here.
  const group = filter.startsWith('group:') ? filter.slice(6) : null
  const counts = group ? groupCounts(state.sessions)[group] || { open: 0, history: 0 } : null
  const items = [...state.sessions].filter(item => (filter === 'all' || (filter === 'pinned' ? item.pinned : group ? item.group === group : item.agent === filter)) && (!project || projectKey(item.cwd) === project) && `${item.name} ${item.agent} ${item.cwd} ${item.group || ''} ${item.preview || ''}`.normalize('NFC').toLowerCase().includes(query.normalize('NFC').toLowerCase())).sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
  const deleteGroup = (name: string) => api('/groups/delete', { name }).then(() => { setFilter('all'); setConfirmDelete(false) }).catch(reportError)
  async function open(item: ChatSession) {
    if (opening) return
    setOpening(item.id)
    try { if (!item.open || item.status !== 'running') await api(`/sessions/${item.id}/resume`, {}); choose(item.id); close() }
    catch (error) { reportError(error) } finally { setOpening(null) }
  }
  return <section className="chat-history" aria-label={t('chats.historyAria')}>
    <header><span><Icon name="history" /><strong>{t('chats.history')}</strong><small>{t('chats.conversationsCount', { count: state.sessions.length })}</small></span><button className="desk-icon" aria-label={t('chats.closeHistory')} onClick={close}><Icon name="close" /></button></header>
    <div className="history-search"><Icon name="search" size={16} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={t('chats.findConversationPlaceholder')} aria-label={t('chats.searchHistoryAria')} /></div>
    <div className="history-filters">{[['all', t('common.all')], ['pinned', t('chats.pinnedFilter')], ...state.agents.filter(item => item.id !== 'shell').map(item => [item.id, item.label]), ...groupNames(state.sessions).map(name => [`group:${name}`, name])].map(([value, label]) => <button key={value} className={filter === value ? 'selected' : ''} onClick={() => { setFilter(value); setConfirmDelete(false) }}>{label}</button>)}{projects.length > 1 && <select className={`history-project ${project ? 'selected' : ''}`} value={project} onChange={event => setProject(event.target.value)} aria-label={t('chats.filterByProject')}><option value="">{t('chats.allProjects')}</option>{projects.map(item => <option key={item.key} value={item.key} title={item.folder}>{item.name}</option>)}</select>}</div>
    {group && counts && <div className="history-group-bar" role="group" aria-label={t('chats.groupBarAria', { group })}><span>{t('chats.groupBarCounts', { group, open: counts.open, history: counts.history })}</span>{confirmDelete ? <><span>{counts.open + counts.history === 1 ? t('chats.removeGroupOne') : t('chats.removeGroupMany', { count: counts.open + counts.history })}</span><button className="danger" onClick={() => deleteGroup(group)}>{t('chats.deleteGroup')}</button><button onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</button></> : <button onClick={() => setConfirmDelete(true)}>{t('chats.deleteGroupEllipsis')}</button>}</div>}
    <div className="history-list">{items.map(item => <article key={item.id} className="history-item">
      <button className="history-open" onClick={() => open(item)} disabled={!!opening} title={t('chats.openHistoryItemTitle', { name: item.name, activity: chatActivityLabel(item, lang) })}><span className="history-agent" style={{ color: state.agents.find(agent => agent.id === item.agent)?.color }}><SessionLogo session={item} size={24} /></span><span><strong>{item.name}</strong><small>{item.group ? `${item.group} · ` : ''}{state.agents.find(agent => agent.id === item.agent)?.label} · {item.open ? t('chats.openLabel') : date(item.updatedAt || item.createdAt, { month: 'short', day: 'numeric' })} · {item.cwd.split(/[\\/]/).filter(Boolean).slice(-1)[0]}</small>{item.preview && <p>{item.preview}</p>}</span><Icon name={opening === item.id ? 'refresh' : 'arrow'} size={16} /></button>
      {hasConversationView(item) && item.nativeId && <button type="button" className="desk-icon history-read" aria-label={t('conv.readSaved', { name: item.name })} title={t('conv.readSaved', { name: item.name })} onClick={() => read(item.id)}><Icon name="eye" size={15} /></button>}
      <button className={`desk-icon history-pin ${item.pinned ? 'active' : ''}`} aria-label={t(item.pinned ? 'chats.unpinNamed' : 'chats.pinNamed', { name: item.name })} onClick={() => api(`/sessions/${item.id}`, { pinned: !item.pinned }, 'PATCH').catch(reportError)}><Icon name="pin" size={15} /></button>
    </article>)}{!items.length && <p className="desk-muted">{query ? t('chats.noMatchingConversations') : filter === 'pinned' ? t('chats.emptyPinned') : t('chats.emptyClosed')}</p>}</div>
    <footer>{t('chats.historyFooter')}</footer>
  </section>
}

function SavedConversation({ session, close }: { session: ChatSession; close: () => void }) {
  const { t } = useT()
  const { connected, agents, settings } = useDesktop()
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="conversation-reader" aria-labelledby="saved-conversation-title" onClose={close}>
    <header>
      <h2 id="saved-conversation-title">{session.name}</h2>
      <div className="conversation-transfer-actions">
        <ConversationTransfer session={session} connected={connected} />
        <button type="button" className="desk-icon" onClick={() => dialog.current?.close()} aria-label={t('common.close')}><Icon name="close" size={16} /></button>
      </div>
    </header>
    <div className="chat-skill-stage">
      <ChatSkillRail session={session} connected={connected} />
      <div className="chat-skill-content"><Conversation session={session} connected={connected} agentLabel={agents.find(agent => agent.id === session.agent)?.label || session.agent} systemEvents={settings.systemEvents} /></div>
    </div>
  </dialog>
}

export default function Chats() {
  const { lang, t, serviceMessage } = useT()
  const state = useDesktop()
  const [newChat, setNewChat] = useState(false)
  const [switcher, setSwitcher] = useState(false)
  const [history, setHistory] = useState(false)
  const [readingId, setReadingId] = useState<string | null>(null)
  const reading = state.sessions.find(item => item.id === readingId)
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState('')
  const [pinned, setPinned] = useState(false)
  const [fontSize, setFontSize] = useState(() => state.settings.terminalFontSize || 13)
  const [attachmentNotice, setAttachmentNotice] = useState({ id: '', text: '' })
  const attachmentStatus = useCallback((id: string, text: string) => setAttachmentNotice(current => text || current.id === id ? { id, text } : current), [])
  const active = orderedChats(state.sessions)
  const session = active.find(item => item.id === state.selectedId) || active[0]
  const { model, modelName, effort: usedEffort } = useChatStats(session)
  const effort = usedEffort || session?.effort || null
  const agent = state.agents.find(item => item.id === session?.agent)
  const running = session?.status === 'running' || session?.status === 'starting'
  const [, setViewVersion] = useState(0)
  const view: ChatView = session ? chatView(session) : 'terminal'
  const showView = (value: ChatView, preferred = true) => { if (!session) return; saveChatView(session.id, value, preferred); setViewVersion(version => version + 1) }
  const filtered = active.filter(item => `${item.name} ${item.agent} ${item.cwd} ${item.group || ''}`.normalize('NFC').toLowerCase().includes(query.normalize('NFC').toLowerCase()))
  const choose = (id: string) => { selectChat(id); setSwitcher(false); setMenu(false); setHistory(false); setRenaming(false) }
  useEffect(() => onServiceEvent(event => {
    if (event.type !== 'navigate' || event.window !== 'chats' || !event.sessionId) return
    setSwitcher(false)
    setMenu(false)
    setHistory(false)
    setRenaming(false)
  }), [])
  const closeChat = (id: string) => api(`/sessions/${id}`, {}, 'DELETE').catch(reportError)
  // Marked unread while it is open, a chat keeps the mark until it is opened again.
  const [held, setHeld] = useState<string | null>(null)
  if (held && held !== session?.id) setHeld(null)
  const markChat = (item: ChatSession) => {
    if (item.id === session?.id) setHeld(item.unread ? null : item.id)
    api(`/sessions/${item.id}`, { unread: !item.unread }, 'PATCH').catch(reportError)
  }
  const groups = groupNames(state.sessions)
  const byProject = projectGrouped(state.sessions)
  const historyCounts = Object.fromEntries(Object.entries(groupCounts(state.sessions)).map(([name, counts]) => [name, counts.history]))
  const collapsed = state.settings.collapsedGroups || []
  const setCollapsed = (names: string[]) => api('/settings', { collapsedGroups: names }).catch(reportError)
  const toggleGroup = (name: string) => setCollapsed(collapsed.includes(name) ? collapsed.filter(item => item !== name) : [...collapsed, name])
  const collapseOthers = (name: string) => setCollapsed(groupNames(active).filter(item => item !== name))
  const groupColors = state.settings.groupColors || {}
  const setGroupColor = (name: string, value: string | null) => { const next = { ...groupColors }; if (value) next[name] = value; else delete next[name]; api('/settings', { groupColors: next }).catch(reportError) }
  // The service accepts `seen` only for the chat this window subscribed to. TerminalPane subscribes
  // itself, so the Conversation view does it here.
  const shownId = session?.id
  useEffect(() => {
    if (state.connected && shownId && view === 'conversation') sendEvent({ type: 'subscribe', id: shownId })
  }, [state.connected, shownId, view])
  useEffect(() => {
    if (!state.connected || !session?.unread || held === session.id || history || switcher || newChat) return
    let timer = 0
    const viewed = () => {
      clearTimeout(timer)
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return
      timer = window.setTimeout(() => {
        if (document.visibilityState === 'visible' && document.hasFocus()) sendEvent({ type: 'seen', id: session.id, completionVersion: session.completionVersion })
      }, 600)
    }
    viewed()
    window.addEventListener('focus', viewed)
    window.addEventListener('blur', viewed)
    document.addEventListener('visibilitychange', viewed)
    return () => { clearTimeout(timer); window.removeEventListener('focus', viewed); window.removeEventListener('blur', viewed); document.removeEventListener('visibilitychange', viewed) }
  }, [state.connected, session?.id, session?.unread, session?.completionVersion, held, history, switcher, newChat])
  useEffect(() => { document.title = t('brand.chatsTitle') }, [t])
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (modKey(event) && event.shiftKey && event.code === 'KeyT') { event.preventDefault(); setNewChat(true) }
      if (modKey(event) && event.shiftKey && event.code === 'KeyP') { event.preventDefault(); setSwitcher(value => !value) }
      if (event.key === 'Escape') { setSwitcher(false); setMenu(false); setNewChat(false); setHistory(false) }
      if (modKey(event) && event.shiftKey && event.code === 'KeyH') { event.preventDefault(); setHistory(value => !value) }
      if (modKey(event) && event.shiftKey && event.code === 'KeyW' && session?.id) { event.preventDefault(); api(`/sessions/${session.id}`, {}, 'DELETE').catch(reportError) }
      const openChats = orderedChats(state.sessions)
      if (event.ctrlKey && event.code === 'Tab' && openChats.length) {
        event.preventDefault()
        const index = openChats.findIndex(item => item.id === session?.id)
        selectChat(openChats[(index + (event.shiftKey ? -1 : 1) + openChats.length) % openChats.length].id)
      }
      if ((isMac ? event.metaKey : event.altKey) && /^Digit[1-9]$/.test(event.code)) {
        const target = openChats[Number(event.code.slice(5)) - 1]
        if (target) { event.preventDefault(); selectChat(target.id) }
      }
    }
    // macOS: Cmd+1…9 arrive from the native Chats menu (the web view never sees them).
    const menuSelect = (event: Event) => {
      const target = orderedChats(state.sessions)[((event as CustomEvent<{ index: number }>).detail?.index || 0) - 1]
      if (target) selectChat(target.id)
    }
    window.addEventListener('keydown', shortcut)
    window.addEventListener('mrmak-select-chat', menuSelect)
    return () => { window.removeEventListener('keydown', shortcut); window.removeEventListener('mrmak-select-chat', menuSelect) }
  }, [state.sessions, session?.id])
  const changeFont = (delta: number) => { const value = Math.max(10, Math.min(24, fontSize + delta)); setFontSize(value); api('/settings', { terminalFontSize: value }).catch(reportError) }
  async function rename(event: React.FormEvent) { event.preventDefault(); if (!session) return; try { await api(`/sessions/${session.id}`, { name: title }, 'PATCH'); setRenaming(false) } catch (error) { reportError(error) } }

  return <div className="chats-surface">
    <header className="chats-header"><div className="chats-brand"><MakLogo size={25} variant="chats" /><span>{t('brand.name')} <b>{t('brand.chatsWord')}</b></span></div><div className="chats-header-actions"><BrowserOsSplit connected={state.connected} /><BrowserSettings target="chat" /><MobileAccess /><button className={`desk-icon ${pinned ? 'active' : ''}`} title={t('chats.pinAbove')} onClick={() => { setPinned(!pinned); windowAction('chats', 'pin', !pinned) }}><Icon name="pin" size={16} /></button><button className="desk-icon" title={t('chats.showWorkspace')} onClick={() => windowAction('workspace')}><Icon name="workspace" size={18} /></button></div></header>
    <div className="chat-tabs-row"><ChatTabs items={active} selectedId={session?.id} agents={state.agents} groups={groups} collapsed={collapsed} groupColors={groupColors} historyCounts={historyCounts} choose={choose} close={closeChat} mark={markChat} toggleGroup={toggleGroup} collapseOthers={collapseOthers} setGroupColor={setGroupColor} /><div className="chat-tab-actions"><button className={`desk-icon ${byProject ? 'active' : ''}`} onClick={() => api('/groups/by-project', {}).catch(reportError)} title={byProject ? t('chats.ungroupTabs') : t('chats.groupByProject')} aria-label={t('chats.groupByProject')} aria-pressed={byProject}><Icon name="folder" size={16} /></button><button className="desk-icon new-chat-button" onClick={() => setNewChat(true)} title={`${t('chats.newChat')} · ${shortcutLabel('Shift+T')}`} aria-label={t('chats.newChat')}><Icon name="plus" /></button><button className={`desk-icon ${switcher ? 'active' : ''}`} onClick={() => { setSwitcher(value => !value); setHistory(false) }} title={`${t('chats.findChat')} · ${shortcutLabel('Shift+P')}`} aria-label={t('chats.findChat')}><Icon name="search" size={16} /></button><button className={`history-button ${history ? 'active' : ''}`} onClick={() => { setHistory(value => !value); setSwitcher(false); setMenu(false) }} title={`${t('chats.history')} · ${shortcutLabel('Shift+H')}`}><Icon name="history" size={15} /><span>{t('chats.history')}</span></button></div></div>
    <div className="chat-body">
    {history && <History close={() => setHistory(false)} choose={choose} read={setReadingId} />}
    {reading && <SavedConversation key={reading.id} session={reading} close={() => setReadingId(null)} />}
    {switcher && <div className="chat-switcher"><div className="switcher-search"><Icon name="search" size={16} /><input autoFocus placeholder={t('chats.findAnyChatPlaceholder')} value={query} onChange={event => setQuery(event.target.value)} /></div><div className="switcher-list">{filtered.map(item => <button key={item.id} onClick={() => choose(item.id)} className={session?.id === item.id ? 'selected' : ''}><span className="agent-letter" style={{ color: state.agents.find(a => a.id === item.agent)?.color }}><SessionLogo session={item} size={19} /></span><span><strong>{item.name}</strong><small>{item.group ? `${item.group} · ` : ''}{item.cwd}</small></span><span className="switcher-state">{chatActivityLabel(item, lang)}</span></button>)}{!filtered.length && <p className="desk-muted">{t('chats.noMatchingChats')}</p>}</div></div>}
    {session ? <>
      <div className="chat-context"><span className="agent-label" style={{ color: agent?.color }}>{agent?.label}</span><span className="chat-folder" title={session.cwd}>{session.cwd.split(/[\\/]/).filter(Boolean).slice(-1)[0]}</span>{hasConversationView(session) && <div className="chat-view-toggle" role="group" aria-label={t('chats.chatViewAria')}>{([['conversation', 'chats', t('chats.viewConversation')], ['terminal', 'terminal', t('chats.viewTerminal')]] as const).map(([value, icon, label]) => <button key={value} aria-pressed={view === value} onClick={() => showView(value)}><Icon name={icon} size={12} />{label}</button>)}</div>}{view === 'conversation' && <ConversationTransfer key={session.id} session={session} connected={state.connected} />}{view === 'terminal' && <><button className="desk-icon" title={t('chats.attachPathsTitle', { mod: modLabel })} aria-label={t('chats.attachFilesAria')} onClick={() => window.dispatchEvent(new Event('mrmak-attach-file'))}><Icon name="attach" size={16} /></button><DictationComposer key={`dictation-${session.id}`} id={session.id} connected={state.connected} running={session.status === 'running'} /></>}<button className="desk-icon" title={t('chats.chatOptions')} onClick={() => setMenu(!menu)}><Icon name="more" size={18} /></button></div>
      {menu && <div className="chat-options">{renaming ? <form className="inline-rename" onSubmit={rename}><input autoFocus value={title} onChange={event => setTitle(event.target.value)} aria-label={t('chats.englishChatNameAria')} /><button type="submit">{t('common.save')}</button></form> : <button onClick={() => { setTitle(session.name); setRenaming(true) }}>{t('chats.renameChat')}</button>}<button onClick={() => api(`/sessions/${session.id}`, { pinned: !session.pinned }, 'PATCH').catch(reportError)}>{session.pinned ? t('chats.unpinFromHistory') : t('chats.pinInHistory')}</button><button onClick={() => api('/reveal', { path: session.cwd }).catch(reportError)}>{t('chats.showWorkingFolder')}</button><button onClick={() => api(`/sessions/${session.id}/clear`, {}).then(() => setMenu(false)).catch(reportError)} title={t('chats.clearScrollbackTitle')}>{t('chats.clearScrollback')}</button><div className="group-setting"><span>{t('chats.groupLabel')}</span><GroupPicker value={session.group} groups={groups} onChange={value => api(`/sessions/${session.id}`, { group: value }, 'PATCH').catch(reportError)} /></div><div className="chat-color-setting"><span>{t('chats.tabColor')}</span><div role="group" aria-label={t('chats.tabColor')}><button className={`tab-color-swatch no-color ${!session.tabColor ? 'selected' : ''}`} aria-label={t('chats.noTabColor')} aria-pressed={!session.tabColor} onClick={() => api(`/sessions/${session.id}`, { tabColor: null }, 'PATCH').catch(reportError)} title={t('chats.noColor')} />{tabColors.map(color => { const colorName = localizeTabColor(lang, color.name); return <button key={color.value} className={`tab-color-swatch ${session.tabColor === color.value ? 'selected' : ''}`} style={{ '--swatch': color.value } as React.CSSProperties} aria-label={t('chats.namedTabColor', { color: colorName })} aria-pressed={session.tabColor === color.value} title={colorName} onClick={() => api(`/sessions/${session.id}`, { tabColor: color.value }, 'PATCH').catch(reportError)} /> })}</div></div><div className="terminal-appearance-setting"><span>{t('settings.terminalAppearance')} <small>{t('chats.allChatsSmall')}</small></span><div role="group" aria-label={t('settings.terminalAppearance')}>{[['original', t('settings.terminalOriginal')], ['focus', t('settings.terminalFocusShort')]].map(([value, label]) => <button key={value} aria-pressed={(state.settings.terminalAppearance || 'original') === value} onClick={() => api('/settings', { terminalAppearance: value }).catch(reportError)}>{label}</button>)}</div><p><i className="legend-user" />{t('common.you')} <i className="legend-agent" />{t('chats.legendAgent')} <i className="legend-detail" />{t('chats.legendDetails')}</p></div><div className="option-select-setting"><span>{t('chats.suggestFreshChat')} <small>{t('chats.suggestFreshChatSub')}</small></span><select aria-label={t('chats.suggestFreshChatAria')} value={state.settings.handoffAt ?? 70} onChange={event => api('/settings', { handoffAt: Number(event.target.value) }).catch(reportError)}>{[[0, t('common.off')], [50, t('chats.contextPercentFull', { percent: 50 })], [70, t('chats.contextPercentFull', { percent: 70 })], [85, t('chats.contextPercentFull', { percent: 85 })]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="option-select-setting"><span>{t('chats.cliEvents')} <small>{t('chats.cliEventsSub')}</small></span><select aria-label={t('chats.cliEvents')} value={state.settings.systemEvents || 'compact'} onChange={event => api('/settings', { systemEvents: event.target.value }).catch(reportError)}>{[['compact', t('chats.cliEventsCompact')], ['full', t('chats.cliEventsFull')], ['hidden', t('chats.cliEventsHidden')]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="font-control"><span>{t('chats.terminalText')}</span><button onClick={() => changeFont(-1)}>−</button><span>{fontSize}</span><button onClick={() => changeFont(1)}>+</button></div><button onClick={() => { closeChat(session.id); setMenu(false) }}>{t('chats.closeTabKeepHistory')}</button></div>}
      <ContextUsage session={session} connected={state.connected} />
      {hasConversationView(session) && <HandoffOffer key={`handoff-${session.id}`} session={session} threshold={state.settings.handoffAt ?? 70} agentLabel={agent?.label || session.agent} />}
      <div className="chat-skill-stage"><ChatSkillRail key={session.id} session={session} connected={state.connected} /><div className="chat-skill-content">
      {view === 'conversation' ? <Conversation key={session.id} session={session} connected={state.connected} agentLabel={agent?.label || session.agent} openTerminal={() => showView('terminal', false)} systemEvents={state.settings.systemEvents} /> : <TerminalPane key={session.id} id={session.id} agent={session.agent} fontSize={fontSize} appearance={state.settings.terminalAppearance || 'original'} optionMeta={!!state.settings.terminalOptionMeta} onAttachmentStatus={attachmentStatus} />}
      </div></div>
      {!running && <div className="terminal-reconnect"><span>{session.restoreError ? serviceMessage(session.restoreError) : t('chats.reconnectingConversation')}</span><button onClick={() => api(`/sessions/${session.id}/resume`, {}).catch(reportError)}>{t('common.reconnect')}</button></div>}
      <footer className="chat-status">{attachmentNotice.id === session.id && attachmentNotice.text ? <span className="attachment-status" role="status"><Icon name="attach" size={12} /><span>{attachmentNotice.text}</span></span> : <><span><i className={state.connected ? 'connected-dot' : 'disconnected-dot'} />{state.connected ? running ? t('chats.connectedAutosaved') : t('common.reconnecting') : t('common.reconnecting')}</span><span>{hasConversationView(session) && <><ModelMenu key={session.id} session={session} model={model} modelName={modelName} effort={effort} running={running} onOpenTerminal={() => showView('terminal', false)} /> · </>}{!hasConversationView(session) && session.effort && `${localizeEffort(lang, session.effort, true)} · `}<span title={t('chats.terminalPermissions')}>{session.agent === 'shell' ? (isMac ? 'macOS' : isWindows ? 'Windows' : t('platform.local')) : session.bypass ? t('chats.bypassShort') : t('chats.cliPermissions')}</span></span><span className="status-shortcut">{t('chats.pasteImageHint', { mod: modLabel })}</span></>}</footer>
    </> : <div className="chats-empty"><div className="empty-orbit"><MakLogo size={64} variant="chats" /></div><span className="desk-eyebrow">{t('chats.emptyEyebrow')}</span><h1>{t('chats.emptyTitleLine1')}<br />{t('chats.emptyTitleLine2')}</h1><p>{t('chats.emptyBodyLine1')}<br />{t('chats.emptyBodyLine2')}<br />{t('chats.emptyBodyLine3')}</p><button className="desk-primary" onClick={() => setNewChat(true)}><Icon name="plus" size={17} />{t('chats.openFirstChat')}</button><div className="empty-agent-names"><span>Claude</span><span>Codex</span><span>OpenCode</span><span>Kimi</span></div><small>{t('chats.emptyFootnote')}</small></div>}
    </div>
    {newChat && <NewChat close={() => setNewChat(false)} />}
  </div>
}
