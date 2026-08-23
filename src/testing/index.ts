/**
 * `@moba2d/core/testing` — everything an observer needs to build a match,
 * run it and read what happened. `@moba2d/core/testing/spell` is the second
 * door, for driving a single spell the way a keypress does.
 *
 * The spell world is deliberately not re-exported here: its `createGame` and
 * its `TestVector` are different from this module's, and a barrel that
 * exported both would have to rename one of them.
 *
 * `./spellRegistry` is deliberately not re-exported here either — not
 * because it leaks (it does not: `spellRegistry.ts` imports
 * `../game/spellRegistry`, which reaches core's content-install machinery,
 * and every file in that chain regenerates clean of any pack reference the
 * moment a pack is not physically installed in core's own tree, which is
 * exactly the state core ships in — `npm run verify:without-packs` proves
 * this every run), but because `export *` evaluates the *whole module*, not
 * only the bindings a caller destructures, so a barrel line here would drag
 * this file's own value-import graph — content-install machinery included —
 * into *every* pack test file that imports anything at all from
 * `@moba2d/core/testing`, whether or not that file ever calls
 * `loadSpellsForTests`. Task 3 measured what eager barrel loading costs when
 * it beat `vi.mock`'s own interception (`src/testing/setup.ts`'s own header);
 * this is the same lesson one level up. Filling core's whole spell registry
 * genuinely *is* reaching into the content machinery; a pack that wants it
 * says so explicitly, at `@moba2d/core/testing/spells`, and a pack that only
 * wants to build a world never pays the import cost of asking, and its own
 * test run never evaluates a module graph it has no use for.
 */
export * from './world';
export * from './api';
export * from './engine';
/**
 * Named, not `export *`, unlike the three lines above — a deliberate
 * allow-list, not a reaction to what `./setup` happens to export today.
 * `./setup` is also published on its own, as `@moba2d/core/testing/setup`
 * (Task 3's own fix round), and `package.json`'s `exports` publishes a
 * module's *entire* export list, not the bindings anyone intended — there is
 * no such thing as "exported, but only for the barrel to see." `./setup`
 * used to also export `cachedLanesForTests`, an implementation detail for
 * this checkout's own `tests/game/lanesFixture.ts`, and publishing
 * `./testing/setup` silently made that importable by any pack too; it now
 * lives in the unmapped `./lanes` instead, precisely so `./setup` has
 * nothing but its two public functions to leak. Naming the re-export here
 * is what keeps that true even if `./setup` ever grows another
 * checkout-only helper: an addition to that file only reaches a pack
 * through *this* line, never automatically through `export *`.
 */
export { installEngineGlobalsForTests, installPackForTests } from './setup';
export type { InstalledPackForTests } from './setup';
