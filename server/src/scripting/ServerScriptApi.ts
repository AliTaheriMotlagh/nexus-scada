import type {
  ActiveAlarm, AlarmsApi, HistoryApi, HttpApi, LogApi, RecipesApi, ScriptEvent, ServerGlobals, TagsApi, TagVQT,
} from '../../../shared/script-api.ts';
import { pathMatches } from '../../../shared/scriptCompiler.ts';
import type { AlarmEngine } from '../alarms/AlarmEngine.ts';
import type { Notifier } from '../alarms/Notifier.ts';
import type { RecipeService } from '../automation/RecipeService.ts';
import type { Database, SqlParam } from '../core/Database.ts';
import type { EventBus } from '../core/EventBus.ts';
import type { DriverManager } from '../drivers/DriverManager.ts';
import type { Historian } from '../historian/Historian.ts';
import type { TagEngine } from '../tags/TagEngine.ts';

/** Services the script facade delegates to. */
export interface ScriptServices {
  bus: EventBus;
  tags: TagEngine;
  alarms: AlarmEngine;
  historian: Historian;
  drivers: DriverManager;
  db: Database;
  notifier: Notifier;
  recipes: RecipeService;
  runScript(name: string, event: ScriptEvent): Promise<void>;
}

const fmt = (args: unknown[]) =>
  args.map((a) => (a instanceof Error ? a.message : typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');

async function readBody(res: Response): Promise<unknown> {
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const type = res.headers.get('content-type') ?? '';
  return type.includes('json') ? res.json() : res.text();
}

/**
 * Facade implementing the shared `ServerGlobals` contract on top of the runtime services.
 * `disposers` collects listeners/timers so they are released when the script is reloaded.
 */
export function createServerGlobals(
  s: ScriptServices,
  scriptName: string,
  state: Record<string, unknown>,
  disposers: (() => void)[],
): Omit<ServerGlobals, 'event'> {
  const log: LogApi = {
    info: (...a) => s.bus.emit('script:log', { ts: Date.now(), script: scriptName, level: 'info', message: fmt(a) }),
    warn: (...a) => s.bus.emit('script:log', { ts: Date.now(), script: scriptName, level: 'warn', message: fmt(a) }),
    error: (...a) => s.bus.emit('script:log', { ts: Date.now(), script: scriptName, level: 'error', message: fmt(a) }),
  };

  const read = (path: string): TagVQT => {
    const v = s.tags.get(path);
    if (!v) throw new Error(`Unknown tag "${path}"`);
    return { ...v };
  };

  const tags: TagsApi = {
    get: (path) => s.tags.get(path)?.value,
    read,
    write: (path, value) => s.tags.write(path, value),
    async writeMany(values) {
      for (const [p, v] of Object.entries(values)) await s.tags.write(p, v);
    },
    async toggle(path) {
      const next = !s.tags.get(path)?.value;
      await s.tags.write(path, next);
      return next;
    },
    on(path, listener) {
      const patterns = Array.isArray(path) ? path : [path];
      const off = s.bus.on('tag:change', (changes) => {
        for (const c of changes) {
          if (!patterns.some((p) => pathMatches(p, c.path))) continue;
          try {
            listener({ value: c.value, quality: c.quality, ts: c.ts }, c.path);
          } catch (err) {
            log.error(`listener for ${c.path}:`, err);
          }
        }
      });
      disposers.push(off);
      return off;
    },
    browse: (prefix) => s.tags.list(prefix),
  };

  const alarms: AlarmsApi = {
    active: (prefix) => s.alarms.active(prefix) as ActiveAlarm[],
    async ack(ids, comment) {
      s.alarms.ack(Array.isArray(ids) ? ids : [ids], `script:${scriptName}`, comment);
    },
    unackedCount: (prefix) => s.alarms.active(prefix).filter((a) => a.state !== 'active-acked').length,
  };

  const history: HistoryApi = {
    async query(paths, from, to = Date.now(), maxPoints = 1000) {
      return s.historian.query(paths, Number(from), Number(to), maxPoints);
    },
    async average(path, seconds) {
      return s.historian.average(path, seconds);
    },
  };

  const http: HttpApi = {
    get: async (url, headers) => readBody(await fetch(url, { headers, signal: AbortSignal.timeout(15000) })) as never,
    post: async (url, body, headers) => readBody(await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })) as never,
  };

  const recipes: RecipesApi = {
    list: () => s.recipes.all().map((r) => ({ name: r.name, sets: Object.keys(r.sets) })),
    load: (name, set) => s.recipes.download(name, set),
  };

  return {
    tags,
    alarms,
    history,
    recipes,
    log,
    http,
    sleep: (ms) => new Promise((r) => {
      const t = setTimeout(r, ms);
      disposers.push(() => clearTimeout(t));
    }),
    db: {
      query: (sql, ...params) => s.db.query(sql, ...(params as SqlParam[])),
      exec: (sql, ...params) => ({ changes: s.db.run(sql, ...(params as SqlParam[])).changes }),
    },
    mqtt: {
      publish: (device, topic, payload, options) => s.drivers.publish(device, topic, payload, options),
    },
    notify: (message, options) => s.notifier.notify(
      { title: options?.title ?? scriptName, message, severity: options?.severity ?? 'info' },
      options?.channel,
    ),
    runScript: (name, event) => s.runScript(name, { type: 'call', caller: scriptName, ...event }),
    state,
  };
}
