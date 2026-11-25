import { useEffect, useState } from 'react'
import type { NetworkSnapshot } from './NetworkBoard'

export function useNetwork(load: () => Promise<NetworkSnapshot>) {
  const [value, setValue] = useState<NetworkSnapshot | null>(null)
  const [error, setError] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let alive = true, pending = false
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') return
      pending = true
      try {
        const snapshot = await load()
        if (alive) { setValue(snapshot); setError(false) }
      } catch { if (alive) setError(true) }
      finally { pending = false }
    }
    void refresh()
    const timer = window.setInterval(refresh, 5000)
    document.addEventListener('visibilitychange', refresh)
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [load, revision])
  return { value, error, refresh: () => setRevision(current => current + 1) }
}
