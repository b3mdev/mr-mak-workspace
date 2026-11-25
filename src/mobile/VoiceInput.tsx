import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../desktop/Icons'
import { transcribeMobileAudio, type DictationInfo } from './client'
import { onDoubleCtrl } from './double-ctrl'
import { deleteVoiceDraft, readVoiceDraft, saveVoiceDraft, type VoiceDraft } from './voice-drafts'
import { tNow, useT } from '../lib/i18n'

type Phase = 'idle' | 'permission' | 'recording' | 'transcribing' | 'saved'
export default function VoiceInput({ id, connected, disabled, config, hotkey = false, onText, onBusy, transcriber = transcribeMobileAudio }: {
  id: string; connected: boolean; disabled: boolean; config?: DictationInfo; hotkey?: boolean
  transcriber?: typeof transcribeMobileAudio
  onText: (text: string, recordingId: string) => void | Promise<void>; onBusy: (busy: boolean) => void
}) {
  const { t, serviceMessage } = useT()
  const [phase, setPhase] = useState<Phase>('idle'), [seconds, setSeconds] = useState(0), [error, setError] = useState('')
  const [recording, setRecording] = useState<VoiceDraft | null>(null), [recovered, setRecovered] = useState(false)
  const alive = useRef(true), stream = useRef<MediaStream | null>(null), recorder = useRef<MediaRecorder | null>(null)
  const timer = useRef(0), controller = useRef<AbortController | null>(null), discard = useRef(false), serial = useRef(0)
  const textHandler = useRef(onText), busyHandler = useRef(onBusy)
  useEffect(() => { textHandler.current = onText; busyHandler.current = onBusy }, [onText, onBusy])
  const supported = !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'
  const release = useCallback(() => { clearInterval(timer.current); stream.current?.getTracks().forEach(track => track.stop()); stream.current = null }, [])
  const stop = useCallback((cancel = false) => {
    if (cancel) discard.current = true
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop()
    release()
  }, [release])
  useEffect(() => {
    alive.current = true
    void readVoiceDraft(id).then(saved => {
      if (!alive.current) return
      if (saved) { setRecording(saved); setSeconds(saved.seconds); setPhase('saved') }
      setRecovered(true)
    }).catch(() => { if (alive.current) { setRecovered(true); setError(tNow('voiceInput.recoveryUnavailable')) } })
    const hidden = () => { if (document.visibilityState === 'hidden') stop() }
    document.addEventListener('visibilitychange', hidden)
    return () => { alive.current = false; controller.current?.abort(); stop(); document.removeEventListener('visibilitychange', hidden) }
  }, [id, stop])
  useEffect(() => { onBusy(phase === 'permission' || phase === 'recording' || phase === 'transcribing') }, [phase, onBusy])
  const root = useRef<HTMLDivElement>(null), toggle = useRef<() => boolean>(() => false)
  useEffect(() => {
    toggle.current = () => {
      if (!root.current?.getClientRects().length) return false
      if (phase === 'recording') { stop(); return true }
      if (phase !== 'idle' || disabled || !connected || !recovered) return false
      void start(); return true
    }
  })
  useEffect(() => hotkey ? onDoubleCtrl(() => toggle.current()) : undefined, [hotkey])
  async function transcribe(saved: VoiceDraft) {
    const request = ++serial.current
    setPhase('transcribing'); setError(''); busyHandler.current(true)
    const abort = new AbortController(); controller.current = abort
    try {
      const result = await transcriber(saved, abort.signal)
      if (!alive.current || request !== serial.current) return
      // The parent persists the text before removing the recoverable recording.
      await textHandler.current(result.text, saved.id)
      await deleteVoiceDraft(id)
      if (!alive.current || request !== serial.current) return
      setRecording(null); setPhase('idle'); setError('')
    } catch (err) {
      if (!alive.current || request !== serial.current) return
      setPhase('saved'); setError(err instanceof Error ? err.message : t('voiceInput.transcribeFallback'))
    } finally { if (controller.current === abort) controller.current = null; if (alive.current && request === serial.current) busyHandler.current(false) }
  }
  async function start() {
    if (disabled || !connected || !recovered || phase !== 'idle') return
    if (!config?.available) { setError(config?.provider === 'off' ? t('voiceInput.dictationOff') : config?.provider === 'openai' || config?.provider === 'openrouter' ? t('voiceInput.paidNeedsKey') : t('voiceInput.setupLocal')); return }
    if (!supported) { setError(t('voiceInput.browserUnsupported')); return }
    setPhase('permission'); setError(''); busyHandler.current(true); discard.current = false
    const request = ++serial.current
    try {
      const captured = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false })
      if (!alive.current || request !== serial.current) { captured.getTracks().forEach(track => track.stop()); return }
      if (document.visibilityState === 'hidden') { captured.getTracks().forEach(track => track.stop()); setPhase('idle'); busyHandler.current(false); return }
      stream.current = captured
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type))
      if (!mimeType) throw new Error(t('voiceInput.formatUnsupported'))
      const active = new MediaRecorder(captured, { mimeType, audioBitsPerSecond: 64000 })
      recorder.current = active
      const chunks: Blob[] = [], started = Date.now(); let size = 0
      active.ondataavailable = event => {
        if (!event.data.size) return
        chunks.push(event.data); size += event.data.size
        if (size > config.maxBytes) { discard.current = true; stop(true); if (alive.current) setError(t('voiceInput.tooLarge')) }
      }
      active.onerror = () => { stop(true); if (alive.current) setError(t('voiceInput.interrupted')) }
      active.onstop = () => {
        release(); recorder.current = null
        if (discard.current || !size) { if (alive.current) { setPhase('idle'); busyHandler.current(false) }; return }
        const saved: VoiceDraft = { id: crypto.randomUUID(), audio: new Blob(chunks, { type: active.mimeType }), seconds: Math.round((Date.now() - started) / 1000), createdAt: Date.now() }
        void (async () => {
          let durable = true
          try { await saveVoiceDraft(id, saved) } catch { durable = false }
          if (!alive.current) return
          setRecording(saved); setSeconds(saved.seconds); setPhase('saved'); busyHandler.current(false)
          if (!durable) setError(t('voiceInput.notDurable'))
          if (durable && document.visibilityState === 'visible') await transcribe(saved)
        })()
      }
      active.start(500); setSeconds(0); setPhase('recording')
      timer.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - started) / 1000); setSeconds(elapsed)
        if (elapsed >= config.maxSeconds) stop()
      }, 250)
    } catch (err) {
      release()
      if (!alive.current || request !== serial.current) return
      setPhase('idle'); busyHandler.current(false)
      setError(err instanceof DOMException && err.name === 'NotAllowedError' ? t('voiceInput.permissionDenied') : err instanceof Error ? err.message : t('voiceInput.startFailed'))
    }
  }
  async function remove() {
    serial.current++; controller.current?.abort(); stop(true)
    try { await deleteVoiceDraft(id) } catch { setError(t('voiceInput.removeFailed')); return }
    setRecording(null); setPhase('idle'); setError(''); busyHandler.current(false)
  }
  function download() {
    if (!recording) return
    const url = URL.createObjectURL(recording.audio), link = document.createElement('a')
    const type = recording.audio.type
    link.href = url; link.download = `voice-note-${new Date(recording.createdAt).toISOString().replace(/[:.]/g, '-')}.${type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'}`
    link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 10000)
  }
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  const providerName = config?.provider === 'local' ? t('voiceInput.providerLocal') : config?.provider === 'openrouter' ? t('voiceInput.providerOpenRouter') : t('voiceInput.providerOpenAI')
  return <div ref={root} className={`mobile-voice ${phase}`}>
    <button type="button" className="mobile-icon mobile-mic" aria-label={phase === 'recording' ? t('voiceInput.stopAndTranscribe') : t('voiceInput.dictate')} title={hotkey ? t('voiceInput.dictateHotkey') : t('voiceInput.dictate')} disabled={phase !== 'recording' && (disabled || !connected || !recovered || phase !== 'idle')} onClick={() => phase === 'recording' ? stop() : void start()}><Icon name={phase === 'recording' ? 'stop' : 'mic'} /></button>
    {phase !== 'idle' && <div className="mobile-voice-panel" role="status">
      <span>{phase === 'permission' ? t('voiceInput.allowMic') : phase === 'recording' ? t('voiceInput.recordingClock', { clock }) : phase === 'transcribing' ? t('voiceInput.transcribing') : t('voiceInput.savedClock', { clock })}</span>
      {phase === 'recording' && <button type="button" onClick={() => stop(true)}>{t('voiceInput.cancelRecording')}</button>}
      {phase === 'saved' && <div><button type="button" disabled={!connected || disabled} onClick={() => recording && void transcribe(recording)}>{t('voiceInput.transcribeRecording')}</button><button type="button" onClick={download}>{t('voiceInput.downloadAudio')}</button><button type="button" onClick={() => void remove()}>{t('voiceInput.discardRecording')}</button></div>}
      {phase === 'recording' && <small>{t('voiceInput.providerHint', { seconds: config?.maxSeconds || 120, provider: providerName })}</small>}
    </div>}
    {error && <div className="mobile-voice-error" role="alert">{serviceMessage(error)}<button type="button" aria-label={t('voiceInput.dismissError')} onClick={() => setError('')}><Icon name="close" size={14} /></button></div>}
  </div>
}
