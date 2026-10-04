import type { HistoryPoint, HistorySeries, TagChange } from '../../../shared/types.ts';
import type { Database } from '../core/Database.ts';
import type { EventBus } from '../core/EventBus.ts';
import { createLogger } from '../core/logger.ts';
import type { TagEngine, TagRuntime } from '../tags/TagEngine.ts';

const log = createLogger('historian');
const QUALITY_CODE = { good: 0, uncertain: 1, bad: 2 } as const;

interface Logged { deadband: number; intervalMs: number; lastValue?: number; lastTs: number }

/**
 * Process historian on SQLite: store-on-change with deadband, forced heartbeat samples,
 * buffered batch inserts, min/avg/max aggregation for trends and retention cleanup.
 */
export class Historian {
  private readonly db: Database;
  private readonly tags: TagEngine;
  private logged = new Map<string, Logged>();
  private buffer: [string, number, number | null, number][] = [];
  private timers: NodeJS.Timeout[] = [];
  private retentionDays = 30;

  constructor(bus: EventBus, db: Database, tags: TagEngine) {
    this.db = db;
    this.tags = tags;
    bus.on('tag:change', (changes) => this.onChanges(changes));
  }

  load(tags: TagRuntime[], retentionDays = 30): void {
    this.retentionDays = retentionDays;
    const next = new Map<string, Logged>();
    for (const t of tags) {
      const h = t.def.history;
      if (!h || t.dataType === 'string' || t.dataType === 'json') continue;
      const cfg = typeof h === 'object' ? h : {};
      next.set(t.path, { deadband: cfg.deadband ?? 0, intervalMs: (cfg.interval ?? 60) * 1000, lastTs: this.logged.get(t.path)?.lastTs ?? 0, lastValue: this.logged.get(t.path)?.lastValue });
    }
    this.logged = next;
    this.timers.forEach(clearInterval);
    this.timers = [
      setInterval(() => this.heartbeat(), 1000),
      setInterval(() => this.flush(), 1000),
      setInterval(() => this.purge(), 3_600_000),
    ];
    log.info(`logging ${next.size} tags, retention ${retentionDays} days`);
  }

  private toNumber(v: unknown): number | null {
    if (typeof v === 'boolean') return v ? 1 : 0;
    const n = Number(v);
    return v === null || v === undefined || Number.isNaN(n) ? null : n;
  }

  private onChanges(changes: TagChange[]): void {
    for (const c of changes) {
      const l = this.logged.get(c.path);
      if (!l) continue;
      const v = this.toNumber(c.value);
      if (l.lastValue !== undefined && v !== null && Math.abs(v - l.lastValue) < l.deadband && c.ts - l.lastTs < l.intervalMs) continue;
      this.push(c.path, c.ts, v, QUALITY_CODE[c.quality], l);
    }
  }

  private heartbeat(): void {
    const now = Date.now();
    for (const [path, l] of this.logged) {
      if (now - l.lastTs < l.intervalMs) continue;
      const cur = this.tags.get(path);
      if (cur) this.push(path, now, this.toNumber(cur.value), QUALITY_CODE[cur.quality], l);
    }
  }

  private push(path: string, ts: number, value: number | null, quality: number, l: Logged): void {
    l.lastTs = ts;
    if (value !== null) l.lastValue = value;
    this.buffer.push([path, ts, value, quality]);
    if (this.buffer.length > 5000) this.flush();
  }

  flush(): void {
    if (!this.buffer.length) return;
    const rows = this.buffer;
    this.buffer = [];
    try {
      this.db.transaction(() => {
        for (const r of rows) this.db.run('INSERT INTO history (tag, ts, value, quality) VALUES (?,?,?,?)', ...r);
      });
    } catch (err) {
      log.error('flush failed:', err);
    }
  }

  private purge(): void {
    const cutoff = Date.now() - this.retentionDays * 86_400_000;
    const { changes } = this.db.run('DELETE FROM history WHERE ts < ?', cutoff);
    if (changes) log.info(`purged ${changes} samples older than ${this.retentionDays} days`);
  }

  /** Raw samples when they fit in maxPoints, otherwise time buckets with avg/min/max. */
  query(paths: string[], from: number, to: number, maxPoints = 1000): HistorySeries[] {
    this.flush();
    const max = Math.max(10, Math.min(maxPoints, 10000));
    return paths.map((path) => {
      const count = this.db.get<{ n: number }>('SELECT count(*) AS n FROM history WHERE tag = ? AND ts BETWEEN ? AND ?', path, from, to)?.n ?? 0;
      let points: HistoryPoint[];
      if (count <= max) {
        points = this.db.query<HistoryPoint>('SELECT ts, value FROM history WHERE tag = ? AND ts BETWEEN ? AND ? ORDER BY ts', path, from, to);
      } else {
        const bucket = Math.ceil((to - from) / max);
        points = this.db.query<HistoryPoint>(
          `SELECT (ts / ?) * ? AS ts, avg(value) AS value, min(value) AS min, max(value) AS max
           FROM history WHERE tag = ? AND ts BETWEEN ? AND ? GROUP BY ts / ? ORDER BY 1`,
          bucket, bucket, path, from, to, bucket,
        );
      }
      // Carry the last known value into the window so step lines start at the left edge.
      const before = this.db.get<HistoryPoint>('SELECT ts, value FROM history WHERE tag = ? AND ts < ? ORDER BY ts DESC LIMIT 1', path, from);
      if (before) points.unshift({ ts: from, value: before.value });
      return { path, points };
    });
  }

  average(path: string, seconds: number): number | null {
    this.flush();
    return this.db.get<{ v: number | null }>('SELECT avg(value) AS v FROM history WHERE tag = ? AND ts >= ?', path, Date.now() - seconds * 1000)?.v ?? null;
  }

  stop(): void {
    this.timers.forEach(clearInterval);
    this.flush();
  }
}
