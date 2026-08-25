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
  /** The semver the manifest declared, shown to a person. Not a staleness test. */
  version: string;
  /**
   * Which build is pinned in the pack cache — the thing an update check
   * compares against.
   *
   * `version` was written for this job and cannot do it. It is a number a
   * human has to remember to bump, and riot's stayed `1.0.0` across dozens of
   * publishes, so the "so an update can be noticed later" this field's comment
   * used to carry described something no code could act on. `buildId` is
   * derived by the pack's own manifest writer from its emitted file list, so
   * it moves exactly when a content hash does and nobody has to remember
   * anything.
   *
   * Optional: a record written before pinning existed has none, which reads as
   * "not pinned" and costs one fetch on the next boot.
   */
  buildId?: string;
  /**
   * The name the manifest declared, so the packs screen can show a pack the
   * way its author named it rather than by the machine id. Optional: a record
   * written before this field existed has none, and the id is the fallback.
   */
  name?: string;
  /**
   * How many files this pack's manifest declared — the **denominator** for
   * "how much of it is saved", and the one part of that answer that has to
   * survive a reload.
   *
   * The live half is `packPrefetchProgress` (`packCache.ts`): a record written
   * by the prefetch itself, which dies with the page exactly as the download
   * does, so nothing is ever downloading unwatched. What it cannot answer is a
   * pack whose prefetch is *not* running — an install that failed on this
   * boot, or one interrupted before it finished — and the packs screen builds
   * every row out of this store alone, never re-fetching a manifest just to
   * list what is installed (the same reason `name` and `icon` are here).
   * Without the count stored beside them, such a row is back to the bare
   * `83 tệp` that made a player read a download in progress as a total.
   *
   * `0` is a real answer and not the same as absent: a manifest with no
   * `files` saves nothing and the row can say so, while a record written
   * before this field existed has `undefined` and falls back to the old
   * count-only line. One small integer per pack, well inside this store's
   * "a few hundred bytes" contract — the *list* of file names would not be,
   * which is why `missingPackFiles` derives that from the cache instead.
   */
  fileCount?: number;
  /**
   * The pack's own mark, absolute, already checked to be on the manifest's
   * origin (`resolvePackIcon`). Optional — most packs declare none, and the
   * packs screen draws a monogram instead. Stored rather than re-derived
   * because that screen never re-fetches a manifest just to list what is
   * installed.
   */
  icon?: string;
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
    if (isRecord(entry)) {
      const record: InstalledPackRecord = {
        manifestUrl: entry.manifestUrl,
        id: entry.id,
        version: entry.version,
      };
      // Copied only when they are strings: this value is hand-editable and
      // survives across versions, same as every other read here.
      if (typeof entry.buildId === 'string' && entry.buildId.length > 0)
        record.buildId = entry.buildId;
      if (typeof entry.name === 'string' && entry.name.length > 0) record.name = entry.name;
      // A whole, non-negative count or nothing. `Number.isInteger` is what
      // refuses `Infinity` and `1.5`, both of which `typeof … === 'number'`
      // waves through and both of which a hand-edited store can hold; a
      // fraction of a file would then be drawn as a progress bar.
      if (Number.isInteger(entry.fileCount) && entry.fileCount >= 0)
        record.fileCount = entry.fileCount;
      if (typeof entry.icon === 'string' && entry.icon.length > 0) record.icon = entry.icon;
      out.push(record);
    }
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
