import path from 'node:path';
import os from 'node:os';
import { readFile, realpath, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { commandPath } from './agents.mjs';
import { within } from './util.mjs';
import { localDay } from './workspace.mjs';
const execute = promisify(execFile);
const sourceSkills = fileURLToPath(new URL('../../.agents/skills/local-context/', import.meta.url));
const bundledSkills = fileURLToPath(new URL('./skills/local-context/', import.meta.url));
const localContextSkill = path.join('.agents', 'skills', 'local-context', 'SKILL.md');

export function localClock(now = new Date()) {
  return { date: localDay(now), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, observedAt: now.toISOString() };
}

function computerContext() {
  return {
    computer: {
      os: { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[os.platform()] || os.type(),
      release: os.release(), architecture: os.machine(), logicalCpus: os.cpus().length,
      memoryGiB: Math.round(os.totalmem() / 1024 ** 3),
    },
    day: localClock(),
  };
}

export class ContextLibrary {
  constructor(repo) {
    this.repo = repo;
    this.skillRoots = [path.join(repo, '.agents', 'skills'), path.join(repo, '.claude', 'skills'), sourceSkills, bundledSkills, path.join(os.homedir(), '.agents', 'skills'), path.join(os.homedir(), '.codex', 'skills'), path.join(os.homedir(), '.codex', 'plugins', 'cache')];
  }
  async overview({ excerpts = false } = {}) {
    const overview = computerContext();
    const profile = await Promise.all(['context/identity.md', 'context/preferences.md', 'context/goals.md', 'context/me.md'].map(file => this.source(file, excerpts)));
    const daily = await this.source(`context/daily/${overview.day.date}.md`, excerpts);
    return { ...overview, profile: profile.filter(source => source.available), daily };
  }
  async source(file, excerpts) {
    const actual = await realpath(path.join(this.repo, file)).catch(() => null);
    if (!actual || !within(this.repo, actual) || !within(path.join(this.repo, 'context'), actual)) return { path: file, available: false };
    try {
      if (!(await stat(actual)).isFile()) return { path: file, available: false };
      if (!excerpts) return { path: file, available: true };
      const source = await this.read(actual, 0, 2000);
      return { path: file, available: true, text: source.text, truncated: source.nextOffset !== null };
    } catch { return { path: file, available: false }; }
  }
  async skills(query = '') {
    const rg = commandPath('rg');
    if (!rg) return { skills: [], note: 'The rg file search tool is unavailable. Workers can still use their own skills.' };
    const roots = [];
    for (const root of this.skillRoots) if ((await stat(root).catch(() => null))?.isDirectory()) roots.push(root);
    if (!roots.length) return { skills: [] };
    const { stdout } = await execute(rg, ['--files', '--hidden', '-g', 'SKILL.md', '-g', '!node_modules', '-g', '!target', ...roots], { windowsHide: true, maxBuffer: 1024 * 1024 }).catch(error => ({ stdout: error.stdout || '' }));
    const result = [];
    const seen = new Set();
    for (const file of stdout.trim().split(/\r?\n/).filter(Boolean)) {
      const text = await readFile(file, 'utf8').catch(() => '');
      const name = /^name:\s*(.+)$/m.exec(text)?.[1]?.replace(/^['"]|['"]$/g, '') || path.basename(path.dirname(file));
      const description = /^description:\s*(.+)$/m.exec(text)?.[1]?.replace(/^['"]|['"]$/g, '') || text.split('\n').find(line => line && !line.startsWith('#')) || '';
      if (seen.has(name) || (query && !`${name} ${description}`.toLowerCase().includes(query.toLowerCase()))) continue;
      seen.add(name); result.push({ name, description: description.slice(0, 260), path: file });
    }
    return { skills: result.slice(0, 180), total: result.length };
  }
  async read(file, offset = 0, length = 24000) {
    const actual = await realpath(path.resolve(this.repo, file)).catch(async error => {
      if (error.code !== 'ENOENT' || path.normalize(file) !== localContextSkill) throw error;
      for (const root of [bundledSkills, sourceSkills]) {
        const skill = await realpath(path.join(root, 'SKILL.md')).catch(() => null);
        if (skill) return skill;
      }
      throw error;
    });
    const trustedSkill = (await Promise.all(this.skillRoots.map(root => realpath(root).catch(() => null)))).some(root => root && within(root, actual));
    const relative = path.relative(this.repo, actual);
    const privateFile = relative.split(/[\\/]/).some(part => part.startsWith('.'));
    const credential = /(?:^|[/\\])(?:\.env(?:\..*)?|auth\.[^/\\]+|tokens?\.[^/\\]+|credentials\.[^/\\]+|settings\.local\.json)$/i.test(actual);
    if ((!within(this.repo, actual) && !trustedSkill) || (!trustedSkill && privateFile) || credential || !/\.(md|txt|json|toml|ya?ml)$/i.test(actual)) throw new Error('Read a repository context document or an installed skill. Private runtime and credential files are excluded.');
    const info = await stat(actual);
    if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error('Choose a context document smaller than 2 MB.');
    const text = await readFile(actual, 'utf8');
    const start = Math.max(0, Number(offset) || 0);
    return { path: actual, text: text.slice(start, start + length), nextOffset: start + length < text.length ? start + length : null };
  }
  async search(query) {
    if (typeof query !== 'string' || !query.trim() || query.length > 200) throw new Error('Use a short context search phrase.');
    const rg = commandPath('rg');
    if (!rg) throw new Error('The rg context search tool is unavailable.');
    const roots = ['context', 'processes', 'knowledge', 'projects'].map(folder => path.join(this.repo, folder));
    const { stdout } = await execute(rg, ['-n', '-i', '--fixed-strings', '--max-count', '2', '-g', '*.md', '-g', '!node_modules', '--', query, ...roots], { windowsHide: true, maxBuffer: 128 * 1024 }).catch(error => ({ stdout: error.stdout || '' }));
    return { matches: stdout.slice(0, 18000), truncated: stdout.length > 18000 };
  }
}
