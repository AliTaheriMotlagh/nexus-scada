import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import { useProject } from '../stores/project.ts';
import { useUi } from '../stores/ui.ts';
import { scriptLibs, type ScriptKind } from './scriptTypings.ts';

// ── one-time Monaco environment setup (bundled locally: works offline on the plant network) ──
(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    if (label === 'json') return new JsonWorker();
    return new EditorWorker();
  },
};

const ts = monaco.typescript;
ts.typescriptDefaults.setCompilerOptions({
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  lib: ['es2022'],
  allowNonTsExtensions: true,
  strict: false,
  noImplicitAny: false,
  moduleDetection: 3, // force: each script is its own module → no cross-script name clashes, top-level await OK
});
ts.typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: false,
  noSyntaxValidation: false,
  // 1108: top-level `return` is allowed — scripts are wrapped in an async function.
  diagnosticCodesToIgnore: [1108, 1375, 1378],
});
ts.typescriptDefaults.setEagerModelSync(true);

let currentKind: ScriptKind | undefined;
let currentTagsKey = '';
function applyScriptLibs(kind: ScriptKind) {
  const paths = [...useProject.getState().tags.keys()];
  const key = `${paths.length}:${paths[0] ?? ''}:${paths[paths.length - 1] ?? ''}`;
  if (kind === currentKind && key === currentTagsKey) return;
  currentKind = kind;
  currentTagsKey = key;
  ts.typescriptDefaults.setExtraLibs(scriptLibs(kind, paths));
}

export interface EditorMarker { line: number; message: string; severity?: 'error' | 'warning' }

interface Props {
  value: string;
  onChange?: (value: string) => void;
  language: 'typescript' | 'yaml' | 'json';
  /** For TypeScript: which script API is in scope */
  scriptKind?: ScriptKind;
  /** Unique model id (keeps undo history per document) */
  path: string;
  readOnly?: boolean;
  height?: number | string;
  onSave?: () => void;
  markers?: EditorMarker[];
  minimap?: boolean;
}

export function MonacoEditor({ value, onChange, language, scriptKind = 'server', path, readOnly, height = '100%', onSave, markers, minimap }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor>(undefined);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  const theme = useUi((s) => s.theme);
  const tagRevision = useProject((s) => s.revision);

  useEffect(() => {
    if (language === 'typescript') applyScriptLibs(scriptKind);
    const ext = language === 'typescript' ? 'ts' : language;
    const uri = monaco.Uri.parse(`file:///${scriptKind}/${path.replace(/[^\w/.-]/g, '_')}.${ext}`);
    const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(value, language, uri);
    if (model.getValue() !== value) model.setValue(value);
    const editor = monaco.editor.create(host.current!, {
      model,
      readOnly,
      automaticLayout: true,
      minimap: { enabled: minimap ?? language !== 'typescript' },
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace",
      scrollBeyondLastLine: false,
      tabSize: 2,
      fixedOverflowWidgets: true,
      theme: useUi.getState().theme === 'dark' ? 'vs-dark' : 'vs',
    });
    editorRef.current = editor;
    const sub = editor.onDidChangeModelContent(() => onChangeRef.current?.(editor.getValue()));
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSaveRef.current?.());
    editor.onDidFocusEditorText(() => { if (language === 'typescript') applyScriptLibs(scriptKind); });
    return () => {
      sub.dispose();
      editor.dispose();
      model.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, language, scriptKind]);

  // External value changes (e.g. reload from server) without losing cursor when equal.
  useEffect(() => {
    const ed = editorRef.current;
    if (ed && ed.getValue() !== value) ed.getModel()?.setValue(value);
  }, [value]);

  useEffect(() => {
    monaco.editor.setTheme(theme === 'dark' ? 'vs-dark' : 'vs');
  }, [theme]);

  useEffect(() => {
    if (language === 'typescript') {
      currentKind = undefined;
      applyScriptLibs(scriptKind);
    }
  }, [tagRevision, language, scriptKind]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    monaco.editor.setModelMarkers(model, 'nexus', (markers ?? []).map((m) => ({
      startLineNumber: m.line, endLineNumber: m.line, startColumn: 1, endColumn: model.getLineMaxColumn(Math.min(m.line, model.getLineCount())),
      message: m.message, severity: m.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Error,
    })));
  }, [markers]);

  return <div ref={host} className="monaco-host" style={{ height }} />;
}

export function MonacoDiff({ original, modified, language = 'yaml', height = '100%' }: { original: string; modified: string; language?: string; height?: number | string }) {
  const host = useRef<HTMLDivElement>(null);
  const theme = useUi((s) => s.theme);
  useEffect(() => {
    const a = monaco.editor.createModel(original, language);
    const b = monaco.editor.createModel(modified, language);
    const diff = monaco.editor.createDiffEditor(host.current!, { automaticLayout: true, readOnly: true, renderSideBySide: true, theme: theme === 'dark' ? 'vs-dark' : 'vs' });
    diff.setModel({ original: a, modified: b });
    return () => {
      diff.dispose();
      a.dispose();
      b.dispose();
    };
  }, [original, modified, language, theme]);
  return <div ref={host} className="monaco-host" style={{ height }} />;
}

export default MonacoEditor;
