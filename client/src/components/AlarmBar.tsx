import { Bell, BellOff, Check, Volume2, VolumeX } from 'lucide-react';
import { SEVERITY_RANK } from '@shared/types.ts';
import { fmtTime, SEVERITY_COLOR } from '../lib/format.ts';
import { navigate } from '../lib/router.ts';
import { useAlarms } from '../stores/alarms.ts';
import { useHasRole } from '../stores/session.ts';
import { ackAlarms } from './AlarmTable.tsx';

/** Always-visible alarm banner: newest highest-priority alarm, counts per priority, ack & horn silence. */
export function AlarmBar() {
  const list = useAlarms((s) => s.list).filter((a) => !a.shelvedUntil);
  const silenced = useAlarms((s) => s.hornSilenced);
  const silence = useAlarms((s) => s.silence);
  const hornEnabled = useAlarms((s) => s.hornEnabled);
  const setHorn = useAlarms((s) => s.setHornEnabled);
  const canAck = useHasRole('operator');
  const unacked = list.filter((a) => a.state !== 'active-acked');
  const top = [...list].sort((a, b) => (a.state === 'active-acked' ? 1 : 0) - (b.state === 'active-acked' ? 1 : 0)
    || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.activeAt - a.activeAt)[0];
  const counts = (['critical', 'high', 'medium', 'low'] as const).map((s) => [s, list.filter((a) => a.severity === s).length] as const);

  return (
    <footer className={`alarm-bar ${unacked.length ? 'has-unacked' : ''}`}>
      <button className="alarm-bar-icon" onClick={() => navigate('alarms')} title="Open alarm viewer">
        <Bell size={16} className={unacked.length ? 'blink' : ''} />
      </button>
      <div className="alarm-counts">
        {counts.map(([s, n]) => (
          <span key={s} className="alarm-count" style={{ background: n ? SEVERITY_COLOR[s] : undefined }} title={s}>{n}</span>
        ))}
      </div>
      <div className="alarm-bar-text" onClick={() => navigate('alarms')}>
        {top ? (
          <>
            <span className="sev-badge" style={{ background: SEVERITY_COLOR[top.severity] }}>{top.severity}</span>
            <span className="muted">{fmtTime(top.activeAt)}</span>
            <span className={top.state === 'active-unacked' ? 'blink-text' : ''}>{top.message}</span>
          </>
        ) : <span className="muted">No active alarms</span>}
      </div>
      <span className="muted small">{unacked.length} unacked / {list.length} active</span>
      {canAck && top && top.state !== 'active-acked' && (
        <button onClick={() => void ackAlarms([top.id])} title="Acknowledge shown alarm"><Check size={14} /> Ack</button>
      )}
      <button onClick={silence} disabled={silenced || !unacked.length} title="Silence horn"><BellOff size={14} /></button>
      <button className="icon-btn" onClick={() => setHorn(!hornEnabled)} title={hornEnabled ? 'Mute horn' : 'Enable horn'}>
        {hornEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
      </button>
    </footer>
  );
}
