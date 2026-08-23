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

/**
 * Whether this browser has ever been offered the default pack.
 *
 * The list alone cannot answer it: an empty list means "never ran" on a
 * fresh browser and "the player removed everything" on an old one, and
 * seeding the default on both makes an uninstall impossible to keep. This
 * flag is what separates them, and it is deliberately a second key rather
 * than a sentinel inside the list — a list of packs should hold packs.
 */
export const PACK_SEEDED_KEY = 'lol2d:packs:seeded:v1';

/**
 * Defensive the same way `readInstalledPacks` is: a missing key, a blocked
 * or absent `localStorage`, and any unexpected stored value all answer
 * `false` rather than throwing. `false` is also the correct reading of "not
 * present" — the flag exists only once it has been written.
 */
export function hasSeededDefaultPack(): boolean {
  try {
    return localStorage.getItem(PACK_SEEDED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Records that the default pack has been installed at least once.
 *
 * Called only after a seeding attempt that actually landed. See
 * `runtimePacks.ts`'s own header for why: the default pack's URL 404s until
 * the pack repository has published, so marking a *failed* attempt spends a
 * browser's single automatic install forever and the banner's retry — a
 * reload — cannot undo it. Setting it on success alone still buys what this
 * flag exists for, which is that a player who removes every pack afterwards
 * is not re-seeded on the next boot.
 */
export function markDefaultPackSeeded(): void {
  try {
    localStorage.setItem(PACK_SEEDED_KEY, '1');
  } catch {
    // A full or blocked storage costs the player a retried default fetch on
    // the next boot, nothing more.
  }
}
