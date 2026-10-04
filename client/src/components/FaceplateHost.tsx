import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, LineChart, X } from 'lucide-react';
import type { DisplayDoc, TagInfo } from '@shared/types.ts';
import { DisplayView } from '../graphics/DisplayView.tsx';
import { writeTag } from '../graphics/elements/controls.tsx';
import { useTag } from '../hooks/useTags.ts';
import { api, enc } from '../lib/api.ts';
import { formatValue, fmtTime } from '../lib/format.ts';
import { navigate } from '../lib/router.ts';
import { useProject } from '../stores/project.ts';
import { useHasRole } from '../stores/session.ts';
import { useUi, type FaceplateWindow } from '../stores/ui.ts';
import { AlarmTable } from './AlarmTable.tsx';
import { TrendChart } from './TrendChart.tsx';

function TagRow({ info }: { info: TagInfo }) {
  const tv = useTag(info.path);
  const canWrite = useHasRole(info.writeRole ?? 'operator') && info.writable;
  const [text, setText] = useState<string | null>(null);
  const v = tv?.value;
  let control = null;
  if (canWrite) {
    if (info.dataType === 'boolean') {
      control = (
        <button role="switch" aria-checked={Boolean(v)} className={`switch small ${v ? 'on' : ''}`} onClick={() => void writeTag(info.path, !v)}><span /></button>
      );
    } else if (info.states) {
      control = (
        <select value={String(v ?? '')} onChange={(e) => void writeTag(info.path, e.target.value)}>
          {Object.entries(info.states).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      );
    } else {
      control = (
        <input className="fp-input" type={info.dataType === 'number' ? 'number' : 'text'} placeholder="new value"
          value={text ?? ''} onChange={(e) => setText(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key !== 'Enter' || text === null || text === '') return;
            const value = info.dataType === 'number' ? Number(text) : text;
            if (await writeTag(info.path, value)) setText(null);
          }} />
      );
    }
  }
  return (
    <tr className={`q-row q-${tv?.quality ?? 'unknown'}`}>
      <td title={info.description ?? info.path}>{info.path.split('/').slice(-2).join(' / ')}</td>
      <td className="mono fp-val">{formatValue(v, info)}</td>
      <td className="muted small">{tv?.quality ?? '—'} · {fmtTime(tv?.ts)}</td>
      <td>{control}</td>
    </tr>
  );
}

/** Auto-generated faceplate: every tag under the path, operator controls, trend and alarms. */
function GenericFaceplate({ path }: { path: string }) {
  const tags = useProject((s) => s.tags);
  const infos = useMemo(() => [...tags.values()].filter((t) => t.path === path || t.path.startsWith(`${path}/`)), [tags, path]);
  const trendable = infos.filter((t) => t.dataType === 'number' && t.history).slice(0, 4).map((t) => t.path);
  return (
    <div className="faceplate-generic">
      <table className="fp-table">
        <tbody>{infos.map((i) => <TagRow key={i.path} info={i} />)}</tbody>
      </table>
      {!infos.length && <div className="muted">No tags under “{path}”</div>}
      {trendable.length > 0 && (
        <div className="fp-trend"><TrendChart paths={trendable} minutes={10} height={150} compact /></div>
      )}
      <AlarmTable area={path} compact maxRows={5} />
    </div>
  );
}

function CustomFaceplate({ display, params }: { display: string; params: Record<string, string> }) {
  const [doc, setDoc] = useState<DisplayDoc | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get<DisplayDoc>(`/displays/${enc(display)}`).then(setDoc).catch((e: Error) => setError(e.message));
  }, [display]);
  if (error) return <div className="form-error">{error}</div>;
  if (!doc) return <div className="loading">Loading…</div>;
  return <div className="fp-custom" style={{ width: doc.width, maxWidth: '100%', aspectRatio: `${doc.width} / ${doc.height}`, maxHeight: '70dvh' }}><DisplayView doc={doc} params={params} scale="fit" /></div>;
}

function FaceplateWindowView({ fp, index }: { fp: FaceplateWindow; index: number }) {
  const close = useUi((s) => s.closeFaceplate);
  const [pos, setPos] = useState({ x: 120 + index * 36, y: 90 + index * 30 });
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  return (
    <div className="faceplate" style={{ left: pos.x, top: pos.y, maxWidth: 'calc(100vw - 16px)' }}>
      <div
        className="faceplate-header"
        onPointerDown={(e) => {
          drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => { if (drag.current) setPos({ x: Math.max(0, e.clientX - drag.current.dx), y: Math.max(0, e.clientY - drag.current.dy) }); }}
        onPointerUp={() => { drag.current = null; }}
      >
        <span className="fp-title">{fp.path}</span>
        <button className="icon-btn" title="Open trend" onClick={() => navigate('trends', '', { prefix: fp.path })}><LineChart size={14} /></button>
        <button className="icon-btn" title="Show in tag browser" onClick={() => navigate('tags', fp.path)}><ExternalLink size={14} /></button>
        <button className="icon-btn" title="Close" onClick={() => close(fp.id)}><X size={15} /></button>
      </div>
      <div className="faceplate-body">
        {fp.display ? <CustomFaceplate display={fp.display} params={fp.params ?? { path: fp.path }} /> : <GenericFaceplate path={fp.path} />}
      </div>
    </div>
  );
}

export function FaceplateHost() {
  const faceplates = useUi((s) => s.faceplates);
  return <>{faceplates.map((fp, i) => <FaceplateWindowView key={fp.id} fp={fp} index={i} />)}</>;
}
