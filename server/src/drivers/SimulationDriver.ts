import type { TagRuntime } from '../tags/TagEngine.ts';
import { num, src, str, type Driver, type DriverContext } from './Driver.ts';

/**
 * Signal generator for commissioning, training and demos.
 * source: { fn: sine|cosine|ramp|triangle|square|random|randomWalk|counter|toggle|clock|static,
 *           min, max, period (s), phase (rad), step, noise }
 */
export function createSimulationDriver(ctx: DriverContext): Driver {
  const intervalMs = num(ctx.settings.intervalMs, 500);
  const state = new Map<string, unknown>();
  let timer: NodeJS.Timeout | undefined;

  const compute = (tag: TagRuntime, now: number): unknown => {
    const s = src(tag);
    const fn = str(s.fn, 'static');
    const min = num(s.min, tag.def.min ?? 0);
    const max = num(s.max, tag.def.max ?? 100);
    const period = Math.max(0.1, num(s.period, 60)) * 1000;
    const span = max - min;
    const phase = num(s.phase, 0);
    const prev = state.has(tag.path) ? state.get(tag.path) : tag.current.value;
    let v: unknown;
    switch (fn) {
      case 'sine': v = min + span * (0.5 + 0.5 * Math.sin((2 * Math.PI * now) / period + phase)); break;
      case 'cosine': v = min + span * (0.5 + 0.5 * Math.cos((2 * Math.PI * now) / period + phase)); break;
      case 'ramp': v = min + span * ((now % period) / period); break;
      case 'triangle': {
        const x = (now % period) / period;
        v = min + span * (x < 0.5 ? x * 2 : 2 - x * 2);
        break;
      }
      case 'square': v = now % period < period / 2 ? max : min; break;
      case 'toggle': v = now % period < period / 2; break;
      case 'random': v = min + Math.random() * span; break;
      case 'randomWalk': {
        const step = num(s.step, span / 50);
        const p = typeof prev === 'number' ? prev : min + span / 2;
        v = Math.min(max, Math.max(min, p + (Math.random() - 0.5) * 2 * step));
        break;
      }
      case 'counter': {
        const step = num(s.step, 1);
        const p = typeof prev === 'number' ? prev : min;
        v = p + step > max ? min : p + step;
        break;
      }
      case 'clock': v = new Date(now).toLocaleTimeString(); break;
      default: return undefined; // static: value only changes on write
    }
    const noise = num(s.noise, 0);
    if (noise && typeof v === 'number') v += (Math.random() - 0.5) * 2 * noise;
    if (tag.dataType === 'boolean' && typeof v === 'number') v = v > min + span / 2;
    state.set(tag.path, v);
    return v;
  };

  const tick = () => {
    const now = Date.now();
    let n = 0;
    for (const tag of ctx.device.tags) {
      if (tag.expression) continue; // calculated by the tag engine
      const v = compute(tag, now);
      if (v !== undefined) {
        ctx.update(tag.path, v);
        n++;
      } else if (tag.current.quality !== 'good') {
        ctx.update(tag.path, tag.current.value);
      }
    }
    ctx.countRead(n);
  };

  return {
    start() {
      ctx.status('connected', `simulating every ${intervalMs} ms`);
      tick();
      timer = setInterval(tick, intervalMs);
    },
    stop() {
      clearInterval(timer);
    },
    async write(tag, value) {
      state.set(tag.path, value);
      ctx.update(tag.path, value);
      ctx.countWrite();
    },
  };
}

/** Memory device: values live only in the runtime (still grouped as a device in the tree). */
export function createMemoryDriver(ctx: DriverContext): Driver {
  return {
    start() {
      ctx.setQuality('good');
      ctx.status('connected', 'in-memory');
    },
    stop() {},
  };
}
