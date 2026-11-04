import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface Props {
  pdf: Uint8Array | undefined;
}

/**
 * Renders every page to a canvas, fitted to the pane width. New pages are
 * drawn off-screen and swapped in at once, so edits never flash a blank pane.
 */
export function Preview({ pdf }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // Measure now (ResizeObserver only reports on rendering frames, which a
  // background tab may not get), then follow resizes.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    setWidth(contentWidth(el));
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry?.contentRect.width ?? 0)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!pdf || !el || width < 50) return;
    let cancelled = false;
    // pdf.js takes ownership of the buffer, so hand it a copy.
    const task = pdfjs.getDocument({ data: pdf.slice(), isEvalSupported: false } as never);
    (async () => {
      const doc = await task.promise;
      const canvases: HTMLCanvasElement[] = [];
      const ratio = window.devicePixelRatio || 1;
      for (let i = 1; i <= doc.numPages && !cancelled; i++) {
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        // `width` is the content box (padding excluded).
        const scale = width / base.width;
        const viewport = page.getViewport({ scale: scale * ratio });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
        canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
        canvas.className = "page";
        canvas.setAttribute("aria-label", `Page ${i} of ${doc.numPages}`);
        await page.render({ canvas, viewport } as never).promise;
        canvases.push(canvas);
      }
      if (!cancelled) el.replaceChildren(...canvases);
      await task.destroy();
    })().catch((e: unknown) => {
      // A superseded render can be cancelled by pdf.js; anything else is a bug.
      if (!cancelled) console.error("cvac preview:", e);
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, width]);

  return <div className="preview" ref={host} aria-live="polite" />;
}

/** Width inside the padding, like ResizeObserver's contentRect. */
function contentWidth(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  return Math.floor(
    el.clientWidth - Number.parseFloat(cs.paddingLeft) - Number.parseFloat(cs.paddingRight),
  );
}
