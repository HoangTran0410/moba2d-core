import type { BundledPackSummary } from '@/content/install';
import { describeContents, type PackContents } from './packContents';

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
 * `PacksScene` may not statically import `@/content/install` or
 * `@/content/registry` — both are the engine, and `scripts/check-chunks.mjs`'s
 * `PacksScene` rule plus `tests/scenes/packsBootPath.test.ts` exist to keep
 * the whole match out of the chunk a player downloads to read a list. The
 * screen reaches them through a dynamic `import()` at mount, the same
 * sanctioned crossing the install button already uses, and hands the results
 * here.
 */
export interface BundledPackRow {
  /** The pack's own id — `'lol'`, `'reference'`. Its display name too: a
   *  bundled pack's `PackManifest` carries no separate name field. */
  readonly id: string;
  readonly version: string;
  /** `'58 tướng · 1 map · 42 trang bị'`, or `''` for a pack that adds none. */
  readonly contents: string;
  /** Linked from outside this checkout by `npm run pack:link`. */
  readonly linked: boolean;
}

export function bundledPackRows(
  summaries: readonly BundledPackSummary[],
  contents: ReadonlyMap<string, PackContents>
): BundledPackRow[] {
  return summaries.map(summary => ({
    id: summary.id,
    version: summary.version,
    contents: describeContents(contents.get(summary.id)),
    linked: summary.linked,
  }));
}
