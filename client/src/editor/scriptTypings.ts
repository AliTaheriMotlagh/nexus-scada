import apiSource from '@shared/script-api.ts?raw';
import { CLIENT_GLOBALS, SERVER_GLOBALS } from '@shared/script-api.ts';

export type ScriptKind = 'server' | 'client';

/**
 * Turn the shared API module into a global declaration file for Monaco:
 * strip `export`, drop runtime constants and the placeholder TagPath (generated separately).
 */
const apiLib = apiSource
  .split('\n')
  .filter((line) => !line.startsWith('export const ') && !line.includes('@generated-tagpath'))
  .map((line) => line.replace(/^export /, ''))
  .join('\n');

/** Minimal host globals (the DOM lib is excluded so `history`/`event` don't clash). */
const hostLib = `
declare const console: { log(...a: any[]): void; info(...a: any[]): void; warn(...a: any[]): void; error(...a: any[]): void };
declare function setTimeout(fn: () => void, ms?: number): any;
declare function setInterval(fn: () => void, ms?: number): any;
declare function clearTimeout(handle: any): void;
declare function clearInterval(handle: any): void;
declare function fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: any }): Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }>;
declare function structuredClone<T>(value: T): T;
declare class URL { constructor(url: string, base?: string); href: string; searchParams: { get(k: string): string | null }; }
`;

function globalsLib(kind: ScriptKind): string {
  const names = kind === 'server' ? SERVER_GLOBALS : CLIENT_GLOBALS;
  const iface = kind === 'server' ? 'ServerGlobals' : 'ClientGlobals';
  const header = kind === 'server'
    ? '/** Server script: runs in the runtime (triggers: startup, interval, tagChange, cron, alarm, manual). */'
    : '/** Page script: runs in the browser for a display or element event. */';
  return `${header}\n${names.map((n) => `declare const ${n}: ${iface}['${n}'];`).join('\n')}\n`;
}

export function tagPathLib(paths: string[]): string {
  const union = paths.length ? paths.map((p) => JSON.stringify(p)).join(' | ') + ' | (string & {})' : 'string';
  return `/** All tag paths of the project (autocomplete). */\ntype TagPath = ${union};\n`;
}

export function scriptLibs(kind: ScriptKind, paths: string[]): { content: string; filePath: string }[] {
  return [
    { content: apiLib, filePath: 'file:///nexus/script-api.d.ts' },
    { content: hostLib, filePath: 'file:///nexus/host.d.ts' },
    { content: globalsLib(kind), filePath: `file:///nexus/${kind}-globals.d.ts` },
    { content: tagPathLib(paths), filePath: 'file:///nexus/tags.d.ts' },
  ];
}
