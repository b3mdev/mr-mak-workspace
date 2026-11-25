import { useState } from 'react'
import { setUiLanguage, uiLanguageOptions, useT, type UiLanguage } from '../lib/i18n'

export default function LanguagePicker({ compact = false, disabled = false }: { compact?: boolean; disabled?: boolean }) {
  const { lang, t } = useT()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const change = async (value: UiLanguage) => {
    setBusy(true); setError('')
    try { await setUiLanguage(value) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }
  return <div className={`workspace-language-picker${compact ? ' compact' : ''}`}>
    <label>
      {t('lang.label')}
      <select aria-label={t('lang.label')} value={lang} disabled={disabled || busy} onChange={event => void change(event.target.value as UiLanguage)}>
        {uiLanguageOptions.map(option => <option key={option.id} value={option.id}>{option.nativeLabel}</option>)}
      </select>
    </label>
    {!compact && <p>{t('lang.hint')}</p>}
    {error && <p role="alert">{error}</p>}
  </div>
}

export function LanguageToggle({ disabled = false }: { disabled?: boolean }) {
  const { lang, t } = useT()
  const [busy, setBusy] = useState(false)
  const next: UiLanguage = lang === 'pt-BR' ? 'en' : 'pt-BR'
  const currentOption = uiLanguageOptions.find(item => item.id === lang) || uiLanguageOptions[0]
  const nextOption = uiLanguageOptions.find(item => item.id === next) || uiLanguageOptions[1]
  const toggle = async () => {
    if (busy || disabled) return
    setBusy(true)
    try { await setUiLanguage(next) }
    finally { setBusy(false) }
  }
  return <button
    type="button"
    className="language-toggle"
    disabled={disabled || busy}
    onClick={() => void toggle()}
    aria-label={t('lang.quickLabel')}
    title={t('lang.quickTitle', { current: currentOption.nativeLabel, next: nextOption.nativeLabel })}
  >
    <span aria-hidden="true">{currentOption.shortLabel}</span>
  </button>
}
