import { useEffect, useState } from 'react'
import { api, onServiceEvent, useDesktop } from './client'
import type { Effort, Settings } from './types'
import { defaultEffort, efforts } from './effort'
import { Icon } from './Icons'
import DictationSettings from '../components/DictationSettings'
import LanguagePicker from '../components/LanguagePicker'
import { useDictation } from './useDictation'
import ThemePicker from '../components/ThemePicker'
import { isMac, shellName } from './platform'
import { localizeEffort, useT } from '../lib/i18n'
import TelegramSettings from './TelegramSettings'

type NativeSettings = { available: boolean; winKey: boolean; label?: string; error?: string }
export default function WorkspaceSettings({ onClose }: { onClose: () => void }) {
  const { lang, t, serviceMessage } = useT()
  const dictation = useDictation()
  const { settings, repo } = useDesktop()
  const [native, setNative] = useState<NativeSettings>({ available: false, winKey: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const refresh = () => api<NativeSettings>('/native/settings').then(setNative).catch(error => setError(String(error.message || error)))
    void refresh()
    return onServiceEvent(event => { if (event.type === 'native-settings') void refresh() })
  }, [])
  const change = async (patch: Partial<Settings>) => {
    setBusy(true); setError('')
    try { await api('/settings', patch) } catch (error) { setError(String(error instanceof Error ? error.message : error)) }
    finally { setBusy(false) }
  }
  const winKey = async (enabled: boolean) => {
    setBusy(true); setError('')
    try { setNative(await api<NativeSettings>('/native/settings', { winKey: enabled })) }
    catch (error) { setError(String(error instanceof Error ? error.message : error)) }
    finally { setBusy(false) }
  }
  const winKeyName = native.label === 'Win key' ? t('settings.winKeyDefault') : (native.label || (isMac ? '⌃⌥⌘Space' : t('settings.winKeyDefault')))
  return <div className="files-panel workspace-settings"><header><h2>{t('settings.heading')}</h2><button className="desk-icon" onClick={onClose} aria-label={t('settings.close')}><Icon name="close" size={17} /></button></header>
    <div className="settings-scroll"><section><h3>{t('lang.section')}</h3><LanguagePicker /></section><section><h3>{t('settings.appearance')}</h3><ThemePicker /><ThemePicker target="chat" /></section><section><h3>{isMac ? t('settings.shortcutSection') : t('settings.windowsSection')}</h3><label className="setting-toggle"><span>{t('settings.winKeyLabel', { key: winKeyName })}<small>{isMac ? t('settings.winKeyMacDesc') : t('settings.winKeyWinDesc')}</small></span><input type="checkbox" checked={native.winKey} disabled={busy || !native.available} onChange={event => void winKey(event.target.checked)} /></label>{!native.available && <p>{native.error ? serviceMessage(native.error) : t('settings.nativeOnly')}</p>}</section>
    <section><h3>{t('settings.chatsSection')}</h3><label>{t('settings.defaultAgent')}<select disabled={busy} value={settings.defaultAgent} onChange={event => void change({ defaultAgent: event.target.value as Settings['defaultAgent'] })}><option value="codex">Codex</option><option value="claude">Claude</option><option value="antigravity">Antigravity</option><option value="opencode">OpenCode</option><option value="kimi">Kimi</option><option value="shell">{shellName}</option></select></label>
      <label>{t('settings.defaultEffort')}<select disabled={busy} value={settings.defaultEffort || defaultEffort} onChange={event => void change({ defaultEffort: event.target.value as Effort })}>{efforts.map(([value]) => <option key={value} value={value}>{localizeEffort(lang, value)}</option>)}</select></label><p>{t('settings.defaultEffortHint')}</p>
      <label>{t('settings.terminalTextSize')}<select disabled={busy} value={settings.terminalFontSize || 13} onChange={event => void change({ terminalFontSize: Number(event.target.value) })}>{Array.from({ length: 15 }, (_, i) => i + 10).map(size => <option key={size} value={size}>{size} px</option>)}</select></label>
      <label>{t('settings.terminalAppearance')}<select disabled={busy} value={settings.terminalAppearance || 'original'} onChange={event => void change({ terminalAppearance: event.target.value as Settings['terminalAppearance'] })}><option value="original">{t('settings.terminalOriginal')}</option><option value="focus">{t('settings.terminalFocusLong')}</option></select></label><p>{t('settings.terminalAppearanceHint')}</p>
      {isMac && <label className="setting-toggle"><span>{t('settings.optionMeta')}<small>{t('settings.optionMetaDesc')}</small></span><input type="checkbox" checked={!!settings.terminalOptionMeta} disabled={busy} onChange={event => void change({ terminalOptionMeta: event.target.checked })} /></label>}
      <label className="setting-toggle"><span>{t('settings.bypass')}<small>{t('settings.bypassDesc')}</small></span><input type="checkbox" checked={settings.defaultBypass} disabled={busy} onChange={event => void change({ defaultBypass: event.target.checked })} /></label>
    </section><DictationSettings info={dictation.info} onChange={dictation.choose} /><section><h3>{t('brand.name')}</h3><label>{t('settings.voiceLabel')}<select disabled={busy} value={settings.voiceName || 'cedar'} onChange={event => void change({ voiceName: event.target.value })}><option value="cedar">Cedar</option><option value="marin">Marin</option></select></label><label>{t('settings.coordinatorReasoning')}<select disabled={busy} value={settings.coordinatorEffort || 'medium'} onChange={event => void change({ coordinatorEffort: event.target.value as Settings['coordinatorEffort'] })}><option value="medium">{localizeEffort(lang, 'medium')}</option><option value="high">{localizeEffort(lang, 'high')}</option></select></label><p>{t('settings.voiceAppliesHint')}</p></section>
      <TelegramSettings />
      <section><h3>{t('settings.projectSection')}</h3><p className="settings-repo">{repo}</p><p>{t('settings.projectRepoHint')}</p></section>
      {error && <p className="desk-error-inline" role="alert">{serviceMessage(error)}</p>}
    </div></div>
}
