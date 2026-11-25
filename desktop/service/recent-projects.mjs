import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readJson, within } from './util.mjs';
import { codexProjectIndex, codexProjects } from './codex-history.mjs';

const MAX_PROJECTS = 60;

const regularPath = folder => process.platform === 'win32' ? folder.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '') : folder;
export const projectKey = folder => process.platform === 'win32' ? path.resolve(regularPath(folder)).toLowerCase() : path.resolve(folder);

// The CLIs also record git worktrees, desktop-app scratch folders and the Codex
// app's dated folders. They are short-lived, not places to start a new chat.
const transient = folder => folder.split(/[\\/]/).some((part, index, parts) => ['.claude', '.codex', 'scratch-workspaces'].includes(part) || (parts[index - 1] === 'Codex' && /^\d{4}-\d{2}-\d{2}$/.test(part)));

// Read only the folder names Claude Code has opened. Its config also holds
// account data; none of it leaves this function.
async function claudeProjects() {
  const home = process.env.CLAUDE_CONFIG_DIR;
  const config = await readJson(home ? path.join(home, '.claude.json') : path.join(os.homedir(), '.claude.json'), {});
  const projects = config?.projects && typeof config.projects === 'object' && !Array.isArray(config.projects) ? Object.keys(config.projects) : [];
  const transcripts = path.join(home || path.join(os.homedir(), '.claude'), 'projects');
  const folders = new Map((await readdir(transcripts).catch(() => [])).map(name => [name.toLowerCase(), name]));
  return Promise.all(projects.map(async folder => {
    // Same folder naming as claudeTranscript(); a new conversation updates its date.
    const name = folders.get(folder.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase());
    const info = name ? await stat(path.join(transcripts, name)).catch(() => null) : null;
    return { path: folder, source: 'claude', at: info?.mtime.toISOString() || null };
  }));
}

export async function recentProjects({ repo, sessions = [], pinned = [], catalog = false, entities = [] }) {
  // The first spelling of a folder is shown. The CLIs record their own working
  // directory, so they come before folders typed into New chat.
  const specRoot = path.join(repo, 'projects');
  const [claude, codex, local] = await Promise.all([
    claudeProjects(),
    (catalog ? codexProjectIndex() : codexProjects()).catch(() => []),
    catalog ? readdir(specRoot, { withFileTypes: true }).catch(() => []) : [],
  ]);
  const candidates = [
    { path: repo, source: 'workspace', at: null },
    ...claude, ...codex,
    ...sessions.flatMap(item => {
      const at = item.updatedAt || item.createdAt || null;
      const edge = { path: item.cwd, source: 'mrmak', at };
      return catalog && ['codex', 'claude'].includes(item.agent) ? [edge, { ...edge, source: item.agent }] : [edge];
    }),
    ...pinned.map(folder => ({ path: folder, source: 'pinned', at: null })),
    ...local.filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && !entities.some(entity => entity.id === entry.name))
      .map(entry => ({ path: path.join(specRoot, entry.name), source: 'workspace', at: null })),
  ];
  const registered = new Set(entities.filter(entity => typeof entity.folder === 'string').map(entity => projectKey(path.join(repo, 'workspace', entity.folder))));
  const repoKey = projectKey(repo), homeKey = projectKey(os.homedir());
  const projects = new Map();
  for (const item of candidates) {
    if (typeof item.path !== 'string' || /[\x00-\x1f]/.test(item.path)) continue;
    const folder = regularPath(item.path);
    if (!path.isAbsolute(folder) || transient(folder)) continue;
    const resolved = path.resolve(folder), key = projectKey(folder);
    if (catalog && registered.has(key)) continue;
    if (catalog && key !== repoKey && (resolved === path.parse(resolved).root || key === homeKey || within(os.tmpdir(), resolved))) continue;
    const project = projects.get(key) || { path: resolved, name: path.basename(resolved) || resolved, sources: [], pinned: false, lastUsedAt: null };
    if (item.source === 'pinned') project.pinned = true;
    else if (!project.sources.includes(item.source)) project.sources.push(item.source);
    if (typeof item.at === 'string' && Number.isFinite(Date.parse(item.at)) && (!project.lastUsedAt || item.at > project.lastUsedAt)) project.lastUsedAt = item.at;
    projects.set(key, project);
  }
  const existing = await Promise.all([...projects.values()].map(async item => (await stat(item.path).catch(() => null))?.isDirectory() ? item : null));
  // The Workspace stays first: it was the only default before this list existed.
  // Pinned favorites follow, then the most recently used folders.
  const sorted = existing.filter(Boolean).sort((a, b) => Number(projectKey(b.path) === repoKey) - Number(projectKey(a.path) === repoKey) || Number(b.pinned) - Number(a.pinned) || String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt || '')) || a.name.localeCompare(b.name));
  return catalog ? sorted : sorted.slice(0, MAX_PROJECTS);
}
