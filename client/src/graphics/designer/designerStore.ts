import { create } from 'zustand';
import { applyOps, type DesignOp } from '@shared/designOps.ts';
import type { Binding, DisplayDoc, ElementDoc } from '@shared/types.ts';
import { uid } from '../../lib/format.ts';

const MAX_HISTORY = 100;
const clone = <T,>(v: T): T => structuredClone(v);

export type AlignKind = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

interface DesignerState {
  name: string | null;
  doc: DisplayDoc | null;
  selection: string[];
  dirty: boolean;
  past: DisplayDoc[];
  future: DisplayDoc[];
  clipboard: ElementDoc[];
  zoom: number;
  snap: boolean;
  showGrid: boolean;
  preview: boolean;
  /** Armed placement tool (tap-to-place; works with touch where drag & drop does not) */
  tool: { kind: 'element' | 'tag'; id: string; label: string } | null;
  setTool(tool: DesignerState['tool']): void;

  load(name: string, doc: DisplayDoc): void;
  /** Apply a collaborator's operations; they are also folded into undo/redo history so undo only reverts your own changes. */
  applyRemote(ops: DesignOp[]): void;
  markSaved(): void;
  /** Push an undo checkpoint (call once before a continuous gesture such as dragging). */
  checkpoint(): void;
  /** Mutate the document without a checkpoint (during a gesture). */
  mutate(fn: (doc: DisplayDoc) => void): void;
  /** Checkpoint + mutate — one undoable command. */
  apply(fn: (doc: DisplayDoc) => void): void;
  undo(): void;
  redo(): void;
  select(ids: string[], additive?: boolean): void;
  setZoom(z: number): void;
  toggle(key: 'snap' | 'showGrid' | 'preview'): void;

  addElement(el: ElementDoc): void;
  removeSelected(): void;
  duplicateSelected(): void;
  copy(): void;
  cut(): void;
  paste(): void;
  updateElement(id: string, patch: Partial<ElementDoc>): void;
  updateProps(id: string, patch: Record<string, unknown>): void;
  setBinding(id: string, prop: string, binding: Binding | undefined): void;
  align(kind: AlignKind): void;
  distribute(axis: 'h' | 'v'): void;
  zorder(dir: 'front' | 'back' | 'forward' | 'backward'): void;
  group(): void;
  ungroup(): void;
  nudge(dx: number, dy: number): void;
}

export const findElement = (doc: DisplayDoc | null, id: string): ElementDoc | undefined => doc?.elements.find((e) => e.id === id);

export const useDesigner = create<DesignerState>((set, get) => {
  const selected = () => {
    const { doc, selection } = get();
    return doc ? doc.elements.filter((e) => selection.includes(e.id)) : [];
  };

  return {
    name: null,
    doc: null,
    selection: [],
    dirty: false,
    past: [],
    future: [],
    clipboard: [],
    zoom: 1,
    snap: true,
    showGrid: true,
    preview: false,
    tool: null,
    setTool: (tool) => set({ tool }),

    load: (name, doc) => set({ name, doc: clone(doc), selection: [], dirty: false, past: [], future: [] }),
    markSaved: () => set({ dirty: false }),
    applyRemote(ops) {
      const { doc, past, future, selection } = get();
      if (!doc) return;
      const next = applyOps(doc, ops);
      const alive = new Set(next.elements.map((e) => e.id));
      set({
        doc: next,
        past: past.map((d) => applyOps(d, ops)),
        future: future.map((d) => applyOps(d, ops)),
        selection: selection.filter((id) => alive.has(id)),
      });
    },

    checkpoint() {
      const { doc, past } = get();
      if (!doc) return;
      set({ past: [...past.slice(-MAX_HISTORY + 1), clone(doc)], future: [] });
    },
    mutate(fn) {
      const doc = get().doc;
      if (!doc) return;
      const next = clone(doc);
      fn(next);
      set({ doc: next, dirty: true });
    },
    apply(fn) {
      get().checkpoint();
      get().mutate(fn);
    },
    undo() {
      const { past, doc, future } = get();
      if (!past.length || !doc) return;
      set({ doc: past[past.length - 1], past: past.slice(0, -1), future: [doc, ...future], dirty: true });
    },
    redo() {
      const { past, doc, future } = get();
      if (!future.length || !doc) return;
      set({ doc: future[0], future: future.slice(1), past: [...past, doc], dirty: true });
    },
    select(ids, additive) {
      if (!additive) return set({ selection: ids });
      const cur = new Set(get().selection);
      for (const id of ids) {
        if (cur.has(id)) cur.delete(id);
        else cur.add(id);
      }
      set({ selection: [...cur] });
    },
    setZoom: (z) => set({ zoom: Math.min(4, Math.max(0.1, Math.round(z * 100) / 100)) }),
    toggle: (key) => set({ [key]: !get()[key] } as Partial<DesignerState>),

    addElement(el) {
      get().apply((d) => { d.elements.push(el); });
      set({ selection: [el.id] });
    },
    removeSelected() {
      const ids = new Set(get().selection);
      if (!ids.size) return;
      get().apply((d) => { d.elements = d.elements.filter((e) => !ids.has(e.id) || e.locked); });
      set({ selection: [] });
    },
    duplicateSelected() {
      const copies = selected().map((e) => ({ ...clone(e), id: uid(), x: e.x + 20, y: e.y + 20 }));
      if (!copies.length) return;
      get().apply((d) => { d.elements.push(...copies); });
      set({ selection: copies.map((c) => c.id) });
    },
    copy: () => set({ clipboard: clone(selected()) }),
    cut() {
      get().copy();
      get().removeSelected();
    },
    paste() {
      const items = get().clipboard.map((e) => ({ ...clone(e), id: uid(), x: e.x + 24, y: e.y + 24 }));
      if (!items.length) return;
      get().apply((d) => { d.elements.push(...items); });
      set({ selection: items.map((i) => i.id), clipboard: items });
    },
    updateElement(id, patch) {
      get().apply((d) => {
        const el = d.elements.find((e) => e.id === id);
        if (el) Object.assign(el, patch);
      });
    },
    updateProps(id, patch) {
      get().apply((d) => {
        const el = d.elements.find((e) => e.id === id);
        if (el) el.props = { ...el.props, ...patch };
      });
    },
    setBinding(id, prop, binding) {
      get().apply((d) => {
        const el = d.elements.find((e) => e.id === id);
        if (!el) return;
        const bindings = { ...el.bindings };
        if (binding && (binding.tag || binding.expr)) bindings[prop] = binding;
        else delete bindings[prop];
        el.bindings = Object.keys(bindings).length ? bindings : undefined;
      });
    },
    align(kind) {
      const els = selected();
      if (els.length < 2) return;
      const minX = Math.min(...els.map((e) => e.x)), maxX = Math.max(...els.map((e) => e.x + e.w));
      const minY = Math.min(...els.map((e) => e.y)), maxY = Math.max(...els.map((e) => e.y + e.h));
      get().apply((d) => {
        for (const e of d.elements) {
          if (!get().selection.includes(e.id)) continue;
          if (kind === 'left') e.x = minX;
          if (kind === 'right') e.x = maxX - e.w;
          if (kind === 'hcenter') e.x = Math.round((minX + maxX) / 2 - e.w / 2);
          if (kind === 'top') e.y = minY;
          if (kind === 'bottom') e.y = maxY - e.h;
          if (kind === 'vcenter') e.y = Math.round((minY + maxY) / 2 - e.h / 2);
        }
      });
    },
    distribute(axis) {
      const els = selected().sort((a, b) => (axis === 'h' ? a.x - b.x : a.y - b.y));
      if (els.length < 3) return;
      const first = els[0], last = els[els.length - 1];
      const total = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y;
      const sizes = els.reduce((s, e) => s + (axis === 'h' ? e.w : e.h), 0);
      const gap = (total - sizes) / (els.length - 1);
      let cursor = axis === 'h' ? first.x : first.y;
      const pos = new Map<string, number>();
      for (const e of els) {
        pos.set(e.id, Math.round(cursor));
        cursor += (axis === 'h' ? e.w : e.h) + gap;
      }
      get().apply((d) => {
        for (const e of d.elements) {
          const p = pos.get(e.id);
          if (p === undefined) continue;
          if (axis === 'h') e.x = p;
          else e.y = p;
        }
      });
    },
    zorder(dir) {
      const ids = new Set(get().selection);
      if (!ids.size) return;
      get().apply((d) => {
        const sel = d.elements.filter((e) => ids.has(e.id));
        const rest = d.elements.filter((e) => !ids.has(e.id));
        if (dir === 'front') d.elements = [...rest, ...sel];
        else if (dir === 'back') d.elements = [...sel, ...rest];
        else {
          const arr = d.elements;
          const order = dir === 'forward' ? [...arr.keys()].reverse() : [...arr.keys()];
          for (const i of order) {
            const j = dir === 'forward' ? i + 1 : i - 1;
            if (ids.has(arr[i].id) && j >= 0 && j < arr.length && !ids.has(arr[j].id)) [arr[i], arr[j]] = [arr[j], arr[i]];
          }
        }
      });
    },
    group() {
      const els = selected();
      if (els.length < 2) return;
      const x = Math.min(...els.map((e) => e.x)), y = Math.min(...els.map((e) => e.y));
      const w = Math.max(...els.map((e) => e.x + e.w)) - x, h = Math.max(...els.map((e) => e.y + e.h)) - y;
      const group: ElementDoc = {
        id: uid('g'), type: 'group', name: 'Group', x, y, w, h, props: {},
        children: els.map((e) => ({ ...clone(e), x: e.x - x, y: e.y - y })),
      };
      const ids = new Set(els.map((e) => e.id));
      get().apply((d) => {
        const at = d.elements.findIndex((e) => ids.has(e.id));
        d.elements = d.elements.filter((e) => !ids.has(e.id));
        d.elements.splice(at, 0, group);
      });
      set({ selection: [group.id] });
    },
    ungroup() {
      const groups = selected().filter((e) => e.type === 'group');
      if (!groups.length) return;
      const newIds: string[] = [];
      get().apply((d) => {
        for (const g of groups) {
          const at = d.elements.findIndex((e) => e.id === g.id);
          const kids = (g.children ?? []).map((c) => ({ ...c, x: c.x + g.x, y: c.y + g.y }));
          newIds.push(...kids.map((k) => k.id));
          d.elements.splice(at, 1, ...kids);
        }
      });
      set({ selection: newIds });
    },
    nudge(dx, dy) {
      const ids = new Set(get().selection);
      if (!ids.size) return;
      get().apply((d) => {
        for (const e of d.elements) if (ids.has(e.id) && !e.locked) { e.x += dx; e.y += dy; }
      });
    },
  };
});
