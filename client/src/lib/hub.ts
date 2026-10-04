import {
  HttpTransportType, HubConnectionBuilder, HubConnectionState, LogLevel, type HubConnection,
} from '@microsoft/signalr';
import type { AlarmEvent, AlarmInfo, DeviceStatus, ScriptLogEntry, TagChange, TagValue } from '@shared/types.ts';
import { useAlarms } from '../stores/alarms.ts';
import { useProject } from '../stores/project.ts';
import { useSession } from '../stores/session.ts';

// ───────────────────────────── Tag cache ─────────────────────────────

type Listener = () => void;

/**
 * Client-side mirror of subscribed tag values. Components subscribe per path;
 * the first subscriber of a path subscribes on the server, the last one leaving unsubscribes.
 */
class TagCache {
  private values = new Map<string, TagValue>();
  private listeners = new Map<string, Set<Listener>>();

  get(path: string): TagValue | undefined {
    return this.values.get(path);
  }

  apply(changes: TagChange[]): void {
    for (const c of changes) {
      this.values.set(c.path, { value: c.value, quality: c.quality, ts: c.ts });
      const set = this.listeners.get(c.path);
      if (set) for (const l of set) l();
    }
  }

  /** Optimistic local update (e.g. slider drag), corrected by the next server push. */
  setLocal(path: string, value: unknown): void {
    const cur = this.values.get(path);
    this.apply([{ path, value, quality: cur?.quality ?? 'good', ts: Date.now() }]);
  }

  subscribe(path: string, listener: Listener): () => void {
    let set = this.listeners.get(path);
    if (!set) {
      set = new Set();
      this.listeners.set(path, set);
    }
    set.add(listener);
    runtime.acquire(path);
    return () => {
      set.delete(listener);
      runtime.release(path);
    };
  }
}

export const tagCache = new TagCache();

// ───────────────────────────── Runtime hub connection ─────────────────────────────

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

class RuntimeConnection {
  private conn?: HubConnection;
  private refCounts = new Map<string, number>();
  private toSubscribe = new Set<string>();
  private toUnsubscribe = new Set<string>();
  private flushTimer?: number;
  private stateListeners = new Set<Listener>();
  private scriptLogListeners = new Set<(e: ScriptLogEntry) => void>();
  private waiters = new Map<string, (() => void)[]>();
  state: ConnectionState = 'disconnected';
  private handlers = new Map<string, Set<(...args: never[]) => void>>();
  private wired = new WeakMap<HubConnection, Set<string>>();

  /** Subscribe to a server → client hub message (survives reconnects). */
  on<A extends unknown[]>(event: string, handler: (...args: A) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as unknown as (...args: never[]) => void);
    if (this.conn) this.wire(this.conn, event);
    return () => { set.delete(handler as unknown as (...args: never[]) => void); };
  }

  private wire(conn: HubConnection, event: string): void {
    let done = this.wired.get(conn);
    if (!done) {
      done = new Set();
      this.wired.set(conn, done);
    }
    if (done.has(event)) return;
    done.add(event);
    conn.on(event, (...args: unknown[]) => {
      for (const h of this.handlers.get(event) ?? []) (h as (...a: unknown[]) => void)(...args);
    });
  }

  /** Current SignalR connection id (to recognise our own echoes). */
  get connectionId(): string | null {
    return this.conn?.connectionId ?? null;
  }

  private setState(s: ConnectionState) {
    this.state = s;
    this.stateListeners.forEach((l) => l());
  }

  onState(l: Listener): () => void {
    this.stateListeners.add(l);
    return () => this.stateListeners.delete(l);
  }

  private startChain: Promise<void> = Promise.resolve();

  /** (Re)connect, e.g. after login/logout. Calls are serialized so a start is never interrupted mid-handshake. */
  start(): Promise<void> {
    this.startChain = this.startChain.then(() => this.doStart(), () => this.doStart());
    return this.startChain;
  }

  private async doStart(): Promise<void> {
    const old = this.conn;
    this.conn = undefined;
    await old?.stop().catch(() => undefined);
    const conn = new HubConnectionBuilder()
      .withUrl('/hubs/runtime', {
        transport: HttpTransportType.WebSockets,
        accessTokenFactory: () => useSession.getState().token ?? '',
      })
      .withAutomaticReconnect({ nextRetryDelayInMilliseconds: (ctx) => Math.min(10_000, 500 * 2 ** ctx.previousRetryCount) })
      .configureLogging(LogLevel.Warning)
      .build();
    conn.serverTimeoutInMilliseconds = 60_000;

    conn.on('tagValues', (changes: TagChange[]) => tagCache.apply(changes));
    conn.on('alarms', (list: AlarmInfo[]) => useAlarms.getState().set(list));
    conn.on('alarmEvent', (ev: AlarmEvent) => useAlarms.getState().onEvent(ev));
    conn.on('deviceStatus', (s: DeviceStatus) => useProject.getState().setDevice(s));
    conn.on('scriptLog', (e: ScriptLogEntry) => this.scriptLogListeners.forEach((l) => l(e)));
    conn.on('projectChanged', () => void useProject.getState().refresh().catch(() => undefined));
    for (const event of this.handlers.keys()) this.wire(conn, event);
    conn.onreconnecting(() => this.setState('reconnecting'));
    conn.onreconnected(() => {
      this.setState('connected');
      void this.resubscribeAll();
      if (this.scriptLogListeners.size) void this.invoke('watchScriptLog', true).catch(() => undefined);
      void useProject.getState().refresh().catch(() => undefined);
    });
    conn.onclose(() => {
      this.setState('disconnected');
      setTimeout(() => { if (this.conn === conn) void this.start(); }, 3000);
    });

    this.conn = conn;
    this.setState('connecting');
    try {
      await conn.start();
      this.setState('connected');
      await this.resubscribeAll();
    } catch {
      this.setState('disconnected');
      setTimeout(() => { if (this.conn === conn) void this.start(); }, 3000);
    }
  }

  private async resubscribeAll(): Promise<void> {
    const paths = [...this.refCounts.keys()];
    if (paths.length) await this.subscribeNow(paths);
  }

  private async subscribeNow(paths: string[]): Promise<void> {
    if (this.conn?.state !== HubConnectionState.Connected) return;
    const snapshot = await this.conn.invoke<TagChange[]>('subscribe', paths);
    tagCache.apply(snapshot);
    for (const p of paths) {
      const w = this.waiters.get(p);
      if (w) {
        this.waiters.delete(p);
        w.forEach((fn) => fn());
      }
    }
  }

  acquire(path: string): void {
    const n = this.refCounts.get(path) ?? 0;
    this.refCounts.set(path, n + 1);
    if (n === 0) {
      this.toUnsubscribe.delete(path);
      this.toSubscribe.add(path);
      this.scheduleFlush();
    }
  }

  release(path: string): void {
    const n = (this.refCounts.get(path) ?? 1) - 1;
    if (n > 0) {
      this.refCounts.set(path, n);
      return;
    }
    this.refCounts.delete(path);
    this.toSubscribe.delete(path);
    this.toUnsubscribe.add(path);
    this.scheduleFlush();
  }

  /** Subscribe and wait until the first values arrived (used before running scripts). */
  ensure(paths: string[]): Promise<() => void> {
    const missing = paths.filter((p) => !tagCache.get(p));
    paths.forEach((p) => this.acquire(p));
    const release = () => paths.forEach((p) => this.release(p));
    if (!missing.length || this.conn?.state !== HubConnectionState.Connected) return Promise.resolve(release);
    return Promise.race([
      Promise.all(missing.map((p) => new Promise<void>((resolve) => {
        this.waiters.set(p, [...(this.waiters.get(p) ?? []), resolve]);
      }))),
      new Promise((r) => setTimeout(r, 2000)),
    ]).then(() => release);
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== undefined) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = undefined;
      const sub = [...this.toSubscribe];
      const unsub = [...this.toUnsubscribe];
      this.toSubscribe.clear();
      this.toUnsubscribe.clear();
      if (this.conn?.state !== HubConnectionState.Connected) return;
      if (sub.length) void this.subscribeNow(sub).catch(() => undefined);
      if (unsub.length) void this.conn.invoke('unsubscribe', unsub).catch(() => undefined);
    }, 30);
  }

  invoke<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    if (!this.conn || this.conn.state !== HubConnectionState.Connected) return Promise.reject(new Error('Not connected to the runtime'));
    return this.conn.invoke<T>(method, ...args).catch((err: Error) => {
      // Strip SignalR's "An unexpected error occurred invoking..." / "HubException:" prefixes.
      throw new Error(err.message.replace(/^.*HubException:\s*/, '').replace(/^Error: /, ''));
    });
  }

  async write(path: string, value: unknown): Promise<void> {
    await this.invoke('write', path, value);
  }

  ackAlarms(ids: string[], comment?: string): Promise<number> {
    return this.invoke<number>('ackAlarms', ids, comment ?? null);
  }

  shelveAlarm(id: string, minutes: number, comment?: string): Promise<void> {
    return this.invoke('shelveAlarm', id, minutes, comment ?? null);
  }

  watchScriptLog(listener: (e: ScriptLogEntry) => void): () => void {
    this.scriptLogListeners.add(listener);
    if (this.scriptLogListeners.size === 1) void this.invoke('watchScriptLog', true).catch(() => undefined);
    return () => {
      this.scriptLogListeners.delete(listener);
      if (this.scriptLogListeners.size === 0) void this.invoke('watchScriptLog', false).catch(() => undefined);
    };
  }
}

export const runtime = new RuntimeConnection();
