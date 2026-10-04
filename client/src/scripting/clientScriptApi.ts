import {
  CLIENT_GLOBALS,
  type ActiveAlarm, type ClientGlobals, type DisplayApi, type ElementApi, type ScriptEvent, type TagVQT,
} from '@shared/script-api.ts';
import { buildScriptFunction, extractTagRefs, pathMatches } from '@shared/scriptCompiler.ts';
import type { HistorySeries } from '@shared/types.ts';
import { api } from '../lib/api.ts';
import { runtime, tagCache } from '../lib/hub.ts';
import { navigate } from '../lib/router.ts';
import { useAlarms } from '../stores/alarms.ts';
import { useProject } from '../stores/project.ts';
import { useSession } from '../stores/session.ts';
import { toast, useUi } from '../stores/ui.ts';

export interface ClientScriptContext {
  display?: DisplayApi;
  element?: ElementApi;
  event: ScriptEvent;
  /** Cleanup callbacks (listeners, timers) owned by the display that ran the script */
  disposers?: (() => void)[];
  /** Label used in logs/toasts */
  source: string;
}

const fmt = (args: unknown[]) => args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');

/** Facade implementing the shared `ClientGlobals` contract in the browser. */
export function createClientGlobals(ctx: ClientScriptContext): ClientGlobals {
  const disposers = ctx.disposers ?? [];
  const read = (path: string): TagVQT => tagCache.get(path) ?? { value: undefined, quality: 'bad', ts: 0 };
  const noDisplay: DisplayApi = { name: '', params: {}, vars: {}, element: () => undefined };

  return {
    tags: {
      get: (path) => tagCache.get(path)?.value,
      read,
      write: (path, value) => runtime.write(path, value),
      async writeMany(values) {
        for (const [p, v] of Object.entries(values)) await runtime.write(p, v);
      },
      async toggle(path) {
        const next = !tagCache.get(path)?.value;
        await runtime.write(path, next);
        return next;
      },
      on(path, listener) {
        const paths = Array.isArray(path) ? path : [path];
        const offs = paths.map((p) => tagCache.subscribe(p, () => listener(read(p), p)));
        const off = () => offs.forEach((o) => o());
        disposers.push(off);
        return off;
      },
      browse: (prefix = '') => [...useProject.getState().tags.keys()].filter((p) => !prefix || pathMatches(`${prefix.replace(/\/$/, '')}/*`, p)),
    },
    alarms: {
      active: (prefix) => useAlarms.getState().list.filter((a) => !prefix || a.tag.startsWith(prefix)) as ActiveAlarm[],
      async ack(ids, comment) {
        await runtime.ackAlarms(Array.isArray(ids) ? ids : [ids], comment);
      },
      unackedCount: (prefix) => useAlarms.getState().list.filter((a) => a.state !== 'active-acked' && (!prefix || a.tag.startsWith(prefix))).length,
    },
    history: {
      query: (paths, from, to = Date.now(), maxPoints = 1000) =>
        api.get<HistorySeries[]>(`/history?paths=${encodeURIComponent(paths.join(','))}&from=${Number(from)}&to=${Number(to)}&points=${maxPoints}`),
      async average(path, seconds) {
        const [s] = await api.get<HistorySeries[]>(`/history?paths=${encodeURIComponent(path)}&from=${Date.now() - seconds * 1000}&points=10000`);
        const vals = (s?.points ?? []).map((p) => p.value).filter((v): v is number => v !== null);
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      },
    },
    recipes: {
      list: () => useProject.getState().recipes.map((r) => ({ name: r.name, sets: Object.keys(r.sets) })),
      load: (recipe, set) => api.post<void>(`/recipes/${encodeURIComponent(recipe)}/download`, { set }),
    },
    log: {
      info: (...a) => console.info(`[${ctx.source}]`, fmt(a)),
      warn: (...a) => console.warn(`[${ctx.source}]`, fmt(a)),
      error: (...a) => {
        console.error(`[${ctx.source}]`, fmt(a));
        toast(`${ctx.source}: ${fmt(a)}`, 'error');
      },
    },
    http: {
      async get(url, headers) {
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (res.headers.get('content-type') ?? '').includes('json') ? res.json() : res.text();
      },
      async post(url, body, headers) {
        const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (res.headers.get('content-type') ?? '').includes('json') ? res.json() : res.text();
      },
    },
    sleep: (ms) => new Promise((r) => {
      const t = setTimeout(r, ms);
      disposers.push(() => clearTimeout(t));
    }),
    event: ctx.event,
    ui: {
      navigate: (display, params) => navigate('view', display, params),
      openFaceplate: (path, display) => useUi.getState().openFaceplate(path, display),
      closeFaceplates: () => useUi.getState().closeAllFaceplates(),
      openScene: (scene) => navigate('scenes', scene),
      toast: (message, kind) => toast(message, kind),
      confirm: (message) => useUi.getState().confirm(message),
      prompt: (message, def) => useUi.getState().prompt(message, def),
      get user() {
        const u = useSession.getState().user;
        return u ? { username: u.username, role: u.role } : null;
      },
    },
    display: ctx.display ?? noDisplay,
    element: ctx.element,
  };
}

type CompiledScript = (...args: unknown[]) => Promise<unknown>;
const compiled = new Map<string, CompiledScript>();

/** Compile (cached) and run a page/element script. Errors are reported, never thrown. */
export async function runClientScript(code: string | undefined, ctx: ClientScriptContext): Promise<void> {
  if (!code?.trim()) return;
  let fn = compiled.get(code);
  try {
    if (!fn) {
      fn = buildScriptFunction(code, CLIENT_GLOBALS);
      compiled.set(code, fn);
    }
    // Make sure statically referenced tags are loaded before the script reads them.
    const release = await runtime.ensure(extractTagRefs(code));
    try {
      const g = createClientGlobals(ctx) as unknown as Record<string, unknown>;
      await fn(...CLIENT_GLOBALS.map((k) => g[k]));
    } finally {
      // keep values cached a little longer for follow-up reads
      setTimeout(release, 5000);
    }
  } catch (err) {
    console.error(`[${ctx.source}]`, err);
    toast(`${ctx.source}: ${(err as Error).message}`, 'error');
  }
}
