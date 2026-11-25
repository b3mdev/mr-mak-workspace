import { createHash, createHmac, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { equalSecret, readJson, saveJson, secret } from './util.mjs';

const interval = 12_000;
const offlineAfter = 45_000;
const inviteLifetime = 10 * 60_000;
const maxPeers = 16;
const maxTasks = 80;
const credentialPattern = /^[A-Za-z0-9_-]{43}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const agents = new Set(['codex', 'claude', 'antigravity', 'opencode', 'kimi']);
const statuses = new Set(['starting', 'working', 'waiting', 'answered', 'idle', 'stopped']);
const digest = value => createHash('sha256').update(value).digest('hex');
const matches = (regex, value) => typeof value === 'string' && regex.test(value);
const text = (value, max) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max) : '';
const time = value => typeof value === 'string' && value.length <= 32 && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

function tailnetOrigin(raw) {
  if (typeof raw !== 'string' || raw.length > 280) return null;
  try {
    const url = new URL(raw);
    const tailnetName = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){2}ts\.net$/i;
    return url.protocol === 'https:' && tailnetName.test(url.hostname) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url.origin : null;
  } catch { return null; }
}

function parseInvite(raw) {
  try {
    const url = new URL(text(raw, 450));
    const token = new URLSearchParams(url.hash.slice(1)).get('bento-rede');
    const origin = tailnetOrigin(url.origin);
    if (origin && matches(credentialPattern, token) && !url.username && !url.password && url.pathname === '/' && !url.search) return { origin, token };
  } catch { /* A pasted invitation must have both its private address and code. */ }
  fail('Cole um convite completo para a Rede Bento.');
}

function cleanTasks(value) {
  if (!Array.isArray(value)) return [];
  const tasks = new Map();
  for (const item of value.slice(0, maxTasks)) {
    if (!matches(idPattern, item?.id) || !agents.has(item.agent) || !statuses.has(item.status)) continue;
    const title = text(item.title, 160);
    if (title) tasks.set(item.id, { id: item.id, title, agent: item.agent, status: item.status, updatedAt: time(item.updatedAt) });
  }
  return [...tasks.values()];
}

function taskStatus(session) {
  if (session.status === 'starting') return 'starting';
  if (session.status !== 'running') return 'stopped';
  if (session.activity === 'waiting' || session.attention) return 'waiting';
  if (session.activity === 'working') return 'working';
  return session.unread || session.completionVersion > 0 ? 'answered' : 'idle';
}

function cleanComputer(item) {
  if (!matches(idPattern, item?.id)) return null;
  const name = text(item.name, 64);
  return name ? { id: item.id, name, online: item.online === true, lastSeen: time(item.lastSeen), tasks: cleanTasks(item.tasks) } : null;
}

export class DeviceNetwork {
  constructor({ stateDir, sessions, relay = fetch, getOrigin }) {
    this.file = path.join(stateDir, 'device-network.json');
    this.sessions = sessions;
    this.relay = relay;
    this.getOrigin = getOrigin;
    this.name = text(os.hostname(), 64) || 'Computador Bento';
    this.writes = Promise.resolve();
    this.snapshots = new Map();
  }

  async init() {
    const saved = await readJson(this.file, null);
    const localId = matches(idPattern, saved?.localId) ? saved.localId : randomUUID();
    const peers = (Array.isArray(saved?.peers) ? saved.peers : []).filter(item => matches(idPattern, item?.id) && item.id !== localId && matches(hashPattern, item.hash) && text(item.name, 64)).slice(0, maxPeers);
    const upstream = saved?.upstream;
    this.state = { localId, peers, upstream: tailnetOrigin(upstream?.origin) && matches(credentialPattern, upstream?.token) && matches(idPattern, upstream?.hubId) && upstream.hubId !== localId ? upstream : null };
    this.timer = setInterval(() => { void this.sync(); }, interval);
    this.timer.unref();
    void this.sync();
    return this;
  }

  change(update) {
    const work = this.writes.catch(() => {}).then(async () => {
      if (this.closed) fail('A Rede Bento está encerrando.', 503);
      const next = update(this.state);
      await saveJson(this.file, next);
      this.state = next;
    });
    this.writes = work;
    return work;
  }

  local() {
    const active = this.sessions.active().filter(item => agents.has(item.agent));
    return { id: this.state.localId, name: this.name, online: true, lastSeen: new Date().toISOString(), tasks: cleanTasks(active.map(item => ({ id: item.id, title: item.name, agent: item.agent, status: taskStatus(item), updatedAt: item.updatedAt || item.createdAt }))) };
  }

  hubComputers() {
    const now = Date.now();
    return [this.local(), ...this.state.peers.map(peer => {
      const snapshot = this.snapshots.get(peer.id);
      return { id: peer.id, name: peer.name, online: !!snapshot && now - snapshot.at < offlineAfter, lastSeen: snapshot ? new Date(snapshot.at).toISOString() : null, tasks: snapshot?.tasks || [] };
    })];
  }

  dashboard() {
    const upstream = this.state.upstream;
    const online = !!this.remote && Date.now() - this.remote.at < offlineAfter;
    const computers = upstream
      ? [this.local(), ...(this.remote?.computers || [{ id: upstream.hubId, name: upstream.name, tasks: [], lastSeen: null }]).filter(item => item.id !== this.state.localId).map(item => ({ ...item, online: online && item.online === true }))]
      : this.hubComputers();
    return { localId: this.state.localId, computers, hub: upstream ? { name: upstream.name, online } : null };
  }

  async invite() {
    const origin = tailnetOrigin(this.getOrigin());
    if (!origin) fail('Ative o acesso pelo Tailscale neste computador para criar o convite.');
    await this.writes.catch(() => {});
    if (this.joining || this.state.upstream) fail('Desconecte-se da central antes de convidar computadores.', 409);
    if (this.state.peers.length >= maxPeers) fail('A central atingiu o limite de computadores.', 409);
    const token = secret(), expires = Date.now() + inviteLifetime;
    this.pending = { hash: digest(token), expires, origin, usedBy: null };
    return { url: `${origin}/#bento-rede=${token}`, expires };
  }

  async accept(token, input) {
    const name = text(input?.name, 64), id = input?.id, hash = input?.hash;
    if (!name || !matches(idPattern, id) || id === this.state.localId || !matches(hashPattern, hash)) fail('Dados do computador inválidos.');
    await this.change(current => {
      const pending = this.pending;
      if (!matches(credentialPattern, token) || !pending || pending.expires <= Date.now() || pending.origin !== tailnetOrigin(this.getOrigin()) || !equalSecret(digest(token), pending.hash) || (pending.usedBy && (pending.usedBy.id !== id || !equalSecret(pending.usedBy.hash, hash)))) fail('Convite inválido, usado ou expirado.', 403);
      if (this.joining || current.upstream) fail('Este computador já pertence a uma central.', 409);
      if (current.peers.length >= maxPeers && !current.peers.some(peer => peer.id === id)) fail('A central atingiu o limite de computadores.', 409);
      pending.usedBy = { id, hash }; // The same machine can retry after a lost reply.
      return { ...current, peers: [...current.peers.filter(peer => peer.id !== id), { id, name, hash }] };
    });
    this.snapshots.delete(id);
    return { id: this.state.localId, name: this.name };
  }

  authenticate(token) {
    if (!matches(credentialPattern, token)) fail('Computador não autorizado.', 401);
    const hash = digest(token);
    const peer = this.state.peers.find(item => equalSecret(item.hash, hash));
    if (!peer) fail('Computador não autorizado.', 401);
    return peer;
  }

  push(peer, data) {
    if (!Array.isArray(data?.tasks) || data.tasks.length > maxTasks) fail('Lista de tarefas inválida.');
    if (!this.state.peers.includes(peer)) fail('Computador não autorizado.', 401);
    this.snapshots.set(peer.id, { at: Date.now(), tasks: cleanTasks(data.tasks) });
    return { computers: this.hubComputers() };
  }

  async remove(id, credentialHash) {
    if (!matches(idPattern, id)) fail('Computador inválido.');
    await this.change(current => ({ ...current, peers: current.peers.filter(peer => peer.id !== id || (credentialHash && !equalSecret(peer.hash, credentialHash))) }));
    if (!this.state.peers.some(item => item.id === id)) this.snapshots.delete(id);
    if (this.pending?.usedBy && !this.state.peers.some(peer => peer.id === this.pending.usedBy.id && equalSecret(peer.hash, this.pending.usedBy.hash))) this.pending = null;
    return this.dashboard();
  }

  async send(origin, action, token, data) {
    const result = await this.relay(`${origin}/mobile/network/${action}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(6000),
      headers: { Authorization: `Bearer ${token}`, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!result.ok) {
      await result.body?.cancel().catch(() => {});
      fail(result.status === 403 || result.status === 401 ? 'A central recusou o convite ou a conexão.' : 'A central não aceitou a conexão.', result.status);
    }
    // A supplied invitation must not let an unexpected server stream unbounded data.
    let size = 0;
    const chunks = [];
    for await (const part of result.body || []) {
      size += part.length;
      if (size > 2 * 1024 * 1024) fail('Resposta da central grande demais.', 502);
      chunks.push(part);
    }
    return JSON.parse(Buffer.concat(chunks).toString() || '{}');
  }

  async join(invitation) {
    if (this.joining) fail('Uma conexão está em andamento.', 409);
    const { origin, token: invite } = parseInvite(invitation);
    this.joining = true;
    try {
      await this.writes.catch(() => {});
      if (this.state.peers.length || this.state.upstream) fail('Encerre as conexões atuais antes de entrar em outra rede.', 409);
      // Persist the ID before the remote side effects so an interrupted join can be retried.
      await this.change(current => current);
      const token = createHmac('sha256', invite).update(this.state.localId).digest('base64url');
      const hub = await this.send(origin, 'join', invite, { id: this.state.localId, name: this.name, hash: digest(token) }).catch(error => {
        if (typeof error.status === 'number') throw error;
        fail('Não foi possível alcançar a central. Verifique o Tailscale nos dois computadores.', 502);
      });
      if (!matches(idPattern, hub.id) || hub.id === this.state.localId || !text(hub.name, 64)) fail('A central retornou uma identidade inválida.', 502);
      await this.change(current => ({ ...current, upstream: { origin, token, hubId: hub.id, name: text(hub.name, 64) } }));
      this.pending = null;
      await this.sync();
      return this.dashboard();
    } finally { this.joining = false; }
  }

  sync() {
    if (this.syncing) return this.syncing;
    const upstream = this.state.upstream;
    if (!upstream || this.closed) return;
    this.syncing = this.send(upstream.origin, 'tasks', upstream.token, { tasks: this.local().tasks }).then(value => {
      if (this.state.upstream !== upstream || !Array.isArray(value.computers)) return;
      const computers = value.computers.slice(0, maxPeers + 1).map(cleanComputer).filter(Boolean);
      if (computers.some(item => item.id === upstream.hubId)) this.remote = { at: Date.now(), computers };
    }).catch(error => {
      if (error.status === 401 && this.state.upstream === upstream) this.remote = null;
    }).finally(() => { this.syncing = null; });
    return this.syncing;
  }

  async disconnect() {
    if (this.joining) fail('Aguarde a conexão em andamento.', 409);
    const upstream = this.state.upstream;
    if (!upstream) return this.dashboard();
    await this.change(current => ({ ...current, upstream: null }));
    this.remote = null;
    await this.send(upstream.origin, 'leave', upstream.token, {}).catch(() => {});
    return this.dashboard();
  }

  async close() {
    this.closed = true;
    clearInterval(this.timer);
    await this.writes.catch(() => {});
  }
}
