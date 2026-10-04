/**
 * One compiler for every script in the system (server scripts, page/element scripts,
 * binding expressions, calculated tags). TypeScript → JavaScript via sucrase, which is
 * small and runs both in Node and in the browser.
 */
import { transform } from 'sucrase';

export class ScriptCompileError extends Error {
  readonly line?: number;
  constructor(message: string, line?: number) {
    super(message);
    this.name = 'ScriptCompileError';
    this.line = line;
  }
}

/** Number of lines added before user code by `compileScript` (for error line mapping). */
export const SCRIPT_LINE_OFFSET = 1;

function stripTypes(source: string): string {
  try {
    return transform(source, { transforms: ['typescript'], disableESTransforms: true }).code;
  } catch (err) {
    const e = err as Error & { loc?: { line: number } };
    const line = e.loc?.line !== undefined ? Math.max(1, e.loc.line - SCRIPT_LINE_OFFSET) : undefined;
    throw new ScriptCompileError(e.message.replace(/\(\d+:\d+\)$/, '').trim(), line);
  }
}

/**
 * Compile a script body into the source of `async function __script__(<globals>) { ... }`.
 * The returned source declares the function; evaluate it and call `__script__`.
 */
export function compileScript(code: string, globals: readonly string[]): string {
  return stripTypes(`async function __script__(${globals.join(', ')}) {\n${code}\n}`);
}

/** Build a callable async function from script source (browser and Node without vm). */
export function buildScriptFunction(code: string, globals: readonly string[]): (...args: unknown[]) => Promise<unknown> {
  const js = compileScript(code, globals);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`${js}\nreturn __script__;`)() as (...args: unknown[]) => Promise<unknown>;
}

export type ExpressionFn = (value: unknown, tag: (path: string) => unknown, params: Record<string, string>) => unknown;

const expressionCache = new Map<string, ExpressionFn>();

/** Compile a TypeScript expression. Cached by source text. */
export function compileExpression(expr: string): ExpressionFn {
  const cached = expressionCache.get(expr);
  if (cached) return cached;
  const js = stripTypes(`function __expr__(value, tag, params) {\nreturn (${expr});\n}`);
  const fn = new Function(`${js}\nreturn __expr__;`)() as ExpressionFn;
  expressionCache.set(expr, fn);
  return fn;
}

const TAG_REF = /\btag\(\s*(['"`])([^'"`]+)\1\s*\)/g;
const TAGS_REF = /\btags\.(?:get|read|toggle|write)\(\s*(['"`])([^'"`]+)\1/g;

/** Static tag references inside an expression or script (`tag("x")`, `tags.get("x")`). */
export function extractTagRefs(code: string): string[] {
  const out = new Set<string>();
  for (const m of code.matchAll(TAG_REF)) out.add(m[2]);
  for (const m of code.matchAll(TAGS_REF)) out.add(m[2]);
  return [...out];
}

// ───────────────────────────── Paths ─────────────────────────────

export function joinPath(...parts: (string | undefined)[]): string {
  return parts.filter((p) => p !== undefined && p !== '').join('/');
}

export function parentPath(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function leafName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

/** Resolve `./x`, `../x` relative to a base folder; absolute paths are returned unchanged. */
export function resolvePath(baseFolder: string, path: string): string {
  if (!path.startsWith('./') && !path.startsWith('../')) return path;
  const stack = baseFolder ? baseFolder.split('/') : [];
  for (const seg of path.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') stack.pop();
    else stack.push(seg);
  }
  return stack.join('/');
}

/** Replace `{$param}` placeholders (faceplate templates). */
export function applyParams(text: string, params: Record<string, string> | undefined): string {
  if (!params || !text.includes('{$')) return text;
  return text.replace(/\{\$([A-Za-z0-9_]+)\}/g, (all, key: string) => (key in params ? params[key] : all));
}

/** `Plant/*` matches every path below Plant; exact paths match themselves; `*` matches all. */
export function pathMatches(pattern: string, path: string): boolean {
  if (pattern === '*' || pattern === path) return true;
  if (pattern.endsWith('/*')) return path.startsWith(pattern.slice(0, -1));
  return false;
}

// ───────────────────────────── Value mapping rules ─────────────────────────────

/**
 * Evaluate a binding rule condition, e.g. ">80", "<= 20", "==true", "!=0", "10..20", "Running", "default".
 */
export function matchRule(when: string, value: unknown): boolean {
  const w = String(when).trim();
  if (w === 'default' || w === '*' || w === 'else') return true;
  const range = /^(-?[\d.]+)\s*\.\.\s*(-?[\d.]+)$/.exec(w);
  if (range) {
    const n = Number(value);
    return n >= Number(range[1]) && n <= Number(range[2]);
  }
  const op = /^(>=|<=|==|!=|>|<)\s*(.+)$/.exec(w);
  if (op) {
    const rhsRaw = op[2].trim();
    if (op[1] === '==' || op[1] === '!=') {
      const eq = looseEquals(value, rhsRaw);
      return op[1] === '==' ? eq : !eq;
    }
    const a = Number(value);
    const b = Number(rhsRaw);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    switch (op[1]) {
      case '>': return a > b;
      case '<': return a < b;
      case '>=': return a >= b;
      case '<=': return a <= b;
    }
  }
  return looseEquals(value, w);
}

function looseEquals(value: unknown, text: string): boolean {
  if (text === 'true') return value === true || value === 1 || value === 'true';
  if (text === 'false') return value === false || value === 0 || value === 'false' || value === null || value === undefined;
  if (typeof value === 'number' && text !== '' && !Number.isNaN(Number(text))) return value === Number(text);
  return String(value) === text;
}
