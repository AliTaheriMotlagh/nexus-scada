import { useMemo, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import {
  Box, ChevronDown, ChevronRight, Cpu, File, Folder, FolderOpen, Gauge, Monitor, Tag, ToggleLeft, Type,
} from 'lucide-react';
import type { TreeItem } from '@shared/types.ts';

export interface TreeProps {
  items: TreeItem[];
  selected?: string | null;
  onSelect?: (item: TreeItem) => void;
  onActivate?: (item: TreeItem) => void;
  /** Text filter; matching items and their ancestors are shown expanded */
  filter?: string;
  /** Initially expanded depth */
  defaultDepth?: number;
  /** Multi-check mode (e.g. selecting trend pens) */
  checked?: Set<string>;
  onCheck?: (item: TreeItem, checked: boolean) => void;
  checkable?: (item: TreeItem) => boolean;
  /** Drag payload, e.g. tag path for dropping on the canvas */
  dragType?: string;
  draggable?: (item: TreeItem) => boolean;
  renderIcon?: (item: TreeItem, expanded: boolean) => ReactNode;
  renderExtra?: (item: TreeItem) => ReactNode;
  onContextMenu?: (item: TreeItem, e: React.MouseEvent) => void;
  emptyText?: string;
}

export function defaultIcon(item: TreeItem, expanded: boolean): ReactNode {
  switch (item.kind) {
    case 'folder': return expanded ? <FolderOpen size={15} className="ic-folder" /> : <Folder size={15} className="ic-folder" />;
    case 'device': return <Cpu size={15} className="ic-device" />;
    case 'tag': {
      const dt = item.meta?.dataType;
      if (dt === 'boolean') return <ToggleLeft size={15} className="ic-tag" />;
      if (dt === 'string') return <Type size={15} className="ic-tag" />;
      return <Tag size={15} className="ic-tag" />;
    }
    case 'display': return <Monitor size={15} className="ic-display" />;
    case 'scene': return <Box size={15} className="ic-scene" />;
    case 'gauge': return <Gauge size={15} />;
    default: return <File size={15} />;
  }
}

function filterTree(items: TreeItem[], q: string): TreeItem[] {
  const out: TreeItem[] = [];
  for (const it of items) {
    const kids = it.children ? filterTree(it.children, q) : [];
    if (it.name.toLowerCase().includes(q) || it.id.toLowerCase().includes(q) || kids.length) {
      out.push({ ...it, children: it.children ? (kids.length ? kids : it.name.toLowerCase().includes(q) ? it.children : []) : undefined });
    }
  }
  return out;
}

function collectIds(items: TreeItem[], depth: number, max: number, out: Set<string>) {
  for (const it of items) {
    if (it.children && depth < max) {
      out.add(it.id);
      collectIds(it.children, depth + 1, max, out);
    }
  }
}

/** Generic, keyboard-accessible tree used for nodes, tags, displays, scenes, scripts, palette and layers. */
export function Tree(props: TreeProps) {
  const { items, filter, defaultDepth = 1 } = props;
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const s = new Set<string>();
    collectIds(items, 0, defaultDepth, s);
    return s;
  });
  const q = filter?.trim().toLowerCase() ?? '';
  const visible = useMemo(() => (q ? filterTree(items, q) : items), [items, q]);

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  // flatten for keyboard navigation
  const flat: { item: TreeItem; depth: number }[] = [];
  const walk = (list: TreeItem[], depth: number) => {
    for (const it of list) {
      flat.push({ item: it, depth });
      if (it.children && (q || expanded.has(it.id))) walk(it.children, depth + 1);
    }
  };
  walk(visible, 0);

  const onKeyDown = (e: KeyboardEvent) => {
    const idx = flat.findIndex((f) => f.item.id === props.selected);
    const cur = flat[idx]?.item;
    if (e.key === 'ArrowDown' && idx < flat.length - 1) props.onSelect?.(flat[idx + 1].item);
    else if (e.key === 'ArrowUp' && idx > 0) props.onSelect?.(flat[idx - 1].item);
    else if (e.key === 'ArrowRight' && cur?.children && !expanded.has(cur.id)) toggle(cur.id);
    else if (e.key === 'ArrowLeft' && cur?.children && expanded.has(cur.id)) toggle(cur.id);
    else if (e.key === 'Enter' && cur) props.onActivate?.(cur);
    else return;
    e.preventDefault();
  };

  if (!flat.length) return <div className="tree-empty">{props.emptyText ?? (q ? 'No matches' : 'Empty')}</div>;

  return (
    <div className="tree" role="tree" tabIndex={0} onKeyDown={onKeyDown}>
      {flat.map(({ item, depth }) => {
        const isOpen = !!item.children && (!!q || expanded.has(item.id));
        const canCheck = props.checked && (props.checkable?.(item) ?? !item.children);
        const canDrag = !!props.dragType && (props.draggable?.(item) ?? !item.children);
        return (
          <div
            key={item.id}
            role="treeitem"
            aria-expanded={item.children ? isOpen : undefined}
            aria-selected={props.selected === item.id}
            className={`tree-row${props.selected === item.id ? ' selected' : ''}`}
            style={{ paddingLeft: 6 + depth * 14 }}
            title={item.description ?? item.id}
            draggable={canDrag}
            onDragStart={(e: DragEvent) => {
              e.dataTransfer.setData(props.dragType!, item.id);
              e.dataTransfer.setData('text/plain', item.id);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => {
              props.onSelect?.(item);
              if (item.children && !props.onSelect) toggle(item.id);
            }}
            onDoubleClick={() => (item.children ? toggle(item.id) : props.onActivate?.(item))}
            onContextMenu={props.onContextMenu ? (e) => { e.preventDefault(); props.onContextMenu!(item, e); } : undefined}
          >
            <span className="tree-chevron" onClick={(e) => { e.stopPropagation(); if (item.children) toggle(item.id); }}>
              {item.children ? (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
            </span>
            {canCheck && (
              <input
                type="checkbox"
                checked={props.checked!.has(item.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => props.onCheck?.(item, e.target.checked)}
              />
            )}
            <span className="tree-icon">{(props.renderIcon ?? defaultIcon)(item, isOpen)}</span>
            <span className="tree-label">{item.name}</span>
            {props.renderExtra && <span className="tree-extra">{props.renderExtra(item)}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Keep only branches that contain items matching a predicate. */
export function pruneTree(items: TreeItem[], keep: (item: TreeItem) => boolean): TreeItem[] {
  const out: TreeItem[] = [];
  for (const it of items) {
    if (it.children) {
      const kids = pruneTree(it.children, keep);
      if (kids.length) out.push({ ...it, children: kids });
    } else if (keep(it)) out.push(it);
  }
  return out;
}
