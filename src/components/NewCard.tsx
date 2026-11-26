import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../desktop/client'
import { entityHash } from '../lib/route'
import type { WorkspaceEntity } from '../types'
import type { CardTemplate } from '../../desktop/service/card-schema.mjs'
import { useT } from '../lib/i18n'
import '../styles/editable-cards.css'

function NewCardDialog({ onClose }: { onClose: () => void }) {
  const { t, serviceMessage } = useT()
  const dialog = useRef<HTMLDialogElement>(null)
  const [title, setTitle] = useState(''), [template, setTemplate] = useState<CardTemplate>('gallery')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close() }, [])
  async function create() {
    if (busy || !title.trim()) return
    setBusy(true); setError('')
    try {
      const { entity } = await api<{ entity: WorkspaceEntity }>('/workspace/cards', { title, template })
      window.dispatchEvent(new Event('mrmak-workspace-changed')); location.hash = entityHash(entity.id)
      onClose()
    } catch (error) { setError(serviceMessage(error instanceof Error ? error.message : String(error))); setBusy(false) }
  }
  return createPortal(<dialog ref={dialog} className="new-card-dialog" aria-label={t('newCard.dialogAria')} onCancel={event => { event.preventDefault(); if (!busy) onClose() }} onKeyDown={event => event.stopPropagation()}><form onSubmit={event => { event.preventDefault(); void create() }}>
    <div className="new-card-heading"><div><span>{t('newCard.eyebrow')}</span><h2>{t('newCard.heading')}</h2></div><button type="button" aria-label={t('newCard.close')} disabled={busy} onClick={onClose}>×</button></div>
    <label>{t('newCard.titleLabel')}<input autoFocus required maxLength={200} placeholder={t('newCard.titlePlaceholder')} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} /></label>
    <fieldset disabled={busy} className="new-card-templates"><legend>{t('newCard.viewLegend')}</legend>{(['gallery', 'research'] as const).map(value => <label key={value} className={template === value ? 'selected' : ''}><input type="radio" name="template" value={value} checked={template === value} onChange={() => setTemplate(value)} /><strong>{value === 'gallery' ? t('newCard.gallery') : t('newCard.research')}</strong><span>{value === 'gallery' ? t('newCard.galleryDesc') : t('newCard.researchDesc')}</span></label>)}</fieldset>
    <p className="new-card-hint">{t('newCard.hint')}</p>
    {error && <p className="card-error" role="alert">{error}</p>}
    <footer><button type="button" disabled={busy} onClick={onClose}>{t('common.cancel')}</button><button type="submit" className="card-primary" disabled={busy || !title.trim()}>{busy ? t('newCard.creating') : t('newCard.create')}</button></footer>
  </form></dialog>, document.body)
}

export default function NewCard() {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  return <><button ref={button} className="new-card-button" onClick={() => setOpen(true)}>{t('newCard.button')}</button>{open && <NewCardDialog onClose={() => { setOpen(false); button.current?.focus() }} />}</>
}
