import { useCallback, useSyncExternalStore } from 'react'
import { api, desktopState, isDesktop, useDesktop } from '../desktop/client'
import { chooseMobileLanguage, mobileState, useMobile } from '../mobile/client'
import {
  CHANGED_EVENT,
  catalogs,
  defaultUiLanguage,
  formatLocaleDate,
  formatLocaleDateTime,
  formatLocaleNumber,
  formatLocaleTime,
  isUiLanguage,
  localeFor,
  localizeCategory,
  localizeCategoryTitle,
  localizeEffort,
  localizeFileManager,
  localizeTabColor,
  localizeThemeDescription,
  localizeTrashName,
  readStoredLanguage,
  resolveUiLanguage,
  tNow,
  translate,
  translateServiceMessage,
  uiLanguageOptions,
  writeStoredLanguage,
  type MessageKey,
  type TranslationParams,
  type UiLanguage,
} from './i18n/translate'

export type { MessageKey, TranslationParams, UiLanguage }
export {
  catalogs,
  defaultUiLanguage,
  formatLocaleDate,
  formatLocaleDateTime,
  formatLocaleNumber,
  formatLocaleTime,
  isUiLanguage,
  localeFor,
  localizeCategory,
  localizeCategoryTitle,
  localizeEffort,
  localizeFileManager,
  localizeTabColor,
  localizeThemeDescription,
  localizeTrashName,
  resolveUiLanguage,
  tNow,
  translate,
  translateServiceMessage,
  uiLanguageOptions,
}

const isMobilePath = () => typeof location !== 'undefined' && (location.pathname === '/mobile' || location.pathname.startsWith('/mobile/'))

const subscribe = (listener: () => void) => {
  window.addEventListener('storage', listener)
  window.addEventListener(CHANGED_EVENT, listener)
  return () => {
    window.removeEventListener('storage', listener)
    window.removeEventListener(CHANGED_EVENT, listener)
  }
}

export function getUiLanguage(): UiLanguage {
  if (isDesktop) {
    const state = desktopState()
    if (state.ready && isUiLanguage(state.settings.uiLanguage)) return state.settings.uiLanguage
  }
  if (isMobilePath()) {
    const state = mobileState()
    if (state.authenticated && isUiLanguage(state.uiLanguage)) return state.uiLanguage
  }
  return readStoredLanguage()
}

export function useUiLanguage(): UiLanguage {
  const desktop = useDesktop()
  const mobile = useMobile()
  const stored = useSyncExternalStore(subscribe, readStoredLanguage)
  if (isDesktop && desktop.ready && isUiLanguage(desktop.settings.uiLanguage)) return desktop.settings.uiLanguage
  if (isMobilePath() && mobile.authenticated && isUiLanguage(mobile.uiLanguage)) return mobile.uiLanguage
  return stored
}

export async function setUiLanguage(language: UiLanguage): Promise<void> {
  const next = resolveUiLanguage(language)
  writeStoredLanguage(next)
  window.dispatchEvent(new Event(CHANGED_EVENT))
  if (isDesktop) {
    await api('/settings', { uiLanguage: next })
  } else if (isMobilePath() && mobileState().authenticated) {
    await chooseMobileLanguage(next)
  }
}

export function useT() {
  const lang = useUiLanguage()
  const t = useCallback((key: MessageKey, params?: TranslationParams) => translate(lang, key, params), [lang])
  const serviceMessage = useCallback((text: string) => translateServiceMessage(lang, text), [lang])
  return {
    lang,
    locale: localeFor(lang),
    t,
    serviceMessage,
    date: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => formatLocaleDate(lang, value, options),
    time: (value: Date | string | number) => formatLocaleTime(lang, value),
    dateTime: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => formatLocaleDateTime(lang, value, options),
    number: (value: number, options?: Intl.NumberFormatOptions) => formatLocaleNumber(lang, value, options),
    compactNumber: (value: number) => formatLocaleNumber(lang, value, { notation: 'compact', maximumFractionDigits: 0 }),
  }
}
