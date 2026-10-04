import { join } from 'node:path';
import YAML from 'yaml';
import { appendNode, appendScripts } from './config/yamlEdit.ts';
import type { ProjectConfig, ProjectInfo, ProjectNode, ScriptConfig } from '../../shared/types.ts';
import { AiService } from './ai/AiService.ts';
import { AlarmEngine } from './alarms/AlarmEngine.ts';
import { Notifier } from './alarms/Notifier.ts';
import { RecipeService } from './automation/RecipeService.ts';
import { Scheduler } from './automation/Scheduler.ts';
import { ProjectStore } from './config/ProjectStore.ts';
import { Database } from './core/Database.ts';
import { EventBus } from './core/EventBus.ts';
import { createLogger } from './core/logger.ts';
import { DriverManager } from './drivers/DriverManager.ts';
import { Historian } from './historian/Historian.ts';
import { ScriptEngine } from './scripting/ScriptEngine.ts';
import { AuthService } from './security/AuthService.ts';
import { TagEngine } from './tags/TagEngine.ts';

const log = createLogger('runtime');

export interface RuntimeOptions {
  projectDir: string;
  dataDir: string;
}

/**
 * Composition root: creates every service once, wires them through the event bus,
 * and (re)applies the project configuration. Hot reloads are serialized.
 */
export class Runtime {
  readonly bus = new EventBus();
  readonly store: ProjectStore;
  readonly db: Database;
  readonly tags: TagEngine;
  readonly drivers: DriverManager;
  readonly alarms: AlarmEngine;
  readonly historian: Historian;
  readonly notifier: Notifier;
  readonly scheduler = new Scheduler();
  readonly recipes: RecipeService;
  readonly scripts: ScriptEngine;
  readonly auth: AuthService;
  readonly ai = new AiService();
  readonly startedAt = Date.now();
  /** NEXUS_DEMO=true → public demo: operating is allowed, saving code/config/graphics is not. */
  readonly demo = process.env.NEXUS_DEMO === 'true' || process.env.NEXUS_DEMO === '1';
  config!: ProjectConfig;
  private reloadChain: Promise<void> = Promise.resolve();

  constructor(opts: RuntimeOptions) {
    this.store = new ProjectStore(opts.projectDir);
    this.db = new Database(join(opts.dataDir, 'nexus.db'));
    this.tags = new TagEngine(this.bus);
    this.drivers = new DriverManager(this.tags, this.bus, this.db);
    this.alarms = new AlarmEngine(this.bus, this.db, this.tags);
    this.historian = new Historian(this.bus, this.db, this.tags);
    this.notifier = new Notifier(this.bus);
    this.recipes = new RecipeService(this.tags, this.store);
    this.auth = new AuthService(this.db);
    this.scripts = new ScriptEngine(
      { bus: this.bus, tags: this.tags, alarms: this.alarms, historian: this.historian, drivers: this.drivers, db: this.db, notifier: this.notifier, recipes: this.recipes },
      this.store,
      this.scheduler,
    );
  }

  async start(): Promise<void> {
    await this.apply(this.store.load());
    this.store.watch(() => void this.reload().catch((err) => log.error('reload failed:', err)));
    log.info(`project "${this.config.project.name}" running`);
  }

  /** Reload project.yaml from disk. */
  reload(): Promise<void> {
    return this.serialize(async () => this.apply(this.store.load()));
  }

  /** Validate + persist + apply a new project.yaml. */
  saveProjectYaml(text: string, user: string): Promise<void> {
    return this.serialize(async () => {
      const config = this.store.saveYaml(text, user);
      this.auth.audit(user, 'project.save', 'project.yaml');
      await this.apply(config);
    });
  }

  /** Replace one section of project.yaml (nodes, map, scripts...) and apply. */
  updateSection(key: keyof ProjectConfig, value: unknown, user: string): Promise<void> {
    return this.serialize(async () => {
      const config = this.store.updateSection(key, value, user);
      this.auth.audit(user, `project.update.${String(key)}`);
      await this.apply(config);
    });
  }

  /** Replace several top-level sections in one save + reload (e.g. nodes and scripts of a template). */
  updateSections(patch: Partial<ProjectConfig>, user: string, action: string): Promise<void> {
    return this.serialize(async () => {
      const doc = YAML.parseDocument(this.store.readYaml());
      for (const [k, v] of Object.entries(patch)) doc.set(k, doc.createNode(v));
      const config = this.store.saveYaml(doc.toString({ lineWidth: 0 }), user);
      this.auth.audit(user, action);
      await this.apply(config);
    });
  }

  /** Add a node subtree (+ script configs) to project.yaml, keeping the existing file's formatting. */
  appendToProject(parentPath: string, node: ProjectNode | undefined, scripts: ScriptConfig[], user: string, action: string): Promise<void> {
    return this.serialize(async () => {
      const doc = YAML.parseDocument(this.store.readYaml());
      if (node) appendNode(doc, parentPath, node);
      appendScripts(doc, scripts);
      const config = this.store.saveYaml(doc.toString({ lineWidth: 0 }), user);
      this.auth.audit(user, action);
      await this.apply(config);
    });
  }

  private serialize(fn: () => Promise<void>): Promise<void> {
    const next = this.reloadChain.then(fn, fn);
    this.reloadChain = next.catch(() => undefined);
    return next;
  }

  private async apply(config: ProjectConfig): Promise<void> {
    const t0 = performance.now();
    this.config = config;
    const devices = this.tags.load(config.nodes);
    await this.drivers.load(devices);
    const allTags = this.tags.all();
    this.alarms.load(allTags);
    this.historian.load(allTags, config.server?.historianRetentionDays ?? 30);
    this.notifier.load(config.notifications);
    this.recipes.load(config.recipes);
    this.auth.load(config.users, {
      tokenSecret: config.server?.tokenSecret,
      tokenTtlHours: config.server?.tokenTtlHours,
      anonymousRole: config.server && 'anonymousRole' in config.server ? config.server.anonymousRole ?? null : 'viewer',
    });

    this.scheduler.clear();
    this.scheduler.setLocation(config.location);
    for (const sch of config.schedules ?? []) {
      if (sch.enabled === false) continue;
      this.scheduler.add(`schedule:${sch.name}`, sch.cron, async () => {
        for (const action of sch.actions) {
          if ('write' in action) await this.tags.write(action.write, action.value);
          else await this.scripts.run(action.script, { type: 'schedule', schedule: sch.name });
        }
        this.auth.audit('scheduler', 'schedule.run', sch.name);
      });
    }
    this.scripts.load(config.scripts);
    this.scheduler.start();
    this.bus.emit('project:reloaded', { revision: this.store.revision });
    log.info(`configuration applied in ${Math.round(performance.now() - t0)} ms`);
  }

  info(): ProjectInfo {
    return {
      name: this.config.project.name,
      description: this.config.project.description,
      version: this.config.project.version,
      startDisplay: this.config.startDisplay,
      revision: this.store.revision,
      serverTime: Date.now(),
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      anonymousRole: this.auth.anonymousRole,
      location: this.config.location,
      demo: this.demo,
    };
  }

  async stop(): Promise<void> {
    this.scheduler.stop();
    this.scripts.stop();
    this.alarms.stop();
    this.historian.stop();
    await this.drivers.stopAll();
    this.store.close();
    this.db.close();
  }
}
