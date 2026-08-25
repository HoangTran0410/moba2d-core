/**
 * What one installed pack's row says about its bytes — the whole sentence,
 * decided in one place.
 *
 * Reported from a real install: the row read `83 tệp · ~168 KB` while 4.7MB
 * was still arriving in the background, the player took that for the pack's
 * size, came back later to a larger number, and had no way to learn that a
 * download had ever been running. A numerator with no denominator and no verb.
 *
 * Five states, which is one more than the screen used to be able to tell
 * apart:
 *
 * - `measuring` — `packCacheUsage` has not answered yet.
 * - `downloading` — a prefetch is in flight *right now*, with `done`/`total`.
 * - `ready` — everything the manifest declared is on this disk.
 * - `empty` — the manifest declared no files, so there is nothing to save.
 *   Real and reachable: such a pack installs and plays and prefetches nothing.
 * - `partial` — some of it is saved and nothing is fetching. An interrupted
 *   prefetch; the boot path resumes it (`missingPackFiles`), so the copy says
 *   so rather than leaving the player to guess.
 * - `unknown` — the fallback, and the *old* behaviour: a record written before
 *   `fileCount` existed has no denominator, so the row shows the bare count it
 *   always showed rather than inventing one.
 *
 * A plain module, not a method inside `PacksScene.vue` — `<script setup>` is
 * the setup function (CLAUDE.md), so nothing declared in one is reachable
 * from a test, and this repository has no DOM to mount a component into.
 * `tests/scenes/packUsage.test.ts` is the suite; it pins the stage and the
 * one wording rule that matters, never the copy itself.
 *
 * No import of `@/content/` or `@/game/`: this is arithmetic over numbers the
 * caller already has, and the packs screen is on the menu's path.
 */

export type PackUsageStage =
  'measuring' | 'downloading' | 'ready' | 'empty' | 'partial' | 'unknown';

/** Everything the row knows, from its three different sources. */
export interface PackUsageInput {
  /** `packCacheUsage().entries`, or `-1` while it has not answered. */
  entries: number;
  /** `packCacheUsage().bytes`. A floor — see `packCache.ts`. */
  bytes: number;
  /** `InstalledPackRecord.fileCount`: the denominator that survives a reload. */
  fileCount?: number;
  /** `packPrefetchProgress(base)`: the only thing that knows about *now*. */
  progress?: { total: number; done: number; active: boolean } | null;
}

export interface PackUsage {
  stage: PackUsageStage;
  /** The Vietnamese sentence, already assembled. */
  label: string;
  /** Files settled, and files declared. `total` is `-1` when nothing knows it. */
  done: number;
  total: number;
  /** `0`..`1` for a bar, or `-1` when there is no denominator to draw one from. */
  ratio: number;
}

/**
 * `content-length` is a floor, not an exact size (`packCache.ts`), hence the
 * `~` every caller puts in front of it — and KB below a megabyte, so a small
 * pack does not round to nothing.
 */
export function formatPackBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** ` · ~168 KB`, or nothing at all before the cache has been measured. */
const sizeSuffix = (bytes: number): string => (bytes > 0 ? ` · ~${formatPackBytes(bytes)}` : '');

export function packUsage(input: PackUsageInput): PackUsage {
  const progress = input.progress ?? null;
  const stored = Number.isInteger(input.fileCount) && input.fileCount >= 0 ? input.fileCount : -1;
  // The live run's own denominator wins: it is what is actually being fetched
  // this minute, and a stored count from an older manifest could disagree.
  const total = progress ? progress.total : stored;

  const shaped = (stage: PackUsageStage, label: string, done: number): PackUsage => ({
    stage,
    label,
    done,
    total,
    ratio: total > 0 ? Math.min(1, Math.max(0, done / total)) : -1,
  });

  // Asked before `entries`, and that order is the install path: the row is
  // added the instant `installPackNow` returns, the prefetch is already
  // running, and `packCacheUsage` answers a round trip later. Reading the
  // cache first would print "Đang xem dung lượng đã lưu…" over a live
  // download — the exact silence this change exists to end.
  if (progress?.active) {
    return shaped(
      'downloading',
      `Đang tải ngầm… ${progress.done}/${progress.total} tệp${sizeSuffix(input.bytes)}`,
      progress.done
    );
  }

  if (total === 0) {
    return shaped('empty', 'Pack này không có tệp nào để lưu offline', 0);
  }

  if (total < 0) {
    // No denominator anywhere: a record from before `fileCount` existed, whose
    // pack has not prefetched this session. Exactly what the screen showed
    // before, including the two states it could already tell apart.
    if (input.entries < 0) return shaped('measuring', 'Đang xem dung lượng đã lưu…', 0);
    if (input.entries === 0) return shaped('unknown', 'Chưa lưu để chơi offline', 0);
    return shaped('unknown', `${input.entries} tệp${sizeSuffix(input.bytes)}`, input.entries);
  }

  // A finished run counts what it settled; without one, the cache's own entry
  // count stands in. That count includes the pinned manifest and can exceed
  // `total` by one — which is why `>= total` is the completeness test and the
  // ratio is clamped. The skew only ever makes an all-but-one-file pack look
  // finished, never an unfinished one look further along than it is.
  const done = progress ? progress.done : Math.max(0, input.entries);
  if (input.entries < 0 && !progress) {
    return shaped('measuring', 'Đang xem dung lượng đã lưu…', 0);
  }
  if (done >= total) {
    return shaped(
      'ready',
      `Đã lưu đủ để chơi offline · ${total} tệp${sizeSuffix(input.bytes)}`,
      total
    );
  }
  return shaped(
    'partial',
    `Tạm dừng ở ${done}/${total} tệp${sizeSuffix(input.bytes)} — mở lại game để tải tiếp`,
    done
  );
}
