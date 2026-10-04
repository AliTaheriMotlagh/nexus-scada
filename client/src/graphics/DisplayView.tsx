import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DisplayApi, ElementApi } from '@shared/script-api.ts';
import type { DisplayDoc, ElementDoc } from '@shared/types.ts';
import { useTagValues } from '../hooks/useTags.ts';
import { bindingTagRefs } from '../scripting/bindings.ts';
import { runClientScript } from '../scripting/clientScriptApi.ts';
import { ElementView } from './ElementView.tsx';

function flatten(elements: ElementDoc[]): ElementDoc[] {
  return elements.flatMap((e) => [e, ...flatten(e.children ?? [])]);
}

interface Props {
  doc: DisplayDoc;
  params?: Record<string, string>;
  /** fit = scale to container, none = 1:1 with scrollbars */
  scale?: 'fit' | 'none' | 'width';
}

/**
 * Runtime renderer for a graphic page: live bindings, element events, display scripts
 * (onOpen / onTimer / onClose), runtime property overrides and responsive scaling.
 */
export function DisplayView({ doc, params, scale = 'fit' }: Props) {
  const all = useMemo(() => flatten(doc.elements), [doc]);
  const refs = useMemo(() => all.flatMap((e) => bindingTagRefs(e, params)), [all, params]);
  const get = useTagValues(refs);
  const [overrides, setOverrides] = useState<Record<string, Record<string, unknown>>>({});
  const vars = useRef<Record<string, unknown>>({});
  const disposers = useRef<(() => void)[]>([]);
  const host = useRef<HTMLDivElement>(null);
  const [factor, setFactor] = useState(1);

  const elementApi = useCallback((el: ElementDoc): ElementApi => ({
    id: el.id,
    type: el.type,
    get: (prop) => el.props[prop],
    set: (prop, value) => setOverrides((o) => ({ ...o, [el.id]: { ...o[el.id], [prop]: value } })),
  }), []);

  const displayApi = useMemo<DisplayApi>(() => ({
    name: doc.name,
    params: params ?? {},
    vars: vars.current,
    element: (idOrName) => {
      const el = all.find((e) => e.id === idOrName || e.name === idOrName);
      return el ? elementApi(el) : undefined;
    },
  }), [doc.name, params, all, elementApi]);

  const onEvent = useCallback((el: ElementDoc, event: string, extra?: Record<string, unknown>) => {
    const code = el.events?.[event as keyof NonNullable<ElementDoc['events']>];
    void runClientScript(code, {
      display: displayApi, element: elementApi(el), event: { type: event, ...extra }, disposers: disposers.current,
      source: `${doc.name}/${el.name ?? el.id}.${event}`,
    });
  }, [displayApi, elementApi, doc.name]);

  // display lifecycle scripts — keyed on the document and parameter values, not object identity
  const apiRef = useRef(displayApi);
  apiRef.current = displayApi;
  const paramsKey = JSON.stringify(params ?? {});
  useEffect(() => {
    const ctx = (type: string) => ({ display: apiRef.current, element: undefined, event: { type }, disposers: disposers.current, source: `${doc.name}.${type}` });
    setOverrides({});
    void runClientScript(doc.scripts?.onOpen, ctx('open'));
    let timer: number | undefined;
    if (doc.scripts?.onTimer?.trim()) {
      let busy = false;
      timer = window.setInterval(async () => {
        if (busy) return;
        busy = true;
        await runClientScript(doc.scripts?.onTimer, ctx('timer'));
        busy = false;
      }, Math.max(100, doc.scripts.timerMs ?? 1000));
    }
    const owned = disposers.current;
    return () => {
      clearInterval(timer);
      void runClientScript(doc.scripts?.onClose, ctx('close'));
      owned.splice(0).forEach((d) => d());
    };
  }, [doc, paramsKey]);

  // responsive scaling
  useEffect(() => {
    const el = host.current;
    if (!el || scale === 'none') {
      setFactor(1);
      return;
    }
    const ro = new ResizeObserver(() => {
      const fx = el.clientWidth / doc.width;
      const fy = el.clientHeight / doc.height;
      setFactor(scale === 'width' ? fx : Math.min(fx, fy));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc.width, doc.height, scale]);

  return (
    <div ref={host} className={`display-host scale-${scale}`}>
      <div className="display-scaler" style={{ width: doc.width * factor, height: doc.height * factor }}>
        <div
          className="display-canvas runtime"
          style={{
            width: doc.width, height: doc.height, transform: `scale(${factor})`,
            background: doc.background ?? 'var(--canvas-bg)',
            backgroundImage: doc.backgroundImage ? `url(${doc.backgroundImage})` : undefined,
          }}
        >
          {doc.elements.map((el) => (
            <ElementView key={el.id} el={el} mode="runtime" get={get} params={params} overrides={overrides} onEvent={onEvent} />
          ))}
        </div>
      </div>
    </div>
  );
}
