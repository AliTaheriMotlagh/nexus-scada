import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, watch, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import YAML from 'yaml';
import type { DisplayDoc, ProjectConfig, SceneDoc, TreeItem } from '../../../shared/types.ts';
import { badRequest, notFound } from '../core/errors.ts';
import { createLogger } from '../core/logger.ts';
import { validateProject } from './validation.ts';

const log = createLogger('project');
const SAFE_NAME = /^[A-Za-z0-9_\- ./]+$/;

/** Atomic write: write a temp file, then rename over the target. */
function writeAtomic(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, file);
}

function assertSafeName(name: string): void {
  if (!name || !SAFE_NAME.test(name) || name.split('/').some((s) => s === '..' || s === '.' || s === '')) {
    throw badRequest(`Invalid name "${name}" (letters, digits, space, _ - . and / folders only)`);
  }
}

/**
 * Repository for YAML documents stored as files in a folder tree (displays, scenes).
 * Document names map to relative paths: "Plant/Overview" → displays/Plant/Overview.yaml
 */
export class DocumentRepository<T extends { name: string }> {
  readonly dir: string;
  private readonly onWrite: () => void;

  constructor(dir: string, onWrite: () => void) {
    this.dir = dir;
    this.onWrite = onWrite;
    mkdirSync(dir, { recursive: true });
  }

  private fileOf(name: string): string {
    assertSafeName(name);
    const file = resolve(this.dir, `${name}.yaml`);
    if (!file.startsWith(this.dir + sep)) throw badRequest('Invalid path');
    return file;
  }

  list(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) {
          out.push(relative(this.dir, full).replace(/\.ya?ml$/, '').split(sep).join('/'));
        }
      }
    };
    walk(this.dir);
    return out.sort();
  }

  tree(kind: string): TreeItem[] {
    const root: TreeItem[] = [];
    for (const name of this.list()) {
      const parts = name.split('/');
      let level = root;
      parts.forEach((part, i) => {
        const id = parts.slice(0, i + 1).join('/');
        const isLeaf = i === parts.length - 1;
        let item = level.find((n) => n.name === part && (n.kind === 'folder') !== isLeaf);
        if (!item) {
          item = { id, name: part, kind: isLeaf ? kind : 'folder', children: isLeaf ? undefined : [] };
          level.push(item);
        }
        if (!isLeaf) level = item.children!;
      });
    }
    return root;
  }

  exists(name: string): boolean {
    return existsSync(this.fileOf(name));
  }

  get(name: string): T {
    const file = this.fileOf(name);
    if (!existsSync(file)) throw notFound(`"${name}"`);
    const doc = YAML.parse(readFileSync(file, 'utf8')) as T;
    doc.name = name;
    return doc;
  }

  save(name: string, doc: T): void {
    const copy = { ...doc, name };
    writeAtomic(this.fileOf(name), YAML.stringify(copy, { lineWidth: 0 }));
    this.onWrite();
  }

  delete(name: string): void {
    const file = this.fileOf(name);
    if (!existsSync(file)) throw notFound(`"${name}"`);
    rmSync(file);
    this.onWrite();
  }

  rename(from: string, to: string): void {
    const doc = this.get(from);
    if (this.exists(to)) throw badRequest(`"${to}" already exists`);
    this.save(to, doc);
    this.delete(from);
  }
}

/**
 * Owns the on-disk project folder ("configuration as code"):
 *   project.yaml          nodes (folders/devices/tags), alarms, scripts, schedules, users, map...
 *   displays/**.yaml      graphic pages and faceplates
 *   scenes/**.yaml        3D scenes
 *   scripts/**.ts         server scripts
 *   .history/             automatic revision backups of project.yaml
 */
export class ProjectStore {
  readonly root: string;
  readonly displays: DocumentRepository<DisplayDoc>;
  readonly scenes: DocumentRepository<SceneDoc>;
  private readonly projectFile: string;
  private lastOwnWrite = 0;
  private watcher?: ReturnType<typeof watch>;
  revision = 0;

  constructor(root: string) {
    this.root = resolve(root);
    this.projectFile = join(this.root, 'project.yaml');
    if (!existsSync(this.projectFile)) throw new Error(`project.yaml not found in ${this.root}`);
    const touch = () => { this.revision++; };
    this.displays = new DocumentRepository<DisplayDoc>(join(this.root, 'displays'), touch);
    this.scenes = new DocumentRepository<SceneDoc>(join(this.root, 'scenes'), touch);
  }

  readYaml(): string {
    return readFileSync(this.projectFile, 'utf8');
  }

  load(): ProjectConfig {
    const config = validateProject(YAML.parse(this.readYaml()));
    this.revision++;
    return config;
  }

  /** Validate and persist a new project.yaml. The previous version is kept in .history/. */
  saveYaml(text: string, user = 'system'): ProjectConfig {
    let parsed: unknown;
    try {
      parsed = YAML.parse(text);
    } catch (err) {
      throw badRequest(`YAML syntax error: ${(err as Error).message}`);
    }
    const config = validateProject(parsed);
    this.backup(user);
    this.lastOwnWrite = Date.now();
    writeAtomic(this.projectFile, text);
    return config;
  }

  /** Replace one top-level section (e.g. "nodes", "map") while keeping comments elsewhere. */
  updateSection(key: keyof ProjectConfig, value: unknown, user = 'system'): ProjectConfig {
    const doc = YAML.parseDocument(this.readYaml());
    doc.set(key, doc.createNode(value));
    return this.saveYaml(doc.toString({ lineWidth: 0 }), user);
  }

  private backup(user: string): void {
    const dir = join(this.root, '.history');
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(join(dir, `project-${stamp}-${user.replace(/[^\w-]/g, '')}.yaml`), this.readYaml(), 'utf8');
    const files = readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort();
    for (const old of files.slice(0, Math.max(0, files.length - 50))) rmSync(join(dir, old));
  }

  revisions(): { id: string; ts: number; size: number }[] {
    const dir = join(this.root, '.history');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.yaml'))
      .map((f) => {
        const st = statSync(join(dir, f));
        return { id: f, ts: st.mtimeMs, size: st.size };
      })
      .sort((a, b) => b.ts - a.ts);
  }

  readRevision(id: string): string {
    if (!/^[\w.-]+\.yaml$/.test(id)) throw badRequest('Invalid revision');
    const file = join(this.root, '.history', id);
    if (!existsSync(file)) throw notFound('Revision');
    return readFileSync(file, 'utf8');
  }

  // ── scripts ──
  private scriptFile(file: string): string {
    assertSafeName(file);
    const full = resolve(this.root, 'scripts', file);
    if (!full.startsWith(join(this.root, 'scripts') + sep)) throw badRequest('Invalid script path');
    return full;
  }

  readScript(file: string): string {
    const full = this.scriptFile(file);
    return existsSync(full) ? readFileSync(full, 'utf8') : '';
  }

  writeScript(file: string, code: string): void {
    this.lastOwnWrite = Date.now();
    writeAtomic(this.scriptFile(file), code);
  }

  /** Watch project.yaml and scripts for edits made outside the app (git pull, text editor). */
  watch(onChange: () => void): void {
    let timer: NodeJS.Timeout | undefined;
    try {
      this.watcher = watch(this.root, { recursive: true }, (_event, file) => {
        if (!file || file.includes('.history') || file.endsWith('.tmp')) return;
        if (!(file === 'project.yaml' || file.startsWith(`scripts${sep}`))) return;
        if (Date.now() - this.lastOwnWrite < 1500) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          log.info(`external change detected (${file}), reloading`);
          onChange();
        }, 400);
      });
    } catch (err) {
      log.warn('file watching unavailable:', err);
    }
  }

  close(): void {
    this.watcher?.close();
  }
}
