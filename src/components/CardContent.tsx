import { cardSourceUrl, type CardDocument } from '../../desktop/service/card-schema.mjs'
import { MarkdownView } from './MarkdownDocument'
import { ZoomImage } from './ImagePreview'
import { useT, type MessageKey } from '../lib/i18n'
import '../styles/editable-cards.css'

const statusKeys: Record<string, MessageKey> = {
  idea: 'cardDoc.statusIdea',
  'in-progress': 'cardDoc.statusInProgress',
  review: 'cardDoc.statusReview',
  done: 'cardDoc.statusDone',
}

export default function CardContent({ document, baseUrl }: { document: CardDocument; baseUrl: string }) {
  const { t } = useT()
  const base = new URL(baseUrl, window.location.href).href
  return <article className={`card-content card-template-${document.template}`}>
    <header className="card-document-heading">
      <div className="card-kicker"><span>{document.template === 'gallery' ? t('newCard.gallery') : t('newCard.research')}</span><span>{t(document.items.length === 1 ? 'cardDoc.entryOne' : 'cardDoc.entryMany', { count: document.items.length })}</span></div>
      <h1>{document.title}</h1>
      {document.summary && <div className="card-prose card-introduction"><MarkdownView text={document.summary} baseUrl={base} /></div>}
    </header>
    <div className="card-entries">
      {document.items.map((item, index) => <section className="card-entry" key={item.id} data-entry-id={item.id}>
        {item.image && <div className="card-entry-image"><ZoomImage src={new URL(item.image, base).href} alt={item.alt || item.title} /></div>}
        <div className="card-entry-copy">
          <div className="card-entry-meta"><span className="card-entry-number">{String(index + 1).padStart(2, '0')}</span>{item.status && <span className={`card-entry-status status-${item.status}`}>{statusKeys[item.status] ? t(statusKeys[item.status]) : item.status}</span>}</div>
          <h2>{item.title}</h2>
          {item.body && <div className="card-prose"><MarkdownView text={item.body} baseUrl={base} /></div>}
          {cardSourceUrl(item.url) && <a className="card-source" href={cardSourceUrl(item.url)} target="_blank" rel="noopener noreferrer">{item.linkLabel || t('cardDoc.sourceDefault')} <span aria-hidden="true">↗</span></a>}
          {item.prompt && <details className="card-prompt"><summary>{t('cardDoc.prompt')}</summary><pre>{item.prompt}</pre></details>}
        </div>
      </section>)}
    </div>
    {!document.items.length && <p className="card-empty">{t('cardDoc.noEntries')}</p>}
  </article>
}
