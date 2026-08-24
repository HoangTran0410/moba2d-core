import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../../src/seams/importScan';
import { packIsInstalled, requireRoot } from './installedPacks';

/**
 * "Does this text carry Riot's vocabulary?" — asked once, here, by everything
 * that has to ask it.
 *
 * `tests/content/vocabularyBoundary.test.ts` has asked it of core's `src/`
 * tree since batch 4. The whole-branch review of batch 5 found the same
 * question needed asking of a second, differently-shaped population —
 * **`@moba2d/core`'s published tarball** — where `corePackTarball.test.ts`
 * was instead asserting a *proxy* (`!path.startsWith('packs/')`) that could
 * not see 296 rows of Riot image provenance, six Riot-Wiki scripts and a dead
 * script naming 19 champions, all of which that tarball carried. Two
 * populations, one rule; a second hand-written copy of the needle list is how
 * the two would drift, so there is one.
 *
 * ## The Riot needles are a snapshot, not a live derivation
 *
 * They used to be derived — read live off `packs/riot/spells/`'s and
 * `packs/riot/monsters/`'s own filenames, so a champion added tomorrow was
 * covered without anyone editing this file. Content-pack-and-repo-split
 * batch 6 task 10 made that permanent rather than a drill's temporary
 * absence: `packs/riot/` left this repository for good, so "derived live"
 * degraded into "derived from nothing, forever" — `riotChampionNames()`/
 * `riotMonsterNames()` returned `[]` unconditionally, which made both of the
 * scans that read them (`vocabularyBoundary.test.ts`'s champion/monster-name
 * rule, `corePackTarball.test.ts`'s same rule over the tarball) a vacuous
 * pass rather than an enforced one, while both this file's own header and
 * `CLAUDE.md` kept describing them as live.
 *
 * `RIOT_CHAMPION_NAMES`/`RIOT_MONSTER_NAMES` below are that live derivation's
 * last real answer, taken by the same filename rule against the sibling
 * repository (`@moba2d/content-riot`, the pack's copy-verified destination)
 * and checked in here. This is a list of 58 champion and 1 monster proper
 * nouns, not pack content — no spell logic, no numbers, no art — so it does
 * not reopen the boundary this programme exists to close, and it stops
 * growing now that the pack itself has left: it is not re-derived from the
 * sibling repository at test time (core's own suite has no business reaching
 * into a repository it does not depend on), so a champion the sibling adds
 * *after* departure is not covered by this list. That is an accepted gap,
 * not an oversight — this scan's job is keeping Riot's vocabulary out of
 * *core's own tree* going forward, and every name that was ever in this
 * tree's history is already in the snapshot below. `DISPLAY_VARIANTS` is the
 * only hand-written part beyond the snapshot, and only because a few
 * filename tokens are not the spelling prose uses (`ChoGath` -> `Cho'Gath`).
 *
 * ## The exemptions are derived too, where they can be
 *
 * `Vera_Q`/`Vera_W`/... are `packs/reference/`'s **fictional** champion, the
 * placeholder that exists to prove the multi-pack qualifying scheme. Those
 * ids used to be exempt by the literal string `'Vera_Q'`; they are exempt now
 * because `Vera` is a name `packs/reference/spells/` itself yields, so the
 * reference pack gaining a second champion does not need an edit here. The
 * three genuinely hand-written exemptions left are `GRANDFATHERED_LINES`, and
 * each carries its argument in the test that owns the file.
 */
const REPO_ROOT = join(__dirname, '..', '..');
const PACKS = join(REPO_ROOT, 'packs');

/** Every summoner-spell id — the shape a real content leak into core takes. */
export const SUMMONER_SPELL_IDS = ['Flash', 'Ghost', 'Heal', 'Ignite', 'StealthWard'];

/** `Ahri_Q.ts` -> `Ahri`; `index.ts` and `_EmptyExample.ts` yield nothing. */
function championNamesIn(dir: string): string[] {
  const names = new Set<string>();
  for (const file of readdirSync(dir)) {
    const match = file.match(/^([A-Za-z]+)_[QWERP][A-Za-z0-9]*\.ts$/);
    if (match) names.add(match[1]);
  }
  return [...names];
}

/**
 * The riot pack's roster, frozen at departure — see "The Riot needles are a
 * snapshot, not a live derivation" above. Derived once, the same way
 * `championNamesIn`/the monster-directory listing always did, against
 * `@moba2d/content-riot`'s `spells/` and `monsters/` directories (58
 * champions, 1 monster). Sorted for a stable, reviewable diff if this list is
 * ever hand-edited again.
 */
const RIOT_CHAMPION_NAMES: readonly string[] = [
  'Ahri',
  'Alistar',
  'Amumu',
  'Anivia',
  'Annie',
  'Ashe',
  'Blitzcrank',
  'Brand',
  'Caitlyn',
  'Camille',
  'Cassiopeia',
  'ChoGath',
  'Darius',
  'Diana',
  'Ekko',
  'Ezreal',
  'Fizz',
  'Garen',
  'Graves',
  'Irelia',
  'Janna',
  'JarvanIV',
  'Jhin',
  'Jinx',
  'Katarina',
  'Leblanc',
  'LeeSin',
  'Lux',
  'Malphite',
  'Malzahar',
  'MasterYi',
  'Morgana',
  'Nasus',
  'Nautilus',
  'Nocturne',
  'Olaf',
  'Pantheon',
  'Rammus',
  'Renekton',
  'Riven',
  'Sett',
  'Shaco',
  'Singed',
  'Soraka',
  'Syndra',
  'Teemo',
  'Thresh',
  'Tryndamere',
  'Twitch',
  'Varus',
  'Vayne',
  'Veigar',
  'Vi',
  'Warwick',
  'XinZhao',
  'Yasuo',
  'Zed',
  'Ziggs',
];

/** Same snapshot, the monster half — `Baron.ts` -> `Baron`. */
const RIOT_MONSTER_NAMES: readonly string[] = ['Baron'];

/** The riot pack's champion roster, frozen at departure — see this file's header. */
export function riotChampionNames(): string[] {
  return [...RIOT_CHAMPION_NAMES];
}

/** The riot pack's monster roster, frozen at departure — see this file's header. */
export function riotMonsterNames(): string[] {
  return [...RIOT_MONSTER_NAMES];
}

/**
 * The reference pack's own fictional champions — `Vera` today. Not Riot's,
 * so a `Vera_R` identifier is not a leak; see this file's header.
 */
export function referenceChampionNames(): string[] {
  if (!packIsInstalled('reference')) return [];
  return championNamesIn(
    requireRoot(join(PACKS, 'reference/spells'), 'riotVocabulary: packs/reference/spells')
  );
}

/**
 * A handful of champions whose filename token (PascalCase, a valid TS
 * identifier) is not the display name a doc comment actually writes in prose.
 * Both forms are banned; this only adds the second.
 */
const DISPLAY_VARIANTS: Record<string, string[]> = {
  ChoGath: ["Cho'Gath"],
  JarvanIV: ['Jarvan IV', 'Jarvan'],
  LeeSin: ['Lee Sin'],
  MasterYi: ['Master Yi'],
  XinZhao: ['Xin Zhao'],
};

/** Every champion and monster proper noun, in both its identifier and prose spellings. */
export function bannedRiotNames(): string[] {
  const base = [...riotChampionNames(), ...riotMonsterNames()];
  const out = [...base];
  for (const name of base) out.push(...(DISPLAY_VARIANTS[name] ?? []));
  return out;
}

/**
 * `${repo-relative path}: ${trimmed line}` for the three lines allowed to
 * carry Riot vocabulary, each argued where it lives:
 *
 *  - `PregameConfig.ts`'s two loadout defaults — that module is deliberately
 *    pure data with no content-system import, so it restates two content
 *    facts as literals the way `DEFAULT_MAP_ID` right above them does.
 *    `PregameConfig.test.ts` cross-checks them against the live shelf.
 *  - one `changelog.ts` highlight — hand-written, player-facing history of
 *    this fan game's own past changes, written in Vietnamese for players. A
 *    changelog entry with the champion's name redacted is not more
 *    pack-neutral, it is useless to the player reading it.
 */
export const GRANDFATHERED_LINES: ReadonlySet<string> = new Set([
  "src/game/config/PregameConfig.ts: summonerD: 'Flash',",
  "src/game/config/PregameConfig.ts: summonerF: 'Heal',",
  "src/scenes/about/changelog.ts: 'Làm lại kỹ năng W của Shaco.',",
]);

export interface VocabularyOffence {
  /** Repo-relative, POSIX-separated. */
  readonly path: string;
  readonly rule: 'champion-or-monster-name' | 'spell-id' | 'summoner-id';
  readonly token: string;
  readonly line: string;
}

/**
 * Every Riot-vocabulary offence in one file's text, grandfathered lines
 * already removed.
 *
 * Comments are **not** stripped for the name and spell-id rules: most of the
 * real hits this scan ever found were doc comments illustrating an engine bug
 * with the spell that first exposed it, and that is exactly the vocabulary
 * being purged. They *are* stripped for the summoner-id rule, whose subject
 * is a quoted id sitting in core as data.
 */
export function riotVocabularyOffences(path: string, source: string): VocabularyOffence[] {
  const offences: VocabularyOffence[] = [];
  const allowed = (line: string) => GRANDFATHERED_LINES.has(`${path}: ${line.trim()}`);

  const namePatterns = bannedRiotNames().map(name => ({
    name,
    // A plain `\b` treats `_` as a word character, so it finds no boundary
    // at either `_B` or `n_` inside a snake_case literal like
    // `'monster_Baron_Nashor'` — the whole token reads as one word to the
    // regex, and a real name sitting inside it goes uncaught. This scan's
    // subject is prose and identifiers, not just bare words, so the
    // boundary has to treat `_` as a separator the same as a space or a
    // quote. The boundary itself cannot simply be dropped, though: without
    // it, this same pattern hits 117 false positives across `src/` alone
    // (`Vi` inside `Vision`/`Visible`/`Vite`, `Sett` inside `Setting`, ...).
    //
    // `\p{L}`/`\p{N}` rather than `[A-Za-z0-9]`, because the prose half of
    // that subject is Vietnamese: `ệ` is not an ASCII letter, so the old
    // boundary held between `Vi` and `ệt` and every "tiếng Việt" in the
    // player-facing changelog was reported as the champion Vi. `_` is
    // `\p{Pc}`, not a letter or a number, so the snake_case case above still
    // works exactly as before.
    re: new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/'/g, "'?")}(?![\\p{L}\\p{N}])`, 'u'),
  }));
  for (const line of source.split('\n')) {
    for (const { name, re } of namePatterns) {
      if (re.test(line) && !allowed(line)) {
        offences.push({ path, rule: 'champion-or-monster-name', token: name, line: line.trim() });
      }
    }
  }

  const fictional = referenceChampionNames();
  const spellIdPattern = /\b[A-Z][a-z]+(?:IV)?_[QWERP][A-Za-z0-9]*\b/g;
  for (const match of source.matchAll(spellIdPattern)) {
    const champion = match[0].slice(0, match[0].indexOf('_'));
    if (fictional.includes(champion)) continue;
    offences.push({ path, rule: 'spell-id', token: match[0], line: match[0] });
  }

  const summonerPattern = new RegExp(`['"](${SUMMONER_SPELL_IDS.join('|')})['"]`, 'g');
  for (const line of stripComments(source).split('\n')) {
    for (const match of line.matchAll(summonerPattern)) {
      if (allowed(line)) continue;
      offences.push({ path, rule: 'summoner-id', token: match[0], line: line.trim() });
    }
  }

  return offences;
}

/** One offence rendered the way both callers report it. */
export function describeOffence(offence: VocabularyOffence): string {
  return `${offence.path}: ${offence.token} (${offence.line})`;
}
