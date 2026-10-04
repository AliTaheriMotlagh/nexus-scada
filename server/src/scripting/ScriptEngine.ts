import vm from 'node:vm';
import { SERVER_GLOBALS, type ScriptEvent } from '../../../shared/script-api.ts';
import { compileScript, pathMatches, ScriptCompileError } from '../../../shared/scriptCompiler.ts';
import { SEVERITY_RANK, type ScriptConfig, type ScriptStatus } from '../../../shared/types.ts';
import type { ProjectStore } from '../config/ProjectStore.ts';
import { notFound } from '../core/errors.ts';
import { createLogger } from '../core/logger.ts';
import { errorMessage } from '../core/util.ts';
import type { Scheduler } from '../automation/Scheduler.ts';
import { createServerGlobals, type ScriptServices } from './ServerScriptApi.ts';

const log = createLogger('scripts');
const SYNC_TIMEOUT_MS = 2000;
const MAX_QUEUE = 50;

type ScriptFn = (...args: unknown[]) => Promise<unknown>;

interface LoadedScript {
  cfg: ScriptConfig;
  status: ScriptStatus;
  context?: vm.Context;
  fn?: ScriptFn;
  globals?: Record<string, unknown>;
  state: Record<string, unknown>;
  stateJson: string;
  disposers: (() => void)[];
  queue: ScriptEvent[];
}

/** Validate a script without running it. Returns diagnostics for the editor. */
export function checkScript(code: string): { ok: boolean; error?: string; line?: number } {
  try {
    compileScript(code, SERVER_GLOBALS);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err), line: err instanceof ScriptCompileError ? err.line : undefined };
  }
}

/**
 * Runs server scripts written in TypeScript inside isolated vm contexts.
 * Triggers: startup, interval, tagChange, cron/solar schedules, alarm and manual.
 * Note: `vm` isolates globals; it is not a hard security boundary — only engineers may edit scripts.
 */
export class ScriptEngine {
  private readonly services: Omit<ScriptServices, 'runScript'>;
  private readonly store: ProjectStore;
  private readonly scheduler: Scheduler;
  private scripts = new Map<string, LoadedScript>();
  private triggerDisposers: (() => void)[] = [];

  constructor(services: Omit<ScriptServices, 'runScript'>, store: ProjectStore, scheduler: Scheduler) {
    this.services = services;
    this.store = store;
    this.scheduler = scheduler;
  }

  /** (Re)load all scripts. Previous contexts, listeners and timers are disposed. */
  load(configs: ScriptConfig[] = []): void {
    this.unload();
    for (const cfg of configs) {
      const state = this.services.db.getKv<Record<string, unknown>>(`script:${cfg.name}`) ?? {};
      const s: LoadedScript = {
        cfg,
        state,
        stateJson: JSON.stringify(state),
        disposers: [],
        queue: [],
        status: {
          name: cfg.name, file: cfg.file, description: cfg.description, enabled: cfg.enabled !== false,
          triggers: cfg.triggers ?? [{ type: 'manual' }], runs: 0, errors: 0, running: false,
        },
      };
      this.scripts.set(cfg.name, s);
      if (s.status.enabled) this.compile(s);
    }
    this.wireTriggers();
    log.info(`loaded ${this.scripts.size} scripts`);
  }

  private compile(s: LoadedScript): void {
    const code = this.store.readScript(s.cfg.file);
    try {
      const js = compileScript(code, SERVER_GLOBALS);
      const timers = new Set<NodeJS.Timeout>();
      s.disposers.push(() => timers.forEach((t) => clearTimeout(t)));
      const globals = createServerGlobals({ ...this.services, runScript: (n, e) => this.run(n, e) }, s.cfg.name, s.state, s.disposers);
      s.globals = globals as unknown as Record<string, unknown>;
      const track = <T extends NodeJS.Timeout>(t: T) => { timers.add(t); return t; };
      s.context = vm.createContext(
        {
          console: { log: globals.log.info, info: globals.log.info, warn: globals.log.warn, error: globals.log.error },
          setTimeout: (fn: () => void, ms?: number) => track(setTimeout(fn, ms)),
          setInterval: (fn: () => void, ms?: number) => track(setInterval(fn, ms)),
          clearTimeout, clearInterval, fetch, URL, URLSearchParams, TextEncoder, TextDecoder, AbortSignal, structuredClone,
        },
        { name: `script:${s.cfg.name}`, codeGeneration: { strings: false, wasm: false } },
      );
      s.fn = new vm.Script(`${js}\n__script__;`, { filename: `scripts/${s.cfg.file}`, lineOffset: -1 }).runInContext(s.context) as ScriptFn;
      s.status.lastError = undefined;
    } catch (err) {
      s.fn = undefined;
      s.status.lastError = `Compile error: ${errorMessage(err)}`;
      s.status.errors++;
      this.emitLog(s.cfg.name, 'error', s.status.lastError);
    }
  }

  private wireTriggers(): void {
    const { bus } = this.services;
    for (const s of this.scripts.values()) {
      if (!s.status.enabled) continue;
      for (const t of s.status.triggers) {
        switch (t.type) {
          case 'startup':
            setImmediate(() => void this.run(s.cfg.name, { type: 'startup' }).catch(() => undefined));
            break;
          case 'interval': {
            const timer = setInterval(() => {
              if (!s.status.running) void this.run(s.cfg.name, { type: 'interval' }).catch(() => undefined);
            }, t.ms);
            this.triggerDisposers.push(() => clearInterval(timer));
            break;
          }
          case 'tagChange':
            this.triggerDisposers.push(bus.on('tag:change', (changes) => {
              for (const c of changes) {
                if (t.tags.some((p) => pathMatches(p, c.path))) {
                  void this.run(s.cfg.name, { type: 'tagChange', path: c.path, value: c.value, quality: c.quality, ts: c.ts }).catch(() => undefined);
                }
              }
            }));
            break;
          case 'cron':
            this.scheduler.add(`script:${s.cfg.name}`, t.cron, () => this.run(s.cfg.name, { type: 'schedule', cron: t.cron }));
            break;
          case 'alarm':
            this.triggerDisposers.push(bus.on('alarm:event', (ev) => {
              if (ev.event !== 'active') return;
              if (SEVERITY_RANK[ev.severity] < SEVERITY_RANK[t.minSeverity ?? 'info']) return;
              void this.run(s.cfg.name, { type: 'alarm', path: ev.tag, value: ev.value, alarm: ev }).catch(() => undefined);
            }));
            break;
        }
      }
    }
  }

  /** Run a script now. Concurrent triggers are queued (bounded) so runs never overlap. */
  async run(name: string, event: ScriptEvent = { type: 'manual' }): Promise<void> {
    const s = this.scripts.get(name);
    if (!s) throw notFound(`Script "${name}"`);
    if (!s.fn || !s.context || !s.globals) throw new Error(s.status.lastError ?? `Script "${name}" is disabled`);
    if (s.status.running) {
      // Coalesce: keep only the latest pending event per tag path.
      const dup = event.path !== undefined ? s.queue.findIndex((e) => e.type === event.type && e.path === event.path) : -1;
      if (dup >= 0) s.queue.splice(dup, 1);
      if (s.queue.length >= MAX_QUEUE) s.queue.shift();
      s.queue.push(event);
      return;
    }
    s.status.running = true;
    const started = performance.now();
    try {
      const g = s.globals;
      const args = SERVER_GLOBALS.map((k) => (k === 'event' ? event : g[k]));
      s.context.__fn = s.fn;
      s.context.__args = args;
      const result = vm.runInContext('__fn.apply(undefined, __args)', s.context, { timeout: SYNC_TIMEOUT_MS }) as Promise<unknown>;
      await result;
      s.status.lastError = undefined;
    } catch (err) {
      s.status.errors++;
      s.status.lastError = errorMessage(err);
      const where = err instanceof Error ? /scripts\/[^:]+:(\d+)/.exec(err.stack ?? '')?.[1] : undefined;
      this.emitLog(name, 'error', `${s.status.lastError}${where ? ` (line ${where})` : ''}`);
      throw err;
    } finally {
      s.status.running = false;
      s.status.runs++;
      s.status.lastRun = Date.now();
      s.status.lastDurationMs = Math.round(performance.now() - started);
      this.persistState(s);
      const next = s.queue.shift();
      if (next) setImmediate(() => void this.run(name, next).catch(() => undefined));
    }
  }

  private persistState(s: LoadedScript): void {
    const json = JSON.stringify(s.state);
    if (json === s.stateJson) return;
    s.stateJson = json;
    this.services.db.setKv(`script:${s.cfg.name}`, s.state);
  }

  private emitLog(script: string, level: 'info' | 'warn' | 'error', message: string): void {
    this.services.bus.emit('script:log', { ts: Date.now(), script, level, message });
    if (level === 'error') log.warn(`[${script}] ${message}`);
  }

  statuses(): ScriptStatus[] {
    return [...this.scripts.values()].map((s) => ({ ...s.status }));
  }

  config(name: string): ScriptConfig {
    const s = this.scripts.get(name);
    if (!s) throw notFound(`Script "${name}"`);
    return s.cfg;
  }

  private unload(): void {
    this.triggerDisposers.forEach((d) => d());
    this.triggerDisposers = [];
    for (const s of this.scripts.values()) {
      s.disposers.forEach((d) => d());
      this.persistState(s);
    }
    this.scripts.clear();
  }

  stop(): void {
    this.unload();
  }
}
