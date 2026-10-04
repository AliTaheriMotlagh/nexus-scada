import { useEffect, useRef, useState } from 'react';
import uPlot, { type AlignedData, type Options } from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { HistorySeries } from '@shared/types.ts';
import { api } from '../lib/api.ts';
import { tagCache } from '../lib/hub.ts';
import { useProject } from '../stores/project.ts';
import { useUi } from '../stores/ui.ts';

export const PEN_COLORS = ['#38bdf8', '#f97316', '#22c55e', '#e879f9', '#facc15', '#f43f5e', '#a78bfa', '#2dd4bf', '#fb923c', '#94a3b8'];

interface Props {
  paths: string[];
  /** Window length for live mode */
  minutes?: number;
  /** Fixed range (disables live mode) */
  from?: number;
  to?: number;
  live?: boolean;
  height?: number;
  compact?: boolean;
  colors?: string[];
  /** Step lines (for booleans/discrete) */
  stepped?: boolean;
}

type Series = { ts: number[]; vals: (number | null)[] };

function toNumber(v: unknown): number | null {
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(v);
  return v === null || v === undefined || Number.isNaN(n) ? null : n;
}

/** Merge per-pen series onto one shared time axis (uPlot's aligned data format). */
function align(series: Series[]): AlignedData {
  const tables = series.map((s) => [s.ts.map((t) => t / 1000), s.vals] as AlignedData);
  if (!tables.length) return [[]];
  if (tables.length === 1) return tables[0];
  return uPlot.join(tables as AlignedData[]);
}

/** Real-time + historical trend based on uPlot (fast canvas charting). */
export function TrendChart({ paths, minutes = 10, from, to, live = from === undefined, height, compact, colors = PEN_COLORS, stepped }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot>(undefined);
  const data = useRef<Series[]>([]);
  const [error, setError] = useState('');
  const theme = useUi((s) => s.theme);
  const tags = useProject((s) => s.tags);
  const key = paths.join('|');

  useEffect(() => {
    const el = host.current!;
    let disposed = false;
    const css = getComputedStyle(document.documentElement);
    const fg = css.getPropertyValue('--text-dim').trim() || '#8b98a5';
    const grid = css.getPropertyValue('--border').trim() || '#253041';
    const windowMs = minutes * 60_000;
    const end = to ?? Date.now();
    const start = from ?? end - windowMs;
    data.current = paths.map(() => ({ ts: [], vals: [] }));

    // one Y axis per engineering unit (left/right alternating), coloured like its first pen
    const unitOf = (p: string) => tags.get(p)?.unit || (tags.get(p)?.dataType === 'boolean' ? 'on/off' : '—');
    const units = [...new Set(paths.map(unitOf))];
    const axisColor = (u: string) => colors[paths.findIndex((p) => unitOf(p) === u) % colors.length];
    const opts: Options = {
      width: el.clientWidth || 600,
      height: height ?? (el.clientHeight || 260),
      legend: { show: !compact, live: true },
      cursor: { drag: { x: true, y: false }, sync: { key: 'nexus' } },
      scales: { x: { time: true }, ...Object.fromEntries(units.map((u) => [`u:${u}`, {}])) },
      axes: [
        { stroke: fg, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid }, size: compact ? 24 : 40, font: '11px system-ui' },
        ...(units.length ? units : ['—']).map((u, i) => ({
          scale: `u:${u}`,
          side: i % 2 ? 1 : 3,
          stroke: units.length > 1 ? axisColor(u) : fg,
          label: compact || units.length < 2 ? undefined : u,
          labelSize: 16,
          labelFont: '11px system-ui',
          grid: { show: i === 0, stroke: grid, width: 1 },
          ticks: { stroke: grid },
          size: compact ? 36 : 56,
          font: '11px system-ui',
        })),
      ],
      series: [
        {},
        ...paths.map((p, i) => {
          const info = tags.get(p);
          const color = colors[i % colors.length];
          return {
            label: info?.unit ? `${p} [${info.unit}]` : p,
            scale: `u:${unitOf(p)}`,
            stroke: color,
            width: 1.6,
            fill: paths.length === 1 ? `${color}22` : undefined,
            spanGaps: true,
            paths: stepped || info?.dataType === 'boolean' ? uPlot.paths.stepped!({ align: 1 }) : undefined,
            value: (_u: uPlot, v: number | null) => (v === null ? '—' : v.toFixed(info?.decimals ?? 2)),
          };
        }),
      ],
    };
    const u = new uPlot(opts, [[], ...paths.map(() => [])] as AlignedData, el);
    plot.current = u;

    const redraw = () => {
      if (disposed) return;
      const d = align(data.current);
      const now = Date.now();
      u.setData(d, false);
      if (live) u.setScale('x', { min: (now - windowMs) / 1000, max: now / 1000 });
      else u.setScale('x', { min: start / 1000, max: end / 1000 });
    };

    // 1) historical backfill
    if (paths.length) {
      api.get<HistorySeries[]>(`/history?paths=${encodeURIComponent(paths.join(','))}&from=${start}&to=${end}&points=${Math.min(2000, el.clientWidth * 2 || 1200)}`)
        .then((series) => {
          if (disposed) return;
          series.forEach((s, i) => {
            const target = data.current[i];
            const merged = s.points.map((p) => [p.ts, p.value] as const);
            // keep live points that arrived after the history query
            const lastHist = merged.length ? merged[merged.length - 1][0] : 0;
            const tail = target.ts.map((t, j) => [t, target.vals[j]] as const).filter(([t]) => t > lastHist);
            const all = [...merged, ...tail];
            target.ts = all.map(([t]) => t);
            target.vals = all.map(([, v]) => v);
          });
          setError('');
          redraw();
        })
        .catch((err: Error) => setError(err.message));
    }

    // 2) live updates over SignalR
    const unsubs: (() => void)[] = [];
    let timer: number | undefined;
    if (live) {
      paths.forEach((p, i) => {
        unsubs.push(tagCache.subscribe(p, () => {
          const v = tagCache.get(p);
          if (!v) return;
          const s = data.current[i];
          const ts = Math.max(v.ts, s.ts[s.ts.length - 1] ?? 0);
          s.ts.push(ts);
          s.vals.push(v.quality === 'bad' ? null : toNumber(v.value));
          const cutoff = Date.now() - windowMs * 1.2;
          while (s.ts.length && s.ts[0] < cutoff) { s.ts.shift(); s.vals.shift(); }
        }));
      });
      timer = window.setInterval(redraw, 1000);
    }

    const ro = new ResizeObserver(() => u.setSize({ width: el.clientWidth, height: height ?? Math.max(80, el.clientHeight - (compact ? 0 : 34)) }));
    ro.observe(el);
    return () => {
      disposed = true;
      ro.disconnect();
      clearInterval(timer);
      unsubs.forEach((f) => f());
      u.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, minutes, from, to, live, theme, compact, height]);

  return (
    <div className={`trend ${compact ? 'compact' : ''}`}>
      <div ref={host} className="trend-host" />
      {error && <div className="trend-error">{error}</div>}
      {!paths.length && <div className="trend-empty">Select tags to plot</div>}
    </div>
  );
}

/** Download history as CSV (server-side export). */
export function exportCsv(paths: string[], from: number, to: number) {
  const token = localStorage.getItem('nexus.token');
  const url = `/api/history/csv?paths=${encodeURIComponent(paths.join(','))}&from=${from}&to=${to}`;
  fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then((r) => r.blob())
    .then((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `trend-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
}
