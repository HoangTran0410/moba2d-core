/**
 * Which packs this browser has installed — the list, not the bytes.
 *
 * A few hundred bytes in `localStorage`, because `LoadingScene` has to know
 * what to fetch before it has fetched anything, and that read has to be
 * synchronous. The packs' actual code and art are cached by the service
 * worker instead; nothing here is large.
 *
 * Every read is defensive on purpose. This value survives across versions of
 * the game, it can be edited by hand, and a player whose stored list has
 * gone bad must still reach the menu — a store that throws during boot is
 * the dead screen the whole design forbids.
 */

export const PACK_STORE_KEY = 'lol2d:packs:v1';

/** One installed pack, as remembered between sessions. */
export interface InstalledPackRecord {
  /** Where the manifest was fetched from. The identity of the install. */
  manifestUrl: string;
  /** The pack id the manifest declared, kept so a stale list can be shown. */
  id: string;
  /** The version last installed, so an update can be noticed later. */
  version: string;
}

const isRecord = (value: unknown): value is InstalledPackRecord =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as InstalledPackRecord).manifestUrl === 'string' &&
  typeof (value as InstalledPackRecord).id === 'string' &&
  typeof (value as InstalledPackRecord).version === 'string';

export function readInstalledPacks(): InstalledPackRecord[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PACK_STORE_KEY);
  } catch {
    // Storage disabled, or absent (node). Not an error here.
    return [];
  }
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  // A plain loop, not `.filter`: `Array.prototype.filter` is polyfilled in
  // this project and cannot narrow a type.
  const out: InstalledPackRecord[] = [];
  for (const entry of parsed) {
    if (isRecord(entry))
      out.push({ manifestUrl: entry.manifestUrl, id: entry.id, version: entry.version });
  }
  return out;
}

export function writeInstalledPacks(records: InstalledPackRecord[]): void {
  try {
    localStorage.setItem(PACK_STORE_KEY, JSON.stringify(records));
  } catch {
    // A full or blocked storage costs the player this list, nothing more.
  }
}
