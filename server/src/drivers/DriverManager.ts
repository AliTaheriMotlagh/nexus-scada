import type { DeviceStatus, DriverType } from '../../../shared/types.ts';
import type { Database } from '../core/Database.ts';
import type { EventBus } from '../core/EventBus.ts';
import { badRequest, notFound } from '../core/errors.ts';
import { createLogger } from '../core/logger.ts';
import { errorMessage } from '../core/util.ts';
import type { DeviceDefinition, TagEngine, TagRuntime } from '../tags/TagEngine.ts';
import type { Driver, DriverContext, DriverFactory } from './Driver.ts';
import { createModbusTcpDriver } from './ModbusTcpDriver.ts';
import { createMqttDriver } from './MqttDriver.ts';
import { createRestDriver, createSqlDriver } from './RestDriver.ts';
import { createMemoryDriver, createSimulationDriver } from './SimulationDriver.ts';

const log = createLogger('drivers');

/** Factory registry — add a protocol by registering one function. */
export const DRIVER_REGISTRY: Record<DriverType, DriverFactory> = {
  simulation: createSimulationDriver,
  memory: createMemoryDriver,
  'modbus-tcp': createModbusTcpDriver,
  mqtt: createMqttDriver,
  rest: createRestDriver,
  sql: createSqlDriver,
};

interface Running {
  def: DeviceDefinition;
  fingerprint: string;
  driver?: Driver;
  status: DeviceStatus;
  /** Runtime override from the UI (not persisted) */
  enabledOverride?: boolean;
}

const fingerprint = (def: DeviceDefinition) =>
  JSON.stringify({ ...def.node, children: undefined, tags: def.tags.map((t) => [t.path, t.dataType, t.def.source]) });

export class DriverManager {
  private readonly tags: TagEngine;
  private readonly bus: EventBus;
  private readonly db: Database;
  private devices = new Map<string, Running>();

  constructor(tags: TagEngine, bus: EventBus, db: Database) {
    this.tags = tags;
    this.bus = bus;
    this.db = db;
    tags.setWriteHandler((tag, value) => this.write(tag, value));
  }

  /** Apply a new set of devices. Unchanged devices keep running (no bump on hot reload). */
  async load(defs: DeviceDefinition[]): Promise<void> {
    const next = new Map(defs.map((d) => [d.path, d]));
    for (const [path, running] of this.devices) {
      const def = next.get(path);
      if (!def || fingerprint(def) !== running.fingerprint) {
        await this.stopDevice(running);
        this.devices.delete(path);
      } else {
        running.def = def; // tag runtimes were rebuilt; keep driver
      }
    }
    for (const def of defs) {
      if (this.devices.has(def.path)) continue;
      const running: Running = {
        def,
        fingerprint: fingerprint(def),
        status: {
          path: def.path, name: def.node.name, driver: def.node.driver, enabled: def.node.enabled !== false,
          state: 'stopped', tagCount: def.tags.length, reads: 0, writes: 0, errors: 0,
        },
      };
      this.devices.set(def.path, running);
      await this.startDevice(running);
    }
  }

  private isEnabled(r: Running): boolean {
    return r.enabledOverride ?? r.def.node.enabled !== false;
  }

  private context(r: Running): DriverContext {
    const paths = r.def.tags.map((t) => t.path);
    const emit = () => this.bus.emit('device:status', { ...r.status });
    let lastEmit = 0;
    const touch = () => {
      r.status.lastUpdate = Date.now();
      if (r.status.lastUpdate - lastEmit > 2000) {
        lastEmit = r.status.lastUpdate;
        emit();
      }
    };
    return {
      device: r.def,
      settings: r.def.node.settings ?? {},
      log: log.child(r.def.path),
      db: this.db,
      update: (path, value, quality = 'good') => { this.tags.update(path, value, quality); },
      setQuality: (q) => this.tags.setQuality(paths, q),
      status: (state, message) => {
        if (r.status.state === state && r.status.message === message) return;
        r.status.state = state;
        r.status.message = message;
        if (state === 'error') log.warn(`${r.def.path}: ${message ?? 'error'}`);
        emit();
      },
      countRead: (n = 1) => { r.status.reads += n; touch(); },
      countWrite: () => { r.status.writes++; touch(); },
      countError: () => { r.status.errors++; touch(); },
    };
  }

  private async startDevice(r: Running): Promise<void> {
    r.status.enabled = this.isEnabled(r);
    r.status.tagCount = r.def.tags.length;
    if (!r.status.enabled) {
      this.tags.setQuality(r.def.tags.map((t) => t.path), 'bad');
      r.status.state = 'disabled';
      r.status.message = 'disabled';
      this.bus.emit('device:status', { ...r.status });
      return;
    }
    const factory = DRIVER_REGISTRY[r.def.node.driver];
    try {
      r.driver = factory(this.context(r));
      await r.driver.start();
    } catch (err) {
      r.status.state = 'error';
      r.status.message = errorMessage(err);
      log.error(`${r.def.path} failed to start:`, err);
      this.bus.emit('device:status', { ...r.status });
    }
  }

  private async stopDevice(r: Running): Promise<void> {
    try {
      await r.driver?.stop();
    } catch (err) {
      log.warn(`${r.def.path} stop failed:`, err);
    }
    r.driver = undefined;
    r.status.state = 'stopped';
  }

  async write(tag: TagRuntime, value: unknown): Promise<void> {
    const r = tag.device ? this.devices.get(tag.device) : undefined;
    if (!r) throw notFound(`Device of ${tag.path}`);
    if (!r.driver || !this.isEnabled(r)) throw badRequest(`Device ${r.def.path} is disabled`);
    if (!r.driver.write) throw badRequest(`Driver ${r.def.node.driver} does not support writes`);
    try {
      await r.driver.write(tag, value);
    } catch (err) {
      r.status.errors++;
      throw badRequest(`Write to ${tag.path} failed: ${errorMessage(err)}`);
    }
  }

  async publish(devicePath: string, topic: string, payload: unknown, options?: { retain?: boolean; qos?: 0 | 1 | 2 }): Promise<void> {
    const r = this.devices.get(devicePath);
    if (!r?.driver?.publish) throw badRequest(`${devicePath} is not a connected MQTT device`);
    await r.driver.publish(topic, payload, options);
  }

  async setEnabled(path: string, enabled: boolean): Promise<void> {
    const r = this.devices.get(path);
    if (!r) throw notFound(`Device "${path}"`);
    r.enabledOverride = enabled;
    await this.stopDevice(r);
    await this.startDevice(r);
  }

  async restart(path: string): Promise<void> {
    const r = this.devices.get(path);
    if (!r) throw notFound(`Device "${path}"`);
    await this.stopDevice(r);
    await this.startDevice(r);
  }

  statuses(): DeviceStatus[] {
    return [...this.devices.values()].map((r) => ({ ...r.status }));
  }

  async stopAll(): Promise<void> {
    for (const r of this.devices.values()) await this.stopDevice(r);
  }
}
