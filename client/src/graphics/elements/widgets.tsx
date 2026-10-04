import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { SceneDoc } from '@shared/types.ts';
import { AlarmTable } from '../../components/AlarmTable.tsx';
import { TrendChart } from '../../components/TrendChart.tsx';
import { useTagValues } from '../../hooks/useTags.ts';
import { api, enc } from '../../lib/api.ts';
import { tagCache } from '../../lib/hub.ts';
import { useProject } from '../../stores/project.ts';
import { bool, clamp, num, register, str, type RenderContext } from '../registry.ts';

const SceneView = lazy(() => import('../../scene3d/SceneView.tsx'));

const list = (v: unknown) => str(v).split(',').map((s) => s.trim()).filter(Boolean);

function Trend({ props: p }: RenderContext) {
  return <div className="widget-frame"><TrendChart paths={list(p.tags)} minutes={num(p.minutes, 10)} compact={!bool(p.legend)} /></div>;
}

function Sparkline({ props: p }: RenderContext) {
  const tag = str(p.tag);
  const [points, setPoints] = useState<number[]>([]);
  const max = num(p.points, 60);
  useEffect(() => {
    if (!tag) return;
    return tagCache.subscribe(tag, () => {
      const v = Number(tagCache.get(tag)?.value);
      if (!Number.isNaN(v)) setPoints((prev) => [...prev.slice(-(max - 1)), v]);
    });
  }, [tag, max]);
  const lo = Math.min(...points), hi = Math.max(...points);
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${(i / Math.max(1, max - 1)) * 100} ${30 - ((v - lo) / (hi - lo || 1)) * 28 - 1}`).join(' ');
  const color = str(p.color, '#38bdf8');
  return (
    <div className="sparkline">
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" width="100%" height="100%">
        {points.length > 1 && <path d={`${d} L${((points.length - 1) / Math.max(1, max - 1)) * 100} 30 L0 30 Z`} fill={color} opacity="0.15" />}
        <path d={d} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      {points.length > 0 && <span className="spark-val">{points[points.length - 1].toFixed(num(p.decimals, 1))}</span>}
    </div>
  );
}

function AlarmWidget({ props: p }: RenderContext) {
  return <div className="widget-frame"><AlarmTable area={str(p.area)} compact maxRows={num(p.maxRows, 8)} /></div>;
}

function Frame({ props: p, runtime }: RenderContext) {
  const url = str(p.url);
  if (!url) return <div className="placeholder">Web frame — set URL</div>;
  return <iframe src={url} title="web frame" style={{ width: '100%', height: '100%', border: 0, pointerEvents: runtime ? 'auto' : 'none', background: '#fff' }} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />;
}

function BarChart({ props: p }: RenderContext) {
  const tags = list(p.tags);
  const labels = list(p.labels);
  const get = useTagValues(tags);
  const info = useProject((s) => s.tags);
  const values = tags.map((t) => num(get(t)?.value));
  const max = num(p.max, Math.max(1, ...values));
  return (
    <div className="barchart">
      {tags.map((t, i) => (
        <div key={t} className="barchart-col" title={t}>
          <span className="barchart-val">{values[i].toFixed(num(p.decimals, 0))}</span>
          <div className="barchart-track"><div style={{ height: `${clamp(values[i] / max, 0, 1) * 100}%`, background: str(p.color, '#6366f1') }} /></div>
          <span className="barchart-lbl">{labels[i] ?? info.get(t)?.name ?? t}</span>
        </div>
      ))}
    </div>
  );
}

/** Embedded live 3D viewport. */
function Scene3D({ props: p }: RenderContext) {
  const name = str(p.scene);
  const [doc, setDoc] = useState<SceneDoc | null>(null);
  const revision = useProject((s) => s.revision);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!name) return;
    api.get<SceneDoc>(`/scenes/${enc(name)}`).then(setDoc).catch(() => setDoc(null));
  }, [name, revision]);
  if (!name) return <div className="placeholder">3D viewport — choose a scene</div>;
  return (
    <div ref={host} className="widget-frame scene-embed">
      {doc ? <Suspense fallback={<div className="loading">Loading 3D…</div>}><SceneView doc={doc} mode="runtime" autoRotate={bool(p.autoRotate)} /></Suspense> : <div className="loading">Loading…</div>}
    </div>
  );
}

register(
  {
    type: 'trend', label: 'Trend', category: 'Widgets', w: 420, h: 220, Component: Trend,
    props: [
      { name: 'tags', type: 'tags', default: '', group: 'Data', bindable: false },
      { name: 'minutes', type: 'number', default: 10, min: 1 },
      { name: 'legend', type: 'boolean', default: false },
    ],
  },
  {
    type: 'sparkline', label: 'Sparkline', category: 'Widgets', w: 160, h: 44, Component: Sparkline,
    props: [{ name: 'tag', type: 'tag', default: '', group: 'Data', bindable: false }, { name: 'points', type: 'number', default: 60 }, { name: 'decimals', type: 'number', default: 1 }, { name: 'color', type: 'color', default: '#38bdf8' }],
  },
  {
    type: 'barChart', label: 'Bar chart', category: 'Widgets', w: 300, h: 180, Component: BarChart,
    props: [{ name: 'tags', type: 'tags', default: '', group: 'Data', bindable: false }, { name: 'labels', type: 'string', default: '' }, { name: 'max', type: 'number' }, { name: 'decimals', type: 'number', default: 0 }, { name: 'color', type: 'color', default: '#6366f1' }],
  },
  {
    type: 'alarmTable', label: 'Alarm list', category: 'Widgets', w: 520, h: 200, Component: AlarmWidget, interactive: true,
    props: [{ name: 'area', type: 'string', default: '', help: 'Tag path prefix filter' }, { name: 'maxRows', type: 'number', default: 8 }],
  },
  { type: 'iframe', label: 'Web frame', category: 'Widgets', w: 400, h: 260, Component: Frame, interactive: true, props: [{ name: 'url', type: 'url', default: '' }] },
  {
    type: 'scene3d', label: '3D viewport', category: 'Widgets', w: 420, h: 300, Component: Scene3D, interactive: true,
    props: [{ name: 'scene', type: 'scene', default: '' }, { name: 'autoRotate', type: 'boolean', default: false }],
  },
);
