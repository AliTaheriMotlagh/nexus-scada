// Install use-case templates into a project folder (tags + display + scripts).
// Usage: npm run install-templates -w server -- [templateId|all] [parentFolder=Sites]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import YAML from 'yaml';
import { installTemplate, TEMPLATES } from '../../../shared/templates/index.ts';
import type { ProjectConfig } from '../../../shared/types.ts';
import { validateProject } from '../config/validation.ts';
import { appendNode, appendScripts } from '../config/yamlEdit.ts';

const [which = 'all', parent = 'Sites'] = process.argv.slice(2);
const projectDir = resolve(process.env.NEXUS_PROJECT_DIR ?? `${import.meta.dirname}/../../../project`);
const file = join(projectDir, 'project.yaml');
const doc = YAML.parseDocument(readFileSync(file, 'utf8'));
let config = validateProject(doc.toJS()) as ProjectConfig;

const selected = TEMPLATES.filter((t) => t.nodes && (which === 'all' || t.id === which));
if (!selected.length) {
  console.error(`No template "${which}". Available: ${TEMPLATES.filter((t) => t.nodes).map((t) => t.id).join(', ')}`);
  process.exit(1);
}
for (const tpl of selected) {
  try {
    const inst = installTemplate(tpl, config.nodes, parent, tpl.defaultName, tpl.name);
    config = { ...config, nodes: inst.nodes };
    const displayFile = join(projectDir, 'displays', `${inst.display.name}.yaml`);
    mkdirSync(dirname(displayFile), { recursive: true });
    writeFileSync(displayFile, YAML.stringify(inst.display, { lineWidth: 0 }));
    const scripts = [...(config.scripts ?? [])];
    const added = [];
    for (const s of inst.scripts) {
      const { code, ...cfg } = s;
      writeFileSync(join(projectDir, 'scripts', s.file), code);
      if (!scripts.some((x) => x.name === s.name)) { scripts.push(cfg); added.push(cfg); }
    }
    config = { ...config, scripts };
    appendNode(doc, parent, tpl.nodes!(tpl.defaultName));
    appendScripts(doc, added);
    console.log(`✓ ${tpl.name} → tags ${inst.base}, display ${inst.display.name}${inst.scripts.length ? `, script ${inst.scripts.map((s) => s.name).join(', ')}` : ''}`);
  } catch (err) {
    console.warn(`• ${tpl.name}: ${(err as Error).message}`);
  }
}
validateProject(doc.toJS());
writeFileSync(file, doc.toString({ lineWidth: 0 }));
console.log(existsSync(file) ? 'project.yaml updated — the running server hot-reloads it.' : '');
