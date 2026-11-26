import { useState } from 'react'
import { AgentLogo, Icon } from '../desktop/Icons'
import type { AgentId } from '../desktop/types'
import { useT, type MessageKey } from '../lib/i18n'
import './network-board.css'

const taskStatusKeys = {
  starting: 'network.task.starting',
  working: 'network.task.working',
  waiting: 'network.task.waiting',
  answered: 'network.task.answered',
  idle: 'network.task.idle',
  stopped: 'network.task.stopped',
} as const satisfies Record<string, MessageKey>
const agentLabels = { codex: 'Codex', claude: 'Claude', antigravity: 'Antigravity', opencode: 'OpenCode', kimi: 'Kimi' }
type NetworkTask = { id: string; title: string; agent: Exclude<AgentId, 'shell'>; status: keyof typeof taskStatusKeys; updatedAt: string | null }
type NetworkComputer = { id: string; name: string; online: boolean; lastSeen: string | null; tasks: NetworkTask[] }
export type NetworkSnapshot = { localId: string; computers: NetworkComputer[]; hub: { name: string; online: boolean } | null; mobileEnabled?: boolean }

function Stamp({ at }: { at: string | null }) {
  const { dateTime } = useT()
  return at ? <time dateTime={at}>{dateTime(at)}</time> : null
}

export default function NetworkBoard({ value, error, refresh, openTask, removeComputer }: {
  value: NetworkSnapshot | null; error: boolean; refresh: () => void;
  openTask?: (id: string) => void; removeComputer?: (id: string) => void;
}) {
  const { t } = useT()
  const [selected, setSelected] = useState('')
  const computers = value?.computers ?? []
  const filtered = computers.some(computer => computer.id === selected) ? computers.filter(computer => computer.id === selected) : computers
  const online = computers.filter(computer => computer.online).length
  const working = computers.reduce((total, computer) => total + (computer.online ? computer.tasks.filter(task => task.status === 'working' || task.status === 'starting').length : 0), 0)

  return <div className="network-board">
    <div className="network-board-top">
      {value && <div className="network-stats"><span><b>{online}/{computers.length}</b> {t('network.statsOnline')}</span><span><b>{working}</b> {t('network.statsWorking')}</span></div>}
      <button type="button" className="network-icon-button" title={t('network.refreshTasks')} aria-label={t('network.refreshTasks')} onClick={refresh}><Icon name="refresh" size={17} /></button>
    </div>
    {error && <p className="network-message" role="status">{value ? t('network.connectionDropped') : t('network.boardUnavailable')}</p>}
    {!value && !error && <p className="network-message" role="status">{t('network.loadingComputers')}</p>}
    {computers.length > 1 && <label className="network-filter">{t('network.filterComputer')}<select value={filtered.length === computers.length ? '' : selected} onChange={event => setSelected(event.target.value)}><option value="">{t('network.allComputers')}</option>{computers.map(computer => <option key={computer.id} value={computer.id}>{computer.name}</option>)}</select></label>}
    {filtered.map(computer => {
      const local = computer.id === value?.localId
      const tasks = [...computer.tasks].sort((a, b) => Number(b.status === 'waiting') - Number(a.status === 'waiting') || Number(b.status === 'working') - Number(a.status === 'working') || (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      return <section className="network-computer" key={computer.id} aria-label={computer.name}>
        <header><Icon name="computer" size={20} /><div><h3>{computer.name}</h3>{local ? <p>{t('network.accessComputer')}</p> : !computer.online && <p>{t('network.lastContact')} <Stamp at={computer.lastSeen} />{!computer.lastSeen && t('network.unavailableLower')}</p>}</div><span className="network-online" data-online={computer.online}>{computer.online ? t('common.online') : t('common.offline')}</span></header>
        {tasks.length ? <ul className="network-tasks">{tasks.map(task => {
          const content = <><AgentLogo agent={task.agent} size={19} /><span><strong>{task.title}</strong><small>{agentLabels[task.agent]}{task.updatedAt && <> · <Stamp at={task.updatedAt} /></>}</small></span><span className="network-task-status" data-status={computer.online ? task.status : 'offline'}>{t(taskStatusKeys[task.status])}</span></>
          return <li key={task.id}>{local && openTask ? <button type="button" className="network-task" onClick={() => openTask(task.id)}>{content}</button> : <div className="network-task">{content}</div>}</li>
        })}</ul> : <p className="network-computer-empty">{computer.online ? t('network.noOpenChats') : t('network.noTasksReceived')}</p>}
        {!local && removeComputer && <button type="button" className="network-revoke" onClick={() => removeComputer(computer.id)}>{t('network.removeFromNetwork')}</button>}
      </section>
    })}
  </div>
}
