import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SeamCheckOptions, SeamViolation } from './types';

/** The last segment of a scanned path, whichever separator the platform used. */
function baseNameOf(relativePath: string): string {
  return relativePath.split(/[\\/]/).pop()!;
}

/**
 * One matching rule for **every** exemption set in this module, and the
 * answer to a real false positive (content-pack-extraction batch 5 task 6
 * fix round 4).
 *
 * Before this existed the module had two keying conventions living in one
 * `seamDebt` object: `skip` matched a **basename at any depth**, while
 * `grandfathered`, `grandfatheredClasses`, `noPressOverride` and `pinned`
 * matched a **path relative to the scanned root**. Nothing said so, and a
 * pack whose spells sit in subdirectories — `walkTsFiles` has always been
 * recursive — got the worst possible result once staleness checking
 * existed: a basename entry failed to suppress the real violation in
 * `nested/<that file>` *and* was reported stale, i.e. the
 * author's still-load-bearing exemption was reported as dead debt while the
 * thing it exempted went red. Reproduced on a two-file tree; `packs/riot/
 * spells` is flat today, which is the only reason it had not happened yet.
 *
 * The rule now, for all five sets: **an entry names either the path
 * relative to the scanned root (`nested/Foo.ts`) or a bare basename
 * (`Foo.ts`), which matches that basename at any depth.** Basenames are
 * what a debt file actually wants to write in a flat tree, and the full
 * relative path is what disambiguates two same-named files in a nested one.
 * Returns the *entry* that matched, not a boolean, because staleness is
 * per declared entry: the caller records what it consumed.
 */
export function exemptionFor(entries: Set<string>, relativePath: string): string | undefined {
  if (entries.has(relativePath)) return relativePath;
  const base = baseNameOf(relativePath);
  return entries.has(base) ? base : undefined;
}

/** The same rule for a single entry: full relative path, or bare basename. */
export function pathMatches(entry: string, relativePath: string): boolean {
  return entry === relativePath || entry === baseNameOf(relativePath);
}

/**
 * A line-level exemption entry, `"<file>:x<count>:<the line's own code,
 * trimmed>"` — the shape `pinned` (`worldMouseInSpellCode.ts`),
 * `pinnedManaLines` (`manaSpend.ts`) and `pinnedResourceLines`
 * (`statResourceModifier.ts`) all use.
 *
 * The code text is what makes it an exemption for a *line* rather than for a
 * line *number* (fix round 4). Keyed on a number alone, a licence issued for
 * one line was inherited by whatever different code was later written at that
 * same number — proven on the real tree: replacing the pack's one pinned line
 * with an entirely new `this.game.worldMouse` read left `check-seams` reporting
 * `scanned 237 file(s), clean`.
 *
 * ## Why a count and not the line number
 *
 * The entry used to carry the 1-indexed line, and every edit above a licensed
 * line made the licence stale — a `STALE-EXEMPTION` failure whose only fix was
 * to hand-copy a new number into this file. Measured across the three debt
 * files this repository and its packs ship: **eight such repairs in a single
 * afternoon's work**, none of which said anything about the code.
 *
 * The number was never the point. Since the code text has to match too, all
 * the position bought was a *cap*: `result.stats.mana.baseValue = 100;` appears
 * twice in one file and each occurrence was licensed separately, so that a
 * third one somebody adds tomorrow is not licensed by the same entry. A count
 * states that directly and cannot drift — and on the real data it loses
 * nothing: of 104 (file, code) groups across the three files, **104 licensed
 * every occurrence**, and not one licensed a subset.
 *
 * So: moving licensed code around is silent, adding another occurrence of it
 * fails as a fresh violation, and removing it all fails as a stale exemption.
 * All three of those are what the seam is for; none of them is bookkeeping.
 *
 * A malformed entry (no `:x<digits>:` at all — including the old numeric form)
 * matches nothing and is reported stale by its seam, which is the right
 * outcome for a licence nobody can act on.
 */
export interface PinnedLine {
  file: string;
  /** How many occurrences of `code` in `file` this entry licenses. */
  count: number;
  code: string;
}

const PINNED_LINE = /^([^:]*):x(\d+):([\s\S]*)$/;

export function parsePinnedLine(entry: string): PinnedLine | null {
  const match = PINNED_LINE.exec(entry);
  if (!match) return null;
  const count = Number(match[2]);
  if (!Number.isInteger(count) || count < 1) return null;
  return { file: match[1], count, code: match[3] };
}

/** What a licence had left over when the scan finished. */
export interface UnspentPin {
  entry: string;
  /** `malformed`: unparseable. `unspent`: fewer matching lines than licensed. */
  reason: 'malformed' | 'unspent';
}

/**
 * The spend side of a set of pinned entries.
 *
 * Stateful on purpose, and one per scan: a seam walks every line once, asking
 * `claim` whether this exact line is already licensed, and asks `unspent` at
 * the end which licences went unused. The old shape returned the matching
 * entry and left each seam to keep its own `consumed` set — which worked while
 * the key was unique per line, and cannot express "two of these three are
 * licensed" at all.
 */
export interface PinnedLedger {
  /** Spends one licence for this line. `false` when none is left to spend. */
  claim(relativePath: string, line: string): boolean;
  unspent(): UnspentPin[];
}

export function pinnedLedger(entries: Set<string>): PinnedLedger {
  const budgets: { entry: string; file: string; code: string; left: number }[] = [];
  const malformed: string[] = [];

  for (const entry of entries) {
    const parsed = parsePinnedLine(entry);
    if (!parsed) {
      malformed.push(entry);
      continue;
    }
    budgets.push({ entry, file: parsed.file, code: parsed.code, left: parsed.count });
  }

  return {
    claim(relativePath, line) {
      const code = line.trim();
      for (const budget of budgets) {
        if (budget.left <= 0) continue;
        if (budget.code !== code) continue;
        if (!pathMatches(budget.file, relativePath)) continue;
        budget.left -= 1;
        return true;
      }
      return false;
    },
    unspent() {
      return [
        ...malformed.map(entry => ({ entry, reason: 'malformed' as const })),
        ...budgets.filter(b => b.left > 0).map(b => ({ entry: b.entry, reason: 'unspent' as const })),
      ];
    },
  };
}

/**
 * Every `.ts` file under `root`, recursive, relative to `root`.
 *
 * `node_modules` is never walked: a seam checks the code a tree *authors*,
 * and a pack installed as its own repository has core (and every other
 * dependency) sitting under it — thousands of files nobody in this
 * repository wrote, all of them free to break rules that are none of the
 * pack author's business.
 */
export function walkTsFiles(root: string, options: SeamCheckOptions = {}): string[] {
  const skip = options.skip ?? new Set<string>();
  return allTsFiles(root).filter(entry => exemptionFor(skip, entry) === undefined);
}

/**
 * The unfiltered listing — `skip` not yet applied, dependencies still out.
 *
 * A hand-rolled walk that **prunes as it descends**, not
 * `readdirSync({ recursive: true })` with a post-filter. The recursive form
 * reads everything first and drops `node_modules` afterwards, which is two
 * different bugs wearing one line: it pays for listing every dependency file
 * it is about to throw away, and — the one that took a machine down — it
 * follows directory *symlinks*, so a linked monorepo (`pack:link` puts
 * `node_modules/@moba2d/core -> ../core` in the pack while core's own
 * workspace link points back at the pack) is an infinite cycle the listing
 * allocates path strings into until the heap dies. Pruning `node_modules`
 * before stepping in, and never stepping through a symlinked directory at
 * all, closes both: a seam checks the code a tree authors, and nothing a
 * tree authors is on the far side of either.
 */
function allTsFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (relativeDir: string): void => {
    let entries;
    try {
      entries = readdirSync(join(root, relativeDir), { withFileTypes: true });
    } catch {
      return; // an unreadable directory has nothing scannable in it
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue;
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      // `isDirectory()` is false for a symlink to one, which is the point.
      if (entry.isDirectory()) walk(relativePath);
      else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(relativePath);
    }
  };
  walk('');
  return out.sort();
}

export function readSource(root: string, relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

/** Block comments and `//` comments removed, so a rule reads code, not prose. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** The code half of one line — used by scans that report `file:line`. */
export function codeOnly(line: string): string {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return '';
  return line.split('//')[0];
}

/**
 * `options.skip` entries that named no file at all this run — the shared
 * half of stale-exemption checking (content-pack-extraction batch 5 task 6
 * fix round 3). `skip` is honoured identically by every seam via
 * `walkTsFiles`, so it is checked once here rather than once per seam,
 * which would report the same dead entry thirteen times. Deliberately
 * checked against the **unfiltered** listing (every `.ts` file under
 * `root`, skip not yet applied) — the question is "does this entry name a
 * file that exists," not "does it exist after removing the files that
 * match it."
 *
 * **Existence, not consumption, and deliberately so** (fix round 4, which
 * corrected the two headers that claimed otherwise — `src/seams/index.ts`
 * and `packs/riot/spells/seam-debt.mjs` both said every licence is
 * consumption-checked, and this one never was). The other four sets name a
 * file, class or line *known to offend*, so "did this entry actually
 * suppress a would-be violation" is exactly what they mean and staleness is
 * answerable. `skip` means something else: it names a file that is **not
 * spell-shaped code at all** — a barrel, a scaffolding template — so the
 * seams should never have looked at it in the first place. A consumption
 * check would demand that `index.ts` violate something to keep earning its
 * place, and report the correct, quiet answer as stale. What can genuinely
 * go stale about a `skip` entry is the file being renamed or deleted, and
 * that is what this reports.
 */
export function staleSkipEntries(root: string, options: SeamCheckOptions = {}): SeamViolation[] {
  const skip = options.skip ?? new Set<string>();
  if (skip.size === 0) return [];

  const present = allTsFiles(root);
  const matched = new Set<string>();
  for (const file of present) {
    const entry = exemptionFor(skip, file);
    if (entry !== undefined) matched.add(entry);
  }

  const stale: SeamViolation[] = [];
  for (const entry of skip) {
    if (!matched.has(entry)) {
      stale.push({
        file: entry,
        message: 'skip exemption matched no file under this root, by path or by basename',
        kind: 'stale-exemption',
      });
    }
  }
  return stale;
}
