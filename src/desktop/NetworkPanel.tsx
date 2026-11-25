import { useEffect, useState } from 'react'
import { api, reportError } from './client'
import { Icon } from './Icons'
import TailscaleHttpsLink from './TailscaleHttpsLink'
import { needsTailscaleHttps } from './tailscale-setup'
import NetworkBoard, { type NetworkSnapshot } from '../components/NetworkBoard'
import { useNetwork } from '../components/useNetwork'

const load = () => api<NetworkSnapshot>('/network')
type Invitation = { url: string; expires: number }

export default function NetworkPanel({ onClose }: { onClose: () => void }) {
  const board = useNetwork(load)
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [actionError, setActionError] = useState('')
  const [httpsError, setHttpsError] = useState(false)
  useEffect(() => {
    if (!invitation) return
    const timer = window.setTimeout(() => setInvitation(null), Math.max(0, invitation.expires - Date.now()))
    return () => window.clearTimeout(timer)
  }, [invitation])
  const change = async (work: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true); setActionError(''); setMessage(''); setHttpsError(false)
    try { await work(); board.refresh() }
    catch (error) { setActionError(error instanceof Error ? error.message : String(error)); setHttpsError(needsTailscaleHttps(error)) }
    finally { setBusy(false) }
  }
  const generate = () => change(async () => {
    if (!board.value?.mobileEnabled) await api('/mobile/enable', {})
    setInvitation(await api<Invitation>('/network/invite', {}))
    setMessage('Convite criado. Cole-o no computador que deseja conectar.')
  })
  const join = () => change(async () => {
    await api('/network/join', { invitation: code })
    setCode(''); setInvitation(null); setMessage('Computador conectado à rede.')
  })
  const disconnect = () => change(async () => {
    await api('/network/disconnect', {}); setMessage('Compartilhamento encerrado neste computador.')
  })
  const remove = (id: string) => void change(() => api('/network/revoke', { id }))
  const hub = board.value?.hub
  const hasComputers = (board.value?.computers.length ?? 0) > 1

  return <div className="files-panel desktop-network"><header><h2>Rede Bento</h2><button type="button" className="desk-icon" aria-label="Fechar Rede Bento" onClick={onClose}><Icon name="close" size={17} /></button></header>
    <div className="settings-scroll">
      {board.value && <section className="network-settings"><h3>Conexões</h3>
        {hub ? <><p className="network-message">Central <strong>{hub.name}</strong> · {hub.online ? 'conectada' : 'sem conexão'}</p><button type="button" className="desk-secondary" disabled={busy} onClick={() => void disconnect()}>Desconectar da central</button></> : <>
          <p>Use o Tailscale nos dispositivos. Compartilhe os nomes dos chats, agentes, estados e horários pela Rede Bento.</p>
          <div>
            <button type="button" className="desk-secondary" disabled={busy} onClick={() => void generate()}>{board.value.mobileEnabled ? 'Gerar convite para outro computador' : 'Ativar acesso remoto e gerar convite'}</button>
            {invitation && <><label>Convite para outro computador<input readOnly value={invitation.url} onFocus={event => event.currentTarget.select()} /></label><button type="button" className="desk-secondary" onClick={() => navigator.clipboard.writeText(invitation.url).then(() => setMessage('Convite copiado.')).catch(() => setActionError('Selecione o convite acima para copiar.'))}>Copiar convite</button><p>O convite vale por 10 minutos e conecta um computador.</p></>}
          </div>
          {!hasComputers && <form onSubmit={event => { event.preventDefault(); void join() }}><label>Convite recebido<input value={code} onChange={event => setCode(event.target.value)} placeholder="Cole o convite da central" autoComplete="off" maxLength={450} /></label><button type="submit" className="desk-secondary" disabled={busy || !code.trim()}>Conectar a uma central</button></form>}
          <p>Para ver as tarefas no celular, pareie-o em Chats → Acesso móvel e abra Rede.</p>
        </>}
        {message && <p role="status">{message}</p>}{actionError && <p className="desk-error-inline" role="alert">{actionError}</p>}{httpsError && <TailscaleHttpsLink />}
      </section>}
      <section><h3>Tarefas dos computadores</h3><NetworkBoard {...board} openTask={id => { void api(`/sessions/${encodeURIComponent(id)}/focus`, {}).catch(reportError) }} removeComputer={hub || busy ? undefined : remove} /></section>
    </div>
  </div>
}
