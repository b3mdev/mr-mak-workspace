import { useT } from '../lib/i18n'

export default function TailscaleHttpsLink() {
  const { t } = useT()
  return <a href="https://login.tailscale.com/admin/dns" target="_blank" rel="noreferrer">{t('tailscale.openDns')}</a>
}
