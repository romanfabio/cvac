import { type FSWatcher, watch } from "node:fs";
import { basename, dirname } from "node:path";
import { loadInputs } from "../inputs.ts";
import type { Io } from "../report.ts";
import { type BuildFlags, build, report } from "./build.ts";

export interface WatchHandle {
  close(): void;
  /** Resolves after the build triggered by the latest change finishes. */
  idle(): Promise<void>;
}

/**
 * Build, then rebuild whenever the CV or theme changes. Watches the
 * containing directories rather than the files, because many editors save
 * by replacing the file (which ends a per-file watch on some platforms).
 */
export async function startWatch(
  cv: string | undefined,
  flags: BuildFlags,
  io: Io,
  opts: { debounceMs?: number } = {},
): Promise<WatchHandle> {
  const debounce = opts.debounceMs ?? 120;
  let running: Promise<void> = Promise.resolve();
  let timer: NodeJS.Timeout | undefined;
  let watchers: FSWatcher[] = [];
  let watched = "";

  const rebuild = async () => {
    const outcome = await build(cv, flags);
    report(outcome, io);
    io.err(io.color("dim", "watching for changes… (Ctrl+C to stop)"));
    rewatch();
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      running = running.then(rebuild);
    }, debounce);
  };

  // (Re)subscribe when the set of input files changes, e.g. a theme.yaml
  // was created next to the CV.
  function rewatch() {
    const inputs = loadInputs(cv, flags.theme);
    const files = inputs.files;
    const key = files.join("|");
    if (key === watched) return;
    for (const w of watchers) w.close();
    watched = key;
    const byDir = new Map<string, Set<string>>();
    for (const f of [...files, ...(flags.theme ? [] : [`${dirname(inputs.cvPath)}/theme.yaml`])]) {
      const set = byDir.get(dirname(f)) ?? new Set<string>();
      set.add(basename(f));
      byDir.set(dirname(f), set);
    }
    watchers = [...byDir].map(([dir, names]) =>
      watch(dir, (_event, filename) => {
        if (filename && names.has(basename(filename.toString()))) schedule();
      }),
    );
  }

  running = rebuild();
  await running;
  return {
    close() {
      clearTimeout(timer);
      for (const w of watchers) w.close();
    },
    async idle() {
      await new Promise((r) => setTimeout(r, debounce + 10));
      await running;
    },
  };
}
