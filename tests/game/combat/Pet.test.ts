import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import Pet, {
  PET_LEASH_RANGE,
  PET_SCAN_INTERVAL_MS,
} from '../../../src/game/gameObject/attackableUnits/Pet';
import { createGame, createUnit, installSpellObjectGlobals } from '../spell/fixtures';

/**
 * Content-pack-and-repo-split batch 6 task 10, fix round 1: this file used
 * to test `Pet` — a core engine class, not any pack's content — alongside
 * four real spells that summon or build on one (`Shaco_R`, `Shaco_W`,
 * `Jinx_E`, `Annie_R`), in the same file. Only the base class needed any of
 * them: `summon()` below always constructed a bare `new Pet({...})`
 * directly, never a real spell. The four spell-specific describe blocks
 * moved to `packs/riot/tests/spells/Pet.test.ts`, in the pack's own
 * repository — each is a claim about a specific spell's own behaviour
 * (Shaco W's hidden/targetable transitions, Jinx E's chompers matching
 * `docs/abilities/jinx/e.json`, Annie R's recast racing its own cooldown
 * state and the pet's scan interval), not about `Pet` in general, so a
 * fixture could not have stood in for them the way `AttackProfiles.test.ts`'s
 * corpus was reduced elsewhere in this fix round.
 *
 * A pet is a unit, not an effect: it can be killed, it fights on its own, and
 * it does not outlive the champion who paid for it.
 */
installSpellObjectGlobals();

const summon = (overrides: Record<string, unknown> = {}) => {
  const game = createGame();
  const owner = createUnit(game, 0, 'blue');
  const enemy = createUnit(game, 120, 'red');
  enemy.stats.maxHealth.baseValue = 200;
  enemy.stats.health.baseValue = 200;
  game.objectManager.queryObjects = vi.fn(() => [enemy]) as never;

  const pet = new Pet({
    game,
    position: owner.position.copy(),
    teamId: owner.teamId,
    ownerUnit: owner,
    lifeTimeMs: 5000,
    ...overrides,
  } as never);
  return { game, owner, enemy, pet };
};

describe('Pet', () => {
  it('picks its own fight and orders a real basic attack', () => {
    const { enemy, pet } = summon();

    vi.stubGlobal('deltaTime', PET_SCAN_INTERVAL_MS);
    pet.update();
    vi.stubGlobal('deltaTime', 16);

    expect(pet.basicAttack.target).toBe(enemy);
  });

  it('inherits its summoner’s team, so it never turns on them', () => {
    const { owner, pet } = summon();
    expect(pet.teamId).toBe(owner.teamId);
  });

  it('drops the target and comes home once it is past the leash', () => {
    const { pet } = summon();

    pet.position.set(PET_LEASH_RANGE + 200, 0);
    expect(pet.leashed).toBe(true);

    vi.stubGlobal('deltaTime', PET_SCAN_INTERVAL_MS);
    pet.update();
    vi.stubGlobal('deltaTime', 16);

    expect(pet.basicAttack.target).toBeFalsy();
    // Walking back, not teleporting: the destination is short of the owner.
    expect(pet.destination).toBeTruthy();
    expect(pet.destination!.x).toBeLessThan(pet.position.x);
  });

  it('expires on its own clock, once', () => {
    const { pet } = summon({ lifeTimeMs: 1000 });
    const gift = vi.spyOn(pet, 'onExpire');

    vi.stubGlobal('deltaTime', 1200);
    pet.update();
    pet.update();
    vi.stubGlobal('deltaTime', 16);

    expect(pet.toRemove).toBe(true);
    expect(gift).toHaveBeenCalledTimes(1);
  });

  it('dies with its summoner rather than outliving them', () => {
    const { owner, pet } = summon();
    const gift = vi.spyOn(pet, 'onExpire');

    owner.die({ reviveAfter: 5000 });
    pet.update();

    expect(pet.toRemove).toBe(true);
    expect(gift).toHaveBeenCalledOnce();
  });

  it('pays its parting effect when it is killed too, not only when it times out', () => {
    const { pet } = summon();
    const gift = vi.spyOn(pet, 'onExpire');

    pet.die({ reviveAfter: 0 });
    pet.update();

    expect(gift).toHaveBeenCalledOnce();
    expect(pet.toRemove).toBe(true);
  });
});
