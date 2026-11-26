import { useEffect, useId, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { useT, type MessageKey } from '../lib/i18n'
import { api } from './client'
import { Icon } from './Icons'
import type { ChatSession } from './types'
import './chat-skills.css'

type State = 'loaded' | 'available' | 'unknown' | 'disabled'
type Scope = 'project' | 'user' | 'plugin' | 'bundled' | 'runtime'
type Reason = 'managed' | 'synced' | 'protected'
interface Skill {
  id: string
  name: string
  description: string
  scope: Scope
  status: State
  current: boolean | null
  next: boolean | null
  canOverride: boolean
  icon?: string
}
interface Catalog { entries: Skill[]; runtimeObservation: boolean }
interface Detail { path: string; instructions: string; revision: string; reason: Reason | null }

const states: Record<State, MessageKey> = { loaded: 'chatSkill.loaded', available: 'chatSkill.available', unknown: 'chatSkill.unknown', disabled: 'chatSkill.disabled' }
const scopes: Record<Scope, MessageKey> = { project: 'chatSkill.project', user: 'chatSkill.user', plugin: 'chatSkill.plugin', bundled: 'chatSkill.bundled', runtime: 'chatSkill.runtime' }
const reasons: Record<Reason, MessageKey> = { managed: 'chatSkill.managed', synced: 'chatSkill.synced', protected: 'chatSkill.readOnly' }
const mark = (name: string) => name.split(/[-_: .]+/).filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase()

export default function ChatSkillRail({ session, connected }: { session: ChatSession; connected: boolean }) {
  const { t, serviceMessage } = useT()
  const panel = useId()
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [catalogError, setCatalogError] = useState(false)
  const [saved, setSaved] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const closeButton = useRef<HTMLButtonElement | null>(null)
  const endpoint = `/sessions/${session.id}/skills`
  const skill = catalog?.entries.find(item => item.id === selected)
  const detailId = skill && skill.scope !== 'runtime' ? skill.id : undefined

  useEffect(() => {
    if (!connected) return
    const request = new AbortController()
    api<Catalog>(endpoint, undefined, undefined, { signal: request.signal }).then(value => {
      if (!request.signal.aborted) { setCatalog(value); setCatalogError(false) }
    }).catch(() => { if (!request.signal.aborted) setCatalogError(true) })
    return () => request.abort()
  }, [connected, endpoint, refresh, session.skillEvidenceVersion, session.status])

  useEffect(() => {
    if (!detailId || !connected) return
    const request = new AbortController()
    api<Detail>(`${endpoint}?skill=${encodeURIComponent(detailId)}`, undefined, undefined, { signal: request.signal })
      .then(value => { if (!request.signal.aborted) setDetail(value) })
      .catch(failure => { if (!request.signal.aborted) setError(String(failure.message || failure)) })
    return () => request.abort()
  }, [connected, detailId, endpoint])

  useEffect(() => { if (selected) closeButton.current?.focus() }, [selected])

  function show(id: string, button: HTMLButtonElement) {
    if (saving) return
    trigger.current = button
    setSelected(id); setDetail(null); setError(''); setDraft(null); setSaved(false)
    if (selected === id) setSelected(null)
  }

  function close() {
    if (saving) return
    setSelected(null); setDraft(null)
    trigger.current?.focus()
  }

  async function write(enabled?: boolean) {
    if (!skill || saving) return
    setError(''); setSaved(false); setSaving(true)
    try {
      if (enabled !== undefined) {
        const next = await api<Catalog>(endpoint, { action: 'setEnabled', skill: skill.id, enabled })
        setCatalog(next)
        setRefresh(value => value + 1)
      } else if (draft !== null && detail) {
        const written = await api<Detail>(endpoint, { action: 'save', skill: skill.id, revision: detail.revision, instructions: draft })
        setDetail(written); setDraft(null); setSaved(true)
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally { setSaving(false) }
  }

  const entries = catalog?.entries || []
  return <>
    <aside className="chat-skill-rail" aria-label={t('chatSkill.title')} data-preserve-terminal-focus>
      {entries.length ? entries.map(item => {
        const label = t('chatSkill.badge', { name: item.name, status: t(states[item.status]) })
        return <button type="button" key={item.id} className="chat-skill-badge" data-status={item.status}
          title={label} aria-label={label} aria-current={selected === item.id ? 'true' : undefined}
          aria-expanded={selected === item.id} aria-controls={selected === item.id ? panel : undefined}
          onClick={event => show(item.id, event.currentTarget)}>
          <span aria-hidden="true">{item.icon ? <img alt="" src={item.icon} /> : mark(item.name) || <Icon name="skills" size={15} />}</span><i aria-hidden="true" />
        </button>
      }) : <button type="button" className="chat-skill-badge" data-status="unknown" title={t('chatSkill.title')} aria-label={t('chatSkill.title')}
        aria-expanded={selected === 'overview'} aria-controls={selected === 'overview' ? panel : undefined}
        onClick={event => show('overview', event.currentTarget)}><Icon name="skills" size={16} /></button>}
    </aside>
    {selected && <section id={panel} className="chat-skill-panel" aria-label={skill?.name || t('chatSkill.title')} data-preserve-terminal-focus
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }}>
      <header><div><small>{t('chatSkill.title')}</small><h2>{skill?.name || t('chatSkill.overview')}</h2></div>
        <button type="button" className="desk-icon" ref={closeButton} onClick={close} disabled={saving} aria-label={t('common.close')}><Icon name="close" size={15} /></button>
      </header>
      <div className="chat-skill-panel-body">
        {skill ? <>
          <span className="chat-skill-state" data-status={skill.status}><i aria-hidden="true" />{t(states[skill.status])}</span>
          {skill.description && <p>{skill.description}</p>}
          <dl>
            <dt>{t('chatSkill.scope')}</dt><dd>{t(scopes[skill.scope])}</dd>
            {detail && <><dt>{t('chatSkill.file')}</dt><dd><code>{detail.path}</code></dd></>}
            {skill.scope !== 'runtime' && <><dt>{t('chatSkill.localCatalog')}</dt><dd>{t('chatSkill.discovered')}</dd></>}
          </dl>
          {skill.status === 'loaded' && <small>{t('chatSkill.confirmation')}</small>}
          {(skill.status === 'unknown' || skill.status === 'available') && <small>{t('chatSkill.noTelemetry')}</small>}
          {skill.scope === 'runtime' && <small>{t('chatSkill.noSource')}</small>}
          <section className="chat-skill-settings" aria-label={t('chatSkill.chatSetting')}>
            <h3>{t('chatSkill.chatSetting')}</h3>
            {skill.canOverride ? <>
              <p>{t('chatSkill.nextLaunch')}</p>
              {skill.current !== null && <small>{t(skill.current ? 'chatSkill.enabledNow' : 'chatSkill.disabledNow')}</small>}
              {skill.next !== null && skill.current !== skill.next && <small role="status">{t(skill.next ? 'chatSkill.enabledNext' : 'chatSkill.disabledNext')}</small>}
              <div className="chat-skill-actions">
                <button type="button" disabled={saving || !connected || skill.next === true} onClick={() => void write(true)}>{t('chatSkill.enable')}</button>
                <button type="button" disabled={saving || !connected || skill.next === false} onClick={() => void write(false)}>{t('chatSkill.disable')}</button>
              </div>
            </> : <small>{t('chatSkill.noOverride')}</small>}
          </section>
          {detail && <section aria-label={t('chatSkill.instructions')} className="chat-skill-instructions">
            <h3>{t('chatSkill.instructions')}</h3>
            {draft === null ? <>
              {detail.reason
                ? <small>{t(reasons[detail.reason])}</small>
                : <button type="button" disabled={!connected || saving} className="chat-skill-edit" onClick={() => { setSaved(false); setDraft(detail.instructions) }}><Icon name="edit" size={13} />{t('chatSkill.edit')}</button>}
              <div className="chat-skill-markdown"><ReactMarkdown components={{ img: () => null, a: ({ children }) => <span>{children}</span> }}>{detail.instructions}</ReactMarkdown></div>
            </> : <>
              <small>{t('chatSkill.editScope')}</small>
              <textarea aria-label={t('chatSkill.instructions')} rows={8} value={draft} onChange={event => setDraft(event.target.value)} disabled={saving} />
              <div className="chat-skill-actions">
                <button type="button" onClick={() => { setDraft(null); setError('') }} disabled={saving}>{t('common.cancel')}</button>
                <button type="button" onClick={() => void write()} disabled={saving || !connected || !draft.trim() || draft === detail.instructions}>{t('common.save')}</button>
              </div>
            </>}
          </section>}
          {!detail && skill.scope !== 'runtime' && !error && <small role="status">{t('chatSkill.loading')}</small>}
        </> : <>
          <p>{t(catalogError ? 'chatSkill.readFailed' : catalog ? 'chatSkill.empty' : 'chatSkill.loading')}</p>
          <p>{t('chatSkill.noTelemetry')}</p>
          {catalogError && <button type="button" onClick={() => setRefresh(value => value + 1)}>{t('common.retry')}</button>}
        </>}
        {error && <p className="chat-skill-error" role="alert">{serviceMessage(error)}</p>}
        {saved && <p role="status">{t('chatSkill.saved')}</p>}
      </div>
    </section>}
  </>
}
