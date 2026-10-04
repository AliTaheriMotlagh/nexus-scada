/**
 * Shared domain model for Nexus SCADA.
 * Used by both the server (Node, type-stripped) and the client (Vite).
 * Only erasable TypeScript syntax is allowed here (no enums / namespaces).
 */

// ───────────────────────────── Tags ─────────────────────────────

export type Quality = 'good' | 'bad' | 'uncertain';
export type DataType = 'number' | 'boolean' | 'string' | 'json';

export interface TagValue {
  value: unknown;
  quality: Quality;
  /** Unix epoch milliseconds */
  ts: number;
}

export interface TagChange extends TagValue {
  path: string;
}

export interface TagInfo {
  path: string;
  name: string;
  dataType: DataType;
  description?: string;
  unit?: string;
  min?: number;
  max?: number;
  decimals?: number;
  writable: boolean;
  writeRole?: Role;
  device?: string;
  driver?: DriverType;
  history: boolean;
  alarmCount: number;
  expression?: string;
  states?: Record<string, string>;
}

// ───────────────────────────── Project tree (YAML) ─────────────────────────────

export type DriverType = 'simulation' | 'memory' | 'modbus-tcp' | 'mqtt' | 'rest' | 'sql';
export const DRIVER_TYPES: DriverType[] = ['simulation', 'memory', 'modbus-tcp', 'mqtt', 'rest', 'sql'];

export interface FolderNode {
  kind: 'folder';
  name: string;
  description?: string;
  children?: ProjectNode[];
}

export interface DeviceNode {
  kind: 'device';
  name: string;
  driver: DriverType;
  enabled?: boolean;
  description?: string;
  settings?: Record<string, unknown>;
  children?: ProjectNode[];
}

export interface HistoryConfig {
  /** Minimum change before a new sample is stored */
  deadband?: number;
  /** Force a sample at least every N seconds */
  interval?: number;
}

export interface TagNode {
  kind: 'tag';
  name: string;
  dataType?: DataType;
  description?: string;
  unit?: string;
  min?: number;
  max?: number;
  decimals?: number;
  writable?: boolean;
  writeRole?: Role;
  initial?: unknown;
  /** Driver specific address / generator definition */
  source?: Record<string, unknown>;
  /** Calculated tag, TypeScript expression, e.g. `tag('../Level') * 2` */
  expression?: string;
  /** Publish deadband (numbers) */
  deadband?: number;
  history?: boolean | HistoryConfig;
  alarms?: AlarmDef[];
  /** Text for discrete values, e.g. { "0": "Stopped", "1": "Running" } */
  states?: Record<string, string>;
}

export type ProjectNode = FolderNode | DeviceNode | TagNode;

// ───────────────────────────── Alarms ─────────────────────────────

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
export const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

export type AlarmKind = 'hihi' | 'hi' | 'lo' | 'lolo' | 'on' | 'off' | 'equals' | 'quality';
export const ALARM_KINDS: AlarmKind[] = ['hihi', 'hi', 'lo', 'lolo', 'on', 'off', 'equals', 'quality'];

export interface AlarmDef {
  kind: AlarmKind;
  limit?: number | string | boolean;
  severity?: Severity;
  /** Supports placeholders: {name} {path} {value} {limit} {unit} */
  message?: string;
  deadband?: number;
  /** Seconds the condition must persist before the alarm becomes active */
  delay?: number;
  enabled?: boolean;
  /** When false, the alarm leaves the list as soon as it clears */
  ackRequired?: boolean;
}

export type AlarmState = 'active-unacked' | 'active-acked' | 'cleared-unacked';

export interface AlarmInfo {
  id: string;
  tag: string;
  area: string;
  kind: AlarmKind;
  severity: Severity;
  message: string;
  state: AlarmState;
  value: unknown;
  limit?: unknown;
  activeAt: number;
  clearedAt?: number;
  ackAt?: number;
  ackBy?: string;
  comment?: string;
  shelvedUntil?: number;
}

export type AlarmEventType = 'active' | 'cleared' | 'ack' | 'shelve' | 'unshelve';

export interface AlarmEvent {
  id?: number;
  alarmId: string;
  tag: string;
  event: AlarmEventType;
  severity: Severity;
  message: string;
  value: unknown;
  user?: string;
  comment?: string;
  ts: number;
}

// ───────────────────────────── Devices ─────────────────────────────

export type DeviceState = 'stopped' | 'connecting' | 'connected' | 'error' | 'disabled';

export interface DeviceStatus {
  path: string;
  name: string;
  driver: DriverType;
  enabled: boolean;
  state: DeviceState;
  message?: string;
  tagCount: number;
  reads: number;
  writes: number;
  errors: number;
  lastUpdate?: number;
}

// ───────────────────────────── Security ─────────────────────────────

export type Role = 'viewer' | 'operator' | 'engineer' | 'admin';
export const ROLE_RANK: Record<Role, number> = { viewer: 0, operator: 1, engineer: 2, admin: 3 };

export interface UserConfig {
  username: string;
  fullName?: string;
  role: Role;
  /** Plain text password (demo only) */
  password?: string;
  /** scrypt hash produced by `npm run hash-password -w server` */
  passwordHash?: string;
}

export interface SessionUser {
  username: string;
  fullName?: string;
  role: Role;
}

// ───────────────────────────── Scripts & automation ─────────────────────────────

export type ScriptTrigger =
  | { type: 'startup' }
  | { type: 'interval'; ms: number }
  | { type: 'tagChange'; tags: string[] }
  | { type: 'cron'; cron: string }
  | { type: 'alarm'; minSeverity?: Severity }
  | { type: 'manual' };

export interface ScriptConfig {
  name: string;
  file: string;
  description?: string;
  enabled?: boolean;
  triggers?: ScriptTrigger[];
}

export interface ScriptStatus {
  name: string;
  file: string;
  description?: string;
  enabled: boolean;
  triggers: ScriptTrigger[];
  runs: number;
  errors: number;
  running: boolean;
  lastRun?: number;
  lastDurationMs?: number;
  lastError?: string;
}

export interface ScriptLogEntry {
  ts: number;
  script: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export type ScheduleAction =
  | { write: string; value: unknown }
  | { script: string };

export interface ScheduleConfig {
  name: string;
  /** 5-field cron, `@hourly`, `@daily`, `@every 30s`, `@sunrise+15m`, `@sunset-30m` */
  cron: string;
  enabled?: boolean;
  description?: string;
  actions: ScheduleAction[];
}

export interface RecipeConfig {
  name: string;
  description?: string;
  tags: string[];
  sets: Record<string, Record<string, unknown>>;
}

export type NotificationType = 'webhook' | 'ntfy' | 'telegram' | 'slack' | 'discord';

export interface NotificationChannel {
  name: string;
  type: NotificationType;
  url?: string;
  token?: string;
  chatId?: string;
  minSeverity?: Severity;
  enabled?: boolean;
}

// ───────────────────────────── Map ─────────────────────────────

export interface MapMarker {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Tag folder whose alarms colour the marker */
  path?: string;
  /** Tags shown in the popup */
  tags?: string[];
  /** Display opened from the popup */
  display?: string;
  icon?: 'site' | 'home' | 'pump' | 'tank' | 'sensor' | 'factory';
}

export interface MapConfig {
  center: [number, number];
  zoom: number;
  tileUrl?: string;
  attribution?: string;
  markers: MapMarker[];
}

// ───────────────────────────── Project root ─────────────────────────────

export interface ServerConfig {
  port?: number;
  /** Anonymous users get this role; omit to require login */
  anonymousRole?: Role;
  tokenSecret?: string;
  tokenTtlHours?: number;
  historianRetentionDays?: number;
}

export interface ProjectConfig {
  project: { name: string; description?: string; version?: string };
  server?: ServerConfig;
  location?: { lat: number; lng: number };
  startDisplay?: string;
  users?: UserConfig[];
  nodes: ProjectNode[];
  scripts?: ScriptConfig[];
  schedules?: ScheduleConfig[];
  recipes?: RecipeConfig[];
  notifications?: NotificationChannel[];
  map?: MapConfig;
}

// ───────────────────────────── Graphics (displays) ─────────────────────────────

export interface Binding {
  /** Tag path; may contain `{$param}` placeholders */
  tag?: string;
  /** TypeScript expression; `value` = tag value, `tag(path)` reads any tag, `params` = display params */
  expr?: string;
  /** First matching rule wins. `when` examples: ">80", "<=20", "==true", "Running", "default" */
  map?: { when: string; value: unknown }[];
}

export interface ElementEvents {
  click?: string;
  dblclick?: string;
  mousedown?: string;
  mouseup?: string;
  change?: string;
}

export interface ElementDoc {
  id: string;
  type: string;
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  opacity?: number;
  visible?: boolean;
  locked?: boolean;
  props: Record<string, unknown>;
  bindings?: Record<string, Binding>;
  events?: ElementEvents;
  /** Faceplate opened when the element is clicked in runtime */
  faceplate?: { path: string; display?: string };
  /** Tooltip shown in runtime */
  tooltip?: string;
  /** Minimum role to interact */
  role?: Role;
  children?: ElementDoc[];
}

export interface DisplayScripts {
  onOpen?: string;
  onClose?: string;
  onTimer?: string;
  timerMs?: number;
}

export interface DisplayDoc {
  name: string;
  title?: string;
  kind?: 'page' | 'faceplate' | 'popup';
  width: number;
  height: number;
  background?: string;
  backgroundImage?: string;
  grid?: number;
  /** Parameter names for faceplate templates; referenced as `{$name}` in bindings */
  params?: string[];
  scripts?: DisplayScripts;
  elements: ElementDoc[];
}

// ───────────────────────────── 3D scenes ─────────────────────────────

export type Vec3 = [number, number, number];

export type SceneObjectType =
  | 'box' | 'cylinder' | 'sphere' | 'plane' | 'cone' | 'torus'
  | 'tank' | 'pump' | 'pipe' | 'valve' | 'motor' | 'fan' | 'conveyor'
  | 'house' | 'lamp' | 'label' | 'model' | 'pointLight';

export interface SceneObject {
  id: string;
  type: SceneObjectType;
  name?: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  props: Record<string, unknown>;
  bindings?: Record<string, Binding>;
  events?: { click?: string };
  faceplate?: { path: string; display?: string };
}

export interface SceneDoc {
  name: string;
  title?: string;
  background?: string;
  environment?: 'city' | 'warehouse' | 'sunset' | 'dawn' | 'night' | 'studio' | 'park' | 'none';
  grid?: boolean;
  shadows?: boolean;
  camera?: { position: Vec3; target: Vec3; fov?: number };
  objects: SceneObject[];
}

// ───────────────────────────── API helpers ─────────────────────────────

export interface TreeItem {
  /** Unique id, usually the full path */
  id: string;
  name: string;
  kind: string;
  description?: string;
  children?: TreeItem[];
  meta?: Record<string, unknown>;
}

export interface HistoryPoint { ts: number; value: number | null; min?: number; max?: number }
export interface HistorySeries { path: string; points: HistoryPoint[] }

export interface AuditEntry {
  id: number;
  ts: number;
  user: string;
  action: string;
  target?: string;
  details?: string;
}

export interface LogEntry {
  ts: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string;
  message: string;
}

export interface ProjectInfo {
  name: string;
  description?: string;
  version?: string;
  startDisplay?: string;
  revision: number;
  serverTime: number;
  uptimeSec: number;
  anonymousRole?: Role;
  location?: { lat: number; lng: number };
  /** Public demo: engineering changes (code, config, graphics) are rejected by the server */
  demo?: boolean;
}
