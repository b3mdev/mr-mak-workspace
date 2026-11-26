import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';
import { tailNativeFile } from '../native-events.mjs';
import { codexSkillOverrides } from '../agents.mjs';
import { sleep } from '../util.mjs';

const uiDir = path.dirname(fileURLToPath(import.meta.url));
const text = (name, body = 'Example instructions.') => `---\nname: ${name}\ndescription: Fixture skill.\n---\n\n${body}\n`;

test('chat skills keep native evidence, launch settings, and explicit file edits scoped', { timeout: 20000 }, async t => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'bento-chat-skills-'));
  const home = path.join(repo, 'fake-home');
  async function write(relative, source) {
    const file = path.join(repo, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, source);
    return file;
  }
  await write('.git', '');
  await write('workspace/workspace.json', '{"entities":[]}');
  const editable = await write('.claude/skills/local-skill/SKILL.md', text('local-skill'));
  const shared = await write('.claude/skills/shared-skill/SKILL.md', text('shared-skill'));
  await write('.agents/skills/shared-skill/SKILL.md', text('shared-skill'));
  await write('.agents/skills/codex-skill/SKILL.md', text('codex-skill'));
  await write('scripts/sync-skills.mjs', '');
  await write('fake-home/.gemini/antigravity-cli/builtin/skills/managed-skill/SKILL.md', text('managed-skill'));
  const service = await createService({ repo, uiDir, networkStateDir: path.join(repo, 'network'), mcpOptions: { home, env: {} }, chatSkillOptions: { supportsOverrides: async () => true } });
  service.sessions.beginDiscovery = () => {};
  t.after(() => service.close());
  const add = (agent, name) => service.sessions.importConversation({ nativeId: randomUUID(), agent, cwd: repo, name });
  const claudeA = await add('claude', 'First Claude'), claudeB = await add('claude', 'Second Claude');
  const codexA = await add('codex', 'First Codex'), codexB = await add('codex', 'Second Codex');
  const agy = await add('antigravity', 'No telemetry');
  const request = (session, suffix = '', data) => fetch(`${service.origin}/api/sessions/${session.id}/skills${suffix}`, {
    method: data ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const rows = async session => (await (await request(session)).json()).entries;
  const find = async (session, name) => (await rows(session)).find(item => item.name === name);
  assert.equal((await find(claudeA, 'local-skill')).status, 'available');
  const records = [
    { type: 'user', message: { content: [{ type: 'text', text: 'I loaded shared-skill' }] } },
    { type: 'assistant', uuid: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', id: 'use', input: { skill: 'local-skill' } }] } },
    { type: 'user', sourceToolAssistantUUID: 'assistant', message: { content: [{ type: 'tool_result', tool_use_id: 'use' }] },
      toolUseResult: { success: true, commandName: 'local-skill' } },
  ];
  const file = await write('synthetic.jsonl', records.map(record => JSON.stringify(record)).join('\n') + '\n');
  const stop = tailNativeFile(file, 'claude', event => service.sessions.nativeEvent(service.sessions.get(claudeA.id), event));
  t.after(stop);
  for (let attempts = 0; attempts < 30 && (await find(claudeA, 'local-skill')).status !== 'loaded'; attempts++) await sleep(30);
  assert.equal((await find(claudeA, 'local-skill')).status, 'loaded');
  assert.equal((await find(claudeB, 'local-skill')).status, 'available');
  assert.equal((await find(claudeA, 'shared-skill')).status, 'available');
  assert.equal((await find(agy, 'managed-skill')).status, 'unknown');

  const first = await find(codexA, 'codex-skill');
  const update = { action: 'setEnabled', skill: first.id, enabled: false };
  assert.equal((await request(codexA, '', update)).status, 200);
  assert.equal((await find(codexA, 'codex-skill')).next, false);
  assert.equal((await find(codexA, 'codex-skill')).current, null);
  assert.equal((await find(codexB, 'codex-skill')).next, null);
  assert.equal((await request(agy, '', { ...update, skill: (await find(agy, 'managed-skill')).id })).status, 409);
  const stored = JSON.parse(await readFile(path.join(repo, '.mrmak/sessions.json'), 'utf8'));
  assert.equal(stored.find(item => item.id === codexA.id).skillOverrides[0].enabled, false);
  assert.equal(stored.find(item => item.id === codexB.id).skillOverrides, undefined);
  const flags = await service.sessions.chatSkills.launch(service.sessions.get(codexA.id), {});
  assert.match(codexSkillOverrides(flags), /^skills\.config=\[\{path=".*SKILL\.md",enabled=false\}\]$/);
  assert.deepEqual(await service.sessions.chatSkills.launch(service.sessions.get(codexB.id), {}), []);

  const skill = await find(claudeA, 'local-skill'), locked = await find(claudeA, 'shared-skill');
  const detail = await (await request(claudeA, '?skill=' + skill.id)).json();
  const readOnly = await (await request(claudeA, '?skill=' + locked.id)).json();
  assert.equal(detail.reason, null);
  assert.equal(readOnly.reason, 'synced');
  assert.match(readOnly.instructions, /Example instructions/);
  const save = { action: 'save', skill: skill.id, revision: detail.revision, instructions: 'Revised instructions.' };
  assert.equal((await request(claudeA, '', { ...save, skill: locked.id, revision: readOnly.revision })).status, 403);
  assert.equal(await readFile(shared, 'utf8'), text('shared-skill'));
  assert.equal((await request(claudeA, '', save)).status, 200);
  assert.match(await readFile(editable, 'utf8'), /^---\nname: local-skill[\s\S]*Revised instructions/);
  assert.equal((await request(claudeA, '', save)).status, 409);
});
