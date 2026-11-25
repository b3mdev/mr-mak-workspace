import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export const tailscaleHttpsRequired = 'TAILSCALE_HTTPS_REQUIRED';
function httpsMessage(hostname) {
  const tailnet = typeof hostname === 'string' && /^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/i.test(hostname) ? hostname.slice(hostname.indexOf('.') + 1) : null;
  const profile = tailnet ? `O perfil ativo do Tailscale usa a rede ${tailnet}, que ainda não disponibiliza certificados HTTPS.` : 'O perfil ativo do Tailscale ainda não disponibiliza certificados HTTPS.';
  return `${profile} Selecione a mesma rede no painel DNS, confira HTTPS Certificates e tente novamente.`;
}
const httpsError = hostname => Object.assign(new Error(httpsMessage(hostname)), { code: tailscaleHttpsRequired });

// Use a dedicated HTTPS port. Never reset or replace someone else's Serve setup.
export class TailscaleTransport {
  async command(args) {
    let executable = 'tailscale';
    if (process.platform === 'win32') {
      const installed = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe');
      try { await access(installed); executable = installed; } catch { /* Try PATH. */ }
    }
    if (process.platform === 'darwin') {
      // The Mac App Store / standalone Tailscale app does not put its CLI on PATH by default.
      const installed = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
      try { await access(installed); executable = installed; } catch { /* Try PATH. */ }
    }
    return execute(executable, args, { windowsHide: true, timeout: 12000, maxBuffer: 1024 * 1024 });
  }
  async probe() {
    try {
      const { stdout } = await this.command(['status', '--json']);
      const status = JSON.parse(stdout);
      const hostname = String(status.Self?.DNSName || '').replace(/\.$/, '');
      const running = status.BackendState === 'Running', named = /^[a-z0-9.-]+\.ts\.net$/i.test(hostname);
      if (running && named && Object.hasOwn(status, 'CertDomains') && !status.CertDomains?.length) {
        return { installed: true, ready: false, hostname, code: tailscaleHttpsRequired, message: httpsMessage(hostname) };
      }
      const message = !running ? 'Open Tailscale and sign in on this computer.' : !named ? 'Tailscale needs an HTTPS device name. Enable MagicDNS in your Tailscale account.' : '';
      return { installed: true, ready: running && named, hostname, message };
    } catch (error) {
      return { installed: error.code !== 'ENOENT', ready: false, message: error.code === 'ENOENT' ? 'Install Tailscale on this computer and your phone, then sign in to the same account.' : 'Open Tailscale, sign in, then check the connection again.' };
    }
  }
  async config() { return JSON.parse((await this.command(['serve', 'status', '--json'])).stdout || '{}'); }
  owns(config, saved) {
    if (!saved?.hostname || !saved?.port || !saved?.target) return false;
    const handlers = config.Web?.[`${saved.hostname}:${saved.port}`]?.Handlers;
    return Object.keys(handlers || {}).length === 1 && handlers['/']?.Proxy === saved.target;
  }
  async enable(target, previous) {
    const status = await this.probe();
    if (status.code === tailscaleHttpsRequired) throw httpsError(status.hostname);
    if (!status.ready) throw new Error(status.message || 'Tailscale needs an HTTPS device name. Enable MagicDNS in your Tailscale account.');
    const config = await this.config();
    let port = previous?.hostname === status.hostname && this.owns(config, previous) ? previous.port : null;
    if (!port) port = [8443, 8444, 8445, 8446].find(value => !config.TCP?.[value] && !Object.keys(config.Web || {}).some(key => key.endsWith(`:${value}`)));
    if (!port) throw new Error('Tailscale HTTPS ports 8443–8446 are already in use. Free one of these ports and try again.');
    if (config.AllowFunnel?.[`${status.hostname}:${port}`]) throw new Error('This Tailscale port is publicly shared. Turn off Funnel for this port before connecting Bento Workspace.');
    try { await this.command(['serve', '--bg', '--yes', `--https=${port}`, target]); }
    catch (error) {
      const output = [error?.stdout, error?.stderr, error?.message].map(value => String(value || '')).join('\n');
      if (/serve is not enabled on your tailnet|https (?:is )?not enabled|no (?:tls )?certificate domains/i.test(output)) throw httpsError(status.hostname);
      const hint = process.platform === 'win32' ? ' Windows may require an administrator terminal for the initial Serve setup.' : process.platform === 'darwin' ? ' Make sure the Tailscale app is running and signed in.' : '';
      throw new Error(`Tailscale Serve could not start. Enable HTTPS for this device in Tailscale and check its Serve permissions.${hint} See the setup instructions below.`);
    }
    const saved = { port, hostname: status.hostname, target };
    const verified = await this.config();
    if (!this.owns(verified, saved) || verified.AllowFunnel?.[`${saved.hostname}:${port}`]) throw new Error('The private Tailscale route could not be verified. Mobile access remains off.');
    return { ...saved, origin: `https://${status.hostname}:${port}` };
  }
  async disable(saved) {
    if (saved && this.owns(await this.config(), saved)) await this.command(['serve', '--yes', `--https=${saved.port}`, 'off']);
  }
}
