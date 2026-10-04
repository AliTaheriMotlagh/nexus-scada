/**
 * Page templates & real-world use cases, plus installation into a project
 * (shared by the designer gallery and the `install-templates` tool).
 */
import type { DisplayDoc, ProjectNode, ScriptConfig } from '../types.ts';
import type { PageTemplate, TemplateScript } from './builder.ts';

export { TEMPLATES } from './useCases.ts';
export { PAGE_SIZES, type PageTemplate, type PageSize, type TemplateCategory } from './builder.ts';

export interface Installation {
  /** Updated project node tree (template tags inserted) */
  nodes: ProjectNode[];
  display: DisplayDoc;
  scripts: (ScriptConfig & { code: string })[];
  /** Tag folder where the template was installed */
  base: string;
}

/** Insert a template into a project. `parent` is a folder path ('' = root), `name` the new folder/display name. */
export function installTemplate(tpl: PageTemplate, nodes: ProjectNode[], parent: string, name: string, title?: string): Installation {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error('Name may only contain letters, digits, _ and -');
  const tree = structuredClone(nodes);
  const base = parent ? `${parent}/${name}` : name;
  if (tpl.nodes) {
    let list = tree;
    for (const seg of parent ? parent.split('/') : []) {
      let f = list.find((n) => n.name === seg);
      if (!f) {
        f = { kind: 'folder', name: seg, children: [] };
        list.push(f);
      }
      if (f.kind === 'tag') throw new Error(`${seg} is a tag, not a folder`);
      if (f.kind === 'device') throw new Error(`Templates cannot be installed inside device ${seg}`);
      list = (f.children ??= []);
    }
    if (list.some((n) => n.name === name)) throw new Error(`"${base}" already exists — choose another name`);
    list.push(tpl.nodes(name));
  }
  const display: DisplayDoc = { ...tpl.display(base, title ?? splitWords(name)), name: base };
  const scripts = (tpl.scripts?.(base, name) ?? []).map((s: TemplateScript) => ({
    name: s.name, file: `${s.name}.ts`, description: s.description, enabled: true, triggers: s.triggers, code: s.code,
  }));
  return { nodes: tree, display, scripts, base };
}

const splitWords = (s: string) => s.replace(/([a-z])([A-Z0-9])/g, '$1 $2');
