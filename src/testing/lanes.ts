import type { LaneDefinition } from '../content/ContentPack';

/**
 * The one cache of "the lanes an installed pack's map carried", for the
 * whole test suite — deliberately its own module, with no `package.json`
 * subpath, rather than living inside `src/testing/setup.ts` where it used
 * to. It was there once: `./testing/setup` is published (Task 3's own fix
 * round), and once a subpath exists, every binding a module exports is
 * public through it — ES modules have no visibility control, so there is no
 * such thing as "exported, but only for this checkout's own use" from a file
 * `package.json` maps. Moving the cache here, unmapped, is what makes it
 * genuinely private again: nothing outside this checkout can import it,
 * because nothing outside this checkout can name this file at all.
 *
 * `setCachedLanesForTests` is written by `src/testing/setup.ts`'s
 * `installPackForTests`, once — see that function's own doc comment for the
 * first-pack-wins rule it applies before calling this. `cachedLanesForTests`
 * is read by `tests/game/lanesFixture.ts`'s `installSummonersRiftLanesForTests`,
 * imported by relative path the way any of this checkout's own `tests/`
 * files may reach into `src/`, which is what actually installs the cached
 * lanes as the active match's lane set.
 */
let cachedLanes: LaneDefinition[] = [];

export function setCachedLanesForTests(lanes: LaneDefinition[]): void {
  cachedLanes = lanes;
}

export function cachedLanesForTests(): LaneDefinition[] {
  return cachedLanes;
}
