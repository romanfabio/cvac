import { type Diagnostic, STARTER_CV, STARTER_THEME } from "@cvac/core/editor";
import { useCallback, useEffect, useRef, useState } from "react";
import { Editor, type EditorHandle } from "./Editor.tsx";
import type { BuildRequest, BuildResult } from "./engine.ts";
import { CV_FILE, THEME_FILE } from "./files.ts";
import { Preview } from "./Preview.tsx";
import { fromBase64, load, save, toBase64 } from "./storage.ts";

const DEBOUNCE_MS = 250;

export function App() {
  const [files, setFiles] = useState<Record<string, string>>(() => ({
    [CV_FILE]: load(CV_FILE) ?? STARTER_CV,
    [THEME_FILE]: load(THEME_FILE) ?? STARTER_THEME,
  }));
  const [active, setActive] = useState(CV_FILE);
  const [locale, setLocale] = useState(() => load("locale") ?? "");
  const [variant, setVariant] = useState(() => load("variant") ?? "");
  const [assets, setAssets] = useState<Record<string, Uint8Array>>(() => loadPhotos());
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
          assets,
          ...(locale ? { locale } : {}),
          ...(variant ? { variant } : {}),
        };
        worker?.postMessage(req);
      }),
    [worker, files, locale, variant, assets],
  );

  // Live preview: rebuild the PDF shortly after the last change.
  useEffect(() => {
    if (!worker) return;
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
  }, [request, worker]);

  const onChange = useCallback((file: string, text: string) => {
    setFiles((f) => (f[file] === text ? f : { ...f, [file]: text }));
    save(file, text);
  }, []);

  const download = async (format: "pdf" | "docx") => {
    const r = format === "pdf" && result?.bytes && pdf ? { bytes: pdf } : await request(format);
    if (!r.bytes) return;
    const parts = ["cv", variant, locale].filter(Boolean).join(".");
    const type =
      format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const url = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${parts}.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file || !result?.photo) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    setAssets((a) => ({ ...a, [result.photo as string]: bytes }));
    save(`photo:${result.photo}`, toBase64(bytes));
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

  const diags = result?.diagnostics ?? [];
  const errors = diags.filter((d) => d.severity === "error").length;
  const missingPhoto = result?.photo !== undefined && !assets[result.photo];

  return (
    <div className="app">
      <header className="toolbar">
        <h1>
          CV as Code <span>{"·"} live editor</span>
        </h1>
        <div className="controls">
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
        <span className="privacy">Runs entirely in your browser. Nothing is uploaded.</span>
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

function loadPhotos(): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith("cvac:photo:")) continue;
      const v = localStorage.getItem(key);
      if (v) out[key.slice("cvac:photo:".length)] = fromBase64(v);
    }
  } catch {
    // storage unavailable
  }
  return out;
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
