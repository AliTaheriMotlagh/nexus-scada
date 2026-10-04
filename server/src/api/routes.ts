import { Router, type NextFunction, type Request, type Response } from 'express';
import type {
  DisplayDoc, MapConfig, ProjectNode, Role, SceneDoc, ScriptConfig, SessionUser,
} from '../../../shared/types.ts';
import { validateProject, ValidationError } from '../config/validation.ts';
import type { DocumentRepository } from '../config/ProjectStore.ts';
import { AppError, badRequest } from '../core/errors.ts';
import { logBuffer } from '../core/logger.ts';
import type { Runtime } from '../Runtime.ts';
import { checkScript } from '../scripting/ScriptEngine.ts';

declare module 'express-serve-static-core' {
  interface Locals {
    user?: SessionUser;
  }
}

const num = (v: unknown, def: number) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? def : Number(v));
const list = (v: unknown) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const wildcard = (v: unknown) => (Array.isArray(v) ? v.join('/') : String(v ?? ''));

export function createApi(rt: Runtime): Router {
  const api = Router();

  // ── authentication: resolve the bearer token on every request ──
  api.use((req, res, next) => {
    const header = req.headers.authorization;
    res.locals.user = rt.auth.verify(header?.startsWith('Bearer ') ? header.slice(7) : undefined);
    next();
  });
  const need = (role: Role) => (_req: Request, res: Response, next: NextFunction) => {
    res.locals.user = rt.auth.require(res.locals.user, role);
    next();
  };
  const who = (res: Response) => res.locals.user?.username ?? 'anonymous';

  // ── system ──
  api.get('/health', (_req, res) => { res.json({ status: 'ok', uptimeSec: rt.info().uptimeSec }); });
  api.get('/info', (_req, res) => { res.json(rt.info()); });
  api.get('/logs', need('engineer'), (req, res) => { res.json(logBuffer.list(num(req.query.limit, 500))); });

  api.post('/auth/login', (req, res) => { res.json(rt.auth.login(req.body?.username, req.body?.password)); });
  api.get('/auth/me', (_req, res) => { res.json(rt.auth.effective(res.locals.user) ?? null); });

  // ── tags ──
  api.get('/tree', need('viewer'), (_req, res) => { res.json(rt.tags.tree()); });
  api.get('/tags', need('viewer'), (req, res) => {
    const prefix = String(req.query.prefix ?? '');
    res.json(rt.tags.infos(prefix).map((info) => ({ ...info, ...rt.tags.get(info.path) })));
  });
  api.get('/tags/info', need('viewer'), (req, res) => { res.json(rt.tags.info(String(req.query.path))); });
  api.get('/tags/values', need('viewer'), (req, res) => { res.json(rt.tags.snapshot(list(req.query.paths))); });
  api.post('/tags/write', async (req, res) => {
    const { path, value } = req.body ?? {};
    const tag = rt.tags.runtime(String(path));
    if (!tag) throw new AppError(`Unknown tag "${path}"`, 404);
    const user = rt.auth.require(res.locals.user, tag.def.writeRole ?? 'operator');
    const before = tag.current.value;
    await rt.tags.write(path, value);
    rt.auth.audit(user.username, 'tag.write', path, { from: before, to: value, via: 'rest' });
    res.json({ ok: true });
  });

  // ── alarms ──
  api.get('/alarms', need('viewer'), (req, res) => { res.json(rt.alarms.active(String(req.query.area ?? ''))); });
  api.get('/alarms/history', need('viewer'), (req, res) => {
    const to = num(req.query.to, Date.now());
    res.json(rt.alarms.history({ from: num(req.query.from, to - 86_400_000), to, search: req.query.q as string | undefined, limit: num(req.query.limit, 1000) }));
  });
  api.post('/alarms/ack', need('operator'), (req, res) => {
    const ids: string[] = req.body?.ids ?? [];
    const n = rt.alarms.ack(ids, who(res), req.body?.comment);
    if (n) rt.auth.audit(who(res), 'alarm.ack', ids.join(', '), req.body?.comment);
    res.json({ acknowledged: n });
  });
  api.post('/alarms/shelve', need('operator'), (req, res) => {
    rt.alarms.shelve(String(req.body?.id), num(req.body?.minutes, 60), who(res), req.body?.comment);
    rt.auth.audit(who(res), 'alarm.shelve', req.body?.id, req.body);
    res.json({ ok: true });
  });

  // ── history / trends ──
  api.get('/history', need('viewer'), (req, res) => {
    const to = num(req.query.to, Date.now());
    res.json(rt.historian.query(list(req.query.paths), num(req.query.from, to - 3_600_000), to, num(req.query.points, 1000)));
  });
  api.get('/history/csv', need('viewer'), (req, res) => {
    const to = num(req.query.to, Date.now());
    const series = rt.historian.query(list(req.query.paths), num(req.query.from, to - 3_600_000), to, num(req.query.points, 10000));
    const lines = ['tag,timestamp,value'];
    for (const s of series) for (const p of s.points) lines.push(`"${s.path}",${new Date(p.ts).toISOString()},${p.value ?? ''}`);
    res.setHeader('content-type', 'text/csv');
    res.setHeader('content-disposition', 'attachment; filename="history.csv"');
    res.send(lines.join('\n'));
  });

  // ── devices ──
  api.get('/devices', need('viewer'), (_req, res) => { res.json(rt.drivers.statuses()); });
  api.post('/devices/enable', need('engineer'), async (req, res) => {
    await rt.drivers.setEnabled(String(req.body?.path), Boolean(req.body?.enabled));
    rt.auth.audit(who(res), req.body?.enabled ? 'device.enable' : 'device.disable', req.body?.path);
    res.json({ ok: true });
  });
  api.post('/devices/restart', need('engineer'), async (req, res) => {
    await rt.drivers.restart(String(req.body?.path));
    rt.auth.audit(who(res), 'device.restart', req.body?.path);
    res.json({ ok: true });
  });

  // ── project configuration (YAML) ──
  api.get('/project/yaml', need('engineer'), (_req, res) => { res.type('text/yaml').send(rt.store.readYaml()); });
  api.put('/project/yaml', need('engineer'), async (req, res) => {
    const text = typeof req.body === 'string' ? req.body : String(req.body?.yaml ?? '');
    await rt.saveProjectYaml(text, who(res));
    res.json({ ok: true, revision: rt.store.revision });
  });
  api.post('/project/validate', need('engineer'), (req, res) => {
    try {
      validateProject(req.body);
      res.json({ ok: true, issues: [] });
    } catch (err) {
      res.json({ ok: false, issues: err instanceof ValidationError ? err.issues : [(err as Error).message] });
    }
  });
  api.get('/project/revisions', need('engineer'), (_req, res) => { res.json(rt.store.revisions()); });
  api.get('/project/revisions/:id', need('engineer'), (req, res) => { res.type('text/yaml').send(rt.store.readRevision(String(req.params.id))); });
  api.get('/project/nodes', need('engineer'), (_req, res) => { res.json(rt.config.nodes); });
  api.put('/project/nodes', need('engineer'), async (req, res) => {
    if (!Array.isArray(req.body)) throw badRequest('nodes must be an array');
    await rt.updateSection('nodes', req.body as ProjectNode[], who(res));
    res.json({ ok: true });
  });
  api.post('/project/reload', need('engineer'), async (_req, res) => {
    await rt.reload();
    rt.auth.audit(who(res), 'project.reload');
    res.json({ ok: true });
  });

  // ── displays & scenes (one generic CRUD for both repositories) ──
  const documents = <T extends { name: string }>(base: string, repo: DocumentRepository<T>, label: string) => {
    api.get(`/${base}`, need('viewer'), (_req, res) => { res.json({ names: repo.list(), tree: repo.tree(label) }); });
    api.get(`/${base}/*name`, need('viewer'), (req, res) => { res.json(repo.get(wildcard(req.params.name))); });
    api.put(`/${base}/*name`, need('engineer'), (req, res) => {
      const name = wildcard(req.params.name);
      repo.save(name, req.body as T);
      rt.auth.audit(who(res), `${label}.save`, name);
      rt.bus.emit('project:reloaded', { revision: rt.store.revision });
      res.json({ ok: true });
    });
    api.delete(`/${base}/*name`, need('engineer'), (req, res) => {
      const name = wildcard(req.params.name);
      repo.delete(name);
      rt.auth.audit(who(res), `${label}.delete`, name);
      rt.bus.emit('project:reloaded', { revision: rt.store.revision });
      res.json({ ok: true });
    });
    api.post(`/${base}-rename`, need('engineer'), (req, res) => {
      repo.rename(String(req.body?.from), String(req.body?.to));
      rt.auth.audit(who(res), `${label}.rename`, `${req.body?.from} → ${req.body?.to}`);
      rt.bus.emit('project:reloaded', { revision: rt.store.revision });
      res.json({ ok: true });
    });
  };
  documents<DisplayDoc>('displays', rt.store.displays, 'display');
  documents<SceneDoc>('scenes', rt.store.scenes, 'scene');

  // ── server scripts ──
  api.get('/scripts', need('viewer'), (_req, res) => { res.json(rt.scripts.statuses()); });
  api.post('/scripts/check', need('engineer'), (req, res) => { res.json(checkScript(String(req.body?.code ?? ''))); });
  api.get('/scripts/:name', need('engineer'), (req, res) => {
    const cfg = rt.scripts.config(req.params.name as string);
    res.json({ config: cfg, code: rt.store.readScript(cfg.file) });
  });
  api.put('/scripts/:name', need('engineer'), async (req, res) => {
    const name = req.params.name as string;
    const scripts = [...(rt.config.scripts ?? [])];
    const idx = scripts.findIndex((s) => s.name === name);
    const incoming = req.body?.config as ScriptConfig | undefined;
    const cfg: ScriptConfig = { ...(idx >= 0 ? scripts[idx] : { file: `${name}.ts` }), ...incoming, name };
    if (typeof req.body?.code === 'string') rt.store.writeScript(cfg.file, req.body.code);
    if (idx >= 0) scripts[idx] = cfg;
    else scripts.push(cfg);
    await rt.updateSection('scripts', scripts, who(res));
    rt.auth.audit(who(res), 'script.save', name);
    res.json({ ok: true });
  });
  api.delete('/scripts/:name', need('engineer'), async (req, res) => {
    const scripts = (rt.config.scripts ?? []).filter((s) => s.name !== req.params.name);
    await rt.updateSection('scripts', scripts, who(res));
    rt.auth.audit(who(res), 'script.delete', req.params.name as string);
    res.json({ ok: true });
  });
  api.post('/scripts/:name/run', need('operator'), async (req, res) => {
    rt.auth.audit(who(res), 'script.run', req.params.name as string);
    await rt.scripts.run(req.params.name as string, { type: 'manual', user: who(res), ...(req.body ?? {}) });
    res.json({ ok: true });
  });

  // ── automation ──
  api.get('/schedules', need('viewer'), (_req, res) => { res.json({ config: rt.config.schedules ?? [], jobs: rt.scheduler.list() }); });
  api.get('/recipes', need('viewer'), (_req, res) => { res.json(rt.recipes.all()); });
  api.post('/recipes/:name/download', need('operator'), async (req, res) => {
    await rt.recipes.download(req.params.name as string, String(req.body?.set));
    rt.auth.audit(who(res), 'recipe.download', `${req.params.name}/${req.body?.set}`);
    res.json({ ok: true });
  });
  api.post('/recipes/:name/upload', need('engineer'), (req, res) => {
    res.json(rt.recipes.upload(req.params.name as string, String(req.body?.set), who(res)));
    rt.auth.audit(who(res), 'recipe.upload', `${req.params.name}/${req.body?.set}`);
  });
  api.delete('/recipes/:name/sets/:set', need('engineer'), (req, res) => {
    rt.recipes.deleteSet(req.params.name as string, req.params.set as string, who(res));
    rt.auth.audit(who(res), 'recipe.deleteSet', `${req.params.name}/${req.params.set}`);
    res.json({ ok: true });
  });
  api.post('/notify/test', need('engineer'), async (req, res) => {
    await rt.notifier.notify({ title: 'Nexus SCADA test', message: `Test notification from ${who(res)}`, severity: 'info' }, req.body?.channel);
    res.json({ ok: true });
  });

  // ── map ──
  api.get('/map', need('viewer'), (_req, res) => {
    res.json(rt.config.map ?? { center: [rt.config.location?.lat ?? 51.5, rt.config.location?.lng ?? 0], zoom: 5, markers: [] });
  });
  api.put('/map', need('engineer'), async (req, res) => {
    await rt.updateSection('map', req.body as MapConfig, who(res));
    res.json({ ok: true });
  });

  // ── audit ──
  api.get('/audit', need('engineer'), (req, res) => {
    const to = num(req.query.to, Date.now());
    res.json(rt.auth.auditLog({ from: num(req.query.from, to - 7 * 86_400_000), to, search: req.query.q as string | undefined, limit: num(req.query.limit, 500) }));
  });

  api.use((_req, res) => { res.status(404).json({ error: 'Not found' }); });
  return api;
}

/** Map thrown errors to JSON responses. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message, issues: err.issues });
    return;
  }
  const status = (err as { status?: number; statusCode?: number }).status ?? (err as { statusCode?: number }).statusCode ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : (err as Error).message });
}
