import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { projectKey, recentProjects } from './recent-projects.mjs';
import { isCoverImage } from './files.mjs';
import { within } from './util.mjs';

const skip = /^(node_modules|vendor|target|cache|backups?|assets?[-_ ]?bak|auto[- ]save|.* auto-save|.*\.aep logs|test(s|[-_]results)?|fixtures?|__pycache__|_shared)$/i;
const outputs = /^(?:out|output|outputs|dist|build|release[s]?|resultados?|entregas?|exports?|renders?|reports?|relat[óo]rios?|storyboards?|artifacts?|previews?|revis[ãa]o|revis[õo]es|videos[-_]revisao|fotos-com-marca)$/i;
const media = /^(?:assets?|media|m[ií]dia|gallery|galeria|images?|imagens?|quadros|frames?|fotos?|thumbnails?|screenshots?|covers?|campanha[-_].+|abertura[-_].+)$/i;
const coverName = /(?:^|[\s._-])(cover|capa|thumb(?:nail)?|hero|preview|pr[ée]via|poster)(?=$|[\s._-])/i;
const resultName = /(?:^|[\s._-])(resultado|entrega|relat[óo]rio|report|final|aprovar|revis[ãa]o|preview|pr[ée]via|gallery|galeria)(?=$|[\s._-])/i;
const smallGraphic = /(?:^|[\s._-])(icon|favicon|badge|logo|sprite|placeholder|avatar|emoji|asset-pack|qr(?:code)?)(?=$|[\s._-])/i;
const authMaterial = /(?:^|[\s._-])(oauth|credentials?|secret|password|tokens?)(?=$|[\s._-])/i;
const resultTypes = new Map([
  ['.mp4', 'video'], ['.webm', 'video'], ['.mov', 'video'], ['.m4v', 'video'],
  ['.html', 'html'], ['.htm', 'html'], ['.pdf', 'pdf'], ['.md', 'text'], ['.txt', 'text'],
  ['.zip', 'archive'], ['.gz', 'archive'], ['.7z', 'archive'], ['.docx', 'document'], ['.xlsx', 'document'], ['.pptx', 'document'],
]);

async function scanFolder(folder, workspaceFolder) {
  const root = await realpath(folder).catch(() => null);
  if (!root) return { cover: null, results: [] };
  const queue = [{ dir: root, depth: 0, output: false }];
  const images = [], deliverables = [];
  for (let index = 0; index < queue.length && index < 48; index++) {
    const { dir, depth, output } = queue[index];
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const dirs = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.') || skip.test(entry.name) || authMaterial.test(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (file === workspaceFolder) continue;
      if (entry.isDirectory() && depth < 4) {
        const exported = outputs.test(entry.name);
        dirs.push({ dir: file, depth: depth + 1, output: output || exported, priority: exported ? 2 : Number(media.test(entry.name)) });
      }
      if (!entry.isFile()) continue;
      const { name, ext: suffix } = path.parse(entry.name);
      const ext = suffix.toLowerCase();
      if (isCoverImage(file)) images.push({ file, score: Number(coverName.test(name)) * 40 + Number(output) * 8 + Number(media.test(path.basename(dir))) * 6 - depth - Number(smallGraphic.test(name)) * 32 });
      const kind = resultTypes.get(ext);
      if (!kind) continue;
      const readme = /^(readme|leia[-_ ]?me)$/i.test(name);
      const page = kind === 'html' && /^index$/i.test(name);
      const named = resultName.test(name);
      const reportText = kind !== 'text' || named || (readme && !depth);
      if (reportText && (named || page || output || depth === 0)) {
        const score = Number(named) * 20 + Number(output) * 8 + Number(page) * 10 + Number(kind === 'video' || kind === 'pdf') * 10 - depth - Number(readme) * 12;
        deliverables.push({ path: file, name: entry.name, kind, score });
      }
    }
    queue.push(...dirs.sort((a, b) => b.priority - a.priority).slice(0, 48));
  }

  const bestImages = images.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file)).slice(0, 32);
  const bestResults = deliverables.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 30);
  const [covers, results] = await Promise.all([
    Promise.all(bestImages.map(async ({ file, score }) => {
      const info = await stat(file).catch(() => null);
      if (!info?.isFile() || !info.size || info.size > 8 * 1024 * 1024) return null;
      return { file, score: score + (info.size >= 60_000 ? 10 : info.size >= 12_000 ? 4 : -8), at: info.mtimeMs };
    })),
    Promise.all(bestResults.map(async ({ path, name, kind, score }) => {
      const info = await stat(path).catch(() => null);
      return info?.isFile() && info.size ? { path, name, kind, score, at: info.mtimeMs } : null;
    })),
  ]);
  const best = covers.filter(Boolean).sort((a, b) => b.score - a.score || b.at - a.at)[0];
  const ranked = results.filter(Boolean).sort((a, b) => b.score - a.score || b.at - a.at);
  const kinds = new Set(), usedNames = new Set();
  const pick = item => {
    const key = item.name.toLowerCase();
    if (usedNames.has(key)) return false;
    usedNames.add(key); kinds.add(item.kind);
    return true;
  };
  const firstOfKind = ranked.filter(item => !kinds.has(item.kind) && pick(item));
  const selected = firstOfKind.concat(ranked.filter(pick)).slice(0, 6);
  return { cover: best?.file || null, results: selected.map(({ path, name, kind }) => ({ path, name, kind })) };
}

export async function projectGallery({ repo, entities, sessions, pinned, files }) {
  const projects = await recentProjects({ repo, sessions, pinned, entities, catalog: true });
  const workspace = path.join(repo, 'workspace');
  const gallery = { projects: [], covers: Object.create(null) };
  const cache = new Map();
  const cards = entities.filter(entity => typeof entity.id === 'string' && typeof entity.folder === 'string');
  const folderCounts = new Map();
  for (const entity of cards) {
    const key = projectKey(path.resolve(workspace, entity.folder));
    folderCounts.set(key, (folderCounts.get(key) || 0) + 1);
  }
  const scan = folder => {
    if (!cache.has(folder)) cache.set(folder, scanFolder(folder, workspace));
    return cache.get(folder);
  };
  const work = [
    ...projects.map(project => async () => {
      const { cover, results } = await scan(project.path);
      if (projectKey(project.path) === projectKey(repo)) return { ...project, name: 'Bento Workspace', cover: '/assets/bento-icon-512.png', results };
      return { ...project, cover: cover ? files.coverUrl(cover) : null, results };
    }),
    ...cards.map(entity => async () => {
      const folder = path.resolve(workspace, entity.folder);
      // Shared directories can hold media for several cards. Use their explicit
      // covers instead of assigning the same project's image to all of them.
      if (entity.cover || folderCounts.get(projectKey(folder)) !== 1 || folder === workspace || !within(workspace, folder)) return null;
      const actual = await realpath(folder).catch(() => null);
      if (!actual || !within(await realpath(workspace).catch(() => workspace), actual)) return null;
      const { cover } = await scan(actual);
      if (cover) gallery.covers[entity.id] = files.coverUrl(cover);
      return null;
    }),
  ];
  for (let offset = 0; offset < work.length; offset += 6) {
    gallery.projects.push(...(await Promise.all(work.slice(offset, offset + 6).map(task => task()))).filter(Boolean));
  }
  return gallery;
}
