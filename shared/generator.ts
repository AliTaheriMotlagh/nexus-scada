/**
 * Offline page generator: builds a sensible operator page from a folder of tags using naming and
 * data-type heuristics. Free, instant and works without internet — also the fallback when no AI is configured.
 */
import type { DisplayDoc, ElementDoc, TagInfo } from './types.ts';

type Info = Pick<TagInfo, 'path' | 'name' | 'dataType' | 'unit' | 'writable' | 'min' | 'max' | 'decimals' | 'history' | 'states' | 'alarmCount' | 'expression'>;

const has = (re: RegExp, ...s: (string | undefined)[]) => s.some((x) => x && re.test(x));
const parent = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('/')));
const leaf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const words = (s: string) => s.replace(/([a-z])([A-Z0-9])/g, '$1 $2');

interface Hero { el: Omit<ElementDoc, 'id' | 'x' | 'y'>; used: string }

/** Pick the equipment symbol that best represents a group of tags. */
function heroFor(group: string, tags: Info[]): Hero | null {
  const g = leaf(group);
  const run = tags.find((t) => t.dataType === 'boolean' && /run|on$|^on|state|active|firing|open|enable/i.test(t.name));
  const level = tags.find((t) => t.dataType === 'number' && /level|soc|fill/i.test(t.name) && (t.unit === '%' || t.max === 100));
  const symbol = (type: string, prop: string, tag: Info, w = 100, h = 100, props: Record<string, unknown> = {}): Hero =>
    ({ el: { type, w, h, props, bindings: { [prop]: { tag: tag.path } }, faceplate: { path: group } }, used: tag.path });
  if (level) return symbol(/batter|soc/i.test(level.name) ? 'battery' : /silo|hopper/i.test(g) ? 'silo' : 'tank', 'level', level, /batter|soc/i.test(level.name) ? 70 : 100, 160, { label: words(g).toUpperCase() });
  if (run) {
    const n = `${g} ${run.name}`;
    if (has(/pump/i, n)) return symbol('pump', 'running', run, 90, 90);
    if (has(/fan|blower|vent/i, n)) return symbol('fan', 'running', run, 90, 90);
    if (has(/compress/i, n)) return symbol('compressor', 'running', run, 90, 90);
    if (has(/conveyor|belt|line/i, n)) return symbol('conveyor', 'running', run, 200, 44);
    if (has(/motor|drive|mixer|agitator/i, n)) return symbol('motor', 'running', run, 120, 80);
    if (has(/light|lamp/i, n)) return symbol('lamp', 'on', run, 70, 84);
    if (has(/valve|damper/i, n)) return symbol('valve', 'open', run, 70, 70);
    if (has(/door|window|garage|gate/i, n)) return symbol('door', 'open', run, 60, 90);
    if (has(/boiler|burner|heat|furnace/i, n)) return symbol('boiler', 'firing', run, 80, 130);
    if (has(/plug|socket|relay/i, n)) return symbol('plug', 'on', run, 70, 70);
  }
  const temp = tags.find((t) => t.dataType === 'number' && /°C|°F|K$/.test(t.unit ?? ''));
  const sp = tags.find((t) => t.dataType === 'number' && /setpoint|target|sp$/i.test(t.name));
  if (temp && sp) return { el: { type: 'thermostat', w: 150, h: 150, props: {}, bindings: { value: { tag: temp.path }, setpoint: { tag: sp.path } }, faceplate: { path: group } }, used: temp.path };
  const solar = tags.find((t) => t.dataType === 'number' && /pv|solar/i.test(t.name));
  if (solar) return symbol('solar', 'power', solar, 140, 120);
  const gaugeTag = tags.find((t) => t.dataType === 'number' && /bar|psi|Pa$|°C|°F|kW$|^W$|A$|V$|Hz|m³\/h|l\/s|rpm|ppm/i.test(t.unit ?? ''));
  if (gaugeTag) {
    const min = gaugeTag.min ?? 0;
    const max = gaugeTag.max ?? guessMax(gaugeTag);
    return { el: { type: 'gauge', w: 150, h: 136, props: { tag: gaugeTag.path, min, max, label: words(gaugeTag.name) } }, used: gaugeTag.path };
  }
  return null;
}

function guessMax(t: Info): number {
  const u = t.unit ?? '';
  if (/bar/.test(u)) return 10;
  if (/psi/.test(u)) return 150;
  if (/°C/.test(u)) return 100;
  if (/ppm/.test(u)) return 2000;
  if (/Hz/.test(u)) return 60;
  if (/^V$/.test(u)) return 260;
  if (/kW/.test(u)) return 200;
  if (/^W$/.test(u)) return 5000;
  if (/%/.test(u)) return 100;
  return 100;
}

/** One row widget per tag. */
function rowFor(t: Info, width: number): Omit<ElementDoc, 'id' | 'x' | 'y'> {
  const label = words(t.name);
  if (t.dataType === 'boolean') {
    return t.writable
      ? { type: 'switch', w: width, h: 32, props: { tag: t.path, label } }
      : { type: 'led', w: width, h: 28, props: { tag: t.path, label, onColor: t.alarmCount ? '#ef4444' : '#22c55e', blinkWhenOn: t.alarmCount > 0 } };
  }
  if (t.dataType === 'string' && t.writable && t.states) return { type: 'dropdown', w: width, h: 32, props: { tag: t.path } };
  if (t.dataType === 'number' && t.writable && !t.expression) {
    return t.min !== undefined && t.max !== undefined && t.max - t.min <= 1000 && /%/.test(t.unit ?? '')
      ? { type: 'slider', w: width, h: 32, props: { tag: t.path } }
      : { type: 'numeric', w: width, h: 32, props: { tag: t.path, label, unit: t.unit ?? '' } };
  }
  return { type: 'value', w: width, h: 32, props: { tag: t.path, label, fontSize: 14, align: 'left' } };
}

export interface GenerateOptions {
  title: string;
  width: number;
  height: number;
  /** Folder prefix to include ('' = everything) */
  scope?: string;
  maxTags?: number;
}

/** Build a complete page from tag metadata. */
export function generateFromTags(all: Info[], o: GenerateOptions): Omit<DisplayDoc, 'name'> {
  const scope = (o.scope ?? '').replace(/\/$/, '');
  const tags = all.filter((t) => !scope || t.path === scope || t.path.startsWith(`${scope}/`)).slice(0, o.maxTags ?? 120);
  const phone = o.width < 700;
  const gap = 16;
  const cols = Math.max(1, Math.floor((o.width - gap) / (phone ? o.width : 380)));
  const cardW = Math.floor((o.width - gap * (cols + 1)) / cols);
  const elements: ElementDoc[] = [];
  let seq = 0;
  const push = (e: Omit<ElementDoc, 'id'>) => elements.push({ ...e, id: `g${++seq}` } as ElementDoc);

  push({ type: 'text', x: 24, y: 12, w: o.width - 240, h: 40, props: { text: o.title, fontSize: phone ? 20 : 24, fontWeight: '700', color: '#e2e8f0' } });
  if (!phone) push({ type: 'clock', x: o.width - 200, y: 16, w: 180, h: 32, props: { format: 'datetime', fontSize: 14, color: '#94a3b8' } });

  // group by equipment folder
  const groups = new Map<string, Info[]>();
  for (const t of tags) {
    const g = parent(t.path) || '(root)';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(t);
  }
  const colY = Array.from({ length: cols }, () => 64);
  for (const [group, list] of groups) {
    const col = colY.indexOf(Math.min(...colY));
    const x = gap + col * (cardW + gap);
    const y = colY[col];
    const hero = heroFor(group, list);
    const rows = list.filter((t) => t.path !== hero?.used).slice(0, 12);
    const heroH = hero ? hero.el.h + 16 : 0;
    const h = 40 + heroH + rows.length * 40 + 8;
    push({ type: 'rect', x, y, w: cardW, h, locked: true, props: { fill: '#111b27', stroke: '#233244', radius: 10 } });
    push({ type: 'text', x: x + 14, y: y + 6, w: cardW - 28, h: 24, props: { text: words(group).toUpperCase(), fontSize: 12, fontWeight: '700', color: '#64748b' }, ...(group !== '(root)' && { faceplate: { path: group } }) });
    let cy = y + 38;
    if (hero) {
      push({ ...hero.el, x: x + Math.round((cardW - hero.el.w) / 2), y: cy } as Omit<ElementDoc, 'id'>);
      cy += heroH;
    }
    for (const t of rows) {
      push({ ...rowFor(t, cardW - 28), x: x + 14, y: cy });
      cy += 40;
    }
    colY[col] = y + h + gap;
  }

  // trend + alarms across the bottom
  let bottom = Math.max(...colY);
  const trendTags = tags.filter((t) => t.history && t.dataType === 'number').slice(0, 4).map((t) => t.path);
  if (trendTags.length) {
    const w = phone ? o.width - 2 * gap : Math.floor((o.width - 3 * gap) * 0.55);
    push({ type: 'trend', x: gap, y: bottom, w, h: 240, props: { tags: trendTags.join(','), minutes: 15, legend: !phone } });
    if (phone) bottom += 240 + gap;
    push({ type: 'alarmTable', x: phone ? gap : gap * 2 + w, y: bottom, w: phone ? o.width - 2 * gap : o.width - 3 * gap - w, h: 240, props: { area: scope, maxRows: 8 } });
    bottom += 240 + gap;
  } else {
    push({ type: 'alarmTable', x: gap, y: bottom, w: o.width - 2 * gap, h: 200, props: { area: scope, maxRows: 6 } });
    bottom += 200 + gap;
  }
  return { title: o.title, kind: 'page', width: o.width, height: Math.max(o.height, bottom), background: '#0f1722', grid: 10, elements };
}
