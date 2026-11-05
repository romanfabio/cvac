/**
 * Per-browser persistence of the editor contents. Everything stays on this
 * device; storage can be unavailable (private mode, blocked site data), so
 * every access is guarded and the app works without it.
 */
const PREFIX = "cvac:";

export function load(key: string): string | undefined {
  try {
    return localStorage.getItem(PREFIX + key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function save(key: string, value: string | undefined): void {
  try {
    if (value === undefined) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, value);
  } catch {
    // Quota exceeded or storage blocked: keep working in memory.
  }
}

/** Decodes photos saved by older versions (see photoStore.ts). */
export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
