import type { RefObject } from 'react'
import type { WorkspaceEntity } from '../types'
import { entityHash } from '../lib/route'
import { cardIcon, cardImageUrl } from '../lib/card-meta'
import { categoryIcon } from '../lib/categories'
import { contentUrl } from '../desktop/client'
import MakLogo from './MakLogo'
import MakText from './MakText'
import { EntityStatusButton } from './EntityControls'
import { localizeCategory, useT } from '../lib/i18n'

interface SidebarProps {
  pinned: WorkspaceEntity[]
  grouped: Map<string, WorkspaceEntity[]>
  activeId: string | null
  query: string
  onQuery: (q: string) => void
  searchRef: RefObject<HTMLInputElement | null>
  archivedCount: number
  showArchived: boolean
  onToggleArchived: () => void
  total: number
  offline: boolean
  lastSync: Date | null
  onCollapse: () => void
}

function Item({ entity, active }: { entity: WorkspaceEntity; active: boolean }) {
  const icon = cardIcon(entity)
  return (
    <div className="sidebar-item-row" data-card={entity.id}>
    <a
      href={entityHash(entity.id)}
      className={`sidebar-item${active ? ' active' : ''}${entity.pinned ? ' pinned' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      <span className="item-icon" aria-hidden="true">
        {icon ? <img src={contentUrl(cardImageUrl(entity, icon))} width="24" height="24" alt="" decoding="async" /> : categoryIcon(entity.category)}
      </span>
      <span className="item-text">{entity.title}</span>
    </a>
    <EntityStatusButton entity={entity} />
    </div>
  )
}

export default function Sidebar({
  pinned,
  grouped,
  activeId,
  query,
  onQuery,
  searchRef,
  archivedCount,
  showArchived,
  onToggleArchived,
  total,
  offline,
  lastSync,
  onCollapse,
}: SidebarProps) {
  const { lang, t, time } = useT()
  const empty = pinned.length === 0 && grouped.size === 0

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <MakLogo size={44} />
        <div className="brand-text">
          <MakText height={22} animated={activeId !== 'my-dream-game'} />
        </div>
        <button
          className="sidebar-collapse"
          onClick={onCollapse}
          title={t('workspace.hideMenuTitle')}
          aria-label={t('workspace.hideMenu')}
        >
          ‹
        </button>
      </div>

      <div className="sidebar-search">
        <span className="search-icon" aria-hidden="true">
          {'⌕'}
        </span>
        <input
          ref={searchRef}
          value={query}
          onChange={ev => onQuery(ev.target.value)}
          onKeyDown={ev => {
            if (ev.key === 'Escape') {
              onQuery('')
              ev.currentTarget.blur()
            }
          }}
          placeholder={t('workspace.searchPlaceholder')}
          aria-label={t('workspace.searchAria')}
        />
        {query && (
          <button className="search-clear" onClick={() => onQuery('')} aria-label={t('workspace.clearSearch')}>
            ×
          </button>
        )}
      </div>

      <nav className="sidebar-list">
        {pinned.length > 0 && (
          <div>
            <div className="sidebar-section">
              <span className="sidebar-label">{'\u{1F4CC}'} {t('workspace.pinned')}</span>
            </div>
            {pinned.map(e => (
              <Item key={e.id} entity={e} active={e.id === activeId} />
            ))}
          </div>
        )}

        {[...grouped.entries()].map(([cat, list]) => (
          <div key={cat}>
            <div className="sidebar-section">
              <span className="sidebar-label">{cat === 'by date' ? t('workspace.byDate') : localizeCategory(lang, cat)}</span>
              <span className="sidebar-count">{list.length}</span>
            </div>
            {list.map(e => (
              <Item key={e.id} entity={e} active={e.id === activeId} />
            ))}
          </div>
        ))}

        {empty && <div className="sidebar-empty">{t('workspace.sidebarEmpty')}</div>}

        {archivedCount > 0 && !query && (
          <button className="sidebar-archive-toggle" onClick={onToggleArchived}>
            {showArchived
              ? t('workspace.hideArchive', { count: archivedCount })
              : t('workspace.showArchive', { count: archivedCount })}
          </button>
        )}
      </nav>

      <footer className="sidebar-foot">
        <span className={`sync-dot${offline ? ' offline' : ''}`} />
        <span>
          {t('workspace.entitiesCount', { count: total })} ·{' '}
          {offline
            ? t('workspace.offline')
            : lastSync
              ? t('workspace.syncedAt', { time: time(lastSync) })
              : t('workspace.syncing')}
        </span>
      </footer>
    </aside>
  )
}
