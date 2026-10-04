import { useEffect, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import type { AuditEntry, LogEntry, ScheduleConfig } from '@shared/types.ts';
import { Tabs } from '../components/Overlays.tsx';
import { api } from '../lib/api.ts';
import { fmtDateTime } from '../lib/format.ts';
import { runtime } from '../lib/hub.ts';
import { useProject } from '../stores/project.ts';
import { errorToast } from '../stores/ui.ts';

function Audit() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [q, setQ] = useState('');
  const load = () => api.get<AuditEntry[]>(`/audit?q=${encodeURIComponent(q)}`).then(setRows).catch(errorToast);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);
  return (
    <>
      <div className="toolbar">
        <div className="search"><Search size={14} /><input placeholder="user, action or target…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void load(); }} /></div>
        <button onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td className="mono small">{fmtDateTime(r.ts)}</td><td>{r.user}</td><td><span className="chip">{r.action}</span></td><td className="mono">{r.target}</td><td className="muted mono small">{r.details}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}

function Logs() {
  const [rows, setRows] = useState<LogEntry[]>([]);
  const load = () => api.get<LogEntry[]>('/logs?limit=800').then((r) => setRows(r.reverse())).catch(errorToast);
  useEffect(() => {
    void load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="console tall">
      <div className="console-body">{rows.map((r, i) => <div key={i} className={`log-${r.level}`}><span className="muted">{fmtDateTime(r.ts)}</span> <b>{r.level.toUpperCase()}</b> [{r.source}] {r.message}</div>)}</div>
    </div>
  );
}

function Schedules() {
  const [data, setData] = useState<{ config: ScheduleConfig[]; jobs: { name: string; schedule: string; next?: number }[] } | null>(null);
  useEffect(() => { api.get<typeof data>('/schedules').then(setData).catch(errorToast); }, []);
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Job</th><th>Schedule</th><th>Next run</th><th>Actions</th></tr></thead>
        <tbody>
          {data?.jobs.map((j) => {
            const cfg = data.config.find((c) => `schedule:${c.name}` === j.name);
            return (
              <tr key={j.name}>
                <td>{j.name}</td><td className="mono">{j.schedule}</td><td>{fmtDateTime(j.next)}</td>
                <td className="muted mono small">{cfg ? cfg.actions.map((a) => ('write' in a ? `${a.write} = ${JSON.stringify(a.value)}` : `run ${a.script}`)).join('; ') : 'script trigger'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="hint">Edit schedules in project.yaml (<code>schedules:</code>). Supports cron, @hourly/@daily, <code>@every 30s</code>, <code>@sunrise+10m</code>, <code>@sunset-15m</code>.</p>
    </div>
  );
}

function About() {
  const info = useProject((s) => s.info);
  const tags = useProject((s) => s.tags.size);
  const devices = useProject((s) => s.devices.size);
  return (
    <div className="about">
      <h3>{info?.name}</h3>
      <p>{info?.description}</p>
      <table className="kv">
        <tbody>
          <tr><td>Project version</td><td>{info?.version}</td></tr>
          <tr><td>Config revision</td><td>{info?.revision}</td></tr>
          <tr><td>Server uptime</td><td>{Math.round((info?.uptimeSec ?? 0) / 60)} min</td></tr>
          <tr><td>Tags / devices</td><td>{tags} / {devices}</td></tr>
          <tr><td>Realtime link</td><td>SignalR (WebSockets) · {runtime.state}</td></tr>
          <tr><td>Location</td><td>{info?.location ? `${info.location.lat}, ${info.location.lng}` : '—'}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

export function SystemPage() {
  const [tab, setTab] = useState<'audit' | 'logs' | 'schedules' | 'about'>('audit');
  return (
    <div className="page">
      <main className="content">
        <div className="content-head">
          <h2>System</h2>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'audit', label: 'Audit trail' }, { id: 'logs', label: 'Server log' }, { id: 'schedules', label: 'Schedules' }, { id: 'about', label: 'About' }]} />
        </div>
        <div className="content-body padded scroll">
          {tab === 'audit' && <Audit />}
          {tab === 'logs' && <Logs />}
          {tab === 'schedules' && <Schedules />}
          {tab === 'about' && <About />}
        </div>
      </main>
    </div>
  );
}
