import type { DisplayDoc, ElementDoc } from '../../../shared/types.ts';
import { AppError } from '../core/errors.ts';
import { createLogger } from '../core/logger.ts';
import { errorMessage } from '../core/util.ts';

const log = createLogger('ai');

/**
 * OpenAI-compatible chat endpoints. All of these have a free option:
 *  - gemini:     Google AI Studio free tier (key from https://aistudio.google.com/apikey)
 *  - groq:       free tier (https://console.groq.com/keys)
 *  - openrouter: models ending in ":free" (https://openrouter.ai/keys)
 *  - ollama:     completely free & private, runs on your own machine (https://ollama.com)
 * Model ids change over time — override with NEXUS_AI_MODEL.
 */
const PRESETS: Record<string, { url: string; model: string; needsKey: boolean }> = {
  gemini: { url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', needsKey: true },
  groq: { url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', needsKey: true },
  openrouter: { url: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free', needsKey: true },
  ollama: { url: 'http://localhost:11434/v1', model: 'qwen2.5:14b', needsKey: false },
  openai: { url: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', needsKey: true },
  custom: { url: '', model: '', needsKey: false },
};

export interface CatalogEntry {
  type: string;
  label: string;
  category: string;
  w: number;
  h: number;
  primary?: string;
  props: { name: string; type: string; default?: unknown; options?: string[] }[];
}

export interface GenTagInfo {
  path: string;
  dataType: string;
  unit?: string;
  writable?: boolean;
  min?: number;
  max?: number;
  states?: Record<string, string>;
}

export interface GenerateRequest {
  prompt: string;
  catalog: CatalogEntry[];
  tags: GenTagInfo[];
  width: number;
  height: number;
  current?: DisplayDoc;
}

const SYSTEM = `You are an expert SCADA/HMI graphics engineer. You design operator displays that follow ISA-101 high-performance HMI practice:
dark neutral background, grey equipment, colour only for state and alarms, clear grouping in panels, alignment on a 10 px grid, readable labels, the most important values largest.
Return ONLY one JSON object: {"title": string, "width": number, "height": number, "background": string, "elements": Element[]}.
Element = {"id": unique short string, "type": one of the element types listed, "x","y","w","h": integers inside the page, "props": object,
  "bindings"?: {"<prop>": {"tag": "<tag path>", "expr"?: "TypeScript expression using value", "map"?: [{"when": ">80", "value": "#ef4444"}, {"when": "default", "value": "#22c55e"}]}},
  "faceplate"?: {"path": "<tag folder path>"}}
Rules:
- Use ONLY tag paths from the provided tag list. Never invent tags.
- Controls and indicators (button, switch, slider, numeric, textInput, dropdown, checkbox, gauge, bar, led, value, multistate, progress, sparkline) take the tag path in props.tag.
- trend and barChart take props.tags = comma separated tag paths. alarmTable takes props.area = tag folder prefix.
- Process symbols (tank, pump, valve, motor, fan, …) are animated with bindings on their primary property, e.g. {"level": {"tag": "Plant/T1/Level"}}; add "faceplate": {"path": "<equipment folder>"} so operators can click them.
- Buttons: props.action is one of write|toggle|pulse|navigate|faceplate; for write set props.value.
- Background panels are rect elements with props {"fill":"#111b27","stroke":"#233244","radius":10}, listed BEFORE the elements on top of them; panel captions are text with fontSize 12, fontWeight "700", color "#64748b".
- Start with a header text (fontSize 24, fontWeight "700", color "#e2e8f0") and a clock at the top right.
- Pipes are horizontal; use "rotation": 90 for vertical pipes. Connect equipment with pipes and bind "flowing" to running/flow tags.
- No overlapping except content placed on its panel. Keep 16 px margins. Use the whole page.`;

function catalogText(catalog: CatalogEntry[]): string {
  return catalog
    .filter((c) => c.type !== 'group')
    .map((c) => `- ${c.type} (${c.category}, default ${c.w}×${c.h}${c.primary ? `, primary: ${c.primary}` : ''}): ${c.props.map((p) => `${p.name}:${p.type}${p.options ? `[${p.options.join('|')}]` : ''}`).join(', ')}`)
    .join('\n');
}

function tagText(tags: GenTagInfo[]): string {
  return tags
    .slice(0, 400)
    .map((t) => [t.path, t.dataType, t.unit ?? '', t.writable ? 'rw' : 'ro', t.min !== undefined || t.max !== undefined ? `${t.min ?? ''}..${t.max ?? ''}` : '', t.states ? Object.entries(t.states).map(([k, v]) => `${k}=${v}`).join('/') : '']
      .join(' | '))
    .join('\n');
}

/** Pull the first JSON object out of a model reply (handles ```json fences and chatter). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The AI answer contained no JSON');
  return JSON.parse(body.slice(start, end + 1));
}

/** Make a model answer safe to load: known types only, finite geometry inside the page, unique ids, no scripts. */
export function sanitizeDisplay(raw: unknown, knownTypes: Set<string>, width: number, height: number): Omit<DisplayDoc, 'name'> {
  const r = (raw ?? {}) as Partial<DisplayDoc>;
  const W = Math.min(4000, Math.max(200, Number(r.width) || width));
  const H = Math.min(4000, Math.max(200, Number(r.height) || height));
  const ids = new Set<string>();
  const elements: ElementDoc[] = [];
  for (const e of Array.isArray(r.elements) ? r.elements : []) {
    if (!e || typeof e !== 'object' || !knownTypes.has(String(e.type))) continue;
    let id = String(e.id ?? '').replace(/[^\w-]/g, '').slice(0, 40) || `ai${elements.length}`;
    while (ids.has(id)) id += '_';
    ids.add(id);
    const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);
    const w = Math.max(4, Math.min(W, num(e.w, 100)));
    const h = Math.max(4, Math.min(H, num(e.h, 40)));
    elements.push({
      id,
      type: String(e.type),
      name: typeof e.name === 'string' ? e.name.slice(0, 60) : undefined,
      x: Math.max(0, Math.min(W - w, num(e.x, 0))),
      y: Math.max(0, Math.min(H - h, num(e.y, 0))),
      w,
      h,
      rotation: Number.isFinite(Number(e.rotation)) ? Number(e.rotation) : undefined,
      props: e.props && typeof e.props === 'object' ? e.props : {},
      bindings: e.bindings && typeof e.bindings === 'object' ? e.bindings : undefined,
      faceplate: e.faceplate && typeof e.faceplate.path === 'string' ? { path: e.faceplate.path } : undefined,
      tooltip: typeof e.tooltip === 'string' ? e.tooltip : undefined,
      // AI-generated event scripts are never accepted
    });
  }
  if (!elements.length) throw new Error('The AI answer contained no usable elements');
  return { title: typeof r.title === 'string' ? r.title : 'AI page', kind: 'page', width: W, height: H, background: typeof r.background === 'string' ? r.background : '#0f1722', grid: 10, elements };
}

/** AI page generation through any OpenAI-compatible chat endpoint (configured with environment variables). */
export class AiService {
  private readonly provider = (process.env.NEXUS_AI_PROVIDER ?? '').toLowerCase();
  private readonly url: string;
  private readonly model: string;
  private readonly key = process.env.NEXUS_AI_KEY ?? '';
  private readonly usage = new Map<string, number[]>();
  private readonly perHour = Number(process.env.NEXUS_AI_RATE_PER_HOUR ?? 30);

  constructor() {
    const preset = PRESETS[this.provider];
    this.url = (process.env.NEXUS_AI_URL ?? preset?.url ?? '').replace(/\/$/, '');
    this.model = process.env.NEXUS_AI_MODEL ?? preset?.model ?? '';
    if (this.enabled) log.info(`AI page generation via ${this.provider} (${this.model})`);
  }

  get enabled(): boolean {
    const preset = PRESETS[this.provider];
    return !!preset && !!this.url && !!this.model && (!preset.needsKey || !!this.key);
  }

  status() {
    return { enabled: this.enabled, provider: this.provider || null, model: this.enabled ? this.model : null, providers: Object.keys(PRESETS).filter((p) => p !== 'custom') };
  }

  private rateLimit(user: string): void {
    const now = Date.now();
    const recent = (this.usage.get(user) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= this.perHour) throw new AppError(`AI limit reached (${this.perHour} pages per hour)`, 429);
    recent.push(now);
    this.usage.set(user, recent);
  }

  async generate(req: GenerateRequest, user: string): Promise<Omit<DisplayDoc, 'name'>> {
    if (!this.enabled) throw new AppError('AI is not configured on this server (set NEXUS_AI_PROVIDER and NEXUS_AI_KEY)', 503);
    if (!req.prompt?.trim()) throw new AppError('Describe the page you want', 400);
    this.rateLimit(user);
    const known = new Set(req.catalog.map((c) => c.type));
    const userMsg = [
      `Page size: ${req.width}×${req.height} px.`,
      `Request: ${req.prompt.slice(0, 4000)}`,
      `Available tags (path | type | unit | rw/ro | range | states):\n${tagText(req.tags) || '(none — use static values)'}`,
      req.current ? `Current page JSON — modify it according to the request and return the complete updated page (keep the ids of elements you keep):\n${JSON.stringify({ ...req.current, name: undefined }).slice(0, 60000)}` : '',
    ].filter(Boolean).join('\n\n');
    const messages = [
      { role: 'system', content: `${SYSTEM}\n\nElement types:\n${catalogText(req.catalog)}` },
      { role: 'user', content: userMsg },
    ];
    const started = Date.now();
    let text = await this.chat(messages, true).catch(async (err: Error & { status?: number }) => {
      if (err.status === 400) return this.chat(messages, false); // provider without JSON mode
      throw err;
    });
    let doc: Omit<DisplayDoc, 'name'>;
    try {
      doc = sanitizeDisplay(extractJson(text), known, req.width, req.height);
    } catch (err) {
      log.warn(`unusable AI answer, retrying once: ${errorMessage(err)}`);
      text = await this.chat([...messages, { role: 'assistant', content: text.slice(0, 2000) }, { role: 'user', content: 'That was not valid. Reply with ONLY the JSON object.' }], true);
      doc = sanitizeDisplay(extractJson(text), known, req.width, req.height);
    }
    log.info(`${user} generated "${doc.title}" (${doc.elements.length} elements) in ${Date.now() - started} ms`);
    return doc;
  }

  private async chat(messages: { role: string; content: string }[], jsonMode: boolean): Promise<string> {
    const res = await fetch(`${this.url}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(this.key && { authorization: `Bearer ${this.key}` }) },
      body: JSON.stringify({ model: this.model, messages, temperature: 0.2, max_tokens: 12000, ...(jsonMode && { response_format: { type: 'json_object' } }) }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new AppError(`AI provider error ${res.status}: ${detail}`, res.status === 429 ? 429 : res.status === 400 ? 400 : 502);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new AppError('Empty answer from the AI provider', 502);
    return content;
  }
}
