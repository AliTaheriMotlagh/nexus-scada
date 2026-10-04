import type { ReactNode } from 'react';
import { bool, clamp, num, register, shade, str, useSvgId, type PropDef, type RenderContext } from '../registry.ts';

/** Metallic horizontal gradient shared by vessels. */
function Metal({ id, tint = '#94a3b8' }: { id: string; tint?: string }) {
  return (
    <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stopColor={shade(tint, -55)} />
      <stop offset="0.35" stopColor={shade(tint, 35)} />
      <stop offset="0.5" stopColor={shade(tint, 55)} />
      <stop offset="0.75" stopColor={shade(tint, -10)} />
      <stop offset="1" stopColor={shade(tint, -60)} />
    </linearGradient>
  );
}

function Liquid({ id, color }: { id: string; color: string }) {
  return (
    <linearGradient id={id} x1="0" x2="1">
      <stop offset="0" stopColor={shade(color, -45)} />
      <stop offset="0.45" stopColor={shade(color, 15)} />
      <stop offset="1" stopColor={shade(color, -50)} />
    </linearGradient>
  );
}

function Radial({ id, color }: { id: string; color: string }) {
  return (
    <radialGradient id={id} cx="0.35" cy="0.3" r="0.8">
      <stop offset="0" stopColor={shade(color, 60)} />
      <stop offset="0.5" stopColor={color} />
      <stop offset="1" stopColor={shade(color, -55)} />
    </radialGradient>
  );
}

/** HTML overlay for crisp text over stretched SVGs. */
function Overlay({ children, pos = 'center' }: { children: ReactNode; pos?: 'center' | 'top' | 'bottom' }) {
  return <div className={`symbol-overlay ${pos}`}>{children}</div>;
}

const runColor = (p: Record<string, unknown>) =>
  bool(p.fault) ? str(p.faultColor, '#ef4444') : bool(p.running) ? str(p.onColor, '#22c55e') : str(p.offColor, '#64748b');

const fmt = (v: number, d: unknown) => v.toFixed(num(d, 1));

// ───────────────────────────── Process ─────────────────────────────

function Tank({ props: p }: RenderContext) {
  const id = useSvgId();
  const level = clamp(num(p.level, 50), 0, 100);
  const fill = str(p.fillColor, '#38bdf8');
  const top = 12, bottom = 188, h = bottom - top;
  const ly = bottom - (h * level) / 100;
  return (
    <>
      <svg viewBox="0 0 100 200" preserveAspectRatio="none" width="100%" height="100%">
        <defs>
          <Metal id={`${id}m`} tint={str(p.shellColor, '#94a3b8')} />
          <Liquid id={`${id}l`} color={fill} />
          <clipPath id={`${id}c`}><rect x="5" y={top} width="90" height={h} /></clipPath>
        </defs>
        <rect x="5" y={top} width="90" height={h} fill={`url(#${id}m)`} />
        <rect x="14" y={top + 4} width="72" height={h - 8} fill="#0b1220" opacity="0.55" />
        <g clipPath={`url(#${id}c)`}>
          <rect x="14" y={ly} width="72" height={bottom - ly - 4} fill={`url(#${id}l)`} className="liquid" />
          <rect x="14" y={ly} width="72" height="3" fill={shade(fill, 45)} opacity="0.8" />
        </g>
        {Array.from({ length: 11 }, (_, i) => (
          <line key={i} x1="86" x2={i % 5 === 0 ? 78 : 82} y1={bottom - 4 - ((h - 8) * i) / 10} y2={bottom - 4 - ((h - 8) * i) / 10} stroke="#cbd5e1" strokeWidth="0.8" />
        ))}
        <ellipse cx="50" cy={top} rx="45" ry="9" fill={`url(#${id}m)`} stroke="#0f172a" strokeWidth="0.8" />
        <path d={`M5 ${bottom} A45 9 0 0 0 95 ${bottom}`} fill={`url(#${id}m)`} stroke="#0f172a" strokeWidth="0.8" />
      </svg>
      {bool(p.showValue ?? true) && <Overlay><span className="sym-value">{fmt(level, p.decimals)}{str(p.unit, '%')}</span></Overlay>}
      {p.label ? <Overlay pos="top"><span className="sym-label">{str(p.label)}</span></Overlay> : null}
    </>
  );
}

function Silo({ props: p }: RenderContext) {
  const id = useSvgId();
  const level = clamp(num(p.level, 50), 0, 100);
  const fill = str(p.fillColor, '#eab308');
  const ly = 150 - (140 * level) / 100;
  return (
    <>
      <svg viewBox="0 0 100 200" preserveAspectRatio="none" width="100%" height="100%">
        <defs>
          <Metal id={`${id}m`} />
          <Liquid id={`${id}l`} color={fill} />
          <clipPath id={`${id}c`}><path d="M8 10 H92 V130 L60 175 H40 L8 130 Z" /></clipPath>
        </defs>
        <path d="M8 10 H92 V130 L60 175 H40 L8 130 Z" fill={`url(#${id}m)`} stroke="#0f172a" strokeWidth="1" />
        <g clipPath={`url(#${id}c)`}><rect x="0" y={ly + 25} width="100" height="200" fill={`url(#${id}l)`} opacity="0.92" /></g>
        <ellipse cx="50" cy="10" rx="42" ry="7" fill={`url(#${id}m)`} stroke="#0f172a" strokeWidth="0.8" />
        <rect x="42" y="175" width="16" height="22" fill={`url(#${id}m)`} />
        <path d="M14 130 L4 198 M86 130 L96 198" stroke="#475569" strokeWidth="4" />
      </svg>
      {bool(p.showValue ?? true) && <Overlay><span className="sym-value">{fmt(level, p.decimals)}%</span></Overlay>}
    </>
  );
}

function Pump({ props: p }: RenderContext) {
  const id = useSvgId();
  const color = runColor(p);
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" className={bool(p.fault) ? 'blink' : ''}>
      <defs>
        <Radial id={`${id}r`} color={color} />
        <linearGradient id={`${id}n`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={shade(color, 40)} /><stop offset="1" stopColor={shade(color, -45)} />
        </linearGradient>
      </defs>
      <path d="M22 82 L78 82 L88 96 L12 96 Z" fill="#475569" stroke="#1e293b" />
      <rect x="44" y="10" width="46" height="18" rx="2" fill={`url(#${id}n)`} stroke="#1e293b" />
      <circle cx="44" cy="50" r="34" fill={`url(#${id}r)`} stroke="#0f172a" strokeWidth="2" />
      <g className={bool(p.running) ? 'spin' : ''} style={{ animationDuration: `${Math.max(0.15, 1.6 - num(p.speed, 50) / 80)}s` }}>
        {[0, 120, 240].map((a) => (
          <path key={a} d="M44 50 C50 36 60 30 66 34 C58 40 52 46 44 50 Z" fill="#0f172a" opacity="0.75" transform={`rotate(${a} 44 50)`} />
        ))}
      </g>
      <circle cx="44" cy="50" r="6" fill="#e2e8f0" stroke="#0f172a" />
    </svg>
  );
}

function Valve({ props: p }: RenderContext) {
  const id = useSvgId();
  const open = bool(p.open);
  const color = bool(p.fault) ? '#ef4444' : open ? str(p.openColor, '#22c55e') : str(p.closedColor, '#dc2626');
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%">
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={shade(color, 45)} /><stop offset="0.5" stopColor={color} /><stop offset="1" stopColor={shade(color, -50)} />
        </linearGradient>
      </defs>
      <rect x="47" y="24" width="6" height="34" fill="#94a3b8" />
      <path d="M26 26 A24 18 0 0 1 74 26 Z" fill={`url(#${id}g)`} stroke="#0f172a" strokeWidth="1.5" />
      <path d="M6 40 L50 64 L6 88 Z" fill={`url(#${id}g)`} stroke="#0f172a" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M94 40 L50 64 L94 88 Z" fill={`url(#${id}g)`} stroke="#0f172a" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="50" cy="64" r="4" fill="#0f172a" />
    </svg>
  );
}

function Motor({ props: p }: RenderContext) {
  const id = useSvgId();
  const color = runColor(p);
  return (
    <svg viewBox="0 0 120 80" width="100%" height="100%">
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={shade(color, -40)} /><stop offset="0.3" stopColor={shade(color, 50)} />
          <stop offset="0.6" stopColor={color} /><stop offset="1" stopColor={shade(color, -60)} />
        </linearGradient>
      </defs>
      <rect x="38" y="4" width="26" height="12" rx="2" fill={`url(#${id}g)`} stroke="#0f172a" />
      <rect x="10" y="16" width="84" height="50" rx="10" fill={`url(#${id}g)`} stroke="#0f172a" strokeWidth="1.5" />
      {Array.from({ length: 7 }, (_, i) => <line key={i} x1={22 + i * 10} x2={22 + i * 10} y1="20" y2="62" stroke="#0f172a" opacity="0.35" strokeWidth="2" />)}
      <rect x="94" y="34" width="22" height="14" fill="#cbd5e1" stroke="#0f172a" />
      <rect x="14" y="66" width="76" height="8" fill="#475569" />
    </svg>
  );
}

function Fan({ props: p }: RenderContext) {
  const id = useSvgId();
  const color = runColor(p);
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%">
      <defs><Radial id={`${id}r`} color={shade(color, -20)} /></defs>
      <circle cx="50" cy="50" r="46" fill={`url(#${id}r)`} stroke="#0f172a" strokeWidth="2" />
      <circle cx="50" cy="50" r="38" fill="#0b1220" opacity="0.6" />
      <g className={bool(p.running) ? 'spin' : ''} style={{ animationDuration: '0.8s' }}>
        {[0, 90, 180, 270].map((a) => (
          <path key={a} d="M50 50 C52 30 66 16 74 22 C70 34 60 44 50 50 Z" fill={shade(color, 30)} stroke="#0f172a" transform={`rotate(${a} 50 50)`} />
        ))}
      </g>
      <circle cx="50" cy="50" r="7" fill="#e2e8f0" stroke="#0f172a" />
    </svg>
  );
}

function HeatExchanger({ props: p }: RenderContext) {
  const id = useSvgId();
  const active = bool(p.active ?? true);
  return (
    <svg viewBox="0 0 160 70" width="100%" height="100%">
      <defs>
        <linearGradient id={`${id}s`} x1="0" x2="1">
          <stop offset="0" stopColor={active ? str(p.hotColor, '#ef4444') : '#64748b'} />
          <stop offset="1" stopColor={active ? str(p.coldColor, '#3b82f6') : '#475569'} />
        </linearGradient>
        <linearGradient id={`${id}h`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.45" /><stop offset="0.5" stopColor="#ffffff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.4" />
        </linearGradient>
      </defs>
      <rect x="10" y="12" width="140" height="46" rx="23" fill={`url(#${id}s)`} stroke="#0f172a" strokeWidth="1.5" />
      <rect x="10" y="12" width="140" height="46" rx="23" fill={`url(#${id}h)`} />
      {[24, 35, 46].map((y) => <line key={y} x1="26" x2="134" y1={y} y2={y} stroke="#0f172a" opacity="0.5" strokeWidth="2" />)}
      <rect x="34" y="2" width="12" height="10" fill="#94a3b8" /><rect x="114" y="58" width="12" height="10" fill="#94a3b8" />
    </svg>
  );
}

function Compressor({ props: p }: RenderContext) {
  const id = useSvgId();
  const color = runColor(p);
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%">
      <defs><Radial id={`${id}r`} color={color} /></defs>
      <path d="M14 88 H86" stroke="#475569" strokeWidth="8" />
      <circle cx="50" cy="48" r="36" fill={`url(#${id}r)`} stroke="#0f172a" strokeWidth="2" />
      <path d="M22 30 L78 40 L78 56 L22 66 Z" fill="#0f172a" opacity="0.55" />
      <g className={bool(p.running) ? 'spin' : ''} style={{ animationDuration: '1.2s' }}>
        <line x1="50" y1="30" x2="50" y2="66" stroke="#e2e8f0" strokeWidth="3" />
      </g>
    </svg>
  );
}

function Conveyor({ props: p }: RenderContext) {
  const color = runColor(p);
  return (
    <svg viewBox="0 0 200 40" preserveAspectRatio="none" width="100%" height="100%">
      <rect x="4" y="8" width="192" height="22" rx="11" fill="#1e293b" stroke={color} strokeWidth="2.5" />
      <line x1="16" y1="8" x2="184" y2="8" stroke={color} strokeWidth="3" strokeDasharray="8 6" className={bool(p.running) ? 'flow' : ''} />
      {[18, 60, 100, 140, 182].map((x) => <circle key={x} cx={x} cy="19" r="7" fill="#64748b" stroke="#0f172a" />)}
      <path d="M30 30 L22 40 M170 30 L178 40" stroke="#475569" strokeWidth="3" />
    </svg>
  );
}

function Boiler({ props: p }: RenderContext) {
  const id = useSvgId();
  const firing = bool(p.firing);
  return (
    <svg viewBox="0 0 100 160" preserveAspectRatio="none" width="100%" height="100%">
      <defs><Metal id={`${id}m`} tint="#a8a29e" /></defs>
      <rect x="10" y="6" width="80" height="148" rx="30" fill={`url(#${id}m)`} stroke="#0f172a" strokeWidth="1.5" />
      <rect x="28" y="96" width="44" height="40" rx="6" fill="#1c1917" />
      {firing && (
        <g className="flicker">
          <path d="M50 132 C34 120 40 106 50 98 C48 110 60 112 56 124 C62 118 64 110 62 104 C72 116 66 132 50 132 Z" fill="#f97316" />
          <path d="M50 132 C42 124 46 116 50 112 C52 120 58 122 50 132 Z" fill="#fde047" />
        </g>
      )}
    </svg>
  );
}

function Instrument({ props: p }: RenderContext) {
  const field = str(p.mounting, 'field');
  return (
    <>
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <circle cx="50" cy="50" r="44" fill="#0f172a" stroke={str(p.color, '#e2e8f0')} strokeWidth="3" />
        {field !== 'field' && <line x1="6" y1="50" x2="94" y2="50" stroke={str(p.color, '#e2e8f0')} strokeWidth="2" strokeDasharray={field === 'local-panel' ? '6 4' : undefined} />}
      </svg>
      <div className="isa-text" style={{ color: str(p.color, '#e2e8f0') }}>
        <span className="isa-fn">{str(p.function, 'TT')}</span>
        <span className="isa-loop">{str(p.loop, '101')}</span>
      </div>
      {p.value !== undefined && p.value !== '' && <div className="isa-value">{typeof p.value === 'number' ? fmt(p.value, p.decimals) : String(p.value)} {str(p.unit)}</div>}
    </>
  );
}

// ───────────────────────────── 3D shapes ─────────────────────────────

function Cylinder3D({ props: p }: RenderContext) {
  const id = useSvgId();
  const c = str(p.color, '#0ea5e9');
  return (
    <svg viewBox="0 0 100 200" preserveAspectRatio="none" width="100%" height="100%">
      <defs><Metal id={`${id}m`} tint={c} /></defs>
      <rect x="4" y="14" width="92" height="172" fill={`url(#${id}m)`} />
      <path d="M4 186 A46 12 0 0 0 96 186" fill={`url(#${id}m)`} />
      <ellipse cx="50" cy="14" rx="46" ry="12" fill={shade(c, 30)} stroke={shade(c, -40)} />
    </svg>
  );
}

function Cube3D({ props: p }: RenderContext) {
  const c = str(p.color, '#8b5cf6');
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%">
      <path d="M50 4 L94 26 L50 48 L6 26 Z" fill={shade(c, 35)} stroke={shade(c, -50)} />
      <path d="M6 26 L50 48 L50 96 L6 74 Z" fill={shade(c, -10)} stroke={shade(c, -50)} />
      <path d="M94 26 L50 48 L50 96 L94 74 Z" fill={shade(c, -40)} stroke={shade(c, -50)} />
    </svg>
  );
}

function Sphere3D({ props: p }: RenderContext) {
  const id = useSvgId();
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%">
      <defs><Radial id={`${id}r`} color={str(p.color, '#f43f5e')} /></defs>
      <ellipse cx="50" cy="94" rx="30" ry="4" fill="#000" opacity="0.3" />
      <circle cx="50" cy="48" r="44" fill={`url(#${id}r)`} />
    </svg>
  );
}

function Cone3D({ props: p }: RenderContext) {
  const id = useSvgId();
  const c = str(p.color, '#f59e0b');
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%">
      <defs><Metal id={`${id}m`} tint={c} /></defs>
      <path d="M50 4 L94 86 A44 10 0 0 1 6 86 Z" fill={`url(#${id}m)`} />
    </svg>
  );
}

// ───────────────────────────── Home & IoT ─────────────────────────────

function Lamp({ props: p }: RenderContext) {
  const id = useSvgId();
  const on = bool(p.on);
  const c = str(p.onColor, '#fde047');
  return (
    <svg viewBox="0 0 100 120" width="100%" height="100%" overflow="visible">
      <defs>
        <radialGradient id={`${id}g`}>
          <stop offset="0" stopColor={c} stopOpacity="0.9" /><stop offset="1" stopColor={c} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}b`} cx="0.4" cy="0.35">
          <stop offset="0" stopColor={on ? '#ffffff' : '#cbd5e1'} /><stop offset="1" stopColor={on ? c : '#64748b'} />
        </radialGradient>
      </defs>
      {on && <circle cx="50" cy="45" r="58" fill={`url(#${id}g)`} opacity={num(p.brightness, 100) / 100} />}
      <path d="M50 6 C26 6 14 26 18 44 C21 58 34 64 36 80 H64 C66 64 79 58 82 44 C86 26 74 6 50 6 Z" fill={`url(#${id}b)`} stroke="#0f172a" strokeWidth="2" />
      <rect x="35" y="80" width="30" height="8" rx="2" fill="#94a3b8" /><rect x="37" y="90" width="26" height="7" rx="2" fill="#64748b" />
      <rect x="41" y="99" width="18" height="8" rx="3" fill="#475569" />
    </svg>
  );
}

function Thermostat({ props: p }: RenderContext) {
  const id = useSvgId();
  const v = num(p.value, 21);
  const sp = num(p.setpoint, 21);
  const min = num(p.min, 10), max = num(p.max, 30);
  const heating = bool(p.heating);
  const frac = clamp((v - min) / (max - min), 0, 1);
  const a0 = Math.PI * 0.75, sweep = Math.PI * 1.5;
  const pt = (f: number, r: number) => [50 + r * Math.cos(a0 + sweep * f), 50 + r * Math.sin(a0 + sweep * f)];
  const [x0, y0] = pt(0, 40), [x1, y1] = pt(frac, 40), [xe, ye] = pt(1, 40);
  const [sx, sy] = pt(clamp((sp - min) / (max - min), 0, 1), 40);
  const color = heating ? '#f97316' : '#38bdf8';
  return (
    <>
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <defs><Radial id={`${id}r`} color="#1e293b" /></defs>
        <circle cx="50" cy="50" r="48" fill={`url(#${id}r)`} stroke="#334155" strokeWidth="2" />
        <path d={`M${x0} ${y0} A40 40 0 1 1 ${xe} ${ye}`} fill="none" stroke="#334155" strokeWidth="6" strokeLinecap="round" />
        <path d={`M${x0} ${y0} A40 40 0 ${frac > 2 / 3 ? 1 : 0} 1 ${x1} ${y1}`} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" />
        <circle cx={sx} cy={sy} r="4" fill="#fff" stroke="#0f172a" />
      </svg>
      <Overlay>
        <div className="thermo-text">
          <span className="sym-value">{v.toFixed(1)}°</span>
          <span className="small">set {sp.toFixed(1)}°</span>
          <span className="small" style={{ color }}>{heating ? '🔥 heating' : 'idle'}</span>
        </div>
      </Overlay>
    </>
  );
}

function Door({ props: p }: RenderContext) {
  const open = bool(p.open);
  const c = open ? str(p.openColor, '#f59e0b') : str(p.closedColor, '#22c55e');
  return (
    <svg viewBox="0 0 80 120" width="100%" height="100%">
      <rect x="6" y="4" width="68" height="112" fill="#0f172a" stroke="#64748b" strokeWidth="3" />
      {open
        ? <path d="M9 7 L46 18 L46 112 L9 113 Z" fill={c} stroke="#0f172a" />
        : <rect x="9" y="7" width="62" height="106" fill={c} stroke="#0f172a" />}
      <circle cx={open ? 40 : 62} cy="62" r="3.5" fill="#e2e8f0" />
    </svg>
  );
}

function Solar({ props: p }: RenderContext) {
  const power = num(p.power, 0);
  const active = power > num(p.threshold, 1);
  return (
    <>
      <svg viewBox="0 0 120 100" width="100%" height="100%">
        <circle cx="96" cy="18" r="12" fill={active ? '#fde047' : '#475569'} className={active ? 'pulse' : ''} />
        <path d="M10 40 L84 30 L104 80 L22 92 Z" fill="#1e3a8a" stroke="#93c5fd" strokeWidth="2" />
        {[0.25, 0.5, 0.75].map((f) => <line key={`a${f}`} x1={10 + 12 * f} y1={40 + 52 * f} x2={84 + 20 * f} y2={30 + 50 * f} stroke="#93c5fd" strokeWidth="1" />)}
        {[0.25, 0.5, 0.75].map((f) => <line key={`b${f}`} x1={10 + 74 * f} y1={40 - 10 * f} x2={22 + 82 * f} y2={92 - 12 * f} stroke="#93c5fd" strokeWidth="1" />)}
        <path d="M60 90 L60 100" stroke="#64748b" strokeWidth="5" />
      </svg>
      {bool(p.showValue ?? true) && <Overlay pos="bottom"><span className="sym-chip">{power.toFixed(0)} {str(p.unit, 'W')}</span></Overlay>}
    </>
  );
}

function Battery({ props: p }: RenderContext) {
  const level = clamp(num(p.level, 50), 0, 100);
  const c = level < 20 ? '#ef4444' : level < 50 ? '#f59e0b' : '#22c55e';
  return (
    <>
      <svg viewBox="0 0 60 110" preserveAspectRatio="none" width="100%" height="100%">
        <rect x="20" y="2" width="20" height="8" rx="2" fill="#94a3b8" />
        <rect x="4" y="10" width="52" height="96" rx="7" fill="#0f172a" stroke="#94a3b8" strokeWidth="3" />
        <rect x="9" y={15 + 86 * (1 - level / 100)} width="42" height={86 * (level / 100)} rx="3" fill={c} />
      </svg>
      <Overlay><span className="sym-value">{level.toFixed(0)}%</span></Overlay>
    </>
  );
}

function Plug({ props: p }: RenderContext) {
  const on = bool(p.on);
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%">
      <rect x="6" y="6" width="88" height="88" rx="18" fill="#e2e8f0" stroke="#64748b" strokeWidth="2" />
      <circle cx="50" cy="50" r="30" fill="#cbd5e1" stroke="#94a3b8" />
      <rect x="36" y="40" width="7" height="20" rx="3" fill="#334155" /><rect x="57" y="40" width="7" height="20" rx="3" fill="#334155" />
      <circle cx="80" cy="20" r="6" fill={on ? '#22c55e' : '#475569'} className={on ? 'glow' : ''} />
    </svg>
  );
}

function House({ props: p }: RenderContext) {
  const c = str(p.color, '#38bdf8');
  const lit = bool(p.lit);
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%">
      <path d="M50 6 L94 44 H82 V92 H18 V44 H6 Z" fill={shade(c, -35)} stroke={shade(c, 30)} strokeWidth="3" strokeLinejoin="round" />
      <rect x="26" y="52" width="18" height="16" fill={lit ? '#fde047' : '#0f172a'} stroke={shade(c, 30)} />
      <rect x="56" y="52" width="18" height="16" fill={lit ? '#fde047' : '#0f172a'} stroke={shade(c, 30)} />
      <rect x="42" y="72" width="16" height="20" fill="#0f172a" stroke={shade(c, 30)} />
    </svg>
  );
}

function Beacon({ props: p }: RenderContext) {
  const active = bool(p.active);
  const c = str(p.color, '#ef4444');
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" overflow="visible">
      {active && <circle cx="50" cy="48" r="46" fill={c} opacity="0.25" className="blink" />}
      <path d="M22 70 C22 30 36 16 50 16 C64 16 78 30 78 70 Z" fill={active ? c : '#475569'} stroke="#0f172a" strokeWidth="2" className={active ? 'blink' : ''} />
      <rect x="14" y="70" width="72" height="16" rx="3" fill="#334155" />
    </svg>
  );
}

// ───────────────────────────── registration ─────────────────────────────

const runningProps: PropDef[] = [
  { name: 'running', type: 'boolean', default: false, group: 'Data' },
  { name: 'fault', type: 'boolean', default: false, group: 'Data' },
  { name: 'onColor', type: 'color', default: '#22c55e' },
  { name: 'offColor', type: 'color', default: '#64748b' },
  { name: 'faultColor', type: 'color', default: '#ef4444' },
];

register(
  {
    type: 'tank', label: 'Tank', category: 'Process', w: 110, h: 200, Component: Tank, primary: 'level',
    props: [
      { name: 'level', type: 'number', default: 50, min: 0, max: 100, group: 'Data' },
      { name: 'fillColor', type: 'color', default: '#38bdf8' },
      { name: 'shellColor', type: 'color', default: '#94a3b8' },
      { name: 'label', type: 'string', default: '' },
      { name: 'showValue', type: 'boolean', default: true },
      { name: 'unit', type: 'string', default: '%' },
      { name: 'decimals', type: 'number', default: 1, min: 0, max: 4 },
    ],
  },
  {
    type: 'silo', label: 'Silo / Hopper', category: 'Process', w: 100, h: 200, Component: Silo, primary: 'level',
    props: [
      { name: 'level', type: 'number', default: 60, group: 'Data' },
      { name: 'fillColor', type: 'color', default: '#eab308' },
      { name: 'showValue', type: 'boolean', default: true },
      { name: 'decimals', type: 'number', default: 0 },
    ],
  },
  { type: 'pump', label: 'Pump', category: 'Process', w: 90, h: 90, Component: Pump, primary: 'running', props: [...runningProps, { name: 'speed', type: 'number', default: 50, group: 'Data', help: 'Animation speed 0-100' }] },
  {
    type: 'valve', label: 'Valve', category: 'Process', w: 70, h: 70, Component: Valve, primary: 'open',
    props: [
      { name: 'open', type: 'boolean', default: false, group: 'Data' },
      { name: 'fault', type: 'boolean', default: false, group: 'Data' },
      { name: 'openColor', type: 'color', default: '#22c55e' },
      { name: 'closedColor', type: 'color', default: '#dc2626' },
    ],
  },
  { type: 'motor', label: 'Motor', category: 'Process', w: 120, h: 80, Component: Motor, primary: 'running', props: runningProps },
  { type: 'fan', label: 'Fan / Blower', category: 'Process', w: 90, h: 90, Component: Fan, primary: 'running', props: runningProps },
  { type: 'compressor', label: 'Compressor', category: 'Process', w: 90, h: 90, Component: Compressor, primary: 'running', props: runningProps },
  { type: 'conveyor', label: 'Conveyor', category: 'Process', w: 240, h: 44, Component: Conveyor, primary: 'running', props: runningProps },
  {
    type: 'heatExchanger', label: 'Heat exchanger', category: 'Process', w: 160, h: 70, Component: HeatExchanger, primary: 'active',
    props: [
      { name: 'active', type: 'boolean', default: true, group: 'Data' },
      { name: 'hotColor', type: 'color', default: '#ef4444' },
      { name: 'coldColor', type: 'color', default: '#3b82f6' },
    ],
  },
  { type: 'boiler', label: 'Boiler / Furnace', category: 'Process', w: 100, h: 160, Component: Boiler, primary: 'firing', props: [{ name: 'firing', type: 'boolean', default: false, group: 'Data' }] },
  {
    type: 'instrument', label: 'ISA instrument', category: 'Process', w: 70, h: 70, Component: Instrument, primary: 'value',
    props: [
      { name: 'function', type: 'string', default: 'TT', help: 'ISA letters, e.g. TT, PIC, FT, LSH' },
      { name: 'loop', type: 'string', default: '101' },
      { name: 'mounting', type: 'select', options: ['field', 'panel', 'local-panel'], default: 'field' },
      { name: 'value', type: 'string', default: '', group: 'Data' },
      { name: 'unit', type: 'string', default: '' },
      { name: 'decimals', type: 'number', default: 1 },
      { name: 'color', type: 'color', default: '#e2e8f0' },
    ],
  },
  { type: 'cylinder3d', label: 'Cylinder (3D)', category: '3D Shapes', w: 80, h: 160, Component: Cylinder3D, primary: 'color', props: [{ name: 'color', type: 'color', default: '#0ea5e9' }] },
  { type: 'cube3d', label: 'Cube (3D)', category: '3D Shapes', w: 100, h: 100, Component: Cube3D, primary: 'color', props: [{ name: 'color', type: 'color', default: '#8b5cf6' }] },
  { type: 'sphere3d', label: 'Sphere (3D)', category: '3D Shapes', w: 90, h: 90, Component: Sphere3D, primary: 'color', props: [{ name: 'color', type: 'color', default: '#f43f5e' }] },
  { type: 'cone3d', label: 'Cone (3D)', category: '3D Shapes', w: 90, h: 100, Component: Cone3D, primary: 'color', props: [{ name: 'color', type: 'color', default: '#f59e0b' }] },
  {
    type: 'lamp', label: 'Light bulb', category: 'Home & IoT', w: 70, h: 84, Component: Lamp, primary: 'on',
    props: [
      { name: 'on', type: 'boolean', default: false, group: 'Data' },
      { name: 'brightness', type: 'number', default: 100, min: 0, max: 100, group: 'Data' },
      { name: 'onColor', type: 'color', default: '#fde047' },
    ],
  },
  {
    type: 'thermostat', label: 'Thermostat', category: 'Home & IoT', w: 140, h: 140, Component: Thermostat, primary: 'value',
    props: [
      { name: 'value', type: 'number', default: 21, group: 'Data' },
      { name: 'setpoint', type: 'number', default: 21, group: 'Data' },
      { name: 'heating', type: 'boolean', default: false, group: 'Data' },
      { name: 'min', type: 'number', default: 10 },
      { name: 'max', type: 'number', default: 30 },
    ],
  },
  {
    type: 'door', label: 'Door / Window', category: 'Home & IoT', w: 60, h: 90, Component: Door, primary: 'open',
    props: [
      { name: 'open', type: 'boolean', default: false, group: 'Data' },
      { name: 'openColor', type: 'color', default: '#f59e0b' },
      { name: 'closedColor', type: 'color', default: '#22c55e' },
    ],
  },
  {
    type: 'solar', label: 'Solar panel', category: 'Home & IoT', w: 130, h: 110, Component: Solar, primary: 'power',
    props: [
      { name: 'power', type: 'number', default: 0, group: 'Data' },
      { name: 'unit', type: 'string', default: 'W' },
      { name: 'threshold', type: 'number', default: 1 },
      { name: 'showValue', type: 'boolean', default: true },
    ],
  },
  { type: 'battery', label: 'Battery', category: 'Home & IoT', w: 60, h: 110, Component: Battery, primary: 'level', props: [{ name: 'level', type: 'number', default: 80, group: 'Data' }] },
  { type: 'plug', label: 'Smart plug', category: 'Home & IoT', w: 70, h: 70, Component: Plug, primary: 'on', props: [{ name: 'on', type: 'boolean', default: false, group: 'Data' }] },
  {
    type: 'house', label: 'House', category: 'Home & IoT', w: 100, h: 100, Component: House, primary: 'color',
    props: [{ name: 'color', type: 'color', default: '#38bdf8' }, { name: 'lit', type: 'boolean', default: false, group: 'Data' }],
  },
  {
    type: 'beacon', label: 'Alarm beacon', category: 'Indicators', w: 60, h: 60, Component: Beacon, primary: 'active',
    props: [{ name: 'active', type: 'boolean', default: false, group: 'Data' }, { name: 'color', type: 'color', default: '#ef4444' }],
  },
);
