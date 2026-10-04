import type { DeviceState, Quality } from '../../../shared/types.ts';
import type { Database } from '../core/Database.ts';
import type { Logger } from '../core/logger.ts';
import type { DeviceDefinition, TagRuntime } from '../tags/TagEngine.ts';

/** What a driver may do with the runtime. Drivers never touch the TagEngine directly. */
export interface DriverContext {
  readonly device: DeviceDefinition;
  readonly settings: Record<string, unknown>;
  readonly log: Logger;
  readonly db: Database;
  update(path: string, value: unknown, quality?: Quality): void;
  /** Set the quality of every tag of the device (e.g. bad on connection loss). */
  setQuality(quality: Quality): void;
  status(state: DeviceState, message?: string): void;
  countRead(n?: number): void;
  countWrite(): void;
  countError(): void;
}

/** Strategy interface implemented by every protocol driver. */
export interface Driver {
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
  write?(tag: TagRuntime, value: unknown): Promise<void>;
  publish?(topic: string, payload: unknown, options?: { retain?: boolean; qos?: 0 | 1 | 2 }): Promise<void>;
}

export type DriverFactory = (ctx: DriverContext) => Driver;

// ── settings helpers ──
export const num = (v: unknown, def: number): number => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? def : Number(v));
export const str = (v: unknown, def = ''): string => (v === undefined || v === null ? def : String(v));
export const bool = (v: unknown, def = false): boolean => (v === undefined ? def : v === true || v === 'true');
export const src = (tag: TagRuntime): Record<string, unknown> => tag.def.source ?? {};
