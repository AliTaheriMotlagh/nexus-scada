import { useState } from 'react';
import { LogIn } from 'lucide-react';
import type { SessionUser } from '@shared/types.ts';
import { runtime } from '../lib/hub.ts';
import { useSession } from '../stores/session.ts';
import { Modal } from './Overlays.tsx';

export function LoginDialog() {
  const open = useSession((s) => s.loginOpen);
  const setOpen = useSession((s) => s.openLogin);
  const setSession = useSession((s) => s.setSession);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) return null;

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Login failed');
      setSession(data.token as string, data.user as SessionUser);
      setOpen(false);
      setPassword('');
      void runtime.start(); // reconnect the hub with the new identity
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={<><LogIn size={16} /> Sign in</>} onClose={() => setOpen(false)} width={360}
      footer={<button className="primary" disabled={busy || !username} onClick={submit}>Sign in</button>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label>Username<input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
        {error && <div className="form-error">{error}</div>}
        <div className="hint">Demo users: admin/admin · engineer/engineer · operator/operator</div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
