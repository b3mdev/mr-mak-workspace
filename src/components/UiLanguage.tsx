import { useLayoutEffect } from 'react'
import { useUiLanguage } from '../lib/i18n'

export default function UiLanguage() {
  const language = useUiLanguage()
  useLayoutEffect(() => {
    const root = document.documentElement
    root.lang = language
    root.dataset.uiLanguage = language
  }, [language])
  return null
}
