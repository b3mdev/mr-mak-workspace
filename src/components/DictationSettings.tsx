import { useState } from 'react'
import type { DictationInfo } from '../mobile/client'
import { useT, type MessageKey } from '../lib/i18n'
import './dictation-settings.css'

const providerLabelKey: Record<string, MessageKey> = {
  local: 'dictation.provider.local',
  openai: 'dictation.provider.openai',
  openrouter: 'dictation.provider.openrouter',
  off: 'dictation.provider.off',
}

const providerDetailKey: Record<string, MessageKey> = {
  local: 'dictation.detail.local',
  openai: 'dictation.detail.openai',
  openrouter: 'dictation.detail.openrouter',
  off: 'dictation.detail.off',
}

export default function DictationSettings({ info, onChange, disabled = false }: { info?: DictationInfo; onChange: (provider: string) => Promise<DictationInfo>; disabled?: boolean }) {
  const { t, serviceMessage } = useT()
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function change(provider: string) {
    setBusy(true); setError('')
    try { await onChange(provider) } catch (error) { setError(serviceMessage(error instanceof Error ? error.message : String(error))) }
    finally { setBusy(false) }
  }
  const selected = info?.providers?.find(item => item.id === info.provider)
  const providers = info?.providers || [
    { id: 'local', label: t('dictation.provider.local') },
    { id: 'openai', label: t('dictation.provider.openai') },
    { id: 'openrouter', label: t('dictation.provider.openrouter') },
    { id: 'off', label: t('dictation.provider.off') },
  ]
  const detailText = selected ? (providerDetailKey[selected.id] ? t(providerDetailKey[selected.id]) : selected.detail) : ''
  return <section className="dictation-settings" aria-label={t('dictation.aria')}>
    <h3>{t('dictation.heading')}</h3>
    <label>{t('dictation.providerLabel')}<select aria-label={t('dictation.providerLabel')} value={info?.provider || 'local'} disabled={disabled || busy || !info} onChange={event => void change(event.target.value)}>
      {providers.map(provider => <option key={provider.id} value={provider.id}>{providerLabelKey[provider.id] ? t(providerLabelKey[provider.id]) : provider.label}</option>)}
    </select></label>
    <p>{detailText} {t('dictation.sharedHint')}</p>
    {selected && !selected.available && <p role="status">{selected.id === 'local' ? t('dictation.needsLocalSetup') : t('dictation.missingKey', { key: selected.id === 'openai' ? 'OPENAI_API_KEY' : 'OPENROUTER_API_KEY' })} {t('dictation.noAutoSwitch')}</p>}
    {error && <p role="alert">{error}</p>}
  </section>
}
