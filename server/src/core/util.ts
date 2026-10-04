export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Exponential backoff for reconnecting drivers. */
export class Backoff {
  private attempt = 0;
  private readonly min: number;
  private readonly max: number;
  constructor(min = 1000, max = 30000) {
    this.min = min;
    this.max = max;
  }
  next(): number {
    const delay = Math.min(this.max, this.min * 2 ** this.attempt);
    this.attempt++;
    return delay;
  }
  reset(): void {
    this.attempt = 0;
  }
}

/** Read a dotted / indexed path from a JSON value, e.g. "data.items[0].temp". */
export function getJsonPath(obj: unknown, path: string | undefined): unknown {
  if (!path) return obj;
  let cur: unknown = obj;
  for (const part of path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Replace {{value}} / {{json}} placeholders in a payload template. */
export function renderTemplate(template: string, value: unknown): string {
  return template
    .replaceAll('{{json}}', JSON.stringify(value))
    .replaceAll('{{value}}', typeof value === 'object' ? JSON.stringify(value) : String(value));
}

/** Parse "500ms", "30s", "5m", "2h" into milliseconds. */
export function parseDuration(text: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/.exec(text.trim());
  if (!m) throw new Error(`Invalid duration "${text}"`);
  const n = Number(m[1]);
  const unit = m[2] ?? 'ms';
  return n * { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit as 'ms'];
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
