import { useEffect, useState } from 'react';
import { useTag, useTagInfo } from '../../hooks/useTags.ts';
import { formatValue } from '../../lib/format.ts';
import { runtime, tagCache } from '../../lib/hub.ts';
import { navigate } from '../../lib/router.ts';
import { hasRole, useSession } from '../../stores/session.ts';
import { errorToast, toast, useUi } from '../../stores/ui.ts';
import { bool, clamp, num, parseStates, register, str, useSvgId, type PropDef, type RenderContext } from '../registry.ts';

/** Write with role check and user feedback. */
export async function writeTag(path: unknown, value: unknown): Promise<boolean> {
  const p = str(path);
  if (!p) {
    toast('No tag configured for this control', 'warning');
    return false;
  }
  if (!hasRole('operator')) {
    useSession.getState().openLogin(true);
    toast('Sign in as operator to operate the process', 'warning');
    return false;
  }
  try {
    await runtime.write(p, value);
    return true;
  } catch (err) {
    errorToast(err);
    return false;
  }
}

function parseLiteral(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

const tagProp: PropDef = { name: 'tag', type: 'tag', default: '', group: 'Data', bindable: false };

// ───────────────────────────── Controls ─────────────────────────────

function Button({ props: p, runtime: live, fire }: RenderContext) {
  const tv = useTag(str(p.tag) || undefined);
  const action = str(p.action, 'none');
  const active = action === 'toggle' && bool(tv?.value);
  const run = async () => {
    if (!live) return;
    if (bool(p.confirm) && !(await useUi.getState().confirm(str(p.confirmText) || `Execute "${str(p.text)}"?`))) return;
    switch (action) {
      case 'write': await writeTag(p.tag, parseLiteral(p.value)); break;
      case 'toggle': await writeTag(p.tag, !bool(tagCache.get(str(p.tag))?.value)); break;
      case 'pulse':
        if (await writeTag(p.tag, true)) setTimeout(() => void writeTag(p.tag, false), num(p.pulseMs, 500));
        break;
      case 'navigate': navigate('view', str(p.target)); break;
      case 'faceplate': useUi.getState().openFaceplate(str(p.target) || str(p.tag)); break;
      case 'scene': navigate('scenes', str(p.target)); break;
    }
    fire('click');
  };
  const bg = active ? str(p.activeColor, '#16a34a') : str(p.color, '#2563eb');
  return (
    <button className="hmi-btn" style={{ background: bg, color: str(p.textColor, '#fff'), fontSize: num(p.fontSize, 14), borderRadius: num(p.radius, 6) }} onClick={() => void run()}>
      {str(p.text, 'Button')}
    </button>
  );
}

function Switch({ props: p, runtime: live, fire }: RenderContext) {
  const tv = useTag(str(p.tag) || undefined);
  const on = bool(p.tag ? tv?.value : p.value);
  return (
    <label className="hmi-switch" style={{ fontSize: num(p.fontSize, 13) }}>
      <button
        role="switch"
        aria-checked={on}
        className={`switch ${on ? 'on' : ''}`}
        style={{ background: on ? str(p.onColor, '#22c55e') : undefined }}
        onClick={async () => { if (live && (await writeTag(p.tag, !on))) fire('change', { value: !on }); }}
      >
        <span />
      </button>
      {str(p.label) && <span>{str(p.label)}</span>}
    </label>
  );
}

function Slider({ props: p, runtime: live, fire }: RenderContext) {
  const tag = str(p.tag) || undefined;
  const tv = useTag(tag);
  const info = useTagInfo(tag);
  const min = num(p.min, info?.min ?? 0), max = num(p.max, info?.max ?? 100);
  const [drag, setDrag] = useState<number | null>(null);
  const v = drag ?? num(tv?.value, min);
  const vertical = str(p.orientation) === 'vertical';
  const commit = async () => {
    if (drag === null) return;
    const value = drag;
    setDrag(null);
    if (await writeTag(tag, value)) fire('change', { value });
  };
  return (
    <div className={`hmi-slider ${vertical ? 'vertical' : ''}`}>
      <input type="range" min={min} max={max} step={num(p.step, 1)} value={v} disabled={!live}
        style={{ accentColor: str(p.color, '#38bdf8') }}
        onChange={(e) => setDrag(Number(e.target.value))} onPointerUp={() => void commit()} onKeyUp={() => void commit()} />
      {bool(p.showValue ?? true) && <span className="slider-value">{formatValue(v, info)}</span>}
    </div>
  );
}

function Numeric({ props: p, runtime: live, fire }: RenderContext) {
  const tag = str(p.tag) || undefined;
  const tv = useTag(tag);
  const info = useTagInfo(tag);
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (tv?.value === undefined ? '' : String(typeof tv.value === 'number' ? Number(tv.value.toFixed(num(p.decimals, info?.decimals ?? 2))) : tv.value));
  const submit = async () => {
    if (text === null) return;
    const n = Number(text);
    setText(null);
    if (Number.isNaN(n)) return toast('Not a number', 'warning');
    if (await writeTag(tag, n)) fire('change', { value: n });
  };
  return (
    <div className="hmi-numeric">
      {str(p.label) && <span className="lbl">{str(p.label)}</span>}
      <input type="number" value={shown} disabled={!live} step={num(p.step, 1)} min={p.min as number} max={p.max as number}
        onChange={(e) => setText(e.target.value)} onBlur={() => setText(null)}
        onKeyDown={(e) => { if (e.key === 'Enter') void submit(); if (e.key === 'Escape') setText(null); }} />
      {(str(p.unit) || info?.unit) && <span className="unit">{str(p.unit) || info?.unit}</span>}
    </div>
  );
}

function TextInput({ props: p, runtime: live, fire }: RenderContext) {
  const tv = useTag(str(p.tag) || undefined);
  const [text, setText] = useState<string | null>(null);
  return (
    <input className="hmi-text" value={text ?? str(tv?.value)} placeholder={str(p.placeholder)} disabled={!live}
      onChange={(e) => setText(e.target.value)} onBlur={() => setText(null)}
      onKeyDown={async (e) => {
        if (e.key === 'Enter' && text !== null) {
          const v = text;
          setText(null);
          if (await writeTag(p.tag, v)) fire('change', { value: v });
        }
      }} />
  );
}

function Dropdown({ props: p, runtime: live, fire }: RenderContext) {
  const tag = str(p.tag) || undefined;
  const tv = useTag(tag);
  const info = useTagInfo(tag);
  const options = str(p.options) ? parseStates(p.options) : Object.entries(info?.states ?? {}).map(([value, label]) => ({ value, label }));
  return (
    <select className="hmi-select" value={str(tv?.value)} disabled={!live}
      onChange={async (e) => { if (await writeTag(tag, parseLiteral(e.target.value))) fire('change', { value: e.target.value }); }}>
      {!options.some((o) => o.value === str(tv?.value)) && <option value={str(tv?.value)}>{str(tv?.value, '—')}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Checkbox({ props: p, runtime: live, fire }: RenderContext) {
  const tv = useTag(str(p.tag) || undefined);
  const on = bool(tv?.value);
  return (
    <label className="hmi-check">
      <input type="checkbox" checked={on} disabled={!live} onChange={async () => { if (await writeTag(p.tag, !on)) fire('change', { value: !on }); }} />
      <span>{str(p.label, 'Enabled')}</span>
    </label>
  );
}

// ───────────────────────────── Indicators ─────────────────────────────

/** Value from the `tag` prop if set, otherwise from the (bindable) `value` prop. */
function useValue(p: Record<string, unknown>) {
  const tag = str(p.tag) || undefined;
  const tv = useTag(tag);
  const info = useTagInfo(tag);
  return { value: tag ? tv?.value : p.value, quality: tag ? tv?.quality : undefined, info };
}

function Gauge({ props: p }: RenderContext) {
  const id = useSvgId();
  const { value, info } = useValue(p);
  const min = num(p.min, info?.min ?? 0), max = num(p.max, info?.max ?? 100);
  const v = num(value, min);
  const f = clamp((v - min) / (max - min || 1), 0, 1);
  const a0 = Math.PI * 0.75, sweep = Math.PI * 1.5;
  const pt = (fr: number, r: number) => [60 + r * Math.cos(a0 + sweep * fr), 60 + r * Math.sin(a0 + sweep * fr)];
  const arc = (f0: number, f1: number, r: number) => {
    const [x0, y0] = pt(f0, r), [x1, y1] = pt(f1, r);
    return `M${x0} ${y0} A${r} ${r} 0 ${(f1 - f0) * sweep > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const zones = parseStates(p.zones || '0:#22c55e,70:#f59e0b,90:#ef4444').map((z) => ({ at: Number(z.value), color: z.label }));
  const [nx, ny] = pt(f, 40);
  return (
    <svg viewBox="0 0 120 108" width="100%" height="100%">
      <defs>
        <radialGradient id={`${id}b`} cx="0.5" cy="0.4"><stop offset="0" stopColor="#1e293b" /><stop offset="1" stopColor="#0b1220" /></radialGradient>
      </defs>
      <circle cx="60" cy="60" r="56" fill={`url(#${id}b)`} stroke="#334155" strokeWidth="2" />
      {zones.map((z, i) => {
        const z0 = clamp((z.at - min) / (max - min || 1), 0, 1);
        const z1 = i < zones.length - 1 ? clamp((zones[i + 1].at - min) / (max - min || 1), 0, 1) : 1;
        return z1 > z0 ? <path key={i} d={arc(z0, z1, 48)} stroke={z.color} strokeWidth="6" fill="none" opacity="0.9" /> : null;
      })}
      <path d={arc(0, Math.max(0.001, f), 40)} stroke={str(p.color, '#38bdf8')} strokeWidth="5" fill="none" strokeLinecap="round" />
      <line x1="60" y1="60" x2={nx} y2={ny} stroke="#f8fafc" strokeWidth="2.5" strokeLinecap="round" className="needle" />
      <circle cx="60" cy="60" r="5" fill="#f8fafc" />
      <text x="60" y="86" textAnchor="middle" fill="#f8fafc" fontSize="15" fontWeight="700">{v.toFixed(num(p.decimals, info?.decimals ?? 1))}</text>
      <text x="60" y="99" textAnchor="middle" fill="#94a3b8" fontSize="9">{str(p.label)} {str(p.unit) || info?.unit || ''}</text>
      <text x="22" y="104" textAnchor="middle" fill="#64748b" fontSize="8">{min}</text>
      <text x="98" y="104" textAnchor="middle" fill="#64748b" fontSize="8">{max}</text>
    </svg>
  );
}

function Bar({ props: p }: RenderContext) {
  const { value, info } = useValue(p);
  const min = num(p.min, info?.min ?? 0), max = num(p.max, info?.max ?? 100);
  const v = num(value, min);
  const f = clamp((v - min) / (max - min || 1), 0, 1);
  const vertical = str(p.orientation, 'vertical') === 'vertical';
  const color = str(p.color, '#22c55e');
  return (
    <div className={`hmi-bar ${vertical ? 'vertical' : ''}`}>
      <div className="bar-track">
        <div className="bar-fill" style={vertical ? { height: `${f * 100}%`, background: color } : { width: `${f * 100}%`, background: color }} />
      </div>
      {bool(p.showValue ?? true) && <span className="bar-value">{formatValue(v, info)}</span>}
    </div>
  );
}

function Led({ props: p }: RenderContext) {
  const { value } = useValue(p);
  const on = bool(value);
  const color = on ? str(p.onColor, '#22c55e') : str(p.offColor, '#334155');
  return (
    <div className="hmi-led">
      <span className={`led ${on && bool(p.blinkWhenOn) ? 'blink' : ''}`} style={{ background: `radial-gradient(circle at 35% 30%, #fff8, ${color} 45%, #0008 100%)`, boxShadow: on ? `0 0 12px ${color}` : 'none' }} />
      {str(p.label) && <span className="lbl">{str(p.label)}</span>}
    </div>
  );
}

function ValueDisplay({ props: p }: RenderContext) {
  const { value, quality, info } = useValue(p);
  const decimals = p.decimals === undefined || p.decimals === '' ? info?.decimals : num(p.decimals);
  const text = formatValue(value, { ...info, decimals, unit: str(p.unit) || info?.unit, dataType: info?.dataType ?? 'number' } as never);
  return (
    <div className={`hmi-value q-${quality ?? 'good'}`} style={{ fontSize: num(p.fontSize, 18), color: str(p.color, '#e2e8f0'), background: str(p.background, '#0b1220'), justifyContent: str(p.align, 'center') === 'left' ? 'flex-start' : 'center' }}>
      {str(p.label) && <span className="lbl">{str(p.label)}</span>}
      <span className="val">{text}</span>
    </div>
  );
}

function Multistate({ props: p }: RenderContext) {
  const { value, info } = useValue(p);
  const states = str(p.states) ? parseStates(p.states) : Object.entries(info?.states ?? {}).map(([v, label]) => ({ value: v, label, color: undefined }));
  const s = states.find((x) => x.value === String(value));
  return (
    <div className="hmi-multistate" style={{ background: s?.color ?? str(p.defaultColor, '#334155') }}>
      {s?.label ?? (value === undefined ? '—' : String(value))}
    </div>
  );
}

function Progress({ props: p }: RenderContext) {
  const { value, info } = useValue(p);
  const min = num(p.min, info?.min ?? 0), max = num(p.max, info?.max ?? 100);
  const f = clamp((num(value) - min) / (max - min || 1), 0, 1);
  return (
    <div className="hmi-progress">
      <div style={{ width: `${f * 100}%`, background: str(p.color, '#6366f1') }} />
      <span>{(f * 100).toFixed(0)}%</span>
    </div>
  );
}

function Clock({ props: p }: RenderContext) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const fmtMode = str(p.format, 'time');
  const text = fmtMode === 'date' ? now.toLocaleDateString() : fmtMode === 'datetime' ? now.toLocaleString() : now.toLocaleTimeString();
  return <div className="hmi-value" style={{ fontSize: num(p.fontSize, 20), color: str(p.color, '#e2e8f0'), background: 'transparent' }}><span className="val mono">{text}</span></div>;
}

const valueProps: PropDef[] = [tagProp, { name: 'value', type: 'number', default: 0, group: 'Data', help: 'Used when no tag is set (bind it for expressions)' }];

register(
  {
    type: 'button', label: 'Button', category: 'Controls', w: 140, h: 40, Component: Button, interactive: true,
    props: [
      { name: 'text', type: 'string', default: 'Button' },
      { name: 'action', type: 'select', options: ['none', 'write', 'toggle', 'pulse', 'navigate', 'faceplate', 'scene'], default: 'none', group: 'Behavior' },
      tagProp,
      { name: 'value', type: 'string', default: 'true', group: 'Behavior', help: 'Value written by "write"' },
      { name: 'target', type: 'string', default: '', group: 'Behavior', help: 'Display / faceplate path / scene' },
      { name: 'pulseMs', type: 'number', default: 500, group: 'Behavior' },
      { name: 'confirm', type: 'boolean', default: false, group: 'Behavior' },
      { name: 'confirmText', type: 'string', default: '', group: 'Behavior' },
      { name: 'color', type: 'color', default: '#2563eb' },
      { name: 'activeColor', type: 'color', default: '#16a34a' },
      { name: 'textColor', type: 'color', default: '#ffffff' },
      { name: 'fontSize', type: 'number', default: 14 },
      { name: 'radius', type: 'number', default: 6 },
    ],
  },
  {
    type: 'switch', label: 'Toggle switch', category: 'Controls', w: 150, h: 34, Component: Switch, interactive: true,
    props: [tagProp, { name: 'label', type: 'string', default: 'Switch' }, { name: 'onColor', type: 'color', default: '#22c55e' }, { name: 'fontSize', type: 'number', default: 13 }],
  },
  {
    type: 'slider', label: 'Slider', category: 'Controls', w: 220, h: 40, Component: Slider, interactive: true,
    props: [tagProp, { name: 'min', type: 'number' }, { name: 'max', type: 'number' }, { name: 'step', type: 'number', default: 1 },
      { name: 'orientation', type: 'select', options: ['horizontal', 'vertical'], default: 'horizontal' }, { name: 'color', type: 'color', default: '#38bdf8' }, { name: 'showValue', type: 'boolean', default: true }],
  },
  {
    type: 'numeric', label: 'Numeric input', category: 'Controls', w: 170, h: 36, Component: Numeric, interactive: true,
    props: [tagProp, { name: 'label', type: 'string', default: '' }, { name: 'unit', type: 'string', default: '' }, { name: 'decimals', type: 'number' }, { name: 'step', type: 'number', default: 1 }, { name: 'min', type: 'number' }, { name: 'max', type: 'number' }],
  },
  { type: 'textInput', label: 'Text input', category: 'Controls', w: 200, h: 34, Component: TextInput, interactive: true, props: [tagProp, { name: 'placeholder', type: 'string', default: 'Type and press Enter' }] },
  {
    type: 'dropdown', label: 'Dropdown', category: 'Controls', w: 160, h: 34, Component: Dropdown, interactive: true,
    props: [tagProp, { name: 'options', type: 'string', default: '', help: 'e.g. "Auto,Manual" or "0:Stopped,1:Running" (empty = tag states)' }],
  },
  { type: 'checkbox', label: 'Checkbox', category: 'Controls', w: 150, h: 28, Component: Checkbox, interactive: true, props: [tagProp, { name: 'label', type: 'string', default: 'Enabled' }] },
  {
    type: 'gauge', label: 'Radial gauge', category: 'Indicators', w: 160, h: 144, Component: Gauge, primary: 'value',
    props: [...valueProps, { name: 'min', type: 'number' }, { name: 'max', type: 'number' }, { name: 'label', type: 'string', default: '' }, { name: 'unit', type: 'string', default: '' },
      { name: 'decimals', type: 'number' }, { name: 'color', type: 'color', default: '#38bdf8' }, { name: 'zones', type: 'string', default: '0:#22c55e,70:#f59e0b,90:#ef4444', help: 'value:color pairs' }],
  },
  {
    type: 'bar', label: 'Bar graph', category: 'Indicators', w: 50, h: 160, Component: Bar, primary: 'value',
    props: [...valueProps, { name: 'min', type: 'number' }, { name: 'max', type: 'number' }, { name: 'orientation', type: 'select', options: ['vertical', 'horizontal'], default: 'vertical' },
      { name: 'color', type: 'color', default: '#22c55e' }, { name: 'showValue', type: 'boolean', default: true }],
  },
  {
    type: 'led', label: 'LED indicator', category: 'Indicators', w: 120, h: 28, Component: Led, primary: 'value',
    props: [tagProp, { name: 'value', type: 'boolean', default: false, group: 'Data' }, { name: 'label', type: 'string', default: '' }, { name: 'onColor', type: 'color', default: '#22c55e' },
      { name: 'offColor', type: 'color', default: '#334155' }, { name: 'blinkWhenOn', type: 'boolean', default: false }],
  },
  {
    type: 'value', label: 'Value display', category: 'Indicators', w: 160, h: 40, Component: ValueDisplay, primary: 'value',
    props: [tagProp, { name: 'value', type: 'string', default: '', group: 'Data' }, { name: 'label', type: 'string', default: '' }, { name: 'unit', type: 'string', default: '' },
      { name: 'decimals', type: 'number' }, { name: 'fontSize', type: 'number', default: 18 }, { name: 'color', type: 'color', default: '#e2e8f0' },
      { name: 'background', type: 'color', default: '#0b1220' }, { name: 'align', type: 'select', options: ['center', 'left'], default: 'center' }],
  },
  {
    type: 'multistate', label: 'Multi-state', category: 'Indicators', w: 140, h: 34, Component: Multistate, primary: 'value',
    props: [tagProp, { name: 'value', type: 'string', default: '', group: 'Data' }, { name: 'states', type: 'string', default: 'false:Stopped:#475569,true:Running:#16a34a', help: 'value:label:color, …' },
      { name: 'defaultColor', type: 'color', default: '#334155' }],
  },
  {
    type: 'progress', label: 'Progress bar', category: 'Indicators', w: 200, h: 22, Component: Progress, primary: 'value',
    props: [...valueProps, { name: 'min', type: 'number' }, { name: 'max', type: 'number' }, { name: 'color', type: 'color', default: '#6366f1' }],
  },
  {
    type: 'clock', label: 'Clock', category: 'Widgets', w: 160, h: 36, Component: Clock,
    props: [{ name: 'format', type: 'select', options: ['time', 'date', 'datetime'], default: 'time' }, { name: 'fontSize', type: 'number', default: 20 }, { name: 'color', type: 'color', default: '#e2e8f0' }],
  },
);
