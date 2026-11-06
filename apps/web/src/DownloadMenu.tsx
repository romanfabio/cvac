import type { OutputFormat } from "./engine.ts";
import { Chevron, MenuButton } from "./Menu.tsx";

/** Every download format, in menu order, with what the menu says about it. */
export const DOWNLOADS: { format: OutputFormat; label: string; hint: string }[] = [
  { format: "pdf", label: "PDF", hint: "The CV as designed by the theme" },
  { format: "docx", label: "Word (.docx)", hint: "One column, editable in Word" },
  { format: "html", label: "Web page (.html)", hint: "One file to open, share or put online" },
  { format: "md", label: "Markdown (.md)", hint: "For a README, a website or a git repository" },
  { format: "txt", label: "Plain text (.txt)", hint: "For pasting into application forms" },
];

/** A split button: the main part downloads the PDF, the arrow opens every format. */
export function DownloadMenu(props: {
  onDownload: (format: OutputFormat) => void;
  /** Formats that cannot be downloaded right now. */
  disabled: (format: OutputFormat) => boolean;
}) {
  return (
    <MenuButton
      className="split"
      menuLabel="Download as"
      toggleLabel="More download formats"
      toggleClass="split-toggle"
      before={
        <button
          type="button"
          className="split-main"
          onClick={() => props.onDownload("pdf")}
          disabled={props.disabled("pdf")}
        >
          Download PDF
        </button>
      }
      items={DOWNLOADS.map((d) => ({
        id: d.format,
        label: d.label,
        hint: d.hint,
        disabled: props.disabled(d.format),
        onSelect: () => props.onDownload(d.format),
      }))}
    >
      <Chevron />
    </MenuButton>
  );
}
