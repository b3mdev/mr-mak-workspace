import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createService } from '../server.mjs';
import { nativeActivity } from '../native-events.mjs';
import { createObserver } from '../opencode/observer.mjs';

export async function notificationFixture(uiDir) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'bento-notifications-'));
  await mkdir(path.join(repo, 'workspace'));
  await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
  const calls = [];
  let items = [], publish = () => {};
  const external = {
    id: 'fixture-app', enabled: true,
    snapshot: () => items,
    subscribe(change) { publish = change; return () => { publish = () => {}; }; },
    deliver() { calls.push('unexpected external delivery'); },
  };
  const disabled = { id: 'disabled', enabled: false, snapshot() { calls.push('unexpected access'); } };
  const options = { repo, uiDir: uiDir || repo, mcpOptions: { home: repo, env: {} }, notificationSources: [external, disabled] };
  const service = await createService(options);
  service.coordinator.ask = async request => { calls.push(request.id); throw new Error('Synthetic fixture prohibits provider calls'); };
  service.quick.ask = service.coordinator.ask;
  let revision = 0;
  async function api(route, data) {
    const response = await fetch(`${service.origin}/api${route}`, {
      method: data ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
    });
    const value = await response.json();
    if (!response.ok) throw Error(value.error);
    return value;
  }
  const ask = (text, id = randomUUID(), selectedId) => api('/coordinator', { id, text, contextRevision: revision, selectedId });
  const reset = async () => { const result = await api('/coordinator/conversation', { action: 'reset', contextRevision: revision }); revision = result.coordinatorConversation.contextRevision; };
  return { repo, options, service, api, ask, reset, calls, publish: events => { items = events; publish(); } };
}

const composer = (agent, draft) => {
  if (agent === 'codex') return `› ${draft || 'Ask Codex to do anything'}\r\n\r\n  100% context left`;
  const marker = { claude: '❯', antigravity: '>', opencode: '│', kimi: '>' }[agent];
  if (marker) return `────────────\r\n${marker} ${draft}\r\n────────────`;
  return 'PS C:\\Synthetic>';
};
export const permission = 'Allow command?\r\n\r\n› 1. Yes, proceed\r\n  2. No\r\n\r\nPress enter to confirm';

export async function addNotificationChat(service, agent, title) {
  const { sessions } = service;
  const session = sessions.make({ id: randomUUID(), agent, name: title, nativeId: agent === 'opencode' ? 'ses_synthetic' : randomUUID(), cwd: sessions.repo, createdAt: new Date().toISOString(), open: true, status: 'running', cols: 120, rows: 24 });
  const writes = [];
  const screen = async text => {
    session.screenVersion++;
    session.terminal.reset();
    await new Promise(resolve => session.terminal.write(text, resolve));
    sessions.emit('output', { id: session.id });
  };
  const idle = draft => screen(composer(agent, draft));
  await sessions.hydrate(session);
  session.process = {
    write(text) {
      writes.push(text);
      if (text.startsWith('\x1b[200~') && !fixture.onPaste?.()) void idle(text.slice(6, -6));
      if (text === '\r') void idle('');
    },
    onExit(callback) { queueMicrotask(callback); return { dispose() {} }; },
    kill() { session.process = null; },
  };
  sessions.items.set(session.id, session);
  await idle('');
  sessions.changed(session);
  const complete = (id, text) => {
    const record = agent === 'codex' ? { type: 'event_msg', payload: { type: 'task_complete', turn_id: id, last_agent_message: text } }
      : agent === 'claude' ? { type: 'assistant', message: { id, stop_reason: 'end_turn', content: [{ type: 'text', text }] } }
      : { type: 'PLANNER_RESPONSE', content: text, step_index: id };
    const event = nativeActivity(record, agent);
    if (event) sessions.nativeEvent(session, event);
  };
  const observeOpenCode = () => createObserver({ directory: service.sessions.repo, nativeId: session.nativeId, chatId: session.id, launchId: 'fixture', save(state) {
    if (state.completion) sessions.nativeEvent(session, { kind: 'turn-completed', id: state.completion });
    if (state.activity === 'waiting') sessions.nativeEvent(session, { kind: 'attention' });
    if (state.activity === 'working') sessions.nativeEvent(session, { kind: 'turn-started' });
  } });
  const fixture = { session, writes, idle, screen, complete, observeOpenCode, onPaste: null };
  return fixture;
}
