import { useEffect, useState } from 'react'
import { mobileApi } from './client'
import { readingVoices, readingVoiceLabelKeys, readingVoiceChanged, saveReadingVoice, savedReadingVoice } from './readingVoices'
import { useT } from '../lib/i18n'
export default function ReadingVoiceSettings() {
  const { t } = useT()
  const [saved, setSaved] = useState(savedReadingVoice), [ready, setReady] = useState<boolean | null>(null)
  useEffect(() => { let active = true; void mobileApi<{ available: boolean }>('/read-aloud').then(info => { if (active) setReady(info.available) }).catch(() => { if (active) setReady(false) }); return () => { active = false } }, [])
  return <fieldset className="mobile-reading-settings"><legend>{t('reading.legend')}</legend><label>{t('reading.voice')}<select aria-label={t('reading.voiceAria')} value={saved} onChange={event => { const value = event.target.value; setSaved(value); saveReadingVoice(value); window.dispatchEvent(new Event(readingVoiceChanged)) }}>{readingVoices.map(voice => <option key={voice.id} value={voice.id}>{t(readingVoiceLabelKeys[voice.id])}</option>)}</select></label>{ready === false && <p>{t('reading.setupHint')}</p>}</fieldset>
}
