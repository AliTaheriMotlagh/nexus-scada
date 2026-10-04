import type {
  AlarmEvent, AlarmInfo, DeviceStatus, ScriptLogEntry, TagChange,
} from '../../../shared/types.ts';
import { createLogger } from './logger.ts';

/** All runtime events. Components communicate through the bus (observer pattern) instead of direct references. */
export interface RuntimeEvents {
  'tag:change': TagChange[];
  'alarm:list': AlarmInfo[];
  'alarm:event': AlarmEvent;
  'device:status': DeviceStatus;
  'script:log': ScriptLogEntry;
  'project:reloaded': { revision: number };
}

type Listener<T> = (payload: T) => void;
const log = createLogger('bus');

export class EventBus<Events extends object = RuntimeEvents> {
  private readonly listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => set.delete(listener as Listener<never>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      try {
        (listener as Listener<Events[K]>)(payload);
      } catch (err) {
        log.error(`listener for "${String(event)}" failed:`, err);
      }
    }
  }
}
