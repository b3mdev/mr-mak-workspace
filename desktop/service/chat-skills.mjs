import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readdir, readFile, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { codexBinary } from './agents.mjs';
import { claudePluginRoots, projectFolders, skillField } from './chat-commands.mjs';
import { samePath } from './platform.mjs';
import { saveText, within } from './util.mjs';

const execute = promisify(execFile);
const documentLimit = 256 * 1024;
const frontmatter = /^\uFEFF?---(?:\r?\n)[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
const hash = value => createHash('sha256').update(value).digest('hex');
const failure = (message, status) => Object.assign(new Error(message), { status });

// Verified with Codex 0.172.0's session-level skills.config layer. Older or
// unidentifiable binaries stay in browse mode.
const versions = new Map();
export async function supportsCodexSkillOverrides(env = process.env) {
  try {
    const { file, args } = codexBinary(env);
    const key = `${file}:${args.join(':')}:${(await stat(file)).mtimeMs}`;
    if (!versions.has(key)) {
      versions.set(key, execute(file, [...args, '--version'], { env, timeout: 5000, windowsHide: true }).then(({ stdout }) => {
        const match = /^codex-cli\s+(\d+)\.(\d+)\.\d+\s*$/m.exec(stdout);
        return !!match && (Number(match[1]) > 0 || Number(match[2]) >= 172);
      }).catch(() => false));
    }
    return versions.get(key);
  } catch { return false; }
}

function choices(session) {
  return Array.isArray(session.skillOverrides) ? session.skillOverrides.filter(item =>
    typeof item?.path === 'string' && path.isAbsolute(item.path) && typeof item.enabled === 'boolean') : [];
}

async function sharedDistribution(source, folder) {
  if (!source.twin || !(await stat(path.join(source.project, 'scripts', 'sync-skills.mjs')).catch(() => null))?.isFile()) return false;
  return !!(await stat(path.join(source.project, source.twin, 'skills', folder, 'SKILL.md')).catch(() => null))?.isFile();
}

// The metadata can reference a local icon shipped with the definition. Only
// small image files within that skill folder enter the catalog sent to the UI.
async function skillIcon(directory) {
  const metadata = await realpath(path.join(directory, 'agents', 'openai.yaml')).catch(() => null);
  if (!metadata || !within(directory, metadata) || ((await stat(metadata).catch(() => null))?.size ?? Infinity) > 8192) return undefined;
  const yaml = await readFile(metadata, 'utf8').catch(() => '');
  const match = /^\s+icon_small:\s*([^\r\n]+)$/m.exec(yaml);
  const relative = match?.[1].trim().replace(/^(['"])(.*)\1$/, '$2');
  if (!relative || path.isAbsolute(relative)) return undefined;
  const icon = await realpath(path.resolve(directory, relative)).catch(() => null);
  if (!icon || !within(directory, icon)) return undefined;
  const info = await stat(icon).catch(() => null);
  if (!info?.isFile() || info.size > 12288) return undefined;
  const bytes = await readFile(icon).catch(() => Buffer.alloc(0));
  const format = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png'
    : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' ? 'webp' : null;
  return format ? `data:image/${format};base64,${bytes.toString('base64')}` : undefined;
}

async function readSkill(source, root, folder) {
  const expected = path.join(root, folder, 'SKILL.md');
  const actual = await realpath(expected).catch(() => null);
  if (!actual || !within(root, actual)) return null;
  const info = await stat(actual).catch(() => null);
  if (!info?.isFile() || info.size > documentLimit) return null;
  const text = await readFile(actual, 'utf8').catch(() => null);
  if (text === null || text.includes('\0')) return null;
  const head = frontmatter.exec(text)?.[0] ?? '';
  const name = `${source.prefix || ''}${skillField(text.replace(/^\uFEFF/, ''), 'name') || folder}`;
  const reason = source.scope === 'plugin' || source.scope === 'bundled' ? 'managed'
    : !head || !samePath(expected, actual) ? 'protected'
    : await sharedDistribution(source, folder) ? 'synced'
    : !(info.mode & 0o222) || !(await access(actual, constants.W_OK).then(() => true, () => false)) ? 'protected' : null;
  return { id: hash(process.platform === 'win32' ? actual.toLowerCase() : actual), name,
    description: skillField(text.replace(/^\uFEFF/, ''), 'description'), path: actual, scope: source.scope, reason, text, head, info };
}

export class ChatSkills {
  constructor({ home = os.homedir(), env = process.env, supportsOverrides = supportsCodexSkillOverrides } = {}) {
    this.home = home;
    this.env = env;
    this.supportsOverrides = supportsOverrides;
  }

  async sources(session) {
    const { home, env } = this;
    if (!['codex', 'claude', 'antigravity'].includes(session.agent)) return [];
    const claude = session.agent === 'claude', folder = claude ? '.claude' : '.agents';
    const ancestors = await projectFolders(session.cwd);
    const hasRepository = await stat(path.join(ancestors.at(-1), '.git')).catch(() => null);
    const project = (hasRepository ? ancestors : ancestors.slice(0, 1)).filter(directory => !samePath(directory, home)).map(directory => ({
      root: path.join(directory, folder, 'skills'), scope: 'project', project: directory, twin: claude ? '.agents' : '.claude',
    }));
    const user = (root, scope = 'user') => ({ root, scope });
    if (claude) {
      const config = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
      const plugins = await claudePluginRoots(config).catch(() => []);
      return [...project, user(path.join(config, 'skills')), ...plugins.map(plugin => ({
        ...user(path.join(plugin.folder, 'skills'), 'plugin'), prefix: plugin.prefix,
      }))];
    }
    return [...project, user(path.join(home, '.agents', 'skills')), session.agent === 'codex'
      ? user(path.join(env.CODEX_HOME || path.join(home, '.codex'), 'skills'))
      : user(path.join(home, '.gemini', 'antigravity-cli', 'builtin', 'skills'), 'bundled')];
  }

  async catalog(session) {
    const entries = await Promise.all((await this.sources(session)).map(async source => {
      const root = await realpath(source.root).catch(() => null);
      if (!root) return [];
      // A project symlink must not turn another folder into a writable project skill root.
      if (source.project && !within(await realpath(source.project).catch(() => source.project), root)) return [];
      const folders = await readdir(root, { withFileTypes: true }).catch(() => []);
      return Promise.all(folders.filter(folder => folder.isDirectory()).map(folder => readSkill(source, root, folder.name)));
    }));
    return [...new Map(entries.flat().filter(Boolean).map(skill => [skill.id, skill])).values()];
  }

  async canOverride(session, env = this.env) {
    return session.agent === 'codex' && await this.supportsOverrides(env);
  }

  async launch(session, env) {
    const overrides = choices(session);
    if (!overrides.length || !(await this.canOverride(session, env))) return [];
    const paths = new Set((await this.catalog(session)).map(skill => skill.path));
    return overrides.filter(item => paths.has(item.path));
  }

  async list(session) {
    const [catalog, canOverride] = await Promise.all([this.catalog(session), this.canOverride(session)]);
    const observed = session.loadedSkills || new Set();
    const counts = new Map();
    for (const skill of catalog) counts.set(skill.name, (counts.get(skill.name) || 0) + 1);
    const desired = new Map(choices(session).map(item => [item.path, item.enabled]));
    const applied = new Map((session.process ? session.appliedSkillOverrides || [] : []).map(item => [item.path, item.enabled]));
    const entries = await Promise.all(catalog.map(async skill => {
      const confirmed = counts.get(skill.name) === 1 && observed.has(skill.name);
      const current = applied.get(skill.path) ?? null;
      const next = desired.get(skill.path) ?? null;
      return { id: skill.id, name: skill.name, description: skill.description, scope: skill.scope, icon: await skillIcon(path.dirname(skill.path)),
        status: confirmed ? 'loaded' : current === false ? 'disabled' : current === true || session.agent === 'claude' ? 'available' : 'unknown',
        current, next, canOverride };
    }));
    for (const name of observed) {
      if (counts.get(name) !== 1) entries.push({ id: `runtime-${hash(name)}`, name, description: '', scope: 'runtime',
        status: 'loaded', current: null, next: null, canOverride: false });
    }
    const order = { loaded: 0, available: 1, unknown: 2, disabled: 3 };
    return { entries: entries.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name)),
      runtimeObservation: session.agent === 'claude' };
  }

  async detail(session, id) {
    const skill = (await this.catalog(session)).find(item => item.id === id);
    if (!skill) throw failure('The skill file is no longer available.', 404);
    return { path: skill.path, instructions: skill.text.slice(skill.head.length).replace(/^[ \t]*\r?\n/, ''), revision: hash(skill.text), reason: skill.reason };
  }

  async setEnabled(session, id, enabled) {
    if (typeof enabled !== 'boolean' || !(await this.canOverride(session))) throw failure('This agent does not support per-chat skill settings.', 409);
    const skill = (await this.catalog(session)).find(item => item.id === id);
    if (!skill) throw failure('The skill file is no longer available.', 404);
    session.skillOverrides = [...choices(session).filter(item => item.path !== skill.path), { path: skill.path, enabled }];
  }

  async save(session, id, revision, instructions) {
    const source = async () => {
      const skill = (await this.catalog(session)).find(item => item.id === id);
      if (!skill) throw failure('The skill file is no longer available.', 404);
      if (skill.reason) throw failure('This skill file is read-only.', 403);
      if (hash(skill.text) !== revision) throw failure('The skill changed on disk. Reopen the file before saving.', 409);
      return skill;
    };
    const skill = await source();
    if (typeof instructions !== 'string' || !instructions.trim() || instructions.includes('\0')) {
      throw failure('Enter skill instructions up to 256 KiB.', 400);
    }
    const newline = skill.head.includes('\r\n') ? '\r\n' : '\n';
    const text = skill.head.replace(/(?:\r?\n)?$/, newline) + newline + instructions.replace(/\r?\n/g, newline);
    if (Buffer.byteLength(text) > documentLimit) throw failure('Enter skill instructions up to 256 KiB.', 400);
    await saveText(skill.path, text, { beforeReplace: source, mode: skill.info.mode & 0o777 });
    return this.detail(session, id);
  }
}
