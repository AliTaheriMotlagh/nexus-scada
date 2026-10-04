import { useCallback, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { ElementDoc } from '@shared/types.ts';
import { useTagValues } from '../../hooks/useTags.ts';
import { uid } from '../../lib/format.ts';
import { bindingTagRefs } from '../../scripting/bindings.ts';
import { useProject } from '../../stores/project.ts';
import { ElementView } from '../ElementView.tsx';
import { defaultProps, getMeta } from '../registry.ts';
import { lockedBy, setCursor, useCollab } from './collab.ts';
import { useDesigner } from './designerStore.ts';
import { toast } from '../../stores/ui.ts';

export const DND_ELEMENT = 'application/x-nexus-element';
export const DND_TAG = 'application/x-nexus-tag';

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
interface Gesture {
  kind: 'move' | 'resize' | 'rotate' | 'marquee';
  sx: number;
  sy: number;
  orig: Map<string, { x: number; y: number; w: number; h: number; rotation: number }>;
  handle?: Handle;
  changed: boolean;
}

/** Build a new element of a registered type with its default props. */
export function createElement(type: string, x: number, y: number, extra?: Partial<ElementDoc>): ElementDoc | null {
  const meta = getMeta(type);
  if (!meta) return null;
  return { id: uid(), type, x: Math.round(x - meta.w / 2), y: Math.round(y - meta.h / 2), w: meta.w, h: meta.h, props: defaultProps(meta), ...extra };
}

export function DesignerCanvas() {
  const doc = useDesigner((s) => s.doc)!;
  const selection = useDesigner((s) => s.selection);
  const zoom = useDesigner((s) => s.zoom);
  const snap = useDesigner((s) => s.snap);
  const showGrid = useDesigner((s) => s.showGrid);
  const preview = useDesigner((s) => s.preview);
  const tool = useDesigner((s) => s.tool);
  const st = useDesigner.getState;
  const canvas = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const grid = doc.grid || 10;

  const refs = preview ? doc.elements.flatMap((e) => bindingTagRefs(e)) : [];
  const get = useTagValues(refs);

  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };
  const snapV = (v: number) => (snap ? Math.round(v / grid) * grid : Math.round(v));

  const begin = (kind: Gesture['kind'], e: ReactPointerEvent, handle?: Handle) => {
    const p = toCanvas(e);
    const orig = new Map<string, { x: number; y: number; w: number; h: number; rotation: number }>();
    for (const el of st().doc!.elements) {
      if (st().selection.includes(el.id) && !el.locked) orig.set(el.id, { x: el.x, y: el.y, w: el.w, h: el.h, rotation: el.rotation ?? 0 });
    }
    gesture.current = { kind, sx: p.x, sy: p.y, orig, handle, changed: false };
    if (kind !== 'marquee') st().checkpoint();
    canvas.current!.setPointerCapture(e.pointerId);
  };

  const onElementDown = useCallback((e: ReactPointerEvent, el: ElementDoc) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (placeTool(e)) return;
    const owner = lockedBy(el.id);
    if (owner) {
      toast(`${owner.user} is editing this element`, 'warning');
      return;
    }
    if (!st().selection.includes(el.id)) st().select([el.id], e.shiftKey);
    else if (e.shiftKey) { st().select([el.id], true); return; }
    begin('move', e);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  const onCanvasDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    if (placeTool(e)) return;
    if (!e.shiftKey) st().select([]);
    begin('marquee', e);
  };

  const onMove = (e: ReactPointerEvent) => {
    const p = toCanvas(e);
    setCursor({ x: Math.round(p.x), y: Math.round(p.y) });
    const g = gesture.current;
    if (!g) return;
    const dx = p.x - g.sx, dy = p.y - g.sy;
    if (g.kind === 'marquee') {
      setMarquee({ x: Math.min(p.x, g.sx), y: Math.min(p.y, g.sy), w: Math.abs(dx), h: Math.abs(dy) });
      return;
    }
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && !g.changed) return;
    g.changed = true;
    st().mutate((d) => {
      for (const el of d.elements) {
        const o = g.orig.get(el.id);
        if (!o) continue;
        if (g.kind === 'move') {
          el.x = snapV(o.x + dx);
          el.y = snapV(o.y + dy);
        } else if (g.kind === 'resize' && g.handle) {
          let { x, y, w, h } = o;
          if (g.handle.includes('e')) w = Math.max(4, snapV(o.w + dx));
          if (g.handle.includes('s')) h = Math.max(4, snapV(o.h + dy));
          if (g.handle.includes('w')) { const nx = Math.min(o.x + o.w - 4, snapV(o.x + dx)); w = o.w + (o.x - nx); x = nx; }
          if (g.handle.includes('n')) { const ny = Math.min(o.y + o.h - 4, snapV(o.y + dy)); h = o.h + (o.y - ny); y = ny; }
          if (e.shiftKey) h = Math.round((w * o.h) / o.w);
          Object.assign(el, { x, y, w, h });
        } else if (g.kind === 'rotate') {
          const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
          let deg = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
          if (!e.altKey) deg = Math.round(deg / 15) * 15;
          el.rotation = ((Math.round(deg) % 360) + 360) % 360;
        }
      }
    });
  };

  const onUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === 'marquee') {
      if (marquee && (marquee.w > 3 || marquee.h > 3)) {
        const hit = st().doc!.elements.filter((el) => !lockedBy(el.id) && el.x < marquee.x + marquee.w && el.x + el.w > marquee.x && el.y < marquee.y + marquee.h && el.y + el.h > marquee.y);
        st().select(hit.map((h) => h.id), true);
      }
      setMarquee(null);
    } else if (!g.changed) {
      useDesigner.setState((s) => ({ past: s.past.slice(0, -1) })); // no-op gesture: drop checkpoint
    }
  };

  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes(DND_ELEMENT) || e.dataTransfer.types.includes(DND_TAG)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  /** Place an element type or a tag at a canvas point (shared by drag & drop and tap-to-place). */
  const placeAt = (kind: 'element' | 'tag', id: string, p: { x: number; y: number }) => {
    if (kind === 'element') {
      const el = createElement(id, snapV(p.x), snapV(p.y));
      if (el) st().addElement(el);
      return;
    }
    const tag = id;
    // On an element → bind its primary property; on empty canvas → create a matching widget.
    const target = [...st().doc!.elements].reverse().find((el) => p.x >= el.x && p.x <= el.x + el.w && p.y >= el.y && p.y <= el.y + el.h && !lockedBy(el.id));
    const meta = target && getMeta(target.type);
    if (target && meta) {
      if (meta.props.some((pd) => pd.name === 'tag' && pd.type === 'tag')) st().updateProps(target.id, { tag });
      else if (meta.primary) st().setBinding(target.id, meta.primary, { tag });
      st().select([target.id]);
      toast(`Bound ${tag} to ${target.name ?? target.id}`, 'success');
      return;
    }
    const info = useProject.getState().tags.get(tag);
    const label = tag.split('/').slice(-2).join(' ');
    const el = info?.dataType === 'boolean'
      ? createElement(info.writable ? 'switch' : 'led', p.x, p.y, { props: { ...defaultProps(getMeta(info.writable ? 'switch' : 'led')!), tag, label } })
      : info?.writable && info.dataType === 'number'
        ? createElement('numeric', p.x, p.y, { props: { ...defaultProps(getMeta('numeric')!), tag, label } })
        : createElement('value', p.x, p.y, { props: { ...defaultProps(getMeta('value')!), tag, label, align: 'left' }, w: 220 });
    if (el) st().addElement(el);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const p = toCanvas(e);
    const type = e.dataTransfer.getData(DND_ELEMENT);
    if (type) return placeAt('element', type, p);
    const tag = e.dataTransfer.getData(DND_TAG);
    if (tag) placeAt('tag', tag, p);
  };

  /** Tap-to-place: an armed tool is placed where the canvas is tapped. */
  const placeTool = (e: ReactPointerEvent): boolean => {
    const tool = st().tool;
    if (!tool) return false;
    placeAt(tool.kind, tool.id, toCanvas(e));
    if (!e.shiftKey) st().setTool(null); // Shift keeps the tool for placing several
    return true;
  };

  const peers = [...useCollab((c) => c.peers).values()];
  const single = selection.length === 1 ? doc.elements.find((e) => e.id === selection[0]) : undefined;
  const handles: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const hs = 8 / zoom;

  return (
    <div className={`designer-viewport ${tool ? 'placing' : ''}`}>
      {tool && (
        <div className="place-banner">
          Tap the canvas to place <b>{tool.label}</b>{tool.kind === 'tag' ? ' (tap an element to bind it)' : ''}
          <button className="small" onClick={() => st().setTool(null)}>Cancel</button>
        </div>
      )}
      <div className="designer-scaler" style={{ width: doc.width * zoom + 80, height: doc.height * zoom + 80 }}>
        <div
          ref={canvas}
          className={`display-canvas design ${showGrid && !preview ? 'grid' : ''}`}
          style={{
            width: doc.width, height: doc.height, transform: `scale(${zoom})`,
            background: doc.background ?? 'var(--canvas-bg)', backgroundSize: showGrid ? `${grid}px ${grid}px` : undefined,
            backgroundImage: doc.backgroundImage ? `url(${doc.backgroundImage})` : undefined,
          }}
          onPointerDown={preview ? undefined : onCanvasDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={() => setCursor(null)}
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          {doc.elements.map((el) => (
            <ElementView key={el.id} el={el} mode={preview ? 'runtime' : 'design'} get={preview ? get : undefined}
              onDesignPointerDown={onElementDown} selected={selection.includes(el.id)} />
          ))}
          {!preview && doc.elements.filter((e) => selection.includes(e.id)).map((el) => (
            <div key={el.id} className="sel-box" style={{ left: el.x, top: el.y, width: el.w, height: el.h, transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined, borderWidth: 1 / zoom }} />
          ))}
          {!preview && single && !single.locked && (
            <div className="handles" style={{ left: single.x, top: single.y, width: single.w, height: single.h, transform: single.rotation ? `rotate(${single.rotation}deg)` : undefined }}>
              {handles.map((h) => (
                <div key={h} className={`handle h-${h}`} style={{ width: hs, height: hs, margin: -hs / 2 }}
                  onPointerDown={(e) => { e.stopPropagation(); begin('resize', e, h); }} />
              ))}
              <div className="handle rotate" style={{ width: hs * 1.4, height: hs * 1.4, top: -28 / zoom, marginLeft: -hs * 0.7 }}
                onPointerDown={(e) => { e.stopPropagation(); begin('rotate', e); }} title="Rotate (Alt = free)" />
            </div>
          )}
 {peers.flatMap((p) => doc.elements.filter((el) => p.selection.includes(el.id)).map((el) => (
            <div key={`${p.connId}:${el.id}`} className="peer-sel" style={{ left: el.x, top: el.y, width: el.w, height: el.h, borderColor: p.color, borderWidth: 2 / zoom, transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined }}>
              <span style={{ background: p.color, fontSize: 11 / zoom, padding: `${1 / zoom}px ${5 / zoom}px` }}>🔒 {p.user}</span>
            </div>
          )))}
          {peers.filter((p) => p.cursor).map((p) => (
            <div key={p.connId} className="peer-cursor" style={{ left: p.cursor!.x, top: p.cursor!.y, transform: `scale(${1 / zoom})` }}>
              <svg width="18" height="18" viewBox="0 0 18 18"><path d="M1 1 L1 15 L5 11 L8 17 L10.5 16 L7.6 10 L13 10 Z" fill={p.color} stroke="#0b1118" strokeWidth="1.2" /></svg>
              <span style={{ background: p.color }}>{p.user}</span>
            </div>
          ))}
          {marquee && <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
        </div>
      </div>
    </div>
  );
}
