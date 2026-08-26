import type { ContentPackData } from '@/content/ContentPack';

/**
 * The packs that came with the build, as the packs screen lists them.
 *
 * ## Why the screen lists them at all
 *
 * It claims to answer "what content do I have", and it used to answer "what
 * did I install by URL" — a different question, and one whose answer is empty
 * in every ordinary build. A player with a compiled-in pack of dozens of
 * champions opened the screen and read *"Chưa cài pack nào — game đang chạy
 * với đúng một tướng mặc định"*, which was not merely incomplete: it was
 * false, and contradicted by the champion select they had just come from.
 *
 * ## Why a plain function over data
 *
 * `PacksScene` may not statically import `@/content/install` — that module is
 * the engine's own loader, and `scripts/check-chunks.mjs`'s `PacksScene` rule
 * plus `tests/scenes/packsBootPath.test.ts` exist to keep the whole match out
 * of the chunk a player downloads to read a list. The screen reaches it
 * through a dynamic `import()` at mount, the same sanctioned crossing the
 * install button already uses, and hands the data here. So this file takes
 * `ContentPackData[]` as an argument and imports nothing but a type.
 */
export interface BundledPackRow {
  /** The pack's own id — `'lol'`, `'reference'`. Its display name too: a
   *  bundled pack's `PackManifest` carries no separate name field. */
  readonly id: string;
  readonly version: string;
  /** How many champions the pregame screen would actually offer. */
  readonly champions: number;
}

export function bundledPackRows(packs: readonly ContentPackData[]): BundledPackRow[] {
  return packs.map(pack => ({
    id: pack.manifest.id,
    version: pack.manifest.version,
    // `playable`, not `champions.length`: a pack's shelves — the bare basic
    // attack, the summoner-spell group — are roster rows too, and counting
    // them promises champions the player cannot pick. `data.ts`'s own
    // `championEntries()` computes the field for exactly this distinction.
    champions: (pack.champions ?? []).filter(entry => entry.playable).length,
  }));
}
