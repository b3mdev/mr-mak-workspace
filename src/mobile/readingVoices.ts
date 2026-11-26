export const readingVoices = [
  { id: 'am_michael', label: 'Michael · US man' },
  { id: 'bf_emma', label: 'Emma · UK woman' },
  { id: 'pf_dora', label: 'Dora · BR woman' },
  { id: 'pm_alex', label: 'Alex · BR man' },
  { id: 'pm_santa', label: 'Santa · BR man' },
] as const

export const readingVoiceLabelKeys = {
  am_michael: 'reading.michael',
  bf_emma: 'reading.emma',
  pf_dora: 'reading.dora',
  pm_alex: 'reading.alex',
  pm_santa: 'reading.santa',
} as const

export const readingVoiceKey = 'mrmak.mobile.read-aloud.voice'
export const readingVoiceChanged = 'mrmak-reading-voice-changed'
let currentVoice = 'am_michael'
export function savedReadingVoice() {
  let value = currentVoice
  try { value = localStorage.getItem(readingVoiceKey) || value } catch { /* Use the current visit's choice. */ }
  return readingVoices.some(voice => voice.id === value) ? value : 'am_michael'
}
export function saveReadingVoice(value: string) {
  if (!readingVoices.some(voice => voice.id === value)) return
  currentVoice = value; try { localStorage.setItem(readingVoiceKey, value) } catch { /* Keep the choice for this visit. */ }
}
