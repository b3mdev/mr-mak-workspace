import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { WorkspaceEntity } from '../types'
import { api, isDesktop, reportError, setPreview, useDesktop } from '../desktop/client'
import { AgentLogo, Icon } from '../desktop/Icons'
import { projectKey } from '../desktop/chatOrder'
import type { ChatSession, GalleryProject, Preview, ProjectGallery, ProjectResult } from '../desktop/types'
import { categoryIcon } from '../lib/categories'
import { localizeCategory, useT, type MessageKey } from '../lib/i18n'
import MakCard from './MakCard'
import MakLogo from './MakLogo'
import AgentUsage from './AgentUsage'
import './project-home.css'

interface HomeGridProps {
  pinned: WorkspaceEntity[]
  grouped: Map<string, WorkspaceEntity[]>
  offline: boolean
  query: string
  onQuery: (value: string) => void
  searchRef: RefObject<HTMLInputElement | null>
  archivedCount: number
  showArchived: boolean
  onToggleArchived: () => void
}

const sourceKeys = { all: 'home.sourceAll', mrmak: 'home.sourceBento', codex: 'home.sourceCodex', claude: 'home.sourceClaude' } as const satisfies Record<string, MessageKey>
type Source = keyof typeof sourceKeys
type View = 'cards' | 'list'

const resultKeys: Record<ProjectResult['kind'], MessageKey> = {
  video: 'home.resultVideo', html: 'home.resultHtml', pdf: 'home.resultPdf', text: 'home.resultText', archive: 'home.resultArchive', document: 'home.resultDocument',
}
const searchable = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
const belongsTo = (item: GalleryProject, source: Source) => source === 'all' ||
  (source === 'mrmak' && item.sources.includes('workspace')) || item.sources.includes(source)
const projectTitle = (item: GalleryProject) => item.name.replace(/^[-_]+|[-_]+$/g, '').replace(/_/g, ' ') || item.name

function SourceMark({ source }: { source: Source }) {
  if (source === 'claude' || source === 'codex') return <AgentLogo agent={source} size={15} />
  return <Icon name={source === 'mrmak' ? 'workspace' : 'folder'} size={15} />
}

function SourceLabels({ project }: { project: GalleryProject }) {
  const { t } = useT()
  const labels = (['mrmak', 'codex', 'claude'] as const).filter(source => belongsTo(project, source))
  return <div className="project-source-labels">
    {labels.length ? labels.map(source => <span key={source} data-source={source}><SourceMark source={source} />{t(sourceKeys[source])}</span>)
      : <span><Icon name="folder" size={15} />{t('home.localFolder')}</span>}
  </div>
}

function Cover({ project, eager = false }: { project: GalleryProject; eager?: boolean }) {
  const [broken, setBroken] = useState<string | null>(null)
  return <div className="project-cover" aria-hidden="true">
    {project.cover && broken !== project.cover
      ? <img src={project.cover} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setBroken(project.cover)} />
      : <span className="project-cover-placeholder"><Icon name="folder" size={42} /></span>}
  </div>
}

function ProjectCard({ project, onOpen }: { project: GalleryProject; onOpen: () => void }) {
  const { t, date } = useT()
  const title = projectTitle(project)
  return <article className="project-card">
    <button type="button" className="project-card-button" onClick={onOpen} aria-label={t('home.viewProjectAria', { title })}>
      <Cover project={project} />
      <div className="project-card-copy">
        <SourceLabels project={project} />
        <h3 title={project.path}>{title}</h3>
        <p>{project.results[0]?.name ?? t('home.viewProjectFolder')}</p>
      </div>
      <span className="project-card-footer">
        {project.lastUsedAt && <time dateTime={project.lastUsedAt}>{date(project.lastUsedAt)}</time>}
        <span>{t('home.viewProject')}</span>
      </span>
    </button>
  </article>
}

function ProjectDetails({ project, onClose }: { project: GalleryProject; onClose: () => void }) {
  const { t, serviceMessage } = useT()
  const dialog = useRef<HTMLDialogElement>(null)
  const { agents, sessions } = useDesktop()
  const folder = projectKey(project.path)
  const conversations = sessions.filter(chat => projectKey(chat.cwd) === folder)
    .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt))
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState(false)
  const [openingChat, setOpeningChat] = useState<string | null>(null)
  const [chatError, setChatError] = useState('')
  useEffect(() => { dialog.current?.showModal() }, [])
  const openConversation = async (chat: ChatSession) => {
    setOpeningChat(chat.id)
    setChatError('')
    try {
      const action = chat.open && (chat.status === 'running' || chat.status === 'starting') ? 'focus' : 'resume'
      await api(`/sessions/${encodeURIComponent(chat.id)}/${action}`, {})
      dialog.current?.close()
    } catch (error) {
      setChatError(error instanceof Error ? error.message : String(error))
    } finally {
      setOpeningChat(null)
    }
  }
  const open = async (result: ProjectResult) => {
    setOpening(true)
    setError(false)
    try {
      const preview = await api<Preview>(`/preview?path=${encodeURIComponent(result.path)}`)
      setPreview(preview)
      dialog.current?.close()
    } catch { setError(true) }
    finally { setOpening(false) }
  }
  return <dialog ref={dialog} className="project-details" aria-labelledby="project-details-title" onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close() }}>
    <div className="project-details-inner">
      <header>
        <div><SourceLabels project={project} /><h2 id="project-details-title">{projectTitle(project)}</h2></div>
        <button type="button" className="project-icon-button" aria-label={t('home.closeProject')} onClick={() => dialog.current?.close()}><Icon name="close" /></button>
      </header>
      <p className="project-details-path">{project.path}</p>
      {project.cover && <Cover project={project} eager />}
      <section aria-labelledby="project-conversations-title" aria-busy={!!openingChat}>
        <h3 id="project-conversations-title">{t('home.conversationsHeading')}</h3>
        {conversations.length ? <ul>{conversations.map(chat => <li key={chat.id}>
          <button type="button" disabled={opening || !!openingChat} onClick={() => void openConversation(chat)} title={t('home.openInBentoChat', { name: chat.name })}>
            <AgentLogo agent={chat.agent} size={17} />
            <span>{chat.name}<small className="project-chat-meta">{agents.find(agent => agent.id === chat.agent)?.label || chat.agent} · {chat.open ? t('home.chatOpen') : t('home.chatHistory')}</small></span>
            <Icon name={openingChat === chat.id ? 'refresh' : 'arrow'} size={16} />
          </button>
        </li>)}</ul> : <p>{t('home.noConversations')}</p>}
        {chatError && <p role="alert">{t('home.chatOpenError', { error: serviceMessage(chatError) })}</p>}
      </section>
      <section aria-labelledby="project-results-title">
        <h3 id="project-results-title">{t('home.foundResultsHeading')}</h3>
        {project.results.length ? <ul>{project.results.map(result => <li key={result.path}>
          <button type="button" disabled={opening || !!openingChat} onClick={() => void open(result)} title={result.path}>
            <Icon name={result.kind === 'video' ? 'play' : 'files'} size={17} />
            <span>{result.name}</span><small>{t(resultKeys[result.kind])}</small>
          </button>
        </li>)}</ul> : <p>{t('home.noResults')}</p>}
        {error && <p role="alert">{t('home.resultOpenError')}</p>}
      </section>
      <button type="button" className="project-folder-button" onClick={() => api('/reveal', { path: project.path }).catch(reportError)}>
        <Icon name="folder" size={17} />{t('home.openFolder')}
      </button>
    </div>
  </dialog>
}

export default function HomeGrid({ pinned, grouped, offline, query, onQuery, searchRef, archivedCount, showArchived, onToggleArchived }: HomeGridProps) {
  const { lang, t } = useT()
  const [gallery, setGallery] = useState<ProjectGallery | null>(null)
  const [loading, setLoading] = useState(isDesktop)
  const [failed, setFailed] = useState(false)
  const [source, setSource] = useState<Source>('all')
  const [view, setView] = useState<View>(() => localStorage.getItem('mak.projectView') === 'list' ? 'list' : 'cards')
  const [selected, setSelected] = useState<GalleryProject | null>(null)
  const pending = useRef(false)
  const refresh = useCallback(async () => {
    if (!isDesktop || pending.current) return
    pending.current = true
    setLoading(true)
    try {
      setGallery(await api<ProjectGallery>('/workspace/projects'))
      setFailed(false)
    } catch { setFailed(true) }
    finally { pending.current = false; setLoading(false) }
  }, [])

  useEffect(() => {
    if (!isDesktop) return
    const whenVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    // Refresh on entry, focus and the Workspace's normal change notification.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
    window.addEventListener('focus', whenVisible)
    window.addEventListener('mrmak-workspace-changed', whenVisible)
    const timer = window.setInterval(whenVisible, 60_000)
    return () => {
      window.removeEventListener('focus', whenVisible)
      window.removeEventListener('mrmak-workspace-changed', whenVisible)
      window.clearInterval(timer)
    }
  }, [refresh])

  const allProjects = gallery?.projects ?? []
  const term = searchable(query.trim())
  const matches = (...fields: (string | undefined)[]) => !term || fields.some(field => field && searchable(field).includes(term))
  const projects = allProjects.filter(item => belongsTo(item, source) && matches(projectTitle(item), item.path, ...item.results.map(result => result.name)))
  const showReports = source === 'all' || source === 'mrmak'
  const reports = [...(pinned.length ? [['__pinned', pinned] as const] : []), ...grouped.entries()]
  const reportCount = reports.reduce((total, [, items]) => total + items.length, 0)
  const lead = allProjects.filter(item => item.cover && !item.sources.includes('workspace')).slice(0, 2)
  const visible = projects.length + (showReports ? reportCount : 0)
  const chooseView = (next: View) => { setView(next); localStorage.setItem('mak.projectView', next) }

  return <div className={`home project-home project-view-${view}`}>
    <div className="project-home-inner">
      <header className={`project-hero${lead.length ? ' has-art' : ''}`}>
        <div className="project-hero-copy">
          <div className="project-brand"><MakLogo size={34} />{t('brand.name')}</div>
          <h1>{t('home.projectsTitle')}</h1>
          <p>{t('home.heroSubtitle')}</p>
        </div>
        {lead.length > 0 && <div className="project-hero-art">
          {lead.map(item => <button type="button" key={item.path} onClick={() => setSelected(item)} aria-label={t('home.viewHighlight', { title: projectTitle(item) })}>
            <Cover project={item} eager /><span>{projectTitle(item)}</span>
          </button>)}
        </div>}
      </header>

      {isDesktop && <AgentUsage />}

      <div className="project-toolbar">
        <div className="project-source-filters" role="group" aria-label={t('home.sourceFilterAria')}>
          {(isDesktop ? Object.entries(sourceKeys) as [Source, MessageKey][] : [['all', sourceKeys.all]] as const).map(([key, labelKey]) =>
            <button key={key} type="button" aria-pressed={source === key} onClick={() => setSource(key)}><SourceMark source={key} />{t(labelKey)}</button>)}
        </div>
        <div className="project-actions">
          <label className="project-search"><Icon name="search" size={17} /><input type="search" ref={searchRef} aria-label={t('home.searchProjects')} placeholder={t('home.searchProjects')} value={query} onChange={event => onQuery(event.target.value)} /></label>
          <div className="project-view-switch" role="group" aria-label={t('home.viewAria')}>
            <button type="button" aria-pressed={view === 'cards'} onClick={() => chooseView('cards')} title={t('home.viewCardsTitle')}><Icon name="grid" size={16} />{t('home.viewCards')}</button>
            <button type="button" aria-pressed={view === 'list'} onClick={() => chooseView('list')} title={t('home.viewListTitle')}><Icon name="list" size={16} />{t('home.viewList')}</button>
          </div>
          {isDesktop && <button type="button" className="project-icon-button" onClick={() => void refresh()} disabled={loading} title={t('home.refreshCatalog')} aria-label={t('home.refreshCatalog')}><Icon name="refresh" size={17} /></button>}
        </div>
      </div>

      {failed && <p className="project-notice" role="status">{t('home.failedNotice')}</p>}
      {offline && <p className="project-notice" role="status">{t('home.offlineNotice')}</p>}
      {loading && !gallery && <p className="project-notice" role="status">{t('home.loadingNotice')}</p>}

      {projects.length > 0 && <section className="project-section" aria-labelledby="project-folders-title">
        <div className="project-section-header"><h2 id="project-folders-title">{t('home.foldersHeading')}</h2><span>{t(projects.length === 1 ? 'home.folderOne' : 'home.folderMany', { count: projects.length })}</span></div>
        <div className="project-gallery-grid">{projects.map(item => <ProjectCard key={item.path} project={item} onOpen={() => setSelected(item)} />)}</div>
      </section>}

      {showReports && (reportCount > 0 || (archivedCount > 0 && !term)) && <div className="project-section" role="region" aria-labelledby="project-reports-title">
        <div className="project-section-header">
          <h2 id="project-reports-title">{t('home.resultsHeading')}</h2>
          {archivedCount > 0 && !term && <button type="button" className="project-archive-button" aria-pressed={showArchived} onClick={onToggleArchived}>
            {showArchived ? t('home.hideArchived') : t('home.archivedCount', { count: archivedCount })}
          </button>}
        </div>
        {reports.map(([category, items]) => <section key={category} className="project-report-group">
          <h3 className="section-title">{category === '__pinned' ? `📌 ${t('workspace.pinnedTitle')}` : category === 'by date' ? t('workspace.byDateTitle') : `${categoryIcon(category)} ${localizeCategory(lang, category)}`}</h3>
          <div className="project-gallery-grid">{items.map(item => <MakCard key={item.id} entity={item} discoveredCover={gallery?.covers[item.id]} />)}</div>
        </section>)}
      </div>}

      {!loading && !visible && !failed && <p className="project-notice" role="status">{term ? t('home.emptySearch') : t('home.emptySource')}</p>}
    </div>
    {selected && <ProjectDetails key={selected.path} project={selected} onClose={() => setSelected(null)} />}
  </div>
}
