import { execFile, spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { codexBinary, commandPath, nativeConversationId, wrapCommand } from './agents.mjs';
import { validAntigravityId } from './antigravity.mjs';
import { powerShellLiteral, shellCommand } from './platform.mjs';

const execute = promisify(execFile);
const run = (file, args) => execute(file, args, { windowsHide: true, timeout: 10_000 });
const works = (file, args) => run(file, args).then(() => true, () => false);
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const appleString = value => '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';

function windowsOpen(file, args = []) {
  const command = shellCommand();
  const argumentsText = args.map(value => '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/\\+$/, '$&$&') + '"').join(' ');
  const start = `Start-Process -ErrorAction Stop -FilePath ${powerShellLiteral(file)}${argumentsText ? ` -ArgumentList ${powerShellLiteral(argumentsText)}` : ''}`;
  return run(command.file, [...command.args, '-NonInteractive', '-EncodedCommand', Buffer.from(start, 'utf16le').toString('base64')]);
}

async function codexDesktop(id) {
  if (!validAntigravityId(id)) return null;
  const url = `codex://threads/${id}`;
  if (process.platform === 'win32' && await works('reg.exe', ['query', 'HKCR\\codex', '/v', 'URL Protocol'])) {
    return () => windowsOpen(url);
  }
  if (process.platform === 'darwin' && await works('open', ['-Ra', 'ChatGPT'])) return () => run('open', [url]);
  if (process.platform === 'linux' && commandPath('xdg-mime')) {
    const handler = await run('xdg-mime', ['query', 'default', 'x-scheme-handler/codex']).catch(() => null);
    if (handler?.stdout.trim()) return () => run('xdg-open', [url]);
  }
  return null;
}

async function nativeTerminal(file, args, cwd) {
  if (process.platform === 'win32') {
    // Windows Terminal's app-execution alias may not be stat-able from Node.
    const resolved = commandPath('wt');
    const alias = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'wt.exe');
    const found = !resolved && alias ? await run('where.exe', ['wt.exe']).catch(() => null) : null;
    const terminal = resolved || (found?.stdout.split(/\r?\n/).some(value => value.trim().toLowerCase() === alias.toLowerCase()) ? alias : null);
    if (!terminal) throw new Error('Windows Terminal is required to continue this chat outside Bento.');
    const cli = wrapCommand(file, args);
    return () => windowsOpen(terminal, ['-w', 'new', 'new-tab', '--startingDirectory', cwd, cli.file, ...cli.args]);
  }
  if (process.platform === 'darwin') {
    const command = `cd ${shellQuote(cwd)} && ${[file, ...args].map(shellQuote).join(' ')}`;
    return () => run('osascript', ['-e', `tell application "Terminal" to do script ${appleString(command)}`, '-e', 'tell application "Terminal" to activate']);
  }
  const terminal = commandPath('x-terminal-emulator') || commandPath('xterm');
  if (!terminal) throw new Error('A graphical terminal is required to continue this chat outside Bento.');
  return () => new Promise((resolve, reject) => {
    const child = spawn(terminal, ['-e', file, ...args], { cwd, detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

// Resolve a launch path before the managed terminal is closed. Only use the
// backend's saved ID and working directory, never commands supplied by the UI.
export async function prepareConversationTransfer(session) {
  const id = nativeConversationId(session.nativeId);
  if (!id) throw new Error('This chat does not have a saved native conversation yet.');
  if (!(await stat(session.cwd).catch(() => null))?.isDirectory()) throw new Error('The original chat folder is unavailable.');
  if (session.agent === 'codex') {
    const desktop = await codexDesktop(id);
    if (desktop) return desktop;
    const { file, args } = codexBinary();
    return nativeTerminal(file, [...args, 'resume', id], session.cwd);
  }
  const provider = session.agent === 'antigravity' ? ['agy', '--conversation'] : session.agent === 'claude' ? ['claude', '--resume'] : null;
  if (!provider) throw new Error('This agent does not support continuing outside Bento.');
  if (session.agent === 'antigravity' && !validAntigravityId(id)) throw new Error('The Antigravity conversation ID is invalid.');
  const file = commandPath(provider[0]);
  if (!file) throw new Error('The original agent CLI is unavailable.');
  return nativeTerminal(file, [provider[1], id], session.cwd);
}

export async function releaseConversation(session, close, prepare = prepareConversationTransfer) {
  if (session.transferring || session.stopping || session.launching || session.status === 'starting') {
    throw Object.assign(new Error('This chat is already opening or closing.'), { status: 409 });
  }
  if (session.activity === 'working' || session.activity === 'waiting') {
    throw Object.assign(new Error('Finish the current turn before moving this conversation.'), { status: 409 });
  }
  session.transferring = true;
  try {
    const launch = await prepare(session);
    if (session.activity === 'working' || session.activity === 'waiting') {
      throw Object.assign(new Error('Finish the current turn before moving this conversation.'), { status: 409 });
    }
    await close();
    try { await launch(); }
    catch { throw new Error('The external app could not open. Your conversation is saved in Bento History.'); }
    return { released: true };
  } finally { session.transferring = false; }
}
