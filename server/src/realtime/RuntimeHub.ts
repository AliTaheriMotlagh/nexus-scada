import type { AlarmInfo, DeviceStatus, Role, TagChange } from '../../../shared/types.ts';
import { pathMatches } from '../../../shared/scriptCompiler.ts';
import type { Runtime } from '../Runtime.ts';
import type { DesignOp } from '../../../shared/designOps.ts';
import { DesignCollab } from './DesignCollab.ts';
import { HubException, type HubClients, type HubConnection, type HubDefinition } from './SignalRServer.ts';

const SUBS = 'subs';
const PATTERNS = 'patterns';
const FLUSH_MS = 100;

const subsOf = (c: HubConnection) => c.items.get(SUBS) as Set<string>;
const patternsOf = (c: HubConnection) => c.items.get(PATTERNS) as Set<string>;

/**
 * The runtime hub: clients subscribe to tags, write values and acknowledge alarms;
 * the server pushes tag values (coalesced every 100 ms), alarms, device status and script logs.
 *
 * Client → server: subscribe, unsubscribe, write, ackAlarms, shelveAlarm, getAlarms, getDevices, watchScriptLog
 * Server → client: tagValues, alarms, alarmEvent, deviceStatus, scriptLog, projectChanged
 */
export function createRuntimeHub(rt: Runtime, clients: () => HubClients): HubDefinition {
  const requireRole = (conn: HubConnection, role: Role) => {
    try {
      return rt.auth.require(conn.user, role);
    } catch (err) {
      throw new HubException((err as Error).message);
    }
  };

  const collab = new DesignCollab(rt, clients);

  return {
    onDisconnected(conn) {
      collab.leaveAll(conn);
    },
    onConnected(conn) {
      conn.items.set(SUBS, new Set<string>());
      conn.items.set(PATTERNS, new Set<string>());
      conn.send('alarms', rt.alarms.active());
    },
    methods: {
      subscribe(conn, paths: string[]): TagChange[] {
        const exact: string[] = [];
        for (const p of paths ?? []) {
          if (p === '*' || p.endsWith('/*')) {
            patternsOf(conn).add(p);
            exact.push(...rt.tags.list(p === '*' ? '' : p.slice(0, -2)));
          } else {
            subsOf(conn).add(p);
            exact.push(p);
          }
        }
        return rt.tags.snapshot(exact);
      },
      unsubscribe(conn, paths: string[]) {
        for (const p of paths ?? []) {
          subsOf(conn).delete(p);
          patternsOf(conn).delete(p);
        }
      },
      async write(conn, path: string, value: unknown) {
        const tag = rt.tags.runtime(path);
        if (!tag) throw new HubException(`Unknown tag "${path}"`);
        const user = requireRole(conn, tag.def.writeRole ?? 'operator');
        const before = tag.current.value;
        try {
          await rt.tags.write(path, value);
        } catch (err) {
          throw new HubException((err as Error).message);
        }
        rt.auth.audit(user.username, 'tag.write', path, { from: before, to: value });
        return true;
      },
      ackAlarms(conn, ids: string[], comment?: string) {
        const user = requireRole(conn, 'operator');
        const n = rt.alarms.ack(ids ?? [], user.username, comment);
        if (n) rt.auth.audit(user.username, 'alarm.ack', ids.join(', '), comment);
        return n;
      },
      shelveAlarm(conn, id: string, minutes: number, comment?: string) {
        const user = requireRole(conn, 'operator');
        try {
          rt.alarms.shelve(id, Number(minutes), user.username, comment);
        } catch (err) {
          throw new HubException((err as Error).message);
        }
        rt.auth.audit(user.username, minutes > 0 ? 'alarm.shelve' : 'alarm.unshelve', id, { minutes, comment });
      },
      getAlarms: (): AlarmInfo[] => rt.alarms.active(),
      getDevices: (): DeviceStatus[] => rt.drivers.statuses(),
      watchScriptLog(conn, on: boolean) {
        requireRole(conn, 'engineer');
        if (on) clients().addToGroup(conn.id, 'scriptlog');
        else clients().removeFromGroup(conn.id, 'scriptlog');
      },
      whoAmI: (conn) => rt.auth.effective(conn.user) ?? null,

      // ── collaborative design ──
      designJoin(conn, name: string) {
        requireRole(conn, 'engineer');
        return collab.join(conn, String(name));
      },
      designLeave(conn, name: string) {
        collab.leave(conn, String(name));
      },
      designOps(conn, name: string, ops: DesignOp[]) {
        requireRole(conn, 'engineer');
        return collab.ops(conn, String(name), ops);
      },
      designPresence(conn, name: string, cursor: { x: number; y: number } | null, selection: string[]) {
        collab.presence(conn, String(name), cursor, selection);
      },
      designSave(conn, name: string) {
        const user = requireRole(conn, 'engineer');
        collab.save(conn, String(name), user.username);
      },
      designRevert(conn, name: string) {
        requireRole(conn, 'engineer');
        return collab.revert(String(name));
      },
      designSessions: () => collab.summary(),
    },
  };
}

/** Bridge runtime bus events to connected clients. */
export function attachBroadcasts(rt: Runtime, clients: HubClients): () => void {
  let buffer = new Map<string, TagChange>();
  const offs = [
    rt.bus.on('tag:change', (changes) => { for (const c of changes) buffer.set(c.path, c); }),
    rt.bus.on('alarm:list', (list) => clients.all.send('alarms', list)),
    rt.bus.on('alarm:event', (ev) => clients.all.send('alarmEvent', ev)),
    rt.bus.on('device:status', (s) => clients.all.send('deviceStatus', s)),
    rt.bus.on('script:log', (e) => clients.group('scriptlog').send('scriptLog', e)),
    rt.bus.on('project:reloaded', (r) => clients.all.send('projectChanged', r)),
  ];
  const timer = setInterval(() => {
    if (!buffer.size) return;
    const changes = [...buffer.values()];
    buffer = new Map();
    for (const conn of clients.connections()) {
      const subs = subsOf(conn);
      const patterns = patternsOf(conn);
      if (!subs || (!subs.size && !patterns.size)) continue;
      const mine = changes.filter((c) => subs.has(c.path) || (patterns.size > 0 && [...patterns].some((p) => pathMatches(p, c.path))));
      if (mine.length) conn.send('tagValues', mine);
    }
  }, FLUSH_MS);
  return () => {
    clearInterval(timer);
    offs.forEach((o) => o());
  };
}
