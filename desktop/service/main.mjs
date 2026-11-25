import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createService } from './server.mjs';
import { saveJson } from './util.mjs';
import { createInterface } from 'node:readline';

const directory = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; };
const repo = path.resolve(option('--repo') || process.env.MRMAK_REPO || path.join(directory, '../..'));
const uiDir = path.resolve(option('--ui') || path.join(directory, '../../dist'));
const stateDir = path.resolve(option('--state') || path.join(repo, '.mrmak'));
// Computer credentials need a machine-local home even when a Workspace is synced.
const localData = process.platform === 'win32' ? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support')
  : process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
const workspaceKey = createHash('sha256').update(process.platform === 'win32' ? repo.toLowerCase() : repo).digest('hex').slice(0, 24);
const networkStateDir = option('--state') ? stateDir : path.join(localData, 'com.mrmak.workspace', 'network', workspaceKey);
const writeNative = value => process.stdout.write(JSON.stringify(value) + '\n');
const service = await createService({ repo, uiDir, stateDir, networkStateDir, native: writeNative, restoreSessions: true });
// Diagnostics are readable project state. Window credentials travel only over
// the private startup pipe to the desktop shell, never through this file.
await saveJson(path.join(stateDir, 'runtime.json'), { pid: process.pid, origin: service.origin });
writeNative({ type: 'ready', ...service.urls });
let exiting = false;
async function stop() {
  if (exiting) return; exiting = true;
  const deadline = setTimeout(() => process.exit(1), 8000); deadline.unref();
  await service.close(); process.exit(0);
}
process.on('SIGINT', stop); process.on('SIGTERM', stop);
if (process.env.MRMAK_PARENT_PID) {
  const parent = Number(process.env.MRMAK_PARENT_PID);
  const timer = setInterval(() => { try { process.kill(parent, 0); } catch { stop(); } }, 2000); timer.unref();
}
createInterface({ input: process.stdin }).on('line', line => {
  if (line.trim() === 'quit') { void stop(); return; }
  try { service.nativeMessage(JSON.parse(line)); } catch { /* Ignore malformed native messages. */ }
});
process.on('uncaughtException', error => { process.stderr.write(`Service error: ${error.message}\n`); stop(); });
