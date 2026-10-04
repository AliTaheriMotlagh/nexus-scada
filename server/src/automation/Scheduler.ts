import { createLogger } from '../core/logger.ts';
import { errorMessage, parseDuration } from '../core/util.ts';

const log = createLogger('scheduler');

export type Schedule =
  | { kind: 'cron'; fields: Set<number>[]; domRestricted: boolean; dowRestricted: boolean }
  | { kind: 'every'; ms: number }
  | { kind: 'sun'; event: 'sunrise' | 'sunset'; offsetMs: number };

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *', '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *',
};
const RANGES: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];

function parseField(text: string, [min, max]: [number, number]): Set<number> {
  const out = new Set<number>();
  for (const part of text.split(',')) {
    const [range, stepText] = part.split('/');
    const step = stepText ? Number(stepText) : 1;
    let lo = min;
    let hi = max;
    if (range !== '*') {
      const [a, b] = range.split('-').map(Number);
      lo = a;
      hi = b ?? (stepText ? max : a);
    }
    if ([lo, hi, step].some((n) => Number.isNaN(n)) || lo < min || hi > max || step < 1) throw new Error(`invalid cron field "${text}"`);
    for (let i = lo; i <= hi; i += step) out.add(i);
  }
  return out;
}

/** Parse 5-field cron, macros, `@every 30s`, `@sunrise`, `@sunset-30m`. */
export function parseSchedule(text: string): Schedule {
  const t = text.trim();
  const every = /^@every\s+(.+)$/.exec(t);
  if (every) return { kind: 'every', ms: Math.max(1000, parseDuration(every[1])) };
  const sun = /^@(sunrise|sunset)\s*(?:([+-])\s*(\S+))?$/.exec(t);
  if (sun) {
    const offset = sun[3] ? parseDuration(sun[3]) : 0;
    return { kind: 'sun', event: sun[1] as 'sunrise' | 'sunset', offsetMs: sun[2] === '-' ? -offset : offset };
  }
  const parts = (MACROS[t] ?? t).split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron "${text}" must have 5 fields`);
  const fields = parts.map((p, i) => parseField(p, RANGES[i]));
  if (fields[4].has(7)) fields[4].add(0);
  return { kind: 'cron', fields, domRestricted: parts[2] !== '*', dowRestricted: parts[4] !== '*' };
}

export function cronMatches(s: Extract<Schedule, { kind: 'cron' }>, d: Date): boolean {
  const [min, hour, dom, mon, dow] = s.fields;
  if (!min.has(d.getMinutes()) || !hour.has(d.getHours()) || !mon.has(d.getMonth() + 1)) return false;
  const domOk = dom.has(d.getDate());
  const dowOk = dow.has(d.getDay());
  // Standard cron: when both day fields are restricted, either may match.
  if (s.domRestricted && s.dowRestricted) return domOk || dowOk;
  return domOk && dowOk;
}

/** Sunrise / sunset (suncalc / NOAA algorithm). Returns null in polar day/night. */
export function sunTimes(date: Date, lat: number, lng: number): { sunrise: Date | null; sunset: Date | null } {
  const rad = Math.PI / 180;
  const dayMs = 86_400_000;
  const J1970 = 2440588;
  const J2000 = 2451545;
  const J0 = 0.0009;
  const noon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const d = noon.valueOf() / dayMs - 0.5 + J1970 - J2000;
  const lw = rad * -lng;
  const phi = rad * lat;
  const n = Math.round(d - J0 - lw / (2 * Math.PI));
  const ds = J0 + lw / (2 * Math.PI) + n;
  const M = rad * (357.5291 + 0.98560028 * ds);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(rad * 23.4397) * Math.sin(L));
  const jNoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const w = Math.acos((Math.sin(-0.833 * rad) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
  if (Number.isNaN(w)) return { sunrise: null, sunset: null };
  const a = J0 + (w + lw) / (2 * Math.PI) + n;
  const jSet = J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const jRise = jNoon - (jSet - jNoon);
  const fromJulian = (j: number) => new Date((j + 0.5 - J1970) * dayMs);
  return { sunrise: fromJulian(jRise), sunset: fromJulian(jSet) };
}

interface Job {
  name: string;
  text: string;
  schedule: Schedule;
  run: () => unknown;
  lastFired: number;
}

/** Fires jobs on cron / interval / solar schedules. Checked every second. */
export class Scheduler {
  private jobs: Job[] = [];
  private timer?: NodeJS.Timeout;
  private lastMinute = -1;
  private location = { lat: 51.5, lng: 0 };

  setLocation(loc?: { lat: number; lng: number }): void {
    if (loc) this.location = loc;
  }

  clear(): void {
    this.jobs = [];
  }

  add(name: string, text: string, run: () => unknown): void {
    try {
      this.jobs.push({ name, text, schedule: parseSchedule(text), run, lastFired: Date.now() });
    } catch (err) {
      log.error(`${name}: ${errorMessage(err)}`);
    }
  }

  list(): { name: string; schedule: string; next?: number }[] {
    return this.jobs.map((j) => ({ name: j.name, schedule: j.text, next: this.nextRun(j) }));
  }

  private nextRun(j: Job): number | undefined {
    const now = Date.now();
    if (j.schedule.kind === 'every') return j.lastFired + j.schedule.ms;
    if (j.schedule.kind === 'sun') {
      for (let day = 0; day < 2; day++) {
        const t = this.sunEvent(j.schedule, new Date(now + day * 86_400_000));
        if (t && t > now) return t;
      }
      return undefined;
    }
    const d = new Date(now - (now % 60_000) + 60_000);
    for (let i = 0; i < 60 * 24 * 8; i++, d.setTime(d.getTime() + 60_000)) {
      if (cronMatches(j.schedule, d)) return d.getTime();
    }
    return undefined;
  }

  private sunEvent(s: Extract<Schedule, { kind: 'sun' }>, day: Date): number | undefined {
    const t = sunTimes(day, this.location.lat, this.location.lng)[s.event];
    return t ? t.getTime() + s.offsetMs : undefined;
  }

  start(): void {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 1000);
  }

  private fire(j: Job, now: number): void {
    j.lastFired = now;
    log.debug(`firing ${j.name}`);
    try {
      const r = j.run();
      if (r instanceof Promise) r.catch((err) => log.error(`${j.name}: ${errorMessage(err)}`));
    } catch (err) {
      log.error(`${j.name}: ${errorMessage(err)}`);
    }
  }

  private tick(): void {
    const now = Date.now();
    const minute = Math.floor(now / 60_000);
    const newMinute = minute !== this.lastMinute;
    this.lastMinute = minute;
    for (const j of this.jobs) {
      const s = j.schedule;
      if (s.kind === 'every' && now - j.lastFired >= s.ms) this.fire(j, now);
      else if (s.kind === 'cron' && newMinute && cronMatches(s, new Date(now))) this.fire(j, now);
      else if (s.kind === 'sun') {
        const t = this.sunEvent(s, new Date(now));
        if (t && j.lastFired < t && t <= now) this.fire(j, now);
      }
    }
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
