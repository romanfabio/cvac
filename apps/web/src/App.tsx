import {
  BUILTIN_THEME_NAMES,
  contentJsonSchema,
  type Diagnostic,
  STARTER_CV,
  STARTER_THEME,
  themeJsonSchema,
} from "@cvac/core/editor";
import { useCallback, useEffect, useRef, useState } from "react";
import { Editor, type EditorHandle } from "./Editor.tsx";
import type { BuildRequest, BuildResult } from "./engine.ts";
import { CV_FILE, THEME_FILE } from "./files.ts";
import { Preview } from "./Preview.tsx";
import { loadPhotos, replacePhotos, savePhoto } from "./photoStore.ts";
import { exportProject, importProject, PROJECT_FILE } from "./project.ts";
import { load, save } from "./storage.ts";
import { readExtends, setExtends } from "./themeFile.ts";

const DEBOUNCE_MS = 250;

export function App() {
  const [files, setFiles] = useState<Record<string, string>>(() => ({
    [CV_FILE]: load(CV_FILE) ?? STARTER_CV,
    [THEME_FILE]: load(THEME_FILE) ?? STARTER_THEME,
  }));
  const [active, setActive] = useState(CV_FILE);
  const [locale, setLocale] = useState(() => load("locale") ?? "");
  const [variant, setVariant] = useState(() => load("variant") ?? "");
  // Photos load asynchronously (IndexedDB); the first build waits for them,
  // so a saved photo never flashes a "photo not found" error.
  const [assets, setAssets] = useState<Record<string, Uint8Array>>();
  /** A problem the user should know about (saving the photo, export, import). */
  const [notice, setNotice] = useState("");
  const importInput = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<BuildResult>();
  const [pdf, setPdf] = useState<Uint8Array>();
  const [hash, setHash] = useState("");
  const [busy, setBusy] = useState(false);
  const dark = usePrefersDark();
  const editor = useRef<EditorHandle>(null);

  // One worker, owned by the effect (so StrictMode's setup/cleanup/setup
  // ends with a live one). Results of superseded requests are ignored.
  const [worker, setWorker] = useState<Worker>();
  const seq = useRef(0);
  const pending = useRef(new Map<number, (r: BuildResult) => void>());
  useEffect(() => {
    const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<BuildResult>) => {
      pending.current.get(e.data.id)?.(e.data);
      pending.current.delete(e.data.id);
    };
    setWorker(w);
    return () => {
      w.terminate();
      pending.current.clear();
    };
  }, []);

  useEffect(() => {
    let live = true;
    loadPhotos().then((photos) => live && setAssets((a) => ({ ...photos, ...a })));
    return () => {
      live = false;
    };
  }, []);

  const request = useCallback(
    (format: "pdf" | "docx") =>
      new Promise<BuildResult>((resolve) => {
        const id = ++seq.current;
        pending.current.set(id, resolve);
        const req: BuildRequest = {
          id,
          format,
          cv: files[CV_FILE] ?? "",
          theme: files[THEME_FILE] ?? "",
          assets: assets ?? {},
          ...(locale ? { locale } : {}),
          ...(variant ? { variant } : {}),
        };
        worker?.postMessage(req);
      }),
    [worker, files, locale, variant, assets],
  );

  // Live preview: rebuild the PDF shortly after the last change.
  useEffect(() => {
    if (!worker || !assets) return;
    setBusy(true);
    const timer = setTimeout(async () => {
      const id = seq.current + 1;
      const r = await request("pdf");
      if (id !== seq.current) return; // a newer build is on its way
      setResult(r);
      setBusy(false);
      if (r.bytes) {
        setPdf(r.bytes);
        setHash(await sha256(r.bytes));
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [request, worker, assets]);

  const onChange = useCallback((file: string, text: string) => {
    setFiles((f) => (f[file] === text ? f : { ...f, [file]: text }));
    save(file, text);
  }, []);

  const download = async (format: "pdf" | "docx") => {
    const r = format === "pdf" && result?.bytes && pdf ? { bytes: pdf } : await request(format);
    if (!r.bytes) return;
    const parts = ["cv", variant, locale].filter(Boolean).join(".");
    saveFile(
      r.bytes,
      `${parts}.${format}`,
      format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  };

  const exportZip = () => {
    const path = result?.photo;
    const data = path ? assets?.[path] : undefined;
    const r = exportProject({
      cv: files[CV_FILE] ?? "",
      theme: files[THEME_FILE] ?? "",
      ...(path && data ? { photo: { path, data } } : {}),
      schemas: { cv: contentJsonSchema(), theme: themeJsonSchema() },
    });
    saveFile(r.zip, PROJECT_FILE, "application/zip");
    setNotice(
      r.skipped
        ? `Exported without the photo: ${r.skipped}.`
        : path && !data
          ? `Exported without the photo: choose the file for ${path} first.`
          : "",
    );
  };

  const importZip = async (file: File | undefined) => {
    if (!file) return;
    let project: ReturnType<typeof importProject>;
    try {
      project = importProject(new Uint8Array(await file.arrayBuffer()));
    } catch (e) {
      setNotice(`Could not import ${file.name}: ${e instanceof Error ? e.message : String(e)}.`);
      return;
    }
    if (!confirm(`Replace cv.yaml, theme.yaml and the photo with the ones in ${file.name}?`)) {
      return;
    }
    setFiles({ [CV_FILE]: project.cv, [THEME_FILE]: project.theme });
    save(CV_FILE, project.cv);
    save(THEME_FILE, project.theme);
    setAssets(project.photos);
    try {
      await replacePhotos(project.photos);
      setNotice("");
    } catch {
      setNotice(
        Object.keys(project.photos).length
          ? "This browser could not save the photo: it is used now, but will be gone after a reload."
          : "",
      );
    }
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file || !result?.photo) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const key = result.photo;
    setAssets((a) => ({ ...a, [key]: bytes }));
    try {
      await savePhoto(key, bytes);
      setNotice("");
    } catch {
      setNotice(
        "This browser could not save the photo: it is used now, but will be gone after a reload.",
      );
    }
  };

  const reset = () => {
    if (!confirm("Replace both files with the starter CV and theme? Your edits will be lost."))
      return;
    setFiles({ [CV_FILE]: STARTER_CV, [THEME_FILE]: STARTER_THEME });
    save(CV_FILE, undefined);
    save(THEME_FILE, undefined);
  };

  const pick = (key: "locale" | "variant", value: string) => {
    (key === "locale" ? setLocale : setVariant)(value);
    save(key, value || undefined);
  };

  // The picker edits `extends:` in theme.yaml, so the file stays the source of truth.
  const base = readExtends(files[THEME_FILE] ?? "") ?? "default";
  const builtin = (BUILTIN_THEME_NAMES as readonly string[]).includes(base);
  const pickTheme = (name: string) =>
    onChange(THEME_FILE, setExtends(files[THEME_FILE] ?? "", name));

  const diags = result?.diagnostics ?? [];
  const errors = diags.filter((d) => d.severity === "error").length;
  const missingPhoto = result?.photo !== undefined && !assets?.[result.photo];

  return (
    <div className="app">
      <header className="toolbar">
        <h1>
          CV as Code <span>{"·"} live editor</span>
        </h1>
        <div className="controls">
          <label title="Sets extends: in theme.yaml">
            Theme
            <select value={base} onChange={(e) => pickTheme(e.target.value)}>
              {BUILTIN_THEME_NAMES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
              {!builtin && <option value={base}>{base}</option>}
            </select>
          </label>
          <label>
            Language
            <select value={locale} onChange={(e) => pick("locale", e.target.value)}>
              <option value="">Default</option>
              {(result?.locales ?? []).map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Variant
            <select value={variant} onChange={(e) => pick("variant", e.target.value)}>
              <option value="">Full CV</option>
              {(result?.variants ?? []).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          {result?.photo !== undefined && (
            <label className={missingPhoto ? "attention" : undefined}>
              Photo
              <input
                type="file"
                accept="image/png,image/jpeg"
                aria-label={`Choose the file for ${result.photo}`}
                onChange={(e) => onPhoto(e.target.files?.[0])}
              />
            </label>
          )}
          <button type="button" onClick={() => download("pdf")} disabled={!pdf || errors > 0}>
            Download PDF
          </button>
          <button type="button" onClick={() => download("docx")} disabled={errors > 0}>
            Download DOCX
          </button>
          <button
            type="button"
            className="secondary"
            onClick={exportZip}
            title="Download cv.yaml, theme.yaml and the photo as a .zip (cvac build works on the unzipped folder)"
          >
            Export
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => importInput.current?.click()}
            title="Open a project .zip exported here, or a zipped folder with cv.yaml"
          >
            Import
          </button>
          <input
            ref={importInput}
            type="file"
            accept=".zip,application/zip"
            aria-label="Import a project (.zip)"
            hidden
            onChange={(e) => {
              void importZip(e.target.files?.[0]);
              e.target.value = ""; // the same file can be imported again
            }}
          />
          <button type="button" className="secondary" onClick={reset}>
            Reset
          </button>
        </div>
      </header>

      <main className="panes">
        <section className="left" aria-label="Source files">
          <div className="tabs" role="tablist">
            {[CV_FILE, THEME_FILE].map((f) => {
              const n = diags.filter((d) => d.file === f && d.severity === "error").length;
              return (
                <button
                  type="button"
                  role="tab"
                  key={f}
                  aria-selected={active === f}
                  className={active === f ? "tab active" : "tab"}
                  onClick={() => setActive(f)}
                >
                  {f}
                  {n > 0 && <span className="badge">{n}</span>}
                </button>
              );
            })}
          </div>
          <Editor
            ref={editor}
            files={files}
            active={active}
            diagnostics={diags}
            dark={dark}
            onChange={onChange}
            onActivate={setActive}
          />
          <Problems
            diags={diags}
            onPick={(d) =>
              d.file &&
              d.range &&
              editor.current?.reveal(d.file, d.range.start.line, d.range.start.column)
            }
          />
        </section>
        <section className="right" aria-label="PDF preview">
          <Preview pdf={pdf} />
        </section>
      </main>

      <footer className="status">
        <span>
          {busy
            ? "Building…"
            : errors
              ? `${errors} error${errors === 1 ? "" : "s"}: preview shows the last good build`
              : "Up to date"}
        </span>
        {result?.pages ? (
          <span>
            {result.pages} page{result.pages === 1 ? "" : "s"}
          </span>
        ) : null}
        {result ? <span>{result.ms} ms</span> : null}
        {hash && (
          <span
            className="hash"
            data-sha256={hash}
            title="SHA-256 of the PDF. The same files give the same hash everywhere, including the cvac CLI."
          >
            sha256 {hash.slice(0, 12)}
          </span>
        )}
        {notice && (
          <span className="notice" role="alert">
            {notice}
          </span>
        )}
        <span className="privacy">
          Runs entirely in your browser. Nothing is uploaded.{" "}
          <a href={`${import.meta.env.BASE_URL}licenses.txt`} target="_blank" rel="noopener">
            Licenses
          </a>
        </span>
      </footer>
    </div>
  );
}

function Problems({ diags, onPick }: { diags: Diagnostic[]; onPick(d: Diagnostic): void }) {
  if (!diags.length) return <div className="problems empty">No problems</div>;
  return (
    <ul className="problems" aria-label="Problems">
      {diags.map((d, i) => (
        <li key={i}>
          <button
            type="button"
            className={`problem ${d.severity}`}
            onClick={() => onPick(d)}
            disabled={!d.range}
          >
            <span className="sev">{d.severity === "info" ? "note" : d.severity}</span>
            <span className="msg">
              {d.message}
              {d.help && <span className="help">{d.help}</span>}
            </span>
            <span className="where">
              {d.file}
              {d.range ? `:${d.range.start.line}` : ""}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Hand bytes to the browser as a file download. */
function saveFile(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function usePrefersDark(): boolean {
  const query = "(prefers-color-scheme: dark)";
  const [dark, setDark] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return dark;
}
