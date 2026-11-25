import NetworkBoard, { type NetworkSnapshot } from '../components/NetworkBoard'
import { useNetwork } from '../components/useNetwork'
import { mobileApi } from './client'

const load = () => mobileApi<NetworkSnapshot>('/network')

export default function NetworkView({ openTask }: { openTask: (id: string) => void }) {
  const board = useNetwork(load)
  return <main className="mobile-network"><NetworkBoard {...board} openTask={openTask} /></main>
}
