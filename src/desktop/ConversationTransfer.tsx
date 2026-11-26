import { useRef, useState } from 'react'
import { useT } from '../lib/i18n'
import { visibleUserMessage } from '../mobile/workspace-context'
import { api, reportError } from './client'
import { Icon } from './Icons'
import type { ChatSession } from './types'

const nativeDestinations = { codex: 'Codex', antigravity: 'Antigravity CLI', claude: 'Claude Code' } as const

export default function ConversationTransfer({ session, connected }: { session: ChatSession; connected: boolean }) {
  const { t, serviceMessage } = useT()
  const dialog = useRef<HTMLDialogElement>(null)
  const [pending, setPending] = useState(false)
  const [copying, setCopying] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const native = session.agent === 'codex' || session.agent === 'antigravity' || session.agent === 'claude'
    ? nativeDestinations[session.agent] : null
  const active = session.status === 'starting' || session.activity === 'working' || session.activity === 'waiting'

  function show() {
    setError(''); setCopied(false)
    dialog.current?.showModal()
  }
  async function transfer() {
    setPending(true); setError('')
    try {
      await api(`/sessions/${session.id}/transfer`, {})
      dialog.current?.close()
    } catch (failure) {
      const text = serviceMessage(failure instanceof Error ? failure.message : String(failure))
      // If release succeeded but the launcher failed, Chats may already be on another tab.
      if (dialog.current?.open) setError(text)
      else reportError(failure)
    } finally { setPending(false) }
  }
  async function copy() {
    setCopying(true); setCopied(false); setError('')
    try {
      const { messages } = await api<{ messages: { role: 'user' | 'assistant'; text: string }[] }>(`/sessions/${session.id}/export`)
      const text = messages.map(message => {
        const role = message.role === 'user' ? t('common.you') : (native || session.agent)
        return `## ${role}\n\n${message.role === 'user' ? visibleUserMessage(message.text) : message.text}`
      }).join('\n\n')
      if (!text) throw new Error(t('conv.historyUnavailable'))
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch (failure) {
      setError(serviceMessage(failure instanceof Error ? failure.message : String(failure)))
    } finally { setCopying(false) }
  }

  if (!session.nativeId) return null
  return <>
    <button type="button" className="desk-icon" aria-label={t('conv.transfer')} title={t('conv.transfer')} onClick={show}><Icon name="external" size={16} /></button>
    <dialog ref={dialog} className="conversation-transfer" aria-labelledby="conversation-transfer-title" onCancel={event => { if (pending) event.preventDefault() }}>
      <h2 id="conversation-transfer-title">{t('conv.transfer')}</h2>
      {native && <section>
        <p>{t('conv.transferSameSession', { app: native })}</p>
        {active && <small>{t('conv.transferWait')}</small>}
        <button type="button" disabled={!connected || pending || active} onClick={() => void transfer()}>{pending ? t('conv.transferOpening') : t('conv.transferNative', { app: native })}</button>
      </section>}
      <section>
        <p>{t('conv.transferCopyHint')}</p>
        <div className="conversation-transfer-actions">
          <button type="button" disabled={!connected || pending || copying} onClick={() => void copy()}>{copied ? t('common.copied') : t('conv.copyHistory')}</button>
          <a href="https://chatgpt.com/" target="_blank" rel="noreferrer">{t('conv.openChatGPT')}<Icon name="external" size={14} /></a>
        </div>
      </section>
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" disabled={pending} onClick={() => dialog.current?.close()}>{t('common.close')}</button></footer>
    </dialog>
  </>
}
