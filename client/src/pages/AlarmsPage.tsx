import { useEffect, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import type { AlarmEvent } from '@shared/types.ts';
import { AlarmTable } from '../components/AlarmTable.tsx';
import { Tabs } from '../components/Overlays.tsx';
import { api } from '../lib/api.ts';
import { fmtDateTime, SEVERITY_COLOR } from '../lib/format.ts';
import { useAlarms } from '../stores/alarms.ts';
import { errorToast } from '../stores/ui.ts';

const RANGES = { '1h': 3_600_000, '8h': 8 * 3_600_000, '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 };

function AlarmHistory() {
  const [range, setRange] = useState<keyof typeof RANGES>('24h');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<AlarmEvent[]>([]);
  const load = () => {
    const to = Date.now();
    api.get<AlarmEvent[]>(`/alarms/history?from=${to - RANGES[range]}&to=${to}&q=${encodeURIComponent(q)}&limit=2000`).then(setRows).catch(errorToast);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [range]);
  return (
    <div className="alarm-table">
      <div className="toolbar">
        <select value={range} onChange={(e) => setRange(e.target.value as keyof typeof RANGES)}>{Object.keys(RANGES).map((r) => <option key={r}>{r}</option>)}</select>
        <div className="search"><Search size={14} /><input placeholder="Search message / tag…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load(); }} /></div>
        <button onClick={load}><RefreshCw size={14} /> Refresh</button>
        <span className="spacer" />
        <span className="muted">{rows.length} events</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Time</th><th>Event</th><th>Priority</th><th>Message</th><th>Tag</th><th>Value</th><th>User</th><th>Comment</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`ev-${r.event}`}>
                <td className="mono small">{fmtDateTime(r.ts)}</td>
                <td><span className={`ev-badge ev-${r.event}`}>{r.event}</span></td>
                <td><span className="sev-badge" style={{ background: SEVERITY_COLOR[r.severity] }}>{r.severity}</span></td>
                <td>{r.message}</td>
                <td className="mono muted">{r.tag}</td>
                <td className="mono">{typeof r.value === 'number' ? r.value.toFixed(2) : String(r.value ?? '')}</td>
                <td>{r.user ?? ''}</td>
                <td className="muted">{r.comment ?? ''}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="empty-row">No events in range</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AlarmsPage() {
  const [tab, setTab] = useState<'active' | 'shelved' | 'history'>('active');
  const [filter, setFilter] = useState('');
  const list = useAlarms((s) => s.list);
  const shelved = list.filter((a) => a.shelvedUntil).length;
  return (
    <div className="page">
      <main className="content">
        <div className="content-head">
          <h2>Alarms & Events</h2>
          <Tabs value={tab} onChange={setTab} tabs={[
            { id: 'active', label: `Active (${list.length - shelved})` }, { id: 'shelved', label: `Shelved (${shelved})` }, { id: 'history', label: 'History' },
          ]} />
          <span className="spacer" />
          {tab !== 'history' && <div className="search"><Search size={14} /><input placeholder="Filter (text, tag or priority)…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>}
        </div>
        <div className="content-body padded">
          {tab === 'active' && <AlarmTable filter={filter} />}
          {tab === 'shelved' && <AlarmTable filter={filter} showShelved />}
          {tab === 'history' && <AlarmHistory />}
        </div>
      </main>
    </div>
  );
}
