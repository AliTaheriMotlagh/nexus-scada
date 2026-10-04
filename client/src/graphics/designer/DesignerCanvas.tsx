import { useCallback, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { ElementDoc } from '@shared/types.ts';
import { useTagValues } from '../../hooks/useTags.ts';
import { uid } from '../../lib/format.ts';
import { bindingTagRefs } from '../../scripting/bindings.ts';
import { useProject } from '../../stores/project.ts';
import { ElementView } from '../ElementView.tsx';
import { defaultProps, getMeta } from '../registry.ts';
import { useDesigner } from './designerStore.ts';

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
    if (!st().selection.includes(el.id)) st().select([el.id], e.shiftKey);
    else if (e.shiftKey) { st().select([el.id], true); return; }
    begin('move', e);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  const onCanvasDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    if (!e.shiftKey) st().select([]);
    begin('marquee', e);
  };

  const onMove = (e: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const p = toCanvas(e);
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
        const hit = st().doc!.elements.filter((el) => el.x < marquee.x + marquee.w && el.x + el.w > marquee.x && el.y < marquee.y + marquee.h && el.y + el.h > marquee.y);
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

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const p = toCanvas(e);
    const type = e.dataTransfer.getData(DND_ELEMENT);
    if (type) {
      const el = createElement(type, snapV(p.x), snapV(p.y));
      if (el) st().addElement(el);
      return;
    }
    const tag = e.dataTransfer.getData(DND_TAG);
    if (!tag) return;
    // Dropped on an element → bind its primary property; on empty canvas → create a matching widget.
    const target = [...st().doc!.elements].reverse().find((el) => p.x >= el.x && p.x <= el.x + el.w && p.y >= el.y && p.y <= el.y + el.h);
    const meta = target && getMeta(target.type);
    if (target && meta) {
      if (meta.props.some((pd) => pd.name === 'tag' && pd.type === 'tag')) st().updateProps(target.id, { tag });
      else if (meta.primary) st().setBinding(target.id, meta.primary, { tag });
      st().select([target.id]);
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

  const single = selection.length === 1 ? doc.elements.find((e) => e.id === selection[0]) : undefined;
  const handles: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const hs = 8 / zoom;

  return (
    <div className="designer-viewport">
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
          {marquee && <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
        </div>
      </div>
    </div>
  );
}
