// What this browser remembers (localStorage), in one place: every key, and
// reads/writes that never throw. Storage can be blocked (private mode, site
// settings) or hold stale/corrupted data; then we just don't remember, and
// callers validate what they load.

export const KEYS = {
  name: "triangle-duel.name",
  localSetup: "triangle-duel.localSetup",
  shape: "triangle-duel.shape",
  eyes: "triangle-duel.eyes",
  touchScheme: "triangle-duel.touchScheme",
  params: "triangle-duel.params.v1", // debug panel tuning
} as const;
type Key = (typeof KEYS)[keyof typeof KEYS];

export function load(key: Key): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function save(key: Key, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

/** Parsed JSON, or `fallback` if missing, blocked or corrupted. */
export function loadJSON<T>(key: Key, fallback: T): T {
  try {
    const raw = load(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function saveJSON(key: Key, value: unknown) {
  save(key, JSON.stringify(value));
}
