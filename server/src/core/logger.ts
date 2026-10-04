import type { LogEntry } from '../../../shared/types.ts';

type Level = LogEntry['level'];
const LEVEL_RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const COLORS: Record<Level, string> = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };

/** In-memory ring buffer of recent log entries (served to the diagnostics page). */
class LogBuffer {
  private readonly entries: LogEntry[] = [];
  private readonly capacity: number;
  constructor(capacity: number) {
    this.capacity = capacity;
  }
  push(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.capacity) this.entries.shift();
  }
  list(limit = 500): LogEntry[] {
    return this.entries.slice(-limit);
  }
}

export const logBuffer = new LogBuffer(2000);
const minLevel: Level = (process.env.LOG_LEVEL as Level) ?? 'info';

export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  child(source: string): Logger;
}

function format(args: unknown[]): string {
  return args
    .map((a) => (a instanceof Error ? a.message : typeof a === 'object' ? JSON.stringify(a) : String(a)))
    .join(' ');
}

export function createLogger(source: string): Logger {
  const write = (level: Level, msg: string, args: unknown[]) => {
    if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return;
    const message = args.length ? `${msg} ${format(args)}` : msg;
    const entry: LogEntry = { ts: Date.now(), level, source, message };
    logBuffer.push(entry);
    const time = new Date(entry.ts).toISOString().slice(11, 23);
    const line = `\x1b[90m${time}\x1b[0m ${COLORS[level]}${level.toUpperCase().padEnd(5)}\x1b[0m \x1b[35m[${source}]\x1b[0m ${message}`;
    (level === 'error' ? console.error : console.log)(line);
  };
  return {
    debug: (m, ...a) => write('debug', m, a),
    info: (m, ...a) => write('info', m, a),
    warn: (m, ...a) => write('warn', m, a),
    error: (m, ...a) => write('error', m, a),
    child: (s) => createLogger(`${source}:${s}`),
  };
}
