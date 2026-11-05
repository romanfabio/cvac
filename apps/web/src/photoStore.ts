/**
 * Photos are kept in IndexedDB, as raw bytes keyed by the path written in
 * the CV. localStorage holds only about 5 MB per site, as text, so a phone
 * photo (base64 adds a third) did not fit and was silently lost on reload.
 * Everything stays in this browser.
 */
import { fromBase64 } from "./storage.ts";

const DB_NAME = "cvac";
const STORE = "photos";
/** Where photos lived before IndexedDB (migrated on first load). */
const LEGACY_PREFIX = "cvac:photo:";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB is blocked by another tab"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/** Save one photo. Rejects when the browser refuses (quota, private mode, blocked storage). */
export async function savePhoto(key: string, data: Uint8Array): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(data, key);
    await done(tx);
  } finally {
    db.close();
  }
}

/** Replace every saved photo (project import). Rejects when the browser refuses. */
export async function replacePhotos(photos: Record<string, Uint8Array>): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.clear();
    for (const [key, data] of Object.entries(photos)) store.put(data, key);
    await done(tx);
  } finally {
    db.close();
  }
}

/**
 * All saved photos, after moving any left in localStorage by older versions
 * into IndexedDB. Resolves to what could be read; never rejects.
 */
export async function loadPhotos(): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return legacyPhotos();
  }
  try {
    const legacy = legacyPhotos();
    if (Object.keys(legacy).length) {
      const tx = db.transaction(STORE, "readwrite");
      for (const [key, data] of Object.entries(legacy)) tx.objectStore(STORE).put(data, key);
      await done(tx);
      removeLegacy();
    }
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const [keys, values] = await Promise.all([
      request(store.getAllKeys()),
      request(store.getAll()),
    ]);
    keys.forEach((k, i) => {
      const v = values[i];
      if (typeof k === "string" && v instanceof Uint8Array) out[k] = v;
    });
    return out;
  } catch {
    return { ...legacyPhotos(), ...out };
  } finally {
    db.close();
  }
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function legacyPhotos(): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(LEGACY_PREFIX)) continue;
      const v = localStorage.getItem(key);
      if (v) out[key.slice(LEGACY_PREFIX.length)] = fromBase64(v);
    }
  } catch {
    // storage unavailable
  }
  return out;
}

function removeLegacy() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(LEGACY_PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // storage unavailable
  }
}
