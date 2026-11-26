import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { childEnvironment, codexBinary } from './agents.mjs';
import { readStatus } from './claude-status.mjs';

import { nonnegative, tokens, date, seconds } from './usage-data.mjs';

function codexQuotas(result) {
  const groups = result?.rateLimitsByLimitId;
  const entries = groups && Object.keys(groups).length ? Object.entries(groups) : [['codex', result?.rateLimits]];
  return entries.flatMap(([id, group]) => ['primary', 'secondary'].flatMap(window => {
    const limit = group?.[window];
    const percent = nonnegative(limit?.usedPercent);
    const resetsAt = seconds(limit?.resetsAt);
    const label = id === 'codex' ? null : String(group?.limitName || id).slice(0, 80);
    return percent === null && resetsAt === null ? [] : [{ key: `${id}:${window}`, label, minutes: nonnegative(limit?.windowDurationMins), percent, remaining: null, resetsAt }];
  }));
}

// Query the signed-in CLI over stdio, without opening a conversation.
function readCodex(repo) {
  const command = codexBinary();
  return new Promise(resolve => {
    const child = spawn(command.file, [...command.args, 'app-server', '--stdio'], {
      cwd: repo, env: childEnvironment(repo), stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
    });
    let quotas = [], total = null;
    let finished = false;
    const pending = new Set([2, 3]);
    const lines = createInterface({ input: child.stdout });
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      lines.close();
      child.stdin.destroy();
      child.kill();
      resolve({ quotas, total, at: Date.now() });
    };
    const timeout = setTimeout(finish, 8000);
    child.once('error', finish);
    child.once('close', finish);
    child.stdin.on('error', finish);
    lines.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (!message || message.method) return;
      if (message.id === 1) {
        if (message.error) return finish();
        child.stdin.write([
          { method: 'initialized', params: {} },
          { id: 2, method: 'account/rateLimits/read' },
          { id: 3, method: 'account/usage/read' },
        ].map(value => JSON.stringify(value) + '\n').join(''));
      }
      if (message.id === 2) quotas = codexQuotas(message.result);
      if (message.id === 3) total = tokens(message.result?.summary?.lifetimeTokens);
      pending.delete(message.id);
      if (!pending.size) finish();
    });
    child.stdin.write(JSON.stringify({ id: 1, method: 'initialize', params: {
      clientInfo: { name: 'bento_usage', title: 'Bento Workspace', version: '0.1.0' }, capabilities: { experimentalApi: true },
    } }) + '\n');
  });
}

export function usageReader(repo, stateDir, getSessions, queryCodex = readCodex) {
  let codex, pending;
  const getCodex = () => {
    if (codex && Date.now() - codex.at < 55_000) return codex;
    return pending ??= Promise.resolve().then(() => queryCodex(repo))
      .catch(() => ({ quotas: [], total: null, at: Date.now() }))
      .then(value => { codex = value; return value; })
      .finally(() => { pending = null; });
  };
  return async () => {
    const sessions = [...getSessions()];
    const collect = async agent => {
      const reports = await Promise.all(sessions.filter(chat => chat.agent === agent)
        .map(async chat => (await readStatus(stateDir, chat.id, agent)).chat));
      const latest = reports.filter(report => date(report?.at) && report.usage)
        .sort((a, b) => b.at - a.at)[0];
      return { quotas: latest?.usage.quotas ?? [], total: latest?.usage.total ?? null, at: latest?.at ?? null };
    };
    const [codexUsage, claude, antigravity] = await Promise.all([getCodex(), collect('claude'), collect('antigravity')]);
    return { codex: codexUsage, claude, antigravity, checkedAt: Date.now() };
  };
}
