import { describe, expect, it } from 'vitest';

import { playableKits } from '../../../src/game/preset';

/**
 * The mechanism, not the tuning: every playable champion must carry *some*
 * attack profile, whichever installed pack supplied it and whatever its
 * six-or-however-many numbers are.
 *
 * The pack-specific assertions that used to live beside this one — the six
 * `ATTACK` role profiles' own gaps, ordering and dps bands — moved to
 * `tests/attackProfiles.test.ts` in the pack's own repository in a fix
 * round: `ATTACK` itself lives in a pack's own `data.ts` (a role taxonomy is
 * the roster's vocabulary, not the engine's), so the test that guards its
 * specific numbers lives with it. This one stays here because it names no
 * pack's own values — it is a claim about `playableKits()`'s own behaviour,
 * true for any installed pack.
 *
 * `playableKits()`, not `spellGroups()` filtered by `image?.startsWith
 * ('champ_')` (this file's own shape before content-pack-and-repo-split
 * batch 6 task 10, fix round 1): that filter assumed every playable
 * champion's portrait key carried Riot's own un-prefixed `champ_<name>`
 * convention, which is not a rule any other pack shares (see `ChampionEntry
 * .playable`'s own doc comment) — with only the reference pack installed,
 * whose portrait key is `reference_champ_vera`, the filter matched nothing
 * at all and this test passed by finding zero champions to examine, not by
 * finding one and checking it. `playableKits()` is `preset.ts`'s own,
 * already-correct playable filter (`champion.playable`), exported
 * specifically so this test reads the real rule instead of a second,
 * silently-wrong copy of it.
 */
describe('basic-attack profiles', () => {
  it('has playable champions to check, or this proves nothing', () => {
    // Guards the guard: this is exactly the vacuous-pass shape the `champ_`
    // sniff fell into above. Derived from the currently-installed roster
    // rather than a literal floor, since the count is meant to move as packs
    // come and go — only "found at least one" is the invariant.
    expect(playableKits().length).toBeGreaterThan(0);
  });

  it('every playable champion declares a profile', () => {
    // a champion left on the default is one that silently opted out of roles
    const unassigned = playableKits()
      .filter(kit => !kit.attack)
      .map(kit => kit.name);
    expect(unassigned).toEqual([]);
  });
});
