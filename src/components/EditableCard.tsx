import { useEffect, useRef, useState, type DragEvent } from 'react'
import { api, isDesktop, onServiceEvent, uploadCardImage } from '../desktop/client'
import { CARD_MAX_ITEMS, cardStatuses, validateCard, validateCardDraft, type CardDocument, type CardItem } from '../../desktop/service/card-schema.mjs'
import CardContent from './CardContent'
import { useT, type MessageKey } from '../lib/i18n'

const cardStatusKeys: Record<string, MessageKey> = {
  idea: 'cardDoc.statusIdea',
  'in-progress': 'cardDoc.statusInProgress',
  review: 'cardDoc.statusReview',
  done: 'cardDoc.statusDone',
}

interface Snapshot { document: CardDocument; revision: string; warning?: string }
interface EditorState { saved: Snapshot | null; draft: CardDocument | null; latest: Snapshot | null; editing: boolean; saving: boolean; message: string; error: string }
const changed = (state: EditorState) => !!state.saved && JSON.stringify(state.draft) !== JSON.stringify(state.saved.document)
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)

export default function EditableCard({ url, entityId, step }: { url: string; entityId: string; step: number }) {
  const { t, serviceMessage } = useT()
  const route = `/workspace/cards/${encodeURIComponent(entityId)}/${step}`
  const draftKey = `mrmak.card-draft.${entityId}.${step}`
  const [state, setState] = useState<EditorState>({ saved: null, draft: null, latest: null, editing: false, saving: false, message: '', error: '' })
  const [removed, setRemoved] = useState<{ item: CardItem; index: number } | null>(null)
  const mutation = useRef(0)
  const scroller = useRef<HTMLElement>(null)
  const dragged = useRef<string | null>(null)
  const dirty = changed(state)
  useEffect(() => { scroller.current?.scrollTo(0, 0) }, [state.editing])
  useEffect(() => {
    let current = true, loading = false
    async function load() {
      if (loading || mutation.current % 2 || document.visibilityState === 'hidden') return
      const generation = mutation.current
      loading = true
      try {
        let snapshot: Snapshot
        if (isDesktop) snapshot = await api<Snapshot>(route)
        else {
          const response = await fetch(url, { cache: 'no-store' })
          if (!response.ok) throw new Error(t('cardDoc.unavailable', { status: response.status }))
          snapshot = { document: validateCard(await response.json()), revision: '' }
        }
        validateCard(snapshot.document)
        if (!current || generation !== mutation.current) return
        setState(previous => {
          if (previous.saving || generation !== mutation.current) return previous
          if (!previous.saved) {
            let recovery: { document: CardDocument; revision: string } | null = null
            if (isDesktop) {
              try { const stored = JSON.parse(sessionStorage.getItem(draftKey) || 'null'); if (stored?.document && typeof stored.revision === 'string') recovery = { document: validateCardDraft(stored.document), revision: stored.revision } } catch { /* A malformed recovery draft never replaces a valid source. */ }
            }
            return { ...previous, saved: recovery && recovery.revision !== snapshot.revision ? { ...snapshot, revision: recovery.revision } : snapshot, draft: recovery?.document || snapshot.document, latest: recovery && recovery.revision !== snapshot.revision ? snapshot : null, editing: !!recovery, message: recovery ? t('cardDoc.recoveredDraft') : '', error: '' }
          }
          if (changed(previous)) return { ...previous, latest: snapshot.revision !== previous.saved.revision ? snapshot : null }
          return { ...previous, saved: snapshot, draft: snapshot.document, latest: null, error: '' }
        })
      } catch (error) { if (current && generation === mutation.current) setState(previous => ({ ...previous, error: serviceMessage(errorText(error)) })) }
      finally { loading = false }
    }
    void load()
    const timer = window.setInterval(() => void load(), 5000)
    const refresh = () => void load()
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
    const off = onServiceEvent(event => { if (event.type === 'workspace-changed') void load() })
    return () => { current = false; clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); off() }
  }, [route, url, draftKey, t, serviceMessage])
  useEffect(() => {
    if (!isDesktop || !state.saved) return
    try { if (dirty) sessionStorage.setItem(draftKey, JSON.stringify({ document: state.draft, revision: state.saved.revision })); else sessionStorage.removeItem(draftKey) } catch { /* Keep the live draft even if session storage is full. */ }
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, state.draft, state.saved, draftKey])
  function edit(update: (document: CardDocument) => CardDocument) {
    setState(previous => previous.draft && !previous.saving ? { ...previous, draft: update(previous.draft), message: '', error: '' } : previous)
  }
  const itemEdit = (id: string, patch: Partial<CardItem>) => edit(document => ({ ...document, items: document.items.map(item => item.id === id ? { ...item, ...patch } : item) }))
  function add() { edit(document => ({ ...document, items: [...document.items, { id: crypto.randomUUID(), title: t('cardDoc.untitledEntry'), body: '', status: 'idea' }] })); setState(previous => ({ ...previous, editing: true })) }
  function move(id: string, to: number) {
    edit(document => { const items = [...document.items], index = items.findIndex(item => item.id === id); if (index < 0 || to < 0 || to >= items.length) return document; items.splice(to, 0, items.splice(index, 1)[0]); return { ...document, items } })
  }
  function dragStart(event: DragEvent, id: string) {
    dragged.current = id
    event.dataTransfer.setData('text/plain', id)
    event.dataTransfer.effectAllowed = 'move'
  }
  function dragOver(event: DragEvent) {
    // WebKit hides custom MIME data during dragover. Accept only a drag that
    // started in this editor, tracked locally; never interpret an external drop.
    if (dragged.current && !state.saving) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }
  }
  function drop(event: DragEvent, index: number) {
    const id = dragged.current
    if (id && !state.saving) { event.preventDefault(); move(id, index) }
    dragged.current = null
  }
  async function save() {
    if (!state.saved || !state.draft || state.saving || mutation.current % 2 || !dirty || state.latest) return
    try { validateCard(state.draft) } catch (error) { setState(previous => ({ ...previous, error: serviceMessage(errorText(error)) })); return }
    mutation.current++
    setState(previous => ({ ...previous, saving: true, error: '', message: '' }))
    try {
      const saved = await api<Snapshot>(route, { document: state.draft, revision: state.saved.revision }, 'PUT')
      // Clear recovery synchronously: a navigation immediately after Save must not resurrect it.
      try { sessionStorage.removeItem(draftKey) } catch { /* Storage is optional. */ }
      setState(previous => ({ ...previous, saved, draft: saved.document, latest: null, saving: false, message: saved.warning || t('common.saved'), error: '' }))
      setRemoved(null); window.dispatchEvent(new Event('mrmak-workspace-changed'))
    } catch (error) {
      setState(previous => ({ ...previous, saving: false, error: serviceMessage(errorText(error)) }))
      try { const latest = await api<Snapshot>(route); setState(previous => ({ ...previous, latest: latest.revision !== previous.saved?.revision ? latest : null })) } catch { /* The draft remains available while offline. */ }
    } finally { mutation.current++ }
  }
  async function image(id: string, file: File) {
    if (state.saving || mutation.current % 2) return
    mutation.current++
    setState(previous => ({ ...previous, saving: true, error: '' }))
    try {
      const result = await uploadCardImage(entityId, step, file)
      setState(previous => ({ ...previous, saving: false, draft: previous.draft && { ...previous.draft, items: previous.draft.items.map(item => item.id === id ? { ...item, image: result.image } : item) }, message: t('cardDoc.imageAdded') }))
    } catch (error) { setState(previous => ({ ...previous, saving: false, error: serviceMessage(errorText(error)) })) }
    finally { mutation.current++ }
  }
  const latest = state.latest
  if (!state.draft) return <div className="report-loading" role={state.error ? 'alert' : 'status'}>{state.error || t('workspace.openingCard')}</div>
  const card = state.draft
  return <section ref={scroller} className="editable-card" aria-label={t('cardDoc.editableAria', { title: card.title })} onKeyDown={event => { if (isDesktop && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save() } }}>
    <div className="card-editor-toolbar">
      {isDesktop ? <div className="card-mode-buttons" aria-label={t('cardDoc.modeAria')}><button aria-pressed={!state.editing} disabled={state.saving} onClick={() => setState(previous => ({ ...previous, editing: false }))}>{t('common.preview')}</button><button aria-pressed={state.editing} disabled={state.saving} onClick={() => setState(previous => ({ ...previous, editing: true }))}>{t('common.edit')}</button></div> : <span className="card-readonly">{t('cardDoc.readonly')}</span>}
      <span className="card-save-status" role="status">{state.saving ? t('common.saving') : dirty ? t('cardDoc.unsavedDraft') : state.message || t('cardDoc.upToDate')}</span>
      {isDesktop && <><button disabled={!dirty || state.saving} onClick={() => { mutation.current += 2; setState(previous => ({ ...previous, saved: previous.latest || previous.saved, draft: (previous.latest || previous.saved)!.document, latest: null, message: t('cardDoc.draftDiscarded'), error: '' })); setRemoved(null) }}>{t('common.discard')}</button><button className="card-primary" disabled={!dirty || state.saving || !!latest} onClick={() => void save()}>{t('common.save')}</button></>}
    </div>
    {state.error && <p className="card-feedback card-error" role="alert">{state.error}</p>}
    {state.message && dirty && <p className="card-feedback">{state.message}</p>}
    {latest && <div className="card-conflict" role="alert"><strong>{t('cardDoc.conflictTitle')}</strong><p>{t('cardDoc.conflictBody')}</p><details><summary>{t('cardDoc.reviewLatest')}</summary><CardContent document={latest.document} baseUrl={url} /></details><button disabled={state.saving} onClick={() => { mutation.current += 2; setState(previous => ({ ...previous, saved: latest, draft: latest.document, latest: null, message: t('cardDoc.loadedLatest'), error: '' })); setRemoved(null) }}>{t('cardDoc.discardAndLoad')}</button><button onClick={() => { const link = document.createElement('a'), objectUrl = URL.createObjectURL(new Blob([JSON.stringify(card, null, 2)], { type: 'application/json' })); link.href = objectUrl; link.download = 'recovered-draft.card.json'; link.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000) }}>{t('cardDoc.downloadDraft')}</button></div>}
    {state.editing && isDesktop ? <fieldset className="card-editor-form" disabled={state.saving}>
      <legend className="sr-only">{t('cardDoc.editLegend')}</legend>
      <div className="card-document-fields"><label>{t('cardDoc.pageTitle')}<input maxLength={200} value={card.title} onChange={event => edit(document => ({ ...document, title: event.target.value }))} /></label><label>{t('cardDoc.viewLabel')}<select aria-label={t('cardDoc.viewLabel')} value={card.template} onChange={event => edit(document => ({ ...document, template: event.target.value as CardDocument['template'] }))}><option value="gallery">{t('newCard.gallery')}</option><option value="research">{t('newCard.research')}</option></select></label><label className="card-wide-field">{t('cardDoc.introduction')} <small>{t('cardDoc.markdownSupported')}</small><textarea rows={3} maxLength={20000} value={card.summary || ''} onChange={event => edit(document => ({ ...document, summary: event.target.value }))} /></label></div>
      <div className="card-editor-section-heading"><h2>{t('cardDoc.entries')} <span>{card.items.length}</span></h2><button onClick={add} disabled={card.items.length >= CARD_MAX_ITEMS}>{t('cardDoc.addEntry')}</button></div>
      {card.items.length > 1 && <div className="card-entry-order" aria-label={t('cardDoc.entryOrderAria')}>{card.items.map((item, index) => <button key={item.id} type="button" draggable aria-label={t('cardDoc.reorderAria', { title: item.title })} onDragStart={event => dragStart(event, item.id)} onDragEnd={() => { dragged.current = null }} onDragOver={dragOver} onDrop={event => drop(event, index)}>{index + 1}<span>{item.title}</span><span aria-hidden="true">⠿</span></button>)}</div>}
      {removed && <div className="card-undo" role="status">{t('cardDoc.entryRemoved')} <button onClick={() => { edit(document => { const items = [...document.items]; items.splice(Math.min(removed.index, items.length), 0, removed.item); return { ...document, items } }); setRemoved(null) }}>{t('cardDoc.undoRemove')}</button></div>}
      <div className="card-editor-entries">{card.items.map((item, index) => <fieldset className="card-entry-editor" key={item.id} aria-label={t('cardDoc.entryAria', { index: index + 1 })} data-entry-id={item.id} onDragOver={dragOver} onDrop={event => drop(event, index)}>
        <legend>{String(index + 1).padStart(2, '0')} · {item.title || t('cardDoc.entryFallback')}</legend>
        <div className="card-entry-actions"><button type="button" className="card-drag-handle" draggable onDragStart={event => dragStart(event, item.id)} onDragEnd={() => { dragged.current = null }} aria-label={t('cardDoc.dragAria', { title: item.title })}>⠿ <span>{t('cardDoc.dragToReorder')}</span></button><button type="button" disabled={index === 0} onClick={() => move(item.id, index - 1)} aria-label={t('cardDoc.moveUpAria', { title: item.title })}>↑</button><button type="button" disabled={index === card.items.length - 1} onClick={() => move(item.id, index + 1)} aria-label={t('cardDoc.moveDownAria', { title: item.title })}>↓</button><button type="button" className="card-remove" onClick={() => { setRemoved({ item, index }); edit(document => ({ ...document, items: document.items.filter(entry => entry.id !== item.id) })) }}>{t('common.remove')}</button></div>
        <div className="card-entry-fields"><label>{t('cardDoc.entryTitle')}<input maxLength={200} value={item.title} onChange={event => itemEdit(item.id, { title: event.target.value })} /></label><label>{t('cardDoc.statusLabel')}<select aria-label={t('cardDoc.statusLabel')} value={item.status || ''} onChange={event => itemEdit(item.id, { status: event.target.value ? event.target.value as CardItem['status'] : undefined })}><option value="">{t('cardDoc.noStatus')}</option>{cardStatuses.map(status => <option key={status} value={status}>{cardStatusKeys[status] ? t(cardStatusKeys[status]) : status}</option>)}</select></label><label className="card-wide-field">{t('cardDoc.notesLabel')} <small>{t('cardDoc.markdownSupported')}</small><textarea rows={4} maxLength={40000} value={item.body || ''} onChange={event => itemEdit(item.id, { body: event.target.value })} /></label><label>{t('cardDoc.sourceUrl')}<input type="url" placeholder="https://" maxLength={2000} value={item.url || ''} onChange={event => itemEdit(item.id, { url: event.target.value })} /></label><label>{t('cardDoc.linkLabel')}<input placeholder={t('cardDoc.sourceDefault')} maxLength={120} value={item.linkLabel || ''} onChange={event => itemEdit(item.id, { linkLabel: event.target.value })} /></label></div>
        <details className="card-entry-extras" open={!!item.image || card.template === 'gallery'}><summary>{t('cardDoc.imageAndPrompt')}</summary>{item.image && <div className="card-edit-image"><img src={new URL(item.image, new URL(url, location.href)).href} alt={item.alt || item.title} /><button onClick={() => itemEdit(item.id, { image: '', alt: '' })}>{t('cardDoc.removeImage')}</button></div>}<label className="card-upload">{item.image ? t('cardDoc.replaceImage') : t('cardDoc.addImage')}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { const file = event.target.files?.[0]; if (file) void image(item.id, file); event.target.value = '' }} /></label><label>{t('cardDoc.imageDescription')}<input maxLength={500} value={item.alt || ''} onChange={event => itemEdit(item.id, { alt: event.target.value })} /></label><label>{t('cardDoc.prompt')}<textarea rows={4} maxLength={40000} value={item.prompt || ''} onChange={event => itemEdit(item.id, { prompt: event.target.value })} /></label></details>
      </fieldset>)}</div>
      {!card.items.length && <div className="card-empty"><p>{t('cardDoc.emptyEditor')}</p><button className="card-primary" onClick={add}>{t('cardDoc.addFirstEntry')}</button></div>}
    </fieldset> : <><CardContent document={card} baseUrl={url} />{isDesktop && !card.items.length && <div className="card-empty-action"><button className="card-primary" onClick={add}>{t('cardDoc.addFirstEntry')}</button></div>}</>}
  </section>
}
