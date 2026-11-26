import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import '../styles/report.css'
import { downloadImage } from '../lib/download'
import { useT } from '../lib/i18n'

export default function ImagePreview({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const { t } = useT()
  const dialog = useRef<HTMLDialogElement>(null)
  const [actual, setActual] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { const current = dialog.current; current?.showModal(); return () => current?.close() }, [])
  // StrictMode closes and reopens the dialog during its effect check. Ignore a
  // queued close event if the dialog has already reopened.
  return createPortal(<dialog ref={dialog} className="mak-lightbox" aria-label={t('image.previewAria')} onClose={event => { if (!event.currentTarget.open) onClose() }}><div className="mak-lightbox-toolbar"><span className="mak-lightbox-caption">{title}</span><button onClick={() => setActual(value => !value)}>{actual ? t('image.fit') : '100%'}</button><a href={url} target="_blank" rel="noreferrer">{t('common.openOriginal')}</a><button onClick={() => void downloadImage(url).catch(error => setError(error.message))}>{t('common.download')}</button><button onClick={() => dialog.current?.close()}>{t('common.close')}</button></div><div className={`mak-lightbox-stage${actual ? ' actual' : ''}`}><img src={url} alt={title} onClick={() => setActual(value => !value)} onError={() => setError(t('image.loadFailed'))} /></div><p className="mak-lightbox-note" role="status">{error || t('image.escToClose')}</p></dialog>, document.body)
}

export function ZoomImage({ src, alt = '', onError }: { src?: string; alt?: string; onError?: () => void }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  if (!src) return <span>{alt}</span>
  return <><a href={src} target="_blank" rel="noreferrer" title={t('image.openTitle')} onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); setOpen(true) } }}><img src={src} alt={alt} loading="lazy" onError={onError} /></a>{open && <ImagePreview url={src} title={alt || t('image.fallbackTitle')} onClose={() => setOpen(false)} />}</>
}
