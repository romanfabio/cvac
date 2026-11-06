import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";

export interface MenuItem {
  /** Stable key. */
  id: string;
  label: string;
  /** A second, muted line. */
  hint?: string;
  disabled?: boolean;
  /** Draw a separator above the item (for destructive actions at the end). */
  separated?: boolean;
  onSelect: () => void;
}

/**
 * A menu button (WAI-ARIA menu button pattern): the toggle opens a menu of
 * actions; arrow keys, Home and End move, Escape and clicks outside close
 * it. `before` puts a main action in front of the toggle, making a split
 * button. The menu opens leftwards from the toggle, or rightwards when the
 * button sits near the left edge of the screen (phones).
 */
export function MenuButton(props: {
  items: MenuItem[];
  /** Accessible name of the menu. */
  menuLabel: string;
  /** The toggle's content (text and/or an arrow). */
  children: ReactNode;
  /** Accessible name of the toggle, when its content has no text. */
  toggleLabel?: string;
  toggleClass?: string;
  toggleTitle?: string;
  className?: string;
  before?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
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

  const show = (next: boolean) => {
    if (next) setStart((root.current?.getBoundingClientRect().right ?? 0) < 300);
    setOpen(next);
  };

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
    <div className={props.className ? `menu-button ${props.className}` : "menu-button"} ref={root}>
      {props.before}
      <button
        ref={toggle}
        type="button"
        className={props.toggleClass}
        title={props.toggleTitle}
        aria-label={props.toggleLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => show(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            show(true);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      >
        {props.children}
      </button>
      {open && (
        <div
          className={start ? "menu start" : "menu"}
          role="menu"
          aria-label={props.menuLabel}
          onKeyDown={onMenuKey}
        >
          {props.items.flatMap((item, i) => [
            ...(item.separated
              ? [<div key={`${item.id}-sep`} role="separator" className="menu-separator" />]
              : []),
            <button
              key={item.id}
              ref={(el) => {
                items.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={item.disabled}
              onClick={() => {
                close();
                item.onSelect();
              }}
            >
              <span className="menu-label">{item.label}</span>
              {item.hint && <span className="menu-hint">{item.hint}</span>}
            </button>,
          ])}
        </div>
      )}
    </div>
  );
}

/** The arrow drawn on menu toggles. */
export function Chevron() {
  return (
    <svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
      <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
