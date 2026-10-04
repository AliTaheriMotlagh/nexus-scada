import { DatabaseSync } from 'node:sqlite';
import { errorMessage, getJsonPath, renderTemplate } from '../core/util.ts';
import type { TagRuntime } from '../tags/TagEngine.ts';
import { num, src, str, type Driver, type DriverContext } from './Driver.ts';

/**
 * REST / HTTP JSON device — web APIs, Shelly Gen2, Philips Hue, Home Assistant, weather services...
 * settings: { baseUrl, pollMs=5000, timeoutMs=5000, headers: {Authorization: "Bearer ..."} }
 * tag source: { path: "/api/states/sensor.temp", jsonPath: "state",
 *               write: { method: POST, path, body: '{"value": {{json}}}' },
 *               writeOn / writeOff: { method, path, body } (boolean tags) }
 */
export function createRestDriver(ctx: DriverContext): Driver {
  const baseUrl = str(ctx.settings.baseUrl).replace(/\/$/, '');
  const pollMs = num(ctx.settings.pollMs, 5000);
  const timeoutMs = num(ctx.settings.timeoutMs, 5000);
  const headers = { 'content-type': 'application/json', ...((ctx.settings.headers as Record<string, string>) ?? {}) };
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const urlOf = (path: string) => (/^https?:\/\//.test(path) ? path : `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`);

  const byUrl = new Map<string, TagRuntime[]>();
  for (const tag of ctx.device.tags) {
    const p = str(src(tag).path ?? src(tag).url);
    if (!p) continue;
    const u = urlOf(p);
    if (!byUrl.has(u)) byUrl.set(u, []);
    byUrl.get(u)!.push(tag);
  }

  const poll = async () => {
    let ok = 0;
    let failed = 0;
    await Promise.all([...byUrl].map(async ([url, tags]) => {
      try {
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        let body: unknown = text;
        try { body = JSON.parse(text); } catch { /* plain text body */ }
        for (const tag of tags) ctx.update(tag.path, getJsonPath(body, src(tag).jsonPath as string | undefined));
        ctx.countRead(tags.length);
        ok++;
      } catch (err) {
        failed++;
        ctx.countError();
        for (const tag of tags) ctx.update(tag.path, tag.current.value, 'bad');
        ctx.log.debug(`GET ${url}: ${errorMessage(err)}`);
      }
    }));
    if (failed && !ok) ctx.status('error', `${failed} endpoint(s) failing`);
    else ctx.status('connected', failed ? `${failed} endpoint(s) failing` : baseUrl);
    if (!stopped) timer = setTimeout(poll, pollMs);
  };

  return {
    start() {
      ctx.status('connecting', baseUrl);
      void poll();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
    async write(tag, value) {
      const s = src(tag);
      const spec = (tag.dataType === 'boolean' && (value ? s.writeOn : s.writeOff)) || s.write;
      if (!spec || typeof spec !== 'object') throw new Error(`${tag.path} has no write definition`);
      const w = spec as { method?: string; path?: string; body?: string };
      const res = await fetch(urlOf(str(w.path, str(s.path))), {
        method: str(w.method, 'POST'),
        headers,
        body: w.body !== undefined ? renderTemplate(w.body, value) : JSON.stringify({ value }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      ctx.countWrite();
      ctx.update(tag.path, value);
    },
  };
}

/**
 * SQL device — poll values from the runtime SQLite database or another SQLite file (MES/ERP integration).
 * settings: { file (optional, read-only), pollMs=5000 }
 * tag source: { query: "SELECT count(*) FROM alarm_events", column }
 */
export function createSqlDriver(ctx: DriverContext): Driver {
  const pollMs = num(ctx.settings.pollMs, 5000);
  const file = ctx.settings.file ? str(ctx.settings.file) : undefined;
  let external: DatabaseSync | undefined;
  let timer: NodeJS.Timeout | undefined;

  const queryRow = (sql: string): Record<string, unknown> | undefined =>
    external ? (external.prepare(sql).get() as Record<string, unknown> | undefined) : ctx.db.get(sql);

  const poll = () => {
    let errors = 0;
    for (const tag of ctx.device.tags) {
      const q = str(src(tag).query);
      if (!q) continue;
      try {
        const row = queryRow(q);
        const col = src(tag).column as string | undefined;
        ctx.update(tag.path, row ? (col ? row[col] : Object.values(row)[0]) : null);
        ctx.countRead();
      } catch (err) {
        errors++;
        ctx.countError();
        ctx.update(tag.path, tag.current.value, 'bad');
        ctx.log.warn(`${tag.path}: ${errorMessage(err)}`);
      }
    }
    ctx.status(errors ? 'error' : 'connected', errors ? `${errors} query error(s)` : file ?? 'runtime database');
  };

  return {
    start() {
      if (file) external = new DatabaseSync(file, { readOnly: true });
      poll();
      timer = setInterval(poll, pollMs);
    },
    stop() {
      clearInterval(timer);
      external?.close();
    },
  };
}
