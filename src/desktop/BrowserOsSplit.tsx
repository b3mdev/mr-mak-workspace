import { useEffect, useRef, useState } from 'react'
import { useT } from '../lib/i18n'
import { api, reportError } from './client'
import { Icon } from './Icons'
import { isWindows } from './platform'

const resultEvent = 'mrmak-browseros-split-result'
const errorKeys = {
  missing: 'browserOs.missing',
  startFailed: 'browserOs.startFailed',
  windowMissing: 'browserOs.windowMissing',
  screenTooSmall: 'browserOs.screenTooSmall',
  moveFailed: 'browserOs.moveFailed',
} as const

export default function BrowserOsSplit({ connected }: { connected: boolean }) {
  const { t } = useT()
  const [pending, setPending] = useState(false)
  const pendingCleanup = useRef<(() => void) | undefined>(undefined)
  useEffect(() => () => pendingCleanup.current?.(), [])

  if (!isWindows) return null

  const split = async () => {
    if (pendingCleanup.current) return
    setPending(true)
    const requestId = crypto.randomUUID()
    const receive = (event: Event) => {
      const result = (event as CustomEvent<{ requestId: string; error?: keyof typeof errorKeys }>).detail
      if (result?.requestId !== requestId) return
      cleanup()
      setPending(false)
      if (result.error) reportError(t(errorKeys[result.error] || 'browserOs.moveFailed'))
    }
    const cleanup = () => {
      clearTimeout(timer)
      window.removeEventListener(resultEvent, receive)
      pendingCleanup.current = undefined
    }
    const timer = window.setTimeout(() => {
      cleanup()
      setPending(false)
      reportError(t('browserOs.moveFailed'))
    }, 16000)
    pendingCleanup.current = cleanup
    window.addEventListener(resultEvent, receive)
    try {
      await api('/browseros/split', { requestId })
    } catch (error) {
      if (pendingCleanup.current !== cleanup) return
      cleanup()
      setPending(false)
      reportError(error)
    }
  }

  return <button type="button" className="desk-icon" onClick={split} disabled={!connected || pending} aria-busy={pending} title={t('browserOs.sideBySide')} aria-label={t('browserOs.sideBySide')}><Icon name="browserSplit" size={17} /></button>
}
