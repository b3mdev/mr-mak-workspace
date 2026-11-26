import { api, clientId, desktopState, surface } from './client'
import type { CoordinatorConversation, Operation } from './types'
import { tNow } from '../lib/i18n/translate'

export interface Caption { role: 'user' | 'assistant'; text: string; start: number; end: number }
export interface LiveState { status: 'off' | 'connecting' | 'live' | 'closing' | 'error'; error: string; captions: Caption[]; startedAt: number | null; audible: boolean }
interface LiveEvent { type: string; delta?: string; start_ms?: number; end_ms?: number; offset_ms?: number; delegation?: { id: string }; session?: { id: string }; error?: { message?: string }; message?: string }

// Live caps each appended message at 500 tokens. A 400-byte UTF-8 ceiling
// leaves room for tokenization overhead, including non-Latin text and emoji.
function boundedAppend(text: string) {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(text)
  if (bytes.length <= 400) return text
  const prefix = new Uint8Array(397)
  const { written } = encoder.encodeInto(text, prefix)
  return new TextDecoder().decode(prefix.subarray(0, written)) + '…'
}

export class LiveVoice {
  state: LiveState = { status: 'off', error: '', captions: [], startedAt: null, audible: true }
  private peer: RTCPeerConnection | null = null
  private channel: RTCDataChannel | null = null
  private microphone: MediaStream | null = null
  private audio = new Audio()
  private listeners = new Set<() => void>()
  private generation = 0
  private ready = false
  private sessionId = ''
  private connectionId = ''
  private conversation: CoordinatorConversation | null = null
  private inputFragments: { sequence: number; text: string }[] = []
  private nextInputSequence = 0
  private lastHandledSequence = -1
  private delegated = new Set<string>()
  private closeTimer = 0
  private startTimer = 0
  private lastContext = ''
  private transcriptTimer = 0
  private tasks = new Set<number>()
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback) } }
  snapshot = () => this.state
  dismissError() { this.update({ error: '', ...(this.state.status === 'error' ? { status: 'off' as const } : {}) }) }
  private update(patch: Partial<LiveState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()) }
  private event(value: unknown) { if (this.ready && this.channel?.readyState === 'open') this.channel.send(JSON.stringify(value)) }
  private append(type: 'thinking' | 'commentary', text: string, delegationId: string | null = null) {
    this.event({ type: `session.${type}.append`, event_id: crypto.randomUUID(), delegation_id: delegationId, content: boundedAppend(text) })
  }
  context() {
    if (!this.ready) return
    const state = desktopState()
    const selectedChat = state.sessions.find(item => item.id === state.selectedId)?.name || 'none'
    const context = `Current UI state (reference data). Open chats: ${state.sessions.filter(item => item.open).length}. Selected chat: ${selectedChat}.`
    if (context === this.lastContext) return
    this.lastContext = context
    this.append('thinking', context)
  }
  announce(text: string) { this.append('commentary', text) }
  syncConversation(conversation: CoordinatorConversation) {
    if (!this.conversation || conversation.contextRevision === this.conversation.contextRevision) return
    this.cleanup()
    this.conversation = null
    this.update({ status: 'off', error: '', captions: [], startedAt: null, audible: true })
  }
  async start() {
    if (['live', 'connecting', 'closing'].includes(this.state.status)) return
    const generation = ++this.generation
    const connectionId = this.connectionId = crypto.randomUUID()
    const conversation = this.conversation = desktopState().coordinatorConversation
    this.sessionId = ''
    this.update({ status: 'connecting', error: '', captions: [], startedAt: null, audible: true })
    this.inputFragments = []; this.nextInputSequence = 0; this.lastHandledSequence = -1
    this.delegated.clear(); this.lastContext = ''; this.ready = false
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      if (generation !== this.generation) { microphone.getTracks().forEach(track => track.stop()); return }
      this.microphone = microphone
      const peer = new RTCPeerConnection(); this.peer = peer
      peer.ontrack = event => { this.audio.srcObject = new MediaStream([event.track]); this.audio.play().catch(() => this.update({ audible: false })) }
      peer.onconnectionstatechange = () => { if (generation === this.generation && ['failed', 'closed'].includes(peer.connectionState) && this.state.status !== 'off') this.fail(tNow('live.connectionEnded')) }
      microphone.getAudioTracks().forEach(track => peer.addTrack(track, microphone))
      const channel = peer.createDataChannel('oai-events'); this.channel = channel
      channel.onmessage = ({ data }) => { if (generation === this.generation) { try { this.receive(JSON.parse(data) as LiveEvent, generation) } catch { this.fail(tNow('live.invalidEvent')) } } }
      channel.onclose = () => { if (generation === this.generation && this.state.status !== 'off') this.fail(tNow('live.disconnectedBeforeConfirm')) }
      await peer.setLocalDescription(await peer.createOffer())
      if (peer.iceGatheringState !== 'complete') await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => { peer.removeEventListener('icegatheringstatechange', changed); reject(new Error(tNow('live.micTimeout'))) }, 10000)
        const changed = () => { if (peer.iceGatheringState === 'complete') { clearTimeout(timeout); peer.removeEventListener('icegatheringstatechange', changed); resolve() } }
        peer.addEventListener('icegatheringstatechange', changed); changed()
      })
      if (generation !== this.generation) return
      const result = await api<{ session: { id: string }; transport: { sdp: string } }>('/live/session', { sdp: peer.localDescription?.sdp, clientId, connectionId, surface, contextRevision: conversation.contextRevision })
      if (generation !== this.generation) { await api('/live/release', { clientId, connectionId }); return }
      this.sessionId = result.session.id
      this.startTimer = window.setTimeout(() => this.fail(tNow('live.openAiDidNotStart')), 25000)
      await peer.setRemoteDescription({ type: 'answer', sdp: result.transport.sdp })
    } catch (error) { if (generation === this.generation) this.fail(error instanceof Error ? error.message : String(error)) }
  }
  private receive(event: LiveEvent, generation: number) {
    if (event.type === 'session.started') {
      clearTimeout(this.startTimer); this.ready = true
      this.update({ status: 'live', startedAt: Date.now() }); this.context()
    } else if (event.type === 'session.closed') { this.cleanup(); this.update({ status: 'off', startedAt: null }) }
    else if (event.type === 'error' || event.type === 'session.error') this.fail(event.error?.message || event.message || tNow('live.sessionError'))
    else if (event.type === 'session.input_transcript.delta' || event.type === 'session.output_transcript.delta') {
      const role = event.type.includes('input_transcript') ? 'user' : 'assistant'
      const delta = event.delta || ''
      if (!delta) return
      if (role === 'user') {
        this.inputFragments.push({ sequence: this.nextInputSequence++, text: delta })
        this.inputFragments = this.inputFragments.slice(-1000)
      }
      const captions = [...this.state.captions]
      const previous = captions[captions.length - 1]
      const start = event.start_ms ?? event.offset_ms ?? 0
      const end = event.end_ms ?? start
      if (previous?.role === role && start - previous.end < 1600) captions[captions.length - 1] = { ...previous, text: previous.text + delta, end }
      else captions.push({ role, text: delta, start, end })
      this.update({ captions: captions.slice(-150) })
      if (!this.transcriptTimer) this.transcriptTimer = window.setTimeout(() => { this.transcriptTimer = 0; this.saveTranscript() }, 2000)
    } else if (event.type === 'session.delegation.created' && event.delegation?.id && !this.delegated.has(event.delegation.id)) {
      const id = event.delegation.id; this.delegated.add(id)
      // Delegations carry no task text. Let the final transcript fragments arrive.
      const task = window.setTimeout(() => { this.tasks.delete(task); this.delegate(id, generation).catch(error => { if (generation === this.generation) this.announce(`The requested action could not be completed: ${String(error)}`) }) }, 200)
      this.tasks.add(task)
    }
  }
  private async delegate(id: string, generation: number) {
    if (generation !== this.generation) return
    const captions = this.state.captions
    const newInput = this.inputFragments.filter(item => item.sequence > this.lastHandledSequence)
    const text = newInput.map(item => item.text).join('').trim()
    if (!text) { this.append('commentary', 'No complete user transcript was available for this request. Ask the user to repeat the instruction briefly.', id); return }
    this.lastHandledSequence = Math.max(...newInput.map(item => item.sequence))
    this.append('thinking', 'The requested action is pending. Wait for the verified result. Do not narrate internal routing or repeat a progress phrase.', id)
    const operation = await api<Operation>('/coordinator', { id: `${this.sessionId}:${id}`, text, selectedId: desktopState().selectedId, contextRevision: this.conversation?.contextRevision, conversation: captions.slice(-20).map(item => `${item.role}: ${item.text}`).join('\n') })
    if (generation !== this.generation) return
    this.append('commentary', `${operation.status}: ${operation.result || 'No result was returned.'}`, id)
    this.context()
  }
  stop() {
    if (this.state.status === 'connecting') { this.cleanup(); this.update({ status: 'off', startedAt: null }); return }
    if (this.ready && this.channel?.readyState === 'open') {
      this.update({ status: 'closing' })
      this.microphone?.getAudioTracks().forEach(track => { track.enabled = false })
      this.event({ type: 'session.close' })
      this.closeTimer = window.setTimeout(() => this.fail(tNow('live.stoppedUnconfirmed')), 15000)
    } else { this.cleanup(); this.update({ status: 'off', startedAt: null }) }
  }
  async enablePlayback() { try { await this.audio.play(); this.update({ audible: true }) } catch { this.update({ error: tNow('live.enableAudioRetry') }) } }
  disconnect() { if (['live', 'connecting'].includes(this.state.status)) { this.cleanup(); this.update({ status: 'error', error: tNow('live.localConnectionLost'), startedAt: null }) } }
  private fail(message: string) { this.cleanup(); this.update({ status: 'error', error: message, startedAt: null }) }
  private saveTranscript() {
    if (this.sessionId && this.state.captions.length) api('/live/transcript', { id: this.sessionId, conversationId: this.conversation?.conversationId, captions: this.state.captions.slice(-50).map(item => ({ ...item, text: item.text.slice(0, 1000) })) }).catch(() => {})
  }
  private cleanup() {
    this.saveTranscript(); clearTimeout(this.transcriptTimer); this.transcriptTimer = 0
    ++this.generation; this.ready = false
    clearTimeout(this.startTimer); clearTimeout(this.closeTimer)
    this.tasks.forEach(clearTimeout); this.tasks.clear()
    this.microphone?.getTracks().forEach(track => track.stop()); this.microphone = null
    this.channel?.close(); this.channel = null; this.peer?.close(); this.peer = null
    this.audio.pause(); this.audio.srcObject = null
    // keepalive: cleanup also runs on pagehide, and WebKit cancels ordinary requests from a closing page.
    if (this.connectionId) api('/live/release', { clientId, connectionId: this.connectionId }, undefined, { keepalive: true }).catch(() => {})
    this.connectionId = ''; this.sessionId = ''
  }
}

export const liveVoice = new LiveVoice()
window.addEventListener('pagehide', () => liveVoice.stop())
