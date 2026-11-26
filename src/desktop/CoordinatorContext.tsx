import { useEffect, useState } from 'react'
import { useT } from '../lib/i18n'
import { api } from './client'
import type { ContextSource, LocalContext } from './types'

function Source({ source }: { source: ContextSource }) {
  const { t } = useT()
  return <details className="coordinator-source">
    <summary><code>{source.path}</code></summary>
    <p>{source.text}</p>
    {source.truncated && <small>{t('voice.contextExcerpt')}</small>}
  </details>
}

export default function CoordinatorContext() {
  const { lang, t, serviceMessage } = useT()
  const [context, setContext] = useState<LocalContext | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const request = new AbortController()
    api<LocalContext>('/coordinator/context', undefined, undefined, { signal: request.signal })
      .then(setContext)
      .catch(error => { if (!request.signal.aborted) setError(serviceMessage(String(error.message || error))) })
      .finally(() => { if (!request.signal.aborted) setLoading(false) })
    return () => request.abort()
  }, [refresh, serviceMessage])

  return <div className="coordinator-context">
    <div className="coordinator-context-heading">
      <span>{t('voice.contextLocal')}</span>
      <button className="desk-secondary" disabled={loading} onClick={() => { setLoading(true); setError(''); setRefresh(value => value + 1) }}>{t('voice.contextRefresh')}</button>
    </div>
    {loading && <p className="desk-muted" role="status">{t('voice.contextLoading')}</p>}
    {error && <p className="voice-error" role="alert">{error}</p>}
    {context && <>
      <section>
        <h3>{t('voice.contextToday')}</h3>
        <p><time dateTime={context.day.observedAt}>{new Intl.DateTimeFormat(lang, { dateStyle: 'full', timeStyle: 'short', timeZone: context.day.timeZone }).format(new Date(context.day.observedAt))}</time> · {context.day.timeZone}</p>
        {context.daily.available ? <Source source={context.daily} /> : <p className="desk-muted">{t('voice.contextNoNote', { path: context.daily.path })}</p>}
      </section>
      <section>
        <h3>{t('voice.contextComputer')}</h3>
        <p>{context.computer.os} {context.computer.release} · {context.computer.architecture}<br />{t('voice.contextHardware', { cpu: context.computer.logicalCpus, ram: context.computer.memoryGiB })}</p>
      </section>
      <section>
        <h3>{t('voice.contextProfile')}</h3>
        {context.profile.length ? context.profile.map(source => <Source source={source} key={source.path} />) : <p className="desk-muted">{t('voice.contextNoProfile')}</p>}
      </section>
    </>}
  </div>
}
