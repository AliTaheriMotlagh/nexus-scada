import {
  ALARM_KINDS, DRIVER_TYPES, ROLE_RANK, SEVERITIES,
  type ProjectConfig, type ProjectNode, type ScriptTrigger,
} from '../../../shared/types.ts';

export class ValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid project configuration:\n - ${issues.join('\n - ')}`);
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

const NAME_RE = /^[^/\\#*?"<>|]+$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validate a parsed project.yaml and return it typed. Throws ValidationError listing every issue found. */
export function validateProject(raw: unknown): ProjectConfig {
  const issues: string[] = [];
  if (!isObj(raw)) throw new ValidationError(['root must be a mapping']);

  if (!isObj(raw.project) || typeof raw.project.name !== 'string') issues.push('project.name is required');
  if (raw.nodes !== undefined && !Array.isArray(raw.nodes)) issues.push('nodes must be a list');

  const checkNodes = (nodes: unknown[], path: string, insideDevice: boolean) => {
    const seen = new Set<string>();
    nodes.forEach((n, i) => {
      const where = `${path}[${i}]`;
      if (!isObj(n)) return issues.push(`${where} must be a mapping`);
      const name = n.name;
      if (typeof name !== 'string' || !NAME_RE.test(name)) return issues.push(`${where}.name is missing or contains / \\ # * ? " < > |`);
      const full = path ? `${path}/${name}` : name;
      if (seen.has(name)) issues.push(`duplicate node name "${full}"`);
      seen.add(name);
      switch (n.kind) {
        case 'folder':
          if (n.children !== undefined && !Array.isArray(n.children)) issues.push(`${full}: children must be a list`);
          else checkNodes((n.children as unknown[]) ?? [], full, insideDevice);
          break;
        case 'device':
          if (insideDevice) issues.push(`${full}: devices cannot be nested in devices`);
          if (!DRIVER_TYPES.includes(n.driver as never)) issues.push(`${full}: driver must be one of ${DRIVER_TYPES.join(', ')}`);
          if (n.settings !== undefined && !isObj(n.settings)) issues.push(`${full}: settings must be a mapping`);
          checkNodes((n.children as unknown[]) ?? [], full, true);
          break;
        case 'tag': {
          if (n.dataType !== undefined && !['number', 'boolean', 'string', 'json'].includes(n.dataType as string)) {
            issues.push(`${full}: dataType must be number|boolean|string|json`);
          }
          if (n.writeRole !== undefined && !(String(n.writeRole) in ROLE_RANK)) issues.push(`${full}: unknown writeRole`);
          if (n.alarms !== undefined) {
            if (!Array.isArray(n.alarms)) issues.push(`${full}: alarms must be a list`);
            else n.alarms.forEach((a, j) => {
              if (!isObj(a) || !ALARM_KINDS.includes(a.kind as never)) issues.push(`${full}.alarms[${j}]: kind must be one of ${ALARM_KINDS.join(', ')}`);
              else if (a.severity !== undefined && !SEVERITIES.includes(a.severity as never)) issues.push(`${full}.alarms[${j}]: unknown severity`);
              else if (['hihi', 'hi', 'lo', 'lolo', 'equals'].includes(a.kind as string) && a.limit === undefined) issues.push(`${full}.alarms[${j}]: limit is required`);
            });
          }
          break;
        }
        default:
          issues.push(`${full}: kind must be folder, device or tag`);
      }
    });
  };
  checkNodes((raw.nodes as unknown[]) ?? [], '', false);

  if (raw.scripts !== undefined) {
    if (!Array.isArray(raw.scripts)) issues.push('scripts must be a list');
    else raw.scripts.forEach((s, i) => {
      if (!isObj(s) || typeof s.name !== 'string' || typeof s.file !== 'string') return issues.push(`scripts[${i}] requires name and file`);
      ((s.triggers as ScriptTrigger[] | undefined) ?? []).forEach((t, j) => {
        if (!['startup', 'interval', 'tagChange', 'cron', 'alarm', 'manual'].includes(t?.type)) issues.push(`scripts[${i}].triggers[${j}]: unknown type`);
        if (t?.type === 'interval' && !(Number(t.ms) >= 50)) issues.push(`scripts[${i}].triggers[${j}]: interval ms must be >= 50`);
        if (t?.type === 'tagChange' && !Array.isArray(t.tags)) issues.push(`scripts[${i}].triggers[${j}]: tags must be a list`);
        if (t?.type === 'cron' && typeof t.cron !== 'string') issues.push(`scripts[${i}].triggers[${j}]: cron is required`);
      });
    });
  }

  if (raw.users !== undefined) {
    if (!Array.isArray(raw.users)) issues.push('users must be a list');
    else raw.users.forEach((u, i) => {
      if (!isObj(u) || typeof u.username !== 'string') issues.push(`users[${i}].username is required`);
      else if (!(String(u.role) in ROLE_RANK)) issues.push(`users[${i}].role must be viewer|operator|engineer|admin`);
    });
  }

  if (raw.schedules !== undefined && !Array.isArray(raw.schedules)) issues.push('schedules must be a list');
  if (raw.recipes !== undefined && !Array.isArray(raw.recipes)) issues.push('recipes must be a list');
  if (raw.map !== undefined && (!isObj(raw.map) || !Array.isArray(raw.map.center))) issues.push('map.center must be [lat, lng]');

  if (issues.length) throw new ValidationError(issues);
  const cfg = raw as unknown as ProjectConfig;
  cfg.nodes ??= [];
  return cfg;
}

/** Depth-first walk over the project tree with full paths. */
export function walkNodes(
  nodes: ProjectNode[],
  visit: (node: ProjectNode, path: string, device: { path: string; node: Extract<ProjectNode, { kind: 'device' }> } | undefined) => void,
  base = '',
  device?: { path: string; node: Extract<ProjectNode, { kind: 'device' }> },
): void {
  for (const node of nodes) {
    const path = base ? `${base}/${node.name}` : node.name;
    visit(node, path, device);
    if (node.kind === 'folder') walkNodes(node.children ?? [], visit, path, device);
    if (node.kind === 'device') walkNodes(node.children ?? [], visit, path, { path, node });
  }
}
