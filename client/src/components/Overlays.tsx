import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, TriangleAlert, X, XCircle } from 'lucide-react';
import { useUi } from '../stores/ui.ts';

export function Modal({ title, onClose, children, footer, width = 520, className }: {
  title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number | string; className?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${className ?? ''}`} style={{ width }} role="dialog" aria-modal="true">
        <div className="modal-header">
          <span>{title}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

const TOAST_ICON = { info: <Info size={16} />, success: <CheckCircle2 size={16} />, warning: <TriangleAlert size={16} />, error: <XCircle size={16} /> };

export function ToastHost() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <div className="toast-host" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)}>
          {TOAST_ICON[t.kind]}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

/** Promise-based confirm / prompt dialogs (used by scripts via ui.confirm / ui.prompt). */
export function DialogHost() {
  const dialog = useUi((s) => s.dialog);
  const close = useUi((s) => s.closeDialog);
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setText(dialog?.defaultValue ?? '');
    setTimeout(() => input.current?.select(), 30);
  }, [dialog]);
  if (!dialog) return null;
  const ok = () => close(dialog.kind === 'prompt' ? text : true);
  return (
    <Modal
      title={dialog.kind === 'confirm' ? 'Confirm' : 'Input'}
      onClose={() => close(dialog.kind === 'prompt' ? null : false)}
      width={420}
      footer={<>
        <button onClick={() => close(dialog.kind === 'prompt' ? null : false)}>Cancel</button>
        <button className="primary" onClick={ok} autoFocus={dialog.kind === 'confirm'}>OK</button>
      </>}
    >
      <p className="dialog-message">{dialog.message}</p>
      {dialog.kind === 'prompt' && (
        <input ref={input} className="full" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') ok(); }} />
      )}
    </Modal>
  );
}

/** Small popover anchored below its trigger. */
export function Popover({ open, onClose, children, className }: { open: boolean; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open, onClose]);
  if (!open) return null;
  return <div ref={ref} className={`popover ${className ?? ''}`}>{children}</div>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? 'active' : ''} onClick={() => onChange(t.id)}>{t.label}</button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
