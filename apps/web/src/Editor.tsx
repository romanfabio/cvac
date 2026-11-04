import { autocompletion, type CompletionContext } from "@codemirror/autocomplete";
import { yaml } from "@codemirror/lang-yaml";
import { type Diagnostic as CmDiagnostic, lintGutter, setDiagnostics } from "@codemirror/lint";
import { Compartment, EditorState, type Extension, type Text } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";
import { contentJsonSchema, type Diagnostic, themeJsonSchema } from "@cvac/core/editor";
import { basicSetup } from "codemirror";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { completeYaml, type JsonSchema } from "./complete.ts";
import { CV_FILE, THEME_FILE } from "./files.ts";

export interface EditorHandle {
  reveal(file: string, line: number, column: number): void;
}

interface Props {
  files: Record<string, string>;
  active: string;
  diagnostics: Diagnostic[];
  dark: boolean;
  onChange(file: string, text: string): void;
  onActivate(file: string): void;
}

const SCHEMAS: Record<string, JsonSchema> = {
  [CV_FILE]: contentJsonSchema() as JsonSchema,
  [THEME_FILE]: themeJsonSchema() as JsonSchema,
};

function schemaCompletion(file: string) {
  return (ctx: CompletionContext) => {
    const schema = SCHEMAS[file];
    if (!schema) return null;
    const r = completeYaml(ctx.state.doc.toString(), ctx.pos, schema);
    if (!r) return null;
    // Only pop up unasked when a word is being typed (or right after "- " / ": ").
    if (
      !ctx.explicit &&
      r.from === ctx.pos &&
      !/(:\s|-\s|^\s*)$/.test(
        ctx.state.doc.lineAt(ctx.pos).text.slice(0, ctx.pos - ctx.state.doc.lineAt(ctx.pos).from),
      )
    ) {
      return null;
    }
    return {
      from: r.from,
      options: r.options.map((o) => ({
        label: o.label,
        apply: o.apply,
        type: o.type,
        ...(o.detail ? { detail: o.detail } : {}),
        ...(o.info ? { info: o.info } : {}),
      })),
      validFor: /^[\w$-]*$/,
    };
  };
}

/** 1-based line/column to a document offset, clamped to the document. */
function offset(doc: Text, line: number, column: number): number {
  const l = doc.line(Math.min(Math.max(line, 1), doc.lines));
  return Math.min(l.from + Math.max(column - 1, 0), l.to);
}

function toCm(doc: Text, file: string, diags: Diagnostic[]): CmDiagnostic[] {
  return diags
    .filter((d) => d.file === file)
    .map((d) => {
      const start = d.range?.start ?? { line: 1, column: 1 };
      const end = d.range?.end ?? start;
      const from = offset(doc, start.line, start.column);
      let to = offset(doc, end.line, end.column);
      if (to <= from) to = doc.lineAt(from).to;
      return {
        from,
        to: Math.max(to, from),
        severity: d.severity,
        source: d.code,
        message: d.help ? `${d.message}\n${d.help}` : d.message,
      };
    });
}

/** One CodeMirror view; one state per file, so each tab keeps its own undo history. */
export const Editor = forwardRef<EditorHandle, Props>(function Editor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const states = useRef(new Map<string, EditorState>());
  const theme = useRef(new Compartment());
  const latest = useRef(props);
  latest.current = props;

  const extensions = (file: string): Extension[] => [
    basicSetup,
    yaml(),
    lintGutter(),
    autocompletion({ override: [schemaCompletion(file)], icons: false }),
    keymap.of([]),
    EditorState.tabSize.of(2),
    EditorView.lineWrapping,
    theme.current.of(latest.current.dark ? oneDark : []),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) latest.current.onChange(file, u.state.doc.toString());
    }),
  ];

  const stateFor = (file: string): EditorState => {
    let s = states.current.get(file);
    if (!s) {
      s = EditorState.create({
        doc: latest.current.files[file] ?? "",
        extensions: extensions(file),
      });
      states.current.set(file, s);
    }
    return s;
  };

  /** Remember the live state of the visible file before swapping it out. */
  const stash = () => {
    const v = view.current;
    if (v) states.current.set(v.dom.dataset.file as string, v.state);
  };

  useEffect(() => {
    if (!host.current) return;
    const file = latest.current.active;
    const v = new EditorView({ state: stateFor(file), parent: host.current });
    v.dom.dataset.file = file;
    view.current = v;
    // Dev-only handle for interactive debugging (stripped from production builds).
    if (import.meta.env.DEV) (window as unknown as { __cvacView?: EditorView }).__cvacView = v;
    return () => v.destroy();
  }, []);

  // Switch the visible file.
  useEffect(() => {
    const v = view.current;
    if (!v || v.dom.dataset.file === props.active) return;
    stash();
    v.setState(stateFor(props.active));
    v.dom.dataset.file = props.active;
    v.dispatch(
      setDiagnostics(v.state, toCm(v.state.doc, props.active, latest.current.diagnostics)),
    );
    v.dispatch({ effects: theme.current.reconfigure(latest.current.dark ? oneDark : []) });
  }, [props.active]);

  // External text changes (reset to starter).
  useEffect(() => {
    stash();
    for (const [file, text] of Object.entries(props.files)) {
      const s = stateFor(file);
      if (s.doc.toString() === text) continue;
      const next = s.update({ changes: { from: 0, to: s.doc.length, insert: text } }).state;
      states.current.set(file, next);
      if (view.current?.dom.dataset.file === file) view.current.setState(next);
    }
  }, [props.files]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.dispatch(
      setDiagnostics(v.state, toCm(v.state.doc, v.dom.dataset.file as string, props.diagnostics)),
    );
  }, [props.diagnostics]);

  useEffect(() => {
    view.current?.dispatch({ effects: theme.current.reconfigure(props.dark ? oneDark : []) });
  }, [props.dark]);

  useImperativeHandle(ref, () => ({
    reveal(file, line, column) {
      latest.current.onActivate(file);
      requestAnimationFrame(() => {
        const v = view.current;
        if (!v) return;
        const pos = offset(v.state.doc, line, column);
        v.dispatch({
          selection: { anchor: pos },
          effects: EditorView.scrollIntoView(pos, { y: "center" }),
        });
        v.focus();
      });
    },
  }));

  return <div className="editor" ref={host} />;
});
