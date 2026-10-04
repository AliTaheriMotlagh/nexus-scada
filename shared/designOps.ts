/**
 * Collaborative design operations.
 * Displays are synchronized element-by-element (last writer wins per element; elements selected
 * by another user are locked). The same functions run on the server (authoritative copy) and in
 * every browser, so all replicas converge.
 */
import type { DisplayDoc, ElementDoc } from './types.ts';

export type DesignOp =
  | { op: 'upsert'; el: ElementDoc }
  | { op: 'remove'; id: string }
  | { op: 'order'; ids: string[] }
  | { op: 'display'; patch: Omit<DisplayDoc, 'elements' | 'name'> };

export interface Participant {
  connId: string;
  user: string;
  color: string;
  cursor?: { x: number; y: number } | null;
  selection: string[];
}

const pageFields = (d: DisplayDoc): Omit<DisplayDoc, 'elements' | 'name'> => {
  const { elements: _e, name: _n, ...rest } = d;
  return rest;
};

/** Apply operations to a copy of the document. */
export function applyOps(doc: DisplayDoc, ops: DesignOp[]): DisplayDoc {
  let elements = [...doc.elements];
  let page = pageFields(doc);
  for (const o of ops) {
    switch (o.op) {
      case 'upsert': {
        const i = elements.findIndex((e) => e.id === o.el.id);
        if (i >= 0) elements[i] = o.el;
        else elements.push(o.el);
        break;
      }
      case 'remove':
        elements = elements.filter((e) => e.id !== o.id);
        break;
      case 'order': {
        const rank = new Map(o.ids.map((id, i) => [id, i]));
        // elements unknown to the sender (added concurrently) keep their place at the end
        elements = [...elements].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
        break;
      }
      case 'display':
        page = { ...o.patch };
        break;
    }
  }
  return { ...page, name: doc.name, elements } as DisplayDoc;
}

/** Minimal operations that turn `a` into `b`. */
export function diffDocs(a: DisplayDoc, b: DisplayDoc): DesignOp[] {
  const ops: DesignOp[] = [];
  const before = new Map(a.elements.map((e) => [e.id, e]));
  const after = new Set(b.elements.map((e) => e.id));
  for (const e of a.elements) if (!after.has(e.id)) ops.push({ op: 'remove', id: e.id });
  for (const e of b.elements) {
    const old = before.get(e.id);
    if (!old || JSON.stringify(old) !== JSON.stringify(e)) ops.push({ op: 'upsert', el: e });
  }
  const applied = applyOps(a, ops);
  if (applied.elements.map((e) => e.id).join('|') !== b.elements.map((e) => e.id).join('|')) {
    ops.push({ op: 'order', ids: b.elements.map((e) => e.id) });
  }
  if (JSON.stringify(pageFields(a)) !== JSON.stringify(pageFields(b))) ops.push({ op: 'display', patch: pageFields(b) });
  return ops;
}

/** Ids of elements an operation touches (for lock checks). */
export function touchedIds(op: DesignOp): string[] {
  if (op.op === 'upsert') return [op.el.id];
  if (op.op === 'remove') return [op.id];
  return [];
}

export const PEER_COLORS = ['#f472b6', '#34d399', '#fbbf24', '#60a5fa', '#a78bfa', '#fb923c', '#22d3ee', '#f87171'];
