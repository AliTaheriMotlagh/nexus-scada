/**
 * Nexus Script API — the ONE scripting language for server scripts and graphic page scripts.
 *
 * Scripts are TypeScript. They are transpiled with sucrase (see scriptCompiler.ts) and run as the
 * body of an `async` function, so top-level `await` and `return` are allowed.
 *
 * This file is the single source of truth:
 *  - the server implements `ServerGlobals`  (server/src/scripting/ServerScriptApi.ts)
 *  - the browser implements `ClientGlobals` (client/src/scripting/clientScriptApi.ts)
 *  - Monaco intellisense is generated from this file's text (client/src/editor/scriptTypings.ts)
 *
 * Keep it declaration-only.
 */

/** Full path of a tag, e.g. "Plant/Tank1/Level". Replaced by a literal union for intellisense. */
export type TagPath = string; // @generated-tagpath

export type TagQuality = 'good' | 'bad' | 'uncertain';
export type AlarmSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface TagVQT {
  value: any;
  quality: TagQuality;
  /** epoch ms */
  ts: number;
}

export interface TagsApi {
  /** Current value of a tag (undefined when unknown). */
  get(path: TagPath): any;
  /** Value, quality and timestamp. */
  read(path: TagPath): TagVQT;
  /** Write a value (goes to the device driver when the tag is linked to one). */
  write(path: TagPath, value: any): Promise<void>;
  /** Write many tags at once. */
  writeMany(values: Partial<Record<TagPath, any>>): Promise<void>;
  /** Toggle a boolean tag and return the new value. */
  toggle(path: TagPath): Promise<boolean>;
  /** Listen for changes; returns an unsubscribe function. Listeners are removed when the script reloads. */
  on(path: TagPath | TagPath[], listener: (value: TagVQT, path: TagPath) => void): () => void;
  /** List tag paths under a folder prefix, e.g. browse("Home/LivingRoom"). */
  browse(prefix?: string): TagPath[];
}

export interface ActiveAlarm {
  id: string;
  tag: string;
  area: string;
  kind: string;
  severity: AlarmSeverity;
  message: string;
  state: 'active-unacked' | 'active-acked' | 'cleared-unacked';
  value: any;
  activeAt: number;
}

export interface AlarmsApi {
  /** Active (and unacknowledged cleared) alarms, optionally filtered by area prefix. */
  active(areaPrefix?: string): ActiveAlarm[];
  /** Acknowledge one or many alarms. */
  ack(ids: string | string[], comment?: string): Promise<void>;
  /** Number of active unacknowledged alarms. */
  unackedCount(areaPrefix?: string): number;
}

export interface HistoryApi {
  /** Historical samples, aggregated to at most `maxPoints` points per tag. */
  query(paths: TagPath[], from: Date | number, to?: Date | number, maxPoints?: number): Promise<{ path: string; points: { ts: number; value: number | null }[] }[]>;
  /** Average value of a tag over the last `seconds`. */
  average(path: TagPath, seconds: number): Promise<number | null>;
}

export interface LogApi {
  info(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
}

export interface HttpApi {
  get<T = any>(url: string, headers?: Record<string, string>): Promise<T>;
  post<T = any>(url: string, body?: any, headers?: Record<string, string>): Promise<T>;
}

export interface RecipesApi {
  list(): { name: string; sets: string[] }[];
  /** Download a recipe set to the tags. */
  load(recipe: string, set: string): Promise<void>;
}

/** Globals available to BOTH server and page scripts. */
export interface CommonGlobals {
  tags: TagsApi;
  alarms: AlarmsApi;
  history: HistoryApi;
  recipes: RecipesApi;
  log: LogApi;
  http: HttpApi;
  /** Await a delay in milliseconds. */
  sleep(ms: number): Promise<void>;
  /** Trigger information (tag change, element event, schedule...). */
  event: ScriptEvent;
}

export interface ScriptEvent {
  type: string;
  path?: string;
  value?: any;
  previous?: any;
  [key: string]: any;
}

// ───────────────────────────── Server only ─────────────────────────────

export interface DbApi {
  /** Run a SELECT against the runtime SQLite database. */
  query<T = any>(sql: string, ...params: any[]): T[];
  /** Run INSERT/UPDATE/DELETE/CREATE. */
  exec(sql: string, ...params: any[]): { changes: number };
}

export interface MqttApi {
  /** Publish via an MQTT device node, e.g. publish("Home/Mqtt", "zigbee2mqtt/lamp/set", { state: "ON" }). */
  publish(devicePath: string, topic: string, payload: any, options?: { retain?: boolean; qos?: 0 | 1 | 2 }): Promise<void>;
}

export interface NotifyOptions {
  channel?: string;
  title?: string;
  severity?: AlarmSeverity;
}

export interface ServerGlobals extends CommonGlobals {
  db: DbApi;
  mqtt: MqttApi;
  /** Send a notification to the configured channels (ntfy, telegram, slack, webhook...). */
  notify(message: string, options?: NotifyOptions): Promise<void>;
  /** Run another server script by name. */
  runScript(name: string, event?: Partial<ScriptEvent>): Promise<void>;
  /** Persistent per-script state (saved to the database after every run). */
  state: Record<string, any>;
}

// ───────────────────────────── Page (client) only ─────────────────────────────

export interface UiApi {
  /** Open a graphic page by name, e.g. "Plant/Overview". */
  navigate(display: string, params?: Record<string, string>): void;
  /** Open a faceplate for a tag folder; optionally use a custom faceplate display. */
  openFaceplate(path: string, display?: string): void;
  closeFaceplates(): void;
  /** Open a 3D scene. */
  openScene(scene: string): void;
  toast(message: string, kind?: 'info' | 'success' | 'warning' | 'error'): void;
  confirm(message: string): Promise<boolean>;
  prompt(message: string, defaultValue?: string): Promise<string | null>;
  /** Logged-in user (null for anonymous). */
  readonly user: { username: string; role: string } | null;
}

export interface ElementApi {
  readonly id: string;
  readonly type: string;
  /** Read a design property. */
  get(prop: string): any;
  /** Override a property at runtime, e.g. element.set("fill", "red"). */
  set(prop: string, value: any): void;
}

export interface DisplayApi {
  readonly name: string;
  /** Faceplate / navigation parameters. */
  readonly params: Record<string, string>;
  /** Page-local variables shared by all scripts of the display. */
  vars: Record<string, any>;
  /** Find an element by id or name. */
  element(idOrName: string): ElementApi | undefined;
}

export interface ClientGlobals extends CommonGlobals {
  ui: UiApi;
  display: DisplayApi;
  /** The element that raised the event (undefined for display scripts). */
  element: ElementApi | undefined;
}

/** Global names injected into each script kind (order matters: it is the function parameter order). */
export const SERVER_GLOBALS = ['tags', 'alarms', 'history', 'recipes', 'log', 'http', 'sleep', 'event', 'db', 'mqtt', 'notify', 'runScript', 'state'] as const;
export const CLIENT_GLOBALS = ['tags', 'alarms', 'history', 'recipes', 'log', 'http', 'sleep', 'event', 'ui', 'display', 'element'] as const;
