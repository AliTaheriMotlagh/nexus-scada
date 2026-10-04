import { useId, type FC } from 'react';
import type { ElementDoc } from '@shared/types.ts';

export type PropType =
  | 'number' | 'string' | 'text' | 'color' | 'boolean' | 'select'
  | 'tag' | 'tags' | 'display' | 'scene' | 'url';

export interface PropDef {
  name: string;
  label?: string;
  type: PropType;
  default?: unknown;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  group?: 'Appearance' | 'Data' | 'Behavior';
  /** Can be animated through a tag binding (default true) */
  bindable?: boolean;
  help?: string;
}

/** Props passed to every element renderer. */
export interface RenderContext {
  el: ElementDoc;
  /** Effective props: design props + parameters + script overrides + live bindings */
  props: Record<string, any>;
  runtime: boolean;
  params?: Record<string, string>;
  /** Raise an element event (runs its script) */
  fire(event: string, extra?: Record<string, unknown>): void;
}

export const CATEGORIES = ['Shapes', 'Process', '3D Shapes', 'Home & IoT', 'Controls', 'Indicators', 'Widgets'] as const;
export type Category = (typeof CATEGORIES)[number];

export interface ElementMeta {
  type: string;
  label: string;
  category: Category;
  /** Default size */
  w: number;
  h: number;
  props: PropDef[];
  /** Main animated property — a tag dropped on the element binds here */
  primary?: string;
  /** Element handles its own pointer input (controls) */
  interactive?: boolean;
  Component: FC<RenderContext>;
}

/** Properties every element supports through bindings (geometry & visibility animation). */
export const COMMON_BINDABLE: PropDef[] = [
  { name: 'visible', type: 'boolean', label: 'Visible' },
  { name: 'blink', type: 'boolean', label: 'Blink' },
  { name: 'opacity', type: 'number', label: 'Opacity', min: 0, max: 1, step: 0.05 },
  { name: 'rotation', type: 'number', label: 'Rotation' },
  { name: 'x', type: 'number', label: 'X (move)' },
  { name: 'y', type: 'number', label: 'Y (move)' },
];

const registry = new Map<string, ElementMeta>();

export function register(...metas: ElementMeta[]): void {
  for (const m of metas) registry.set(m.type, m);
}

export const getMeta = (type: string): ElementMeta | undefined => registry.get(type);
export const allMetas = (): ElementMeta[] => [...registry.values()];

export function defaultProps(meta: ElementMeta): Record<string, unknown> {
  return Object.fromEntries(meta.props.filter((p) => p.default !== undefined).map((p) => [p.name, p.default]));
}

// ── value helpers for renderers ──
export const num = (v: unknown, def = 0): number => {
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(v);
  return v === undefined || v === null || v === '' || Number.isNaN(n) ? def : n;
};
export const str = (v: unknown, def = ''): string => (v === undefined || v === null ? def : String(v));
export const bool = (v: unknown): boolean => v === true || v === 1 || v === 'true' || v === '1' || v === 'on' || v === 'ON';
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Lighten (+) / darken (−) a hex colour by a percentage. Non-hex colours are returned unchanged. */
export function shade(color: string, percent: number): string {
  const m = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const f = percent / 100;
  const ch = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16);
    const v = f >= 0 ? c + (255 - c) * f : c * (1 + f);
    return Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  };
  return `#${ch(0)}${ch(2)}${ch(4)}`;
}

/** Parse "0:Stopped:#888, 1:Running:#2c3" style lists. */
export function parseStates(text: unknown): { value: string; label: string; color?: string }[] {
  return str(text)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [value, label, color] = s.split(':').map((x) => x.trim());
      return { value, label: label ?? value, color };
    });
}

/** Unique, CSS-safe id for SVG gradients / clip paths. */
export function useSvgId(): string {
  return useId().replace(/[^a-zA-Z0-9]/g, '');
}
