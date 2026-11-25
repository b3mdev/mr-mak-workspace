import { useState } from 'react'
import { setWorkspaceTheme, useWorkspaceTheme, type WorkspaceTheme, type ThemeTarget } from '../lib/workspace-theme'
import { themes, themePalette } from '../../desktop/service/appearance.mjs'
import { localizeThemeDescription, useT } from '../lib/i18n'

export default function ThemePicker({ target = 'workspace' }: { target?: ThemeTarget }) {
  const { lang, t } = useT()
  const { preference, resolved } = useWorkspaceTheme(target)
  const palette = themePalette(resolved)
  const label = target === 'chat' ? t('theme.chatLabel') : t('theme.workspaceLabel')
  const paletteName = palette.id === 'dark' ? t('theme.dark') : palette.id === 'light' ? t('theme.light') : palette.name
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const change = async (value: WorkspaceTheme) => {
    setBusy(true); setError('')
    try { await setWorkspaceTheme(value, target) }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <div className="workspace-theme-picker">
    <label>{label}<select aria-label={label} value={preference} disabled={busy} onChange={event => void change(event.target.value as WorkspaceTheme)}>
      <optgroup label={t('theme.groupTools')}>{themes.slice(0, 3).map(theme => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</optgroup>
      <optgroup label={t('theme.groupMore')}>{themes.slice(3).map(theme => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</optgroup>
      <optgroup label={t('theme.groupClassic')}><option value="dark">{t('theme.dark')}</option><option value="light">{t('theme.light')}</option><option value="system">{t('theme.system')}</option></optgroup>
    </select></label>
    <div className="theme-preview" aria-hidden="true" style={{ background: palette.bg, color: palette.text, borderColor: palette.muted + '55' }}>
      <div className="theme-preview-bar" style={{ background: palette.panel }}><i style={{ background: palette.accent }} /><span>{paletteName}</span><i style={{ background: palette.secondary }} /></div>
      <div className="theme-preview-copy"><span style={{ color: palette.muted }}>{t('theme.previewLine1')}</span><strong>{t('theme.previewLine2')}</strong><span style={{ color: palette.accent }}>Aa <span style={{ color: palette.secondary }}>Aa</span></span></div>
    </div>
    <p>{localizeThemeDescription(lang, palette.id, palette.description)} {target === 'chat' ? t('theme.appliesChat') : t('theme.appliesWorkspace')} {t('theme.systemFollows')}</p>
    {error && <p role="alert">{error}</p>}
  </div>
}
