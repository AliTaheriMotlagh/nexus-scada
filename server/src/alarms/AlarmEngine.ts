import {
  SEVERITY_RANK,
  type AlarmDef, type AlarmEvent, type AlarmEventType, type AlarmInfo, type AlarmState, type TagChange,
} from '../../../shared/types.ts';
import { leafName, parentPath } from '../../../shared/scriptCompiler.ts';
import type { Database } from '../core/Database.ts';
import type { EventBus } from '../core/EventBus.ts';
import { notFound } from '../core/errors.ts';
import { createLogger } from '../core/logger.ts';
import type { TagEngine, TagRuntime } from '../tags/TagEngine.ts';

const log = createLogger('alarms');

interface AlarmRuntime {
  id: string;
  tag: string;
  def: AlarmDef;
  unit?: string;
  /** State machine: normal → active-unacked → active-acked → normal, or active-unacked → cleared-unacked → normal */
  state: 'normal' | AlarmState;
  pendingSince?: number;
  activeAt: number;
  clearedAt?: number;
  ackAt?: number;
  ackBy?: string;
  comment?: string;
  shelvedUntil?: number;
  value: unknown;
}

/** Pure condition evaluation (exported for unit tests). Deadband applies while active, for hysteresis. */
export function evaluateCondition(def: AlarmDef, value: unknown, quality: string, currentlyActive: boolean): boolean {
  const db = currentlyActive ? def.deadband ?? 0 : 0;
  const n = Number(value);
  const limit = Number(def.limit);
  switch (def.kind) {
    case 'hihi':
    case 'hi': return quality !== 'bad' && n >= limit - db;
    case 'lo':
    case 'lolo': return quality !== 'bad' && n <= limit + db;
    case 'on': return quality !== 'bad' && Boolean(value);
    case 'off': return quality !== 'bad' && !value;
    case 'equals': return quality !== 'bad' && String(value) === String(def.limit);
    case 'quality': return quality !== 'good';
  }
}

const DEFAULT_SEVERITY: Record<AlarmDef['kind'], AlarmDef['severity']> = {
  hihi: 'critical', lolo: 'critical', hi: 'high', lo: 'high', on: 'medium', off: 'medium', equals: 'medium', quality: 'low',
};

export class AlarmEngine {
  private readonly bus: EventBus;
  private readonly db: Database;
  private readonly tags: TagEngine;
  private alarms = new Map<string, AlarmRuntime>();
  private byTag = new Map<string, AlarmRuntime[]>();
  private listDirty = false;
  private timer?: NodeJS.Timeout;

  constructor(bus: EventBus, db: Database, tags: TagEngine) {
    this.bus = bus;
    this.db = db;
    this.tags = tags;
    bus.on('tag:change', (changes) => this.onTagChanges(changes));
  }

  /** Build alarm definitions from tags. Existing alarm states survive a reload. */
  load(tags: TagRuntime[]): void {
    const previous = this.alarms;
    this.alarms = new Map();
    this.byTag = new Map();
    for (const tag of tags) {
      (tag.def.alarms ?? []).forEach((def, i) => {
        const id = tag.def.alarms!.filter((d) => d.kind === def.kind).length > 1 ? `${tag.path}#${def.kind}${i}` : `${tag.path}#${def.kind}`;
        const old = previous.get(id);
        const rt: AlarmRuntime = old
          ? { ...old, def, unit: tag.def.unit }
          : { id, tag: tag.path, def, unit: tag.def.unit, state: 'normal', activeAt: 0, value: tag.current.value };
        this.alarms.set(id, rt);
        if (!this.byTag.has(tag.path)) this.byTag.set(tag.path, []);
        this.byTag.get(tag.path)!.push(rt);
        this.evaluate(rt, tag.current.value, tag.current.quality, Date.now());
      });
    }
    clearInterval(this.timer);
    this.timer = setInterval(() => this.housekeeping(), 500);
    this.listDirty = true;
    log.info(`loaded ${this.alarms.size} alarm definitions`);
  }

  private onTagChanges(changes: TagChange[]): void {
    for (const c of changes) {
      const list = this.byTag.get(c.path);
      if (list) for (const rt of list) this.evaluate(rt, c.value, c.quality, c.ts);
    }
  }

  private evaluate(rt: AlarmRuntime, value: unknown, quality: string, ts: number): void {
    rt.value = value;
    if (rt.def.enabled === false) return;
    const isActive = rt.state === 'active-unacked' || rt.state === 'active-acked';
    const condition = evaluateCondition(rt.def, value, quality, isActive);
    if (condition && !isActive) {
      if (rt.def.delay) {
        rt.pendingSince ??= ts;
        if (ts - rt.pendingSince < rt.def.delay * 1000) return;
      }
      rt.pendingSince = undefined;
      this.activate(rt, ts);
    } else if (!condition) {
      rt.pendingSince = undefined;
      if (isActive) this.clear(rt, ts);
    }
  }

  private activate(rt: AlarmRuntime, ts: number): void {
    rt.activeAt = ts;
    rt.clearedAt = undefined;
    rt.ackAt = undefined;
    rt.ackBy = undefined;
    rt.comment = undefined;
    rt.state = rt.def.ackRequired === false ? 'active-acked' : 'active-unacked';
    this.record(rt, 'active');
  }

  private clear(rt: AlarmRuntime, ts: number): void {
    rt.clearedAt = ts;
    rt.state = rt.state === 'active-acked' ? 'normal' : 'cleared-unacked';
    this.record(rt, 'cleared');
  }

  /** Periodic work: delayed activations and shelving expiry. */
  private housekeeping(): void {
    const now = Date.now();
    for (const rt of this.alarms.values()) {
      if (rt.pendingSince !== undefined) {
        const v = this.tags.get(rt.tag);
        if (v) this.evaluate(rt, v.value, v.quality, now);
      }
      if (rt.shelvedUntil && rt.shelvedUntil <= now) {
        rt.shelvedUntil = undefined;
        this.record(rt, 'unshelve');
      }
    }
    if (this.listDirty) {
      this.listDirty = false;
      this.bus.emit('alarm:list', this.active());
    }
  }

  private record(rt: AlarmRuntime, event: AlarmEventType, user?: string, comment?: string): void {
    const ev: AlarmEvent = {
      alarmId: rt.id, tag: rt.tag, event, severity: this.severity(rt), message: this.message(rt),
      value: rt.value, user, comment, ts: Date.now(),
    };
    try {
      ev.id = this.db.run(
        'INSERT INTO alarm_events (ts, alarm_id, tag, event, severity, message, value, user, comment) VALUES (?,?,?,?,?,?,?,?,?)',
        ev.ts, ev.alarmId, ev.tag, ev.event, ev.severity, ev.message, JSON.stringify(ev.value ?? null), user ?? null, comment ?? null,
      ).lastInsertRowid;
    } catch (err) {
      log.error('failed to store alarm event:', err);
    }
    this.listDirty = true;
    if (!rt.shelvedUntil || event === 'shelve' || event === 'unshelve') this.bus.emit('alarm:event', ev);
  }

  private severity(rt: AlarmRuntime) {
    return rt.def.severity ?? DEFAULT_SEVERITY[rt.def.kind] ?? 'medium';
  }

  private message(rt: AlarmRuntime): string {
    const tpl = rt.def.message ?? `{path} ${rt.def.kind.toUpperCase()} ({value}{unit})`;
    const value = typeof rt.value === 'number' ? Number(rt.value.toFixed(2)) : rt.value;
    return tpl
      .replaceAll('{name}', leafName(rt.tag))
      .replaceAll('{path}', rt.tag)
      .replaceAll('{value}', String(value))
      .replaceAll('{limit}', String(rt.def.limit ?? ''))
      .replaceAll('{unit}', rt.unit ?? '');
  }

  // ── queries & commands ──

  active(areaPrefix = ''): AlarmInfo[] {
    const out: AlarmInfo[] = [];
    for (const rt of this.alarms.values()) {
      if (rt.state === 'normal') continue;
      if (areaPrefix && !rt.tag.startsWith(areaPrefix)) continue;
      out.push({
        id: rt.id, tag: rt.tag, area: parentPath(rt.tag), kind: rt.def.kind, severity: this.severity(rt),
        message: this.message(rt), state: rt.state, value: rt.value, limit: rt.def.limit, activeAt: rt.activeAt,
        clearedAt: rt.clearedAt, ackAt: rt.ackAt, ackBy: rt.ackBy, comment: rt.comment, shelvedUntil: rt.shelvedUntil,
      });
    }
    return out.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.activeAt - a.activeAt);
  }

  ack(ids: string[], user: string, comment?: string): number {
    let n = 0;
    for (const id of ids) {
      const rt = this.alarms.get(id);
      if (!rt || (rt.state !== 'active-unacked' && rt.state !== 'cleared-unacked')) continue;
      rt.ackAt = Date.now();
      rt.ackBy = user;
      rt.comment = comment;
      rt.state = rt.state === 'active-unacked' ? 'active-acked' : 'normal';
      this.record(rt, 'ack', user, comment);
      n++;
    }
    return n;
  }

  shelve(id: string, minutes: number, user: string, comment?: string): void {
    const rt = this.alarms.get(id);
    if (!rt) throw notFound(`Alarm "${id}"`);
    if (minutes <= 0) {
      rt.shelvedUntil = undefined;
      this.record(rt, 'unshelve', user, comment);
      return;
    }
    rt.shelvedUntil = Date.now() + minutes * 60_000;
    this.record(rt, 'shelve', user, comment);
  }

  history(opts: { from: number; to: number; search?: string; limit?: number }): AlarmEvent[] {
    const like = `%${opts.search ?? ''}%`;
    const rows = this.db.query<{
      id: number; ts: number; alarm_id: string; tag: string; event: AlarmEventType; severity: AlarmEvent['severity'];
      message: string; value: string | null; user: string | null; comment: string | null;
    }>(
      `SELECT * FROM alarm_events WHERE ts BETWEEN ? AND ? AND (message LIKE ? OR tag LIKE ?) ORDER BY ts DESC LIMIT ?`,
      opts.from, opts.to, like, like, Math.min(opts.limit ?? 1000, 10000),
    );
    return rows.map((r) => ({
      id: r.id, ts: r.ts, alarmId: r.alarm_id, tag: r.tag, event: r.event, severity: r.severity, message: r.message,
      value: r.value ? JSON.parse(r.value) : null, user: r.user ?? undefined, comment: r.comment ?? undefined,
    }));
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
