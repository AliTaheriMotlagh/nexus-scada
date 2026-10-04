import { useMemo, useState } from 'react';
import { Sidebar } from '../components/Sidebar.tsx';
import { Download, Radio, Search, Trash2 } from 'lucide-react';
import { exportCsv, PEN_COLORS, TrendChart } from '../components/TrendChart.tsx';
import { pruneTree, Tree } from '../components/Tree.tsx';
import { useTag } from '../hooks/useTags.ts';
import { formatValue } from '../lib/format.ts';
import { useRoute } from '../lib/router.ts';
import { useProject } from '../stores/project.ts';

const PRESETS: Record<string, number> = { '5 min': 5, '15 min': 15, '1 h': 60, '8 h': 480, '24 h': 1440, '7 d': 10080 };
const STORE_KEY = 'nexus.trend.pens';

function PenValue({ path, color }: { path: string; color: string }) {
  const tv = useTag(path);
  const info = useProject((s) => s.tags.get(path));
  return <span className="pen-value" style={{ color }}>{formatValue(tv?.value, info)}</span>;
}

export function TrendsPage() {
  const route = useRoute();
  const tree = useProject((s) => s.tree);
  const tags = useProject((s) => s.tags);
  const [filter, setFilter] = useState(route.query.get('prefix') ?? '');
  const [pens, setPens] = useState<string[]>(() => {
    const prefix = route.query.get('prefix');
    if (prefix) return [...tags.values()].filter((t) => t.history && t.dataType !== 'string' && t.path.startsWith(prefix)).slice(0, 6).map((t) => t.path);
    try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]'); } catch { return []; }
  });
  const [preset, setPreset] = useState('15 min');
  const [live, setLive] = useState(true);
  const [from, setFrom] = useState(() => new Date(Date.now() - 3_600_000).toISOString().slice(0, 16));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));

  const historized = useMemo(() => pruneTree(tree, (it) => it.kind === 'tag' && !!tags.get(it.id)?.history), [tree, tags]);
  const update = (next: string[]) => {
    setPens(next);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const minutes = PRESETS[preset];
  const range = live ? undefined : { from: new Date(from).getTime(), to: new Date(to).getTime() };

  return (
    <div className="page with-sidebar">
      <Sidebar>
        <div className="sidebar-head"><span>Historized tags</span></div>
        <div className="search"><Search size={14} /><input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        <div className="sidebar-scroll">
          <Tree items={historized} filter={filter} defaultDepth={3} checked={new Set(pens)}
            onCheck={(it, on) => update(on ? [...pens, it.id].slice(-10) : pens.filter((p) => p !== it.id))}
            onActivate={(it) => update(pens.includes(it.id) ? pens : [...pens, it.id].slice(-10))} />
        </div>
      </Sidebar>
      <main className="content">
        <div className="content-head">
          <h2>Trends</h2>
          <button className={live ? 'active' : ''} onClick={() => setLive(!live)}><Radio size={14} /> {live ? 'Live' : 'Historical'}</button>
          {live
            ? <select value={preset} onChange={(e) => setPreset(e.target.value)}>{Object.keys(PRESETS).map((p) => <option key={p}>{p}</option>)}</select>
            : <>
              <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
              <span>→</span>
              <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
            </>}
          <span className="spacer" />
          <button disabled={!pens.length} onClick={() => exportCsv(pens, range?.from ?? Date.now() - minutes * 60_000, range?.to ?? Date.now())}><Download size={14} /> CSV</button>
          <button disabled={!pens.length} onClick={() => update([])}><Trash2 size={14} /> Clear</button>
        </div>
        <div className="pens">
          {pens.map((p, i) => (
            <span key={p} className="pen" style={{ borderColor: PEN_COLORS[i % PEN_COLORS.length] }}>
              <i style={{ background: PEN_COLORS[i % PEN_COLORS.length] }} />{p}<PenValue path={p} color={PEN_COLORS[i % PEN_COLORS.length]} />
              <button className="icon-btn" onClick={() => update(pens.filter((x) => x !== p))}>×</button>
            </span>
          ))}
          {!pens.length && <span className="muted">Tick historized tags in the tree to add pens (max 10). Drag on the chart to zoom, double-click to reset.</span>}
        </div>
        <div className="content-body padded trend-page">
          <TrendChart key={`${live}-${minutes}-${range?.from}-${range?.to}`} paths={pens} minutes={live ? minutes : 60} from={range?.from} to={range?.to} live={live} />
        </div>
      </main>
    </div>
  );
}
