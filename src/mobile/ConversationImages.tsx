import { useEffect, useRef, useState } from 'react'
import ImageViewer, { type ConversationImage } from './ImageViewer'
import { Icon } from '../desktop/Icons'
import { useT } from '../lib/i18n'
import './conversation-images.css'

function SharedImage({ image, onOpen }: { image: ConversationImage; onOpen: () => void }) {
  const { t } = useT()
  const [failed, setFailed] = useState(false)
  if (image.kind === 'video') return <SharedVideo image={image} onOpen={onOpen} />
  if (!image.url || image.unavailable || failed) return <p className="mobile-image-unavailable">{t('media.imageUnavailable')}</p>
  return <figure className="mobile-conversation-image"><button type="button" aria-label={t('media.enlargeAria', { name: image.name })} onClick={onOpen}><img src={image.url} alt={image.name} loading="lazy" onError={() => setFailed(true)} /></button><figcaption>{image.name}<a href={`${image.url}?download=1`} download>{t('common.download')}</a></figcaption></figure>
}
function SharedVideo({ image, onOpen }: { image: ConversationImage; onOpen: () => void }) {
  const { t } = useT()
  if (!image.url || image.unavailable) return <p className="mobile-image-unavailable">{t('media.videoUnavailable')}</p>
  return <figure className="mobile-conversation-image mobile-conversation-video"><button type="button" aria-label={t('media.openVideoAria', { name: image.name })} onClick={onOpen}><Icon name="play" /> {image.name}</button><figcaption>{t('media.video')}<a href={`${image.url}?download=1`} download>{t('common.download')}</a></figcaption></figure>
}
function VideoViewer({ image, onClose }: { image: ConversationImage; onClose: () => void }) {
  const { t } = useT()
  const dialog = useRef<HTMLDialogElement>(null), video = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => { const node = dialog.current, player = video.current; node?.showModal(); return () => { player?.pause(); node?.close() } }, [])
  return <dialog ref={dialog} className="mobile-image-viewer" aria-label={t('media.videoPreviewAria')} onCancel={event => { event.preventDefault(); onClose() }}><header><button type="button" aria-label={t('media.closeVideo')} onClick={onClose}><Icon name="close" size={24} /></button><span>{image.name}</span><a href={`${image.url}?download=1`} download>{t('common.download')}</a></header><div className="mobile-video-stage">{failed ? <p role="status">{t('media.videoPlayError')}</p> : <video ref={video} src={image.url} controls playsInline preload="metadata" onError={() => setFailed(true)} />}</div></dialog>
}
export default function ConversationImages({ images }: { images?: ConversationImage[] }) {
  const [selected, setSelected] = useState<ConversationImage | null>(null)
  if (!images?.length) return null
  return <div className="mobile-conversation-images">{images.map((image, index) => <SharedImage key={image.url || index} image={image} onOpen={() => setSelected(image)} />)}{selected && (selected.kind === 'video' ? <VideoViewer image={selected} onClose={() => setSelected(null)} /> : <ImageViewer image={selected} onClose={() => setSelected(null)} />)}</div>
}
