import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { OutputFormat } from "./engine.ts";

/** Every download format, in menu order, with what the menu says about it. */
export const DOWNLOADS: { format: OutputFormat; label: string; hint: string }[] = [
  { format: "pdf", label: "PDF", hint: "The CV as designed by the theme" },
  { format: "docx", label: "Word (.docx)", hint: "One column, editable in Word" },
  { format: "md", label: "Markdown (.md)", hint: "For a README, a website or a git repository" },
  { format: "txt", label: "Plain text (.txt)", hint: "For pasting into application forms" },
];

/**
 * A split button: the main part downloads the PDF, the arrow opens a menu
 * with every format. The menu follows the WAI-ARIA menu button pattern:
 * arrow keys move, Escape and clicks outside close it.
 */
export function DownloadMenu(props: {
  onDownload: (format: OutputFormat) => void;
  /** Formats that cannot be downloaded right now. */
  disabled: (format: OutputFormat) => boolean;
}) {
  const [open, setOpen] = useState(false);
  // Opens to the left of the arrow, unless the button sits near the left edge (phones).
  const [start, setStart] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    items.current.find((b) => b && !b.disabled)?.focus();
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const close = () => {
    setOpen(false);
    toggle.current?.focus();
  };

  const onMenuKey = (e: KeyboardEvent) => {
    const enabled = items.current.filter((b): b is HTMLButtonElement => !!b && !b.disabled);
    const at = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => enabled[(to + enabled.length) % enabled.length]?.focus();
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown") move(at + 1);
    else if (e.key === "ArrowUp") move(at - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(enabled.length - 1);
    else if (e.key === "Tab") setOpen(false);
    else return;
    if (e.key !== "Tab") e.preventDefault();
  };

  return (
    <div className="split" ref={root}>
      <button
        type="button"
        className="split-main"
        onClick={() => props.onDownload("pdf")}
        disabled={props.disabled("pdf")}
      >
        Download PDF
      </button>
      <button
        ref={toggle}
        type="button"
        className="split-toggle"
        aria-label="More download formats"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setStart((root.current?.getBoundingClientRect().right ?? 0) < 300);
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setStart((root.current?.getBoundingClientRect().right ?? 0) < 300);
            setOpen(true);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      >
        <svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
      {open && (
        <div
          className={start ? "menu start" : "menu"}
          role="menu"
          aria-label="Download as"
          onKeyDown={onMenuKey}
        >
          {DOWNLOADS.map((d, i) => (
            <button
              key={d.format}
              ref={(el) => {
                items.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={props.disabled(d.format)}
              onClick={() => {
                close();
                props.onDownload(d.format);
              }}
            >
              <span className="menu-label">{d.label}</span>
              <span className="menu-hint">{d.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
