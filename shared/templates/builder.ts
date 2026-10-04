/**
 * Small DSL for building template displays and tag trees in code.
 * Shared by the designer's template gallery (browser) and the installer tool (server).
 */
import type { AlarmDef, Binding, DeviceNode, DisplayDoc, ElementDoc, FolderNode, ProjectNode, ScriptTrigger, TagNode } from '../types.ts';

export type TemplateCategory = 'Water' | 'Building' | 'Energy' | 'Industry' | 'Food & Agri' | 'Home' | 'Layout';
export type PageSize = 'desktop' | 'tablet' | 'phone' | 'faceplate';
export const PAGE_SIZES: Record<PageSize, { width: number; height: number; label: string }> = {
  desktop: { width: 1600, height: 900, label: 'Desktop 16:9' },
  tablet: { width: 1180, height: 820, label: 'Tablet (iPad landscape)' },
  phone: { width: 420, height: 900, label: 'Phone (portrait)' },
  faceplate: { width: 520, height: 400, label: 'Faceplate popup' },
};

export interface TemplateScript { name: string; code: string; triggers: ScriptTrigger[]; description?: string }

export interface PageTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  description: string;
  /** Suggested name for the tag folder / display */
  defaultName: string;
  size: PageSize;
  /** Real-world equipment shown, for the gallery */
  features?: string[];
  /** Tag tree (a simulated device) installed at `<parent>/<name>` */
  nodes?: (name: string) => ProjectNode;
  display: (base: string, title: string) => Omit<DisplayDoc, 'name'>;
  scripts?: (base: string, name: string) => TemplateScript[];
}

// ───────────────────────────── tags ─────────────────────────────

export const tag = (name: string, o: Partial<TagNode> = {}): TagNode => ({ kind: 'tag', name, ...o });

/** Simulated signal (see SimulationDriver for `fn`). Historized by default. */
export function sim(name: string, fn: string, min: number, max: number, o: Partial<TagNode> & { period?: number; step?: number; noise?: number; phase?: number } = {}): TagNode {
  const { period, step, noise, phase, ...rest } = o;
  return tag(name, {
    source: { fn, min, max, ...(period !== undefined && { period }), ...(step !== undefined && { step }), ...(noise !== undefined && { noise }), ...(phase !== undefined && { phase }) },
    dataType: fn === 'toggle' ? 'boolean' : 'number',
    history: true,
    ...rest,
  });
}

/** Writable memory value (operator setpoints, commands, states). */
export function mem(name: string, initial: number | boolean | string, o: Partial<TagNode> = {}): TagNode {
  const dataType = typeof initial === 'boolean' ? 'boolean' : typeof initial === 'string' ? 'string' : 'number';
  return tag(name, { dataType, initial, writable: true, ...o });
}

/** Calculated tag (TypeScript expression, `./` = same folder). */
export const calc = (name: string, expression: string, o: Partial<TagNode> = {}): TagNode => tag(name, { expression, history: true, ...o });

export const folder = (name: string, children: ProjectNode[]): FolderNode => ({ kind: 'folder', name, children });
export const simDevice = (name: string, children: ProjectNode[], intervalMs = 1000): DeviceNode =>
  ({ kind: 'device', name, driver: 'simulation', description: 'Simulated equipment (replace driver with modbus-tcp / mqtt / rest for real hardware)', settings: { intervalMs }, children });

export const hi = (limit: number, message: string, severity: AlarmDef['severity'] = 'high', extra: Partial<AlarmDef> = {}): AlarmDef => ({ kind: 'hi', limit, severity, message, ...extra });
export const lo = (limit: number, message: string, severity: AlarmDef['severity'] = 'high', extra: Partial<AlarmDef> = {}): AlarmDef => ({ kind: 'lo', limit, severity, message, ...extra });
export const on = (message: string, severity: AlarmDef['severity'] = 'high', extra: Partial<AlarmDef> = {}): AlarmDef => ({ kind: 'on', severity, message, ...extra });

// ───────────────────────────── displays ─────────────────────────────

export const B = (tagPath: string, extra: Partial<Binding> = {}): Binding => ({ tag: tagPath, ...extra });

export const COLORS = {
  bg: '#0f1722', panel: '#111b27', border: '#233244', text: '#e2e8f0', dim: '#94a3b8', label: '#64748b',
  water: '#38bdf8', hot: '#ef4444', cold: '#3b82f6', ok: '#22c55e', warn: '#f59e0b', accent: '#6366f1', solar: '#facc15',
};

/** Fluent page builder: coordinates are absolute pixels on the page. */
export class Page {
  readonly elements: ElementDoc[] = [];
  readonly base: string;
  private seq = 0;

  constructor(base: string) {
    this.base = base;
  }

  /** Tag path relative to the template base. */
  t(rel: string): string {
    return rel ? `${this.base}/${rel}` : this.base;
  }

  add(type: string, x: number, y: number, w: number, h: number, props: Record<string, unknown> = {}, extra: Partial<ElementDoc> = {}): ElementDoc {
    const el: ElementDoc = { id: `${type}${++this.seq}`, type, x, y, w, h, props, ...extra };
    this.elements.push(el);
    return el;
  }

  text(x: number, y: number, w: number, text: string, size = 13, props: Record<string, unknown> = {}): ElementDoc {
    return this.add('text', x, y, w, Math.round(size * 1.8), { text, fontSize: size, color: COLORS.dim, ...props });
  }

  /** Page header with title and clock. */
  header(title: string, width: number): void {
    this.text(24, 12, width < 600 ? width - 48 : Math.min(800, width - 220), title, width < 600 ? 19 : 24, { fontWeight: '700', color: COLORS.text });
    if (width >= 600) this.add('clock', width - 200, 16, 180, 32, { format: 'datetime', fontSize: 14, color: COLORS.dim });
  }

  /** Background panel with a small caps caption. */
  panel(x: number, y: number, w: number, h: number, caption?: string): void {
    this.add('rect', x, y, w, h, { fill: COLORS.panel, stroke: COLORS.border, radius: 10 }, { locked: true });
    if (caption) this.text(x + 14, y + 6, w - 28, caption.toUpperCase(), 12, { fontWeight: '700', color: COLORS.label });
  }

  value(x: number, y: number, w: number, rel: string, label: string, props: Record<string, unknown> = {}): ElementDoc {
    return this.add('value', x, y, w, 34, { tag: this.t(rel), label, fontSize: 15, align: 'left', ...props });
  }

  pipe(x: number, y: number, w: number, flowingRel: string | null, props: Record<string, unknown> = {}, expr = 'value > 0', extra: Partial<ElementDoc> = {}): ElementDoc {
    return this.add('pipe', x, y, w, 18, props, { ...extra, bindings: flowingRel ? { flowing: B(this.t(flowingRel), { expr }) } : undefined });
  }

  /** Vertical pipe centred on (cx, cy) with the given length. */
  vpipe(cx: number, cy: number, length: number, flowingRel: string | null, props: Record<string, unknown> = {}, expr = 'value > 0'): ElementDoc {
    return this.pipe(Math.round(cx - length / 2), Math.round(cy - 9), length, flowingRel, props, expr, { rotation: 90 });
  }

  build(o: { title: string; width: number; height: number; background?: string; scripts?: DisplayDoc['scripts']; kind?: DisplayDoc['kind'] }): Omit<DisplayDoc, 'name'> {
    return { title: o.title, kind: o.kind ?? 'page', width: o.width, height: o.height, background: o.background ?? COLORS.bg, grid: 10, scripts: o.scripts, elements: this.elements };
  }
}

/** Standard desktop frame: process area + KPI + trend + controls + alarms. */
export function desktopFrame(p: Page, title: string, captions: { process?: string; kpi?: string; trend?: string; controls?: string } = {}): void {
  p.header(title, 1600);
  p.panel(16, 60, 1064, 566, captions.process ?? 'Process');
  p.panel(1092, 60, 492, 254, captions.kpi ?? 'Key figures');
  p.panel(1092, 326, 492, 300, captions.trend ?? 'Trend — 15 min');
  p.panel(1092, 638, 492, 248, captions.controls ?? 'Operator controls');
}

export function alarmsAndTrend(p: Page, trendTags: string[], minutes = 15): void {
  p.add('trend', 1104, 356, 468, 258, { tags: trendTags.map((t) => p.t(t)).join(','), minutes, legend: false });
  p.add('alarmTable', 16, 638, 1064, 248, { area: p.base, maxRows: 8 });
}
