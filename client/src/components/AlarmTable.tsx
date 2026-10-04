import { useMemo, useState } from 'react';
import { BellOff, Check, CheckCheck } from 'lucide-react';
import type { AlarmInfo } from '@shared/types.ts';
import { runtime } from '../lib/hub.ts';
import { fmtTime, SEVERITY_COLOR, timeAgo } from '../lib/format.ts';
import { useAlarms } from '../stores/alarms.ts';
import { useHasRole } from '../stores/session.ts';
import { errorToast, toast, useUi } from '../stores/ui.ts';

const STATE_LABEL: Record<AlarmInfo['state'], string> = {
  'active-unacked': 'Active · Unack', 'active-acked': 'Active · Ack', 'cleared-unacked': 'Cleared · Unack',
};

export async function ackAlarms(ids: string[]) {
  if (!ids.length) return;
  try {
    const n = await runtime.ackAlarms(ids);
    toast(`${n} alarm(s) acknowledged`, 'success');
  } catch (err) {
    errorToast(err);
  }
}

/** Live alarm list (used by the alarm viewer page and the embeddable alarm widget). */
export function AlarmTable({ area = '', compact, maxRows, showShelved = false, filter = '' }: {
  area?: string; compact?: boolean; maxRows?: number; showShelved?: boolean; filter?: string;
}) {
  const list = useAlarms((s) => s.list);
  const canAck = useHasRole('operator');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const q = filter.toLowerCase();
  const rows = useMemo(() => list
    .filter((a) => (!area || a.tag.startsWith(area)) && !!a.shelvedUntil === showShelved)
    .filter((a) => !q || a.message.toLowerCase().includes(q) || a.tag.toLowerCase().includes(q) || a.severity === q)
    .slice(0, maxRows ?? 1000), [list, area, showShelved, q, maxRows]);

  const shelve = async (a: AlarmInfo) => {
    const minutes = await useUi.getState().prompt(`Shelve "${a.message}" for how many minutes? (0 = unshelve)`, a.shelvedUntil ? '0' : '60');
    if (minutes === null) return;
    try {
      await runtime.shelveAlarm(a.id, Number(minutes));
    } catch (err) {
      errorToast(err);
    }
  };

  return (
    <div className={`alarm-table ${compact ? 'compact' : ''}`}>
      {!compact && canAck && (
        <div className="toolbar">
          <button disabled={!selected.size} onClick={() => { void ackAlarms([...selected]); setSelected(new Set()); }}><Check size={14} /> Ack selected</button>
          <button onClick={() => void ackAlarms(rows.filter((a) => a.state !== 'active-acked').map((a) => a.id))}><CheckCheck size={14} /> Ack all visible</button>
          <span className="spacer" />
          <span className="muted">{rows.length} alarm(s)</span>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {!compact && <th style={{ width: 28 }} />}
              <th style={{ width: 70 }}>Priority</th>
              <th style={{ width: 90 }}>Time</th>
              {!compact && <th style={{ width: 70 }}>Age</th>}
              <th>Message</th>
              {!compact && <th>Tag</th>}
              <th style={{ width: 120 }}>State</th>
              {!compact && <th>Value</th>}
              {!compact && <th>Ack by</th>}
              <th style={{ width: compact ? 40 : 76 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className={`alarm-row sev-${a.severity} ${a.state}`}>
                {!compact && (
                  <td><input type="checkbox" checked={selected.has(a.id)} onChange={(e) => {
                    const s = new Set(selected);
                    if (e.target.checked) s.add(a.id); else s.delete(a.id);
                    setSelected(s);
                  }} /></td>
                )}
                <td><span className="sev-badge" style={{ background: SEVERITY_COLOR[a.severity] }}>{a.severity}</span></td>
                <td>{fmtTime(a.activeAt)}</td>
                {!compact && <td className="muted">{timeAgo(a.activeAt)}</td>}
                <td className="alarm-msg">{a.message}</td>
                {!compact && <td className="mono muted">{a.tag}</td>}
                <td>{STATE_LABEL[a.state]}</td>
                {!compact && <td className="mono">{typeof a.value === 'number' ? a.value.toFixed(2) : String(a.value)}</td>}
                {!compact && <td className="muted">{a.ackBy ?? ''}</td>}
                <td className="row-actions">
                  {canAck && a.state !== 'active-acked' && <button className="icon-btn" title="Acknowledge" onClick={() => void ackAlarms([a.id])}><Check size={14} /></button>}
                  {canAck && !compact && <button className="icon-btn" title={a.shelvedUntil ? 'Unshelve' : 'Shelve'} onClick={() => void shelve(a)}><BellOff size={14} /></button>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={10} className="empty-row">{showShelved ? 'No shelved alarms' : 'No active alarms ✓'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
