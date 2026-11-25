import { useState } from 'react'
import type { WorkspaceEntity } from '../types'
import { entityHash } from '../lib/route'
import { cardCover, cardIcon, cardImageUrl, cardPhase, cardProgress } from '../lib/card-meta'
import { categoryIcon } from '../lib/categories'
import { contentUrl } from '../desktop/client'
import { EntityStatusButton } from './EntityControls'
import { localizeCategory, useT } from '../lib/i18n'

/**
 * The design-system card: glass surface over the aura, gradient edge
 * (pink→purple; amber when pinned), glow + lift on hover. Building
 * block of the home grid; mirrored as `.mak-card` in
 * scripts/shared/report_style.py for generated reports.
 */
export default function MakCard({ entity, discoveredCover }: { entity: WorkspaceEntity; discoveredCover?: string }) {
  const { lang, t } = useT()
  const steps = entity.steps.length
  // Cover, phase and progress are optional; a card without them is unchanged.
  // A cover that fails to load is dropped, so it leaves no empty band.
  const cover = cardCover(entity), icon = cardIcon(entity)
  const coverUrl = cover ? contentUrl(cardImageUrl(entity, cover)) : discoveredCover || null
  const [failedCover, setFailedCover] = useState<string | null>(null)
  const showCover = coverUrl !== null && failedCover !== coverUrl
  const phase = cardPhase(entity)
  const progress = cardProgress(entity)
  return (
    <div className={`entity-card-wrap${showCover ? ' has-cover' : ''}`} data-card={entity.id}>
    <a
      href={entityHash(entity.id)}
      className={`mak-card entity-card${entity.pinned ? ' pinned' : ''}`}
      data-entity={entity.id}
    >
      {showCover && (
        <div className="card-cover">
          <img src={coverUrl} alt="" loading="lazy" decoding="async" onError={() => setFailedCover(coverUrl)} />
        </div>
      )}
      <div className="card-top">
        <span className="chip">
          <span aria-hidden="true">{categoryIcon(entity.category)}</span>
          {localizeCategory(lang, entity.category || 'other')}
        </span>
        {entity.pinned && <span className="chip chip-pin">{t('card.pinned')}</span>}
      </div>

      <div className="card-project-title">
        {icon && <img className="card-project-icon" src={contentUrl(cardImageUrl(entity, icon))} width="48" height="48" alt="" loading="lazy" decoding="async" />}
        <h3 className="card-title">{entity.title}</h3>
      </div>

      {entity.description && <p className="card-desc">{entity.description}</p>}

      {(phase || progress) && (
        <div className="card-status">
          {phase && (
            <span className="chip chip-phase" title={phase}>
              <span>{phase}</span>
            </span>
          )}
          {progress && (
            <div className="card-progress">
              <div className="card-progress-text" aria-hidden="true">
                <b>{progress.done}/{progress.total}</b>
                {progress.label && <span>{progress.label}</span>}
              </div>
              <div
                className="card-progress-bar"
                role="progressbar"
                aria-label={t('card.progress')}
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.done}
                aria-valuetext={t('card.progressValue', { done: progress.done, total: progress.total, label: progress.label ? ` ${progress.label}` : '' })}
              >
                <span style={{ width: `${progress.percent}%` }} />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="card-foot">
        <span>
          {t(steps === 1 ? 'card.stepOne' : 'card.stepMany', { count: steps })}
        </span>
        <span>·</span>
        <span>{entity.updated ?? entity.created}</span>
        <span className="card-open" aria-hidden="true">
          {t('card.open')}
        </span>
      </div>
    </a>
    <EntityStatusButton entity={entity} />
    </div>
  )
}
