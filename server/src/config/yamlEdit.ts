import YAML, { isMap, isSeq, type Document, type Node, type YAMLMap, type YAMLSeq } from 'yaml';
import type { ProjectNode, ScriptConfig } from '../../../shared/types.ts';

/** Tags written one per line ({ kind: tag, name: … }) like hand-written project files. */
function compact(node: Node): Node {
  YAML.visit(node, {
    Map(_, m) {
      if (m.get('kind') === 'tag' || m.get('type') !== undefined) m.flow = true;
    },
  });
  return node;
}

/**
 * Insert a node under a folder path of project.yaml WITHOUT re-serialising the rest of the file,
 * so comments and formatting of existing sections are preserved.
 */
export function appendNode(doc: Document, parentPath: string, value: ProjectNode): void {
  let seq = doc.get('nodes') as YAMLSeq | undefined;
  if (!isSeq(seq)) {
    seq = doc.createNode([]) as YAMLSeq;
    doc.set('nodes', seq);
  }
  for (const seg of parentPath ? parentPath.split('/') : []) {
    let item = seq.items.find((i) => isMap(i) && i.get('name') === seg) as YAMLMap | undefined;
    if (!item) {
      item = doc.createNode({ kind: 'folder', name: seg, children: [] }) as YAMLMap;
      seq.add(item);
    }
    let kids = item.get('children');
    if (!isSeq(kids)) {
      kids = doc.createNode([]);
      item.set('children', kids);
    }
    seq = kids as YAMLSeq;
  }
  seq.add(compact(doc.createNode(value) as Node));
}

export function appendScripts(doc: Document, scripts: ScriptConfig[]): void {
  if (!scripts.length) return;
  let seq = doc.get('scripts') as YAMLSeq | undefined;
  if (!isSeq(seq)) {
    seq = doc.createNode([]) as YAMLSeq;
    doc.set('scripts', seq);
  }
  for (const s of scripts) seq.add(compact(doc.createNode(s) as Node));
}
