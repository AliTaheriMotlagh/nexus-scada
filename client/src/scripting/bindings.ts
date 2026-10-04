import { applyParams, compileExpression, extractTagRefs, matchRule } from '@shared/scriptCompiler.ts';
import type { Binding, ElementDoc, Quality, TagValue } from '@shared/types.ts';

export type Getter = (path: string) => TagValue | undefined;

/** Every tag an element's bindings depend on (after faceplate parameter substitution). */
export function bindingTagRefs(el: ElementDoc, params?: Record<string, string>): string[] {
  const out = new Set<string>();
  for (const b of Object.values(el.bindings ?? {})) {
    if (b.tag) out.add(applyParams(b.tag, params));
    if (b.expr) for (const r of extractTagRefs(b.expr)) out.add(applyParams(r, params));
  }
  for (const child of el.children ?? []) for (const r of bindingTagRefs(child, params)) out.add(r);
  return [...out];
}

export function evaluateBinding(b: Binding, get: Getter, params?: Record<string, string>, fallback?: unknown): { value: unknown; quality: Quality | undefined } {
  const tag = b.tag ? applyParams(b.tag, params) : undefined;
  const tv = tag ? get(tag) : undefined;
  let value: unknown = tv?.value;
  let quality: Quality | undefined = tag ? tv?.quality ?? 'uncertain' : undefined;
  if (b.expr) {
    try {
      value = compileExpression(applyParams(b.expr, params))(value, (p) => get(applyParams(p, params))?.value, params ?? {});
    } catch {
      value = undefined;
      quality = 'bad';
    }
  }
  if (b.map?.length) {
    const rule = b.map.find((r) => matchRule(r.when, value));
    value = rule ? rule.value : fallback;
  }
  return { value, quality };
}

const QUALITY_RANK: Record<Quality, number> = { good: 0, uncertain: 1, bad: 2 };

/**
 * Resolve the effective props of an element: design props, `{$param}` substitution,
 * runtime overrides from scripts, then live bindings. `__quality` carries the worst bound quality.
 */
export function resolveProps(
  el: ElementDoc,
  get: Getter | undefined,
  params?: Record<string, string>,
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(el.props ?? {})) props[k] = typeof v === 'string' ? applyParams(v, params) : v;
  if (overrides) Object.assign(props, overrides);
  if (!get || !el.bindings) return props;
  let worst: Quality | undefined;
  for (const [prop, b] of Object.entries(el.bindings)) {
    if (!b || (!b.tag && !b.expr)) continue;
    const { value, quality } = evaluateBinding(b, get, params, props[prop]);
    if (value !== undefined) props[prop] = value;
    if (quality && (!worst || QUALITY_RANK[quality] > QUALITY_RANK[worst])) worst = quality;
  }
  if (worst) props.__quality = worst;
  return props;
}
