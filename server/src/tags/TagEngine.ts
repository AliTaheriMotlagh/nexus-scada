import type {
  DataType, DeviceNode, DriverType, ProjectNode, Quality, TagChange, TagInfo, TagNode, TagValue, TreeItem,
} from '../../../shared/types.ts';
import { compileExpression, extractTagRefs, parentPath, resolvePath, type ExpressionFn } from '../../../shared/scriptCompiler.ts';
import { walkNodes } from '../config/validation.ts';
import type { EventBus } from '../core/EventBus.ts';
import { badRequest, notFound } from '../core/errors.ts';
import { createLogger } from '../core/logger.ts';

const log = createLogger('tags');

export interface TagRuntime {
  readonly path: string;
  readonly folder: string;
  def: TagNode;
  readonly dataType: DataType;
  readonly device?: string;
  readonly driver?: DriverType;
  current: TagValue;
  expression?: { fn: ExpressionFn; deps: string[] };
}

export interface DeviceDefinition {
  path: string;
  node: DeviceNode;
  tags: TagRuntime[];
}

export type WriteHandler = (tag: TagRuntime, value: unknown) => Promise<void>;

const DEFAULTS: Record<DataType, unknown> = { number: 0, boolean: false, string: '', json: null };

export function coerce(dataType: DataType, value: unknown): unknown {
  switch (dataType) {
    case 'number': {
      if (typeof value === 'boolean') return value ? 1 : 0;
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean':
      if (typeof value === 'string') return ['true', '1', 'on', 'yes', 'open', 'running'].includes(value.trim().toLowerCase());
      return Boolean(value);
    case 'string':
      return value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    case 'json':
      if (typeof value === 'string') {
        try { return JSON.parse(value); } catch { return value; }
      }
      return value;
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

/**
 * The real-time tag database. Single owner of tag values; everybody else reads through it
 * and observes changes via the `tag:change` bus event (batched per event-loop turn).
 */
export class TagEngine {
  private readonly bus: EventBus;
  private tags = new Map<string, TagRuntime>();
  private dependents = new Map<string, Set<string>>();
  private pending = new Map<string, TagChange>();
  private flushScheduled = false;
  private treeItems: TreeItem[] = [];
  private writeHandler?: WriteHandler;

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  setWriteHandler(handler: WriteHandler): void {
    this.writeHandler = handler;
  }

  /** (Re)build the tag table from the project tree. Values of unchanged tags survive hot reloads. */
  load(nodes: ProjectNode[]): DeviceDefinition[] {
    const previous = this.tags;
    const next = new Map<string, TagRuntime>();
    const devices = new Map<string, DeviceDefinition>();

    walkNodes(nodes, (node, path, device) => {
      if (node.kind === 'device') devices.set(path, { path, node, tags: [] });
      if (node.kind !== 'tag') return;
      const dataType = node.dataType ?? 'number';
      const old = previous.get(path);
      const driven = device !== undefined && device.node.driver !== 'memory';
      // Reuse the runtime object when the addressing is unchanged so running drivers keep valid references.
      const reusable = old && old.dataType === dataType && old.device === device?.path && old.driver === device?.node.driver
        && JSON.stringify(old.def.source) === JSON.stringify(node.source);
      const rt: TagRuntime = reusable ? old : {
        path,
        folder: parentPath(path),
        def: node,
        dataType,
        device: device?.path,
        driver: device?.node.driver,
        current: old && old.dataType === dataType
          ? old.current
          : { value: coerce(dataType, node.initial ?? DEFAULTS[dataType]), quality: driven ? 'uncertain' : 'good', ts: Date.now() },
      };
      rt.def = node;
      rt.expression = undefined;
      if (node.expression) {
        try {
          const deps = extractTagRefs(node.expression).map((p) => resolvePath(rt.folder, p));
          rt.expression = { fn: compileExpression(node.expression), deps };
        } catch (err) {
          log.error(`expression of ${path} does not compile:`, err);
          rt.current = { ...rt.current, quality: 'bad' };
        }
      }
      next.set(path, rt);
      devices.get(device?.path ?? '')?.tags.push(rt);
    });

    this.tags = next;
    this.dependents.clear();
    for (const rt of next.values()) {
      for (const dep of rt.expression?.deps ?? []) {
        if (!this.dependents.has(dep)) this.dependents.set(dep, new Set());
        this.dependents.get(dep)!.add(rt.path);
      }
    }
    this.treeItems = this.buildTree(nodes, '');
    for (const rt of next.values()) if (rt.expression) this.evaluate(rt, 0);
    log.info(`loaded ${next.size} tags, ${devices.size} devices`);
    return [...devices.values()];
  }

  private buildTree(nodes: ProjectNode[], base: string): TreeItem[] {
    return nodes.map((n) => {
      const id = base ? `${base}/${n.name}` : n.name;
      if (n.kind === 'tag') {
        const rt = this.tags.get(id);
        return {
          id, name: n.name, kind: 'tag', description: n.description,
          meta: { dataType: n.dataType ?? 'number', unit: n.unit, writable: rt ? this.isWritable(rt) : false, alarms: n.alarms?.length ?? 0 },
        };
      }
      return {
        id, name: n.name, kind: n.kind, description: n.description,
        meta: n.kind === 'device' ? { driver: n.driver, enabled: n.enabled !== false } : undefined,
        children: this.buildTree(n.children ?? [], id),
      };
    });
  }

  // ── reads ──
  has(path: string): boolean { return this.tags.has(path); }
  runtime(path: string): TagRuntime | undefined { return this.tags.get(path); }
  get(path: string): TagValue | undefined { return this.tags.get(path)?.current; }
  all(): TagRuntime[] { return [...this.tags.values()]; }
  tree(): TreeItem[] { return this.treeItems; }

  list(prefix = ''): string[] {
    const p = prefix.replace(/\/$/, '');
    return [...this.tags.keys()].filter((k) => !p || k === p || k.startsWith(`${p}/`));
  }

  snapshot(paths: Iterable<string>): TagChange[] {
    const out: TagChange[] = [];
    for (const path of paths) {
      const v = this.tags.get(path)?.current;
      if (v) out.push({ path, ...v });
    }
    return out;
  }

  info(path: string): TagInfo {
    const rt = this.tags.get(path);
    if (!rt) throw notFound(`Tag "${path}"`);
    return this.toInfo(rt);
  }

  infos(prefix = ''): TagInfo[] {
    return this.list(prefix).map((p) => this.toInfo(this.tags.get(p)!));
  }

  private toInfo(rt: TagRuntime): TagInfo {
    const d = rt.def;
    return {
      path: rt.path, name: d.name, dataType: rt.dataType, description: d.description, unit: d.unit,
      min: d.min, max: d.max, decimals: d.decimals, writable: this.isWritable(rt), writeRole: d.writeRole,
      device: rt.device, driver: rt.driver, history: !!d.history, alarmCount: d.alarms?.length ?? 0,
      expression: d.expression, states: d.states,
    };
  }

  isWritable(rt: TagRuntime): boolean {
    if (rt.expression) return false;
    return rt.def.writable ?? !rt.device;
  }

  // ── updates ──

  /** Update a value coming from a driver/script. Returns true when a change was published. */
  update(path: string, value: unknown, quality: Quality = 'good', ts = Date.now()): boolean {
    const rt = this.tags.get(path);
    if (!rt) return false;
    return this.apply(rt, value, quality, ts, 0);
  }

  private apply(rt: TagRuntime, raw: unknown, quality: Quality, ts: number, depth: number): boolean {
    const value = coerce(rt.dataType, raw);
    const cur = rt.current;
    if (cur.quality === quality) {
      if (sameValue(cur.value, value)) return false;
      const db = rt.def.deadband;
      if (db && typeof value === 'number' && typeof cur.value === 'number' && Math.abs(value - cur.value) < db) return false;
    }
    rt.current = { value, quality, ts };
    this.pending.set(rt.path, { path: rt.path, value, quality, ts });
    this.scheduleFlush();
    const deps = this.dependents.get(rt.path);
    if (deps && depth < 8) for (const d of deps) this.evaluate(this.tags.get(d)!, depth + 1);
    return true;
  }

  /** Mark every tag of a device with a quality (e.g. bad on disconnect). */
  setQuality(paths: string[], quality: Quality): void {
    const now = Date.now();
    for (const p of paths) {
      const rt = this.tags.get(p);
      if (rt && rt.current.quality !== quality) this.apply(rt, rt.current.value, quality, now, 0);
    }
  }

  private evaluate(rt: TagRuntime, depth: number): void {
    if (!rt?.expression) return;
    try {
      const value = rt.expression.fn(rt.current.value, (p) => this.tags.get(resolvePath(rt.folder, p))?.current.value, {});
      const bad = rt.expression.deps.some((d) => this.tags.get(d)?.current.quality === 'bad');
      this.apply(rt, value, bad ? 'bad' : 'good', Date.now(), depth);
    } catch (err) {
      log.debug(`expression ${rt.path} failed:`, err);
      this.apply(rt, rt.current.value, 'bad', Date.now(), depth);
    }
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    setImmediate(() => {
      this.flushScheduled = false;
      const changes = [...this.pending.values()];
      this.pending.clear();
      if (changes.length) this.bus.emit('tag:change', changes);
    });
  }

  /** Write from a user, script, schedule or API. Device tags are routed to their driver. */
  async write(path: string, value: unknown): Promise<void> {
    const rt = this.tags.get(path);
    if (!rt) throw notFound(`Tag "${path}"`);
    if (!this.isWritable(rt)) throw badRequest(`Tag "${path}" is read-only`);
    const coerced = coerce(rt.dataType, value);
    if (rt.dataType === 'number' && coerced === null) throw badRequest(`"${String(value)}" is not a number`);
    if (typeof coerced === 'number') {
      if (rt.def.min !== undefined && coerced < rt.def.min) throw badRequest(`${path}: ${coerced} is below minimum ${rt.def.min}`);
      if (rt.def.max !== undefined && coerced > rt.def.max) throw badRequest(`${path}: ${coerced} is above maximum ${rt.def.max}`);
    }
    if (rt.device && rt.driver !== 'memory' && this.writeHandler) {
      await this.writeHandler(rt, coerced);
    } else {
      this.apply(rt, coerced, 'good', Date.now(), 0);
    }
  }
}
