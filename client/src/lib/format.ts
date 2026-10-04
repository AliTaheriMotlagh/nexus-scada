import type { TagInfo, TagValue } from '@shared/types.ts';

export function formatValue(v: unknown, info?: Pick<TagInfo, 'decimals' | 'unit' | 'states' | 'dataType'>, withUnit = true): string {
  if (v === undefined || v === null) return '—';
  if (info?.states) {
    const s = info.states[String(v)];
    if (s) return s;
  }
  let text: string;
  if (typeof v === 'number') text = info?.decimals !== undefined ? v.toFixed(info.decimals) : Number.isInteger(v) ? String(v) : v.toFixed(2);
  else if (typeof v === 'boolean') text = v ? 'ON' : 'OFF';
  else if (typeof v === 'object') text = JSON.stringify(v);
  else text = String(v);
  return withUnit && info?.unit ? `${text} ${info.unit}` : text;
}

export const fmtTime = (ts?: number) => (ts ? new Date(ts).toLocaleTimeString() : '—');
export const fmtDateTime = (ts?: number) => (ts ? new Date(ts).toLocaleString() : '—');

export function qualityClass(v?: TagValue): string {
  if (!v) return 'q-unknown';
  return `q-${v.quality}`;
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d`;
}

export const SEVERITY_COLOR: Record<string, string> = {
  critical: 'var(--sev-critical)', high: 'var(--sev-high)', medium: 'var(--sev-medium)', low: 'var(--sev-low)', info: 'var(--sev-info)',
};

let idCounter = 0;
export const uid = (prefix = 'e') => `${prefix}${Date.now().toString(36)}${(idCounter++).toString(36)}`;
