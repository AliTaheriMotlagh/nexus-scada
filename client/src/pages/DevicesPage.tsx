import { Power, RefreshCw } from 'lucide-react';
import { api } from '../lib/api.ts';
import { fmtTime } from '../lib/format.ts';
import { navigate } from '../lib/router.ts';
import { useProject } from '../stores/project.ts';
import { useHasRole } from '../stores/session.ts';
import { errorToast, toast } from '../stores/ui.ts';

/** Communication diagnostics for every device node. */
export function DevicesPage() {
  const devices = [...useProject((s) => s.devices).values()];
  const canEdit = useHasRole('engineer');
  const call = async (url: string, body: unknown, msg: string) => {
    try {
      await api.post(url, body);
      toast(msg, 'success');
    } catch (err) { errorToast(err); }
  };
  return (
    <div className="page">
      <main className="content">
        <div className="content-head"><h2>Devices & communication</h2><span className="muted small">{devices.length} devices</span></div>
        <div className="content-body padded">
          <div className="device-grid">
            {devices.map((d) => (
              <div key={d.path} className={`device-card state-${d.state}`}>
                <div className="device-head">
                  <span className={`dot state-${d.state}`} />
                  <b className="clickable" onClick={() => navigate('tags', d.path)}>{d.path}</b>
                  <span className="chip">{d.driver}</span>
                </div>
                <div className="device-state">{d.state}<span className="muted"> {d.message ?? ''}</span></div>
                <div className="device-stats">
                  <span><b>{d.tagCount}</b> tags</span><span><b>{d.reads}</b> reads</span><span><b>{d.writes}</b> writes</span>
                  <span className={d.errors ? 'err' : ''}><b>{d.errors}</b> errors</span>
                </div>
                <div className="muted small">last update {fmtTime(d.lastUpdate)}</div>
                {canEdit && (
                  <div className="device-actions">
                    <button onClick={() => void call('/devices/enable', { path: d.path, enabled: !d.enabled }, `${d.path} ${d.enabled ? 'disabled' : 'enabled'}`)}>
                      <Power size={13} /> {d.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button onClick={() => void call('/devices/restart', { path: d.path }, `${d.path} restarted`)}><RefreshCw size={13} /> Restart</button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="hint">Enable/disable here is a runtime override. To persist, set <code>enabled</code> on the device in the Tags page or project.yaml.</p>
        </div>
      </main>
    </div>
  );
}
