import { memo, type PointerEvent as ReactPointerEvent } from 'react';
import { applyParams } from '@shared/scriptCompiler.ts';
import type { ElementDoc } from '@shared/types.ts';
import { resolveProps, type Getter } from '../scripting/bindings.ts';
import { hasRole } from '../stores/session.ts';
import { useUi } from '../stores/ui.ts';
import { getMeta } from './registry.ts';
import './elements/index.ts';

export interface ElementViewProps {
  el: ElementDoc;
  mode: 'runtime' | 'design';
  get?: Getter;
  params?: Record<string, string>;
  overrides?: Record<string, Record<string, unknown>>;
  onEvent?: (el: ElementDoc, event: string, extra?: Record<string, unknown>) => void;
  /** Design mode: pointer down on the element (selection / drag) */
  onDesignPointerDown?: (e: ReactPointerEvent, el: ElementDoc) => void;
  selected?: boolean;
  /** Re-render token for live values */
  tick?: number;
}

function ElementViewImpl({ el, mode, get, params, overrides, onEvent, onDesignPointerDown, selected }: ElementViewProps) {
  const meta = getMeta(el.type);
  const runtime = mode === 'runtime';
  const props = resolveProps(el, get, params, overrides?.[el.id]);

  const visible = props.visible === undefined ? el.visible !== false : Boolean(props.visible);
  if (runtime && !visible) return null;
  const x = typeof props.x === 'number' && el.bindings?.x ? props.x : el.x;
  const y = typeof props.y === 'number' && el.bindings?.y ? props.y : el.y;
  const rotation = typeof props.rotation === 'number' && el.bindings?.rotation ? props.rotation : el.rotation ?? 0;
  const opacity = typeof props.opacity === 'number' && el.bindings?.opacity ? props.opacity : el.opacity ?? 1;
  const allowed = !el.role || hasRole(el.role);
  const faceplate = el.faceplate?.path ? el.faceplate : undefined;
  const clickable = runtime && allowed && !meta?.interactive && (!!el.events?.click || !!faceplate);

  const onClick = () => {
    if (!clickable) return;
    if (el.events?.click) onEvent?.(el, 'click');
    if (faceplate) useUi.getState().openFaceplate(applyParams(faceplate.path, params), faceplate.display);
  };

  const classes = [
    'el', `el-${el.type}`,
    clickable ? 'clickable' : '',
    props.blink === true ? 'blink' : '',
    props.__quality === 'bad' ? 'q-bad' : props.__quality === 'uncertain' ? 'q-uncertain' : '',
    !allowed ? 'role-locked' : '',
    selected ? 'selected' : '',
    !visible ? 'hidden-design' : '',
    el.locked && !runtime ? 'locked' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      data-id={el.id}
      style={{
        left: x, top: y, width: el.w, height: el.h, opacity: runtime ? opacity : visible ? opacity : 0.35,
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
      }}
      title={runtime && el.tooltip ? applyParams(el.tooltip, params) : undefined}
      onClick={runtime ? onClick : undefined}
      onDoubleClick={runtime && el.events?.dblclick ? () => onEvent?.(el, 'dblclick') : undefined}
      onPointerDown={!runtime ? (e) => onDesignPointerDown?.(e, el) : el.events?.mousedown ? () => onEvent?.(el, 'mousedown') : undefined}
      onPointerUp={runtime && el.events?.mouseup ? () => onEvent?.(el, 'mouseup') : undefined}
    >
      <div className="el-content">
        {el.type === 'group'
          ? (el.children ?? []).map((c) => (
            <ElementView key={c.id} el={c} mode={mode} get={get} params={params} overrides={overrides} onEvent={onEvent} />
          ))
          : meta
            ? <meta.Component el={el} props={props} runtime={runtime && allowed} params={params} fire={(event, extra) => { if (el.events?.[event as 'click']) onEvent?.(el, event, extra); }} />
            : <div className="placeholder">Unknown type “{el.type}”</div>}
      </div>
    </div>
  );
}

export const ElementView = memo(ElementViewImpl);
