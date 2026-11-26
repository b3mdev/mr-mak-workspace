import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createService } from '../server.mjs';
import { localDay } from '../workspace.mjs';

test('the coordinator recovers from a stuck turn and persists fresh context independently of model and voice', { timeout: 15000 }, async t => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'bento-recovery-'));
  await mkdir(path.join(repo, 'context/daily'), { recursive: true });
  await mkdir(path.join(repo, 'workspace'));
  await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
  await writeFile(path.join(repo, 'context/identity.md'), 'Local profile fixture');
  await writeFile(path.join(repo, `context/daily/${localDay()}.md`), 'Local daily fixture');
  let service = await createService({ repo, uiDir: repo });
  t.after(async () => { await service?.close(); await rm(repo, { recursive: true, force: true }); });

  async function request(route, data, expected = 200) {
    const response = await fetch(service.origin + '/api' + route, {
      method: data ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' },
      body: data && JSON.stringify(data),
    });
    const value = await response.json();
    assert.equal(response.status, expected, value.error);
    return value;
  }

  const { coordinator } = service;
  const local = await request('/coordinator/context');
  assert.equal(local.day.date, localDay());
  assert.equal(local.computer.architecture, os.machine());
  assert.equal(local.profile[0].text, 'Local profile fixture');
  assert.equal(local.daily.text, 'Local daily fixture');
  const sources = await coordinator.execute('get_local_context', {});
  assert.deepEqual(sources.profile, [{ path: 'context/identity.md', available: true }]);
  assert.equal((await coordinator.execute('read_context', { path: local.daily.path })).text, 'Local daily fixture');
  assert.match((await coordinator.execute('read_context', { path: '.agents/skills/local-context/SKILL.md' })).text, /^name: local-context$/m);
  assert.equal(coordinator.child, null);

  const prompts = [];
  const { promise: stuck, resolve: turnStarted } = Promise.withResolvers();
  coordinator.start = async () => { coordinator.threadId = 'fixture'; };
  coordinator.rpc = async (method, params) => {
    assert.equal(method, 'turn/start');
    const text = params.input[0].text;
    prompts.push(text);
    if (text.includes('Stuck request')) {
      turnStarted();
      return new Promise(() => {});
    }
    coordinator.active.resolve('Fixture result');
    return { turn: { id: 'fixture-turn' } };
  };
  const ask = (id, text, contextRevision) => request('/coordinator', { id, text, contextRevision });
  const move = (action, contextRevision) => request('/coordinator/conversation', { action, contextRevision });
  const stalled = ask('stuck', 'Stuck request', 0);
  await stuck;
  const queued = ask('queued', 'Queued request', 0);
  for (let attempt = 0; attempt < 100 && !coordinator.operationPromises.has('queued'); attempt++) await delay(10);
  assert.ok(coordinator.operationPromises.has('queued'), 'expected the second request to wait behind the stuck RPC');
  await move('stop', 0);
  assert.equal((await stalled).status, 'interrupted');
  assert.equal((await queued).status, 'interrupted');
  assert.equal(prompts.length, 1);
  assert.equal((await ask('memory', 'Previous conversational detail', 0)).status, 'completed');
  assert.match(prompts.at(-1), /Previous conversational detail/);
  assert.doesNotMatch(prompts.at(-1), /Local profile fixture|Local daily fixture/);

  assert.equal((await ask('direct', 'list chats', 0)).route, 'direct');
  const reset = await move('reset', 0);
  assert.deepEqual(reset.coordinatorConversation, { conversationId: 0, contextRevision: 1 });
  assert.ok(reset.operations.some(item => item.id === 'memory'));
  await request('/coordinator', { id: 'stale', text: 'Old voice request', contextRevision: 0 }, 409);
  await ask('fresh', 'Fresh conversational turn', 1);
  assert.doesNotMatch(prompts.at(-1), /Previous conversational detail|There are no open chats|Old voice request/);
  assert.equal((await move('new', 1)).operations.length, 0);
  await request('/live/transcript', { id: 'old-voice', conversationId: 0, captions: [{ role: 'user', text: 'Late old voice history' }] });
  assert.deepEqual((await request('/bootstrap')).voiceHistory, []);

  await service.close();
  service = await createService({ repo, uiDir: repo });
  const restored = await request('/bootstrap');
  assert.deepEqual(restored.coordinatorConversation, { conversationId: 2, contextRevision: 2 });
  assert.deepEqual(restored.operations, []);
  assert.ok(service.coordinator.operations.has('memory'), 'old IDs still prevent duplicate actions');
  assert.equal((await request('/coordinator/context')).daily.text, 'Local daily fixture');
});
