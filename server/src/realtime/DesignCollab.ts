import { applyOps, PEER_COLORS, touchedIds, type DesignOp, type Participant } from '../../../shared/designOps.ts';
import type { DisplayDoc } from '../../../shared/types.ts';
import { createLogger } from '../core/logger.ts';
import type { Runtime } from '../Runtime.ts';
import { HubException, type HubClients, type HubConnection } from './SignalRServer.ts';

const log = createLogger('collab');
const MAX_OPS = 500;

interface Session {
  name: string;
  doc: DisplayDoc;
  version: number;
  dirty: boolean;
  participants: Map<string, Participant>;
}

export interface JoinResult {
  doc: DisplayDoc;
  version: number;
  dirty: boolean;
  me: Participant;
  peers: Participant[];
}

const group = (name: string) => `design:${name}`;

/**
 * Real-time collaborative display editing.
 * The server holds the authoritative copy of every display being edited; clients send element-level
 * operations which are applied in arrival order (last writer wins per element) and relayed to the
 * other editors. Elements selected by someone else are locked for everybody else.
 */
export class DesignCollab {
  private readonly rt: Runtime;
  private readonly clients: () => HubClients;
  private sessions = new Map<string, Session>();

  constructor(rt: Runtime, clients: () => HubClients) {
    this.rt = rt;
    this.clients = clients;
  }

  private session(name: string): Session {
    const s = this.sessions.get(name);
    if (!s) throw new HubException(`"${name}" is not open for editing`);
    return s;
  }

  join(conn: HubConnection, name: string): JoinResult {
    let s = this.sessions.get(name);
    if (!s) {
      let doc: DisplayDoc;
      try {
        doc = this.rt.store.displays.get(name);
      } catch {
        throw new HubException(`Display "${name}" not found`);
      }
      s = { name, doc, version: 0, dirty: false, participants: new Map() };
      this.sessions.set(name, s);
    }
    for (const other of this.sessions.values()) if (other !== s) this.leave(conn, other.name);
    const used = new Set([...s.participants.values()].map((p) => p.color));
    const color = PEER_COLORS.find((c) => !used.has(c)) ?? PEER_COLORS[s.participants.size % PEER_COLORS.length];
    const me: Participant = { connId: conn.id, user: conn.user?.username ?? 'anonymous', color, cursor: null, selection: [] };
    s.participants.set(conn.id, me);
    this.clients().addToGroup(conn.id, group(name));
    this.clients().groupExcept(group(name), conn.id).send('designPeer', name, me);
    this.broadcastSessions();
    log.info(`${me.user} joined design of ${name} (${s.participants.size} editing)`);
    return { doc: s.doc, version: s.version, dirty: s.dirty, me, peers: [...s.participants.values()].filter((p) => p.connId !== conn.id) };
  }

  leave(conn: { id: string }, name: string): void {
    const s = this.sessions.get(name);
    if (!s || !s.participants.delete(conn.id)) return;
    this.clients().removeFromGroup(conn.id, group(name));
    this.clients().group(group(name)).send('designLeave', name, conn.id);
    // keep unsaved work in memory for whoever opens the display next
    if (!s.participants.size && !s.dirty) this.sessions.delete(name);
    this.broadcastSessions();
  }

  leaveAll(conn: { id: string }): void {
    for (const name of [...this.sessions.keys()]) this.leave(conn, name);
  }

  /** Apply operations from one editor. Ops touching elements locked by others are rejected. */
  ops(conn: HubConnection, name: string, ops: DesignOp[]): { version: number; rejected: string[] } {
    const s = this.session(name);
    if (!s.participants.has(conn.id)) throw new HubException('Join the design session first');
    if (!Array.isArray(ops) || ops.length > MAX_OPS) throw new HubException('Invalid operations');
    const lockedBy = new Map<string, string>();
    for (const p of s.participants.values()) if (p.connId !== conn.id) for (const id of p.selection) lockedBy.set(id, p.user);

    const accepted: DesignOp[] = [];
    const rejected: string[] = [];
    for (const raw of ops) {
      const op = this.sanitize(raw);
      if (!op) continue;
      const locked = touchedIds(op).filter((id) => lockedBy.has(id));
      if (locked.length) rejected.push(...locked);
      else accepted.push(op);
    }
    if (accepted.length) {
      s.doc = applyOps(s.doc, accepted);
      s.version++;
      s.dirty = true;
      this.clients().groupExcept(group(name), conn.id).send('designOps', name, accepted, s.version, conn.id);
    }
    return { version: s.version, rejected };
  }

  /** Strip anything that is not a well-formed operation (and, in the public demo, any scripts). */
  private sanitize(op: DesignOp): DesignOp | null {
    if (!op || typeof op !== 'object') return null;
    if (op.op === 'remove') return typeof op.id === 'string' ? op : null;
    if (op.op === 'order') return Array.isArray(op.ids) ? { op: 'order', ids: op.ids.filter((x) => typeof x === 'string') } : null;
    if (op.op === 'display') {
      if (!op.patch || typeof op.patch !== 'object') return null;
      const patch = { ...op.patch };
      if (this.rt.demo) delete patch.scripts;
      return { op: 'display', patch };
    }
    if (op.op === 'upsert') {
      const el = op.el;
      if (!el || typeof el.id !== 'string' || typeof el.type !== 'string') return null;
      if ([el.x, el.y, el.w, el.h].some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null;
      if (this.rt.demo) return { op: 'upsert', el: { ...el, events: undefined, children: el.children?.map((c) => ({ ...c, events: undefined })) } };
      return op;
    }
    return null;
  }

  presence(conn: HubConnection, name: string, cursor: { x: number; y: number } | null, selection: string[]): void {
    const s = this.sessions.get(name);
    const p = s?.participants.get(conn.id);
    if (!s || !p) return;
    p.cursor = cursor && Number.isFinite(cursor.x) && Number.isFinite(cursor.y) ? { x: cursor.x, y: cursor.y } : null;
    if (Array.isArray(selection)) p.selection = selection.filter((x) => typeof x === 'string').slice(0, 500);
    this.clients().groupExcept(group(name), conn.id).send('designPeer', name, p);
  }

  save(conn: HubConnection, name: string, user: string): void {
    if (this.rt.demo) throw new HubException('Saving is disabled in the public demo — run your own copy to edit');
    const s = this.session(name);
    this.rt.store.displays.save(name, s.doc);
    s.dirty = false;
    this.rt.auth.audit(user, 'display.save', name, { collaborative: s.participants.size });
    this.clients().group(group(name)).send('designSaved', name, user, s.version);
    this.rt.bus.emit('project:reloaded', { revision: this.rt.store.revision });
    if (!s.participants.size) this.sessions.delete(name);
  }

  /** Discard unsaved shared changes and reload from disk. */
  revert(name: string): DisplayDoc {
    const s = this.session(name);
    s.doc = this.rt.store.displays.get(name);
    s.version++;
    s.dirty = false;
    this.clients().group(group(name)).send('designReset', name, s.doc, s.version);
    return s.doc;
  }

  /** Who is editing what (shown in the Displays tree). */
  summary(): Record<string, { user: string; color: string }[]> {
    const out: Record<string, { user: string; color: string }[]> = {};
    for (const s of this.sessions.values()) {
      if (s.participants.size) out[s.name] = [...s.participants.values()].map((p) => ({ user: p.user, color: p.color }));
    }
    return out;
  }

  private broadcastSessions(): void {
    this.clients().all.send('designSessions', this.summary());
  }
}
