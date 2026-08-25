import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '@/testing';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import Spell from '@/game/gameObject/Spell';
import type { CastSpec } from '@/game/spell/runtime/types';

/**
 * The passive slot: a spell a champion *has* rather than one it casts.
 *
 * ## Why this is a slot and not just another ability
 *
 * A kit is `spells[]`, indexed by `SpellHotKeys` — seven fixed entries, A Q W
 * E R D F — and that array is also what the loadout editor lets a player
 * rearrange. A passive belongs in none of it: there is no key to press, no
 * cooldown to read, and offering it in a kit builder as something to slot into
 * `W` is offering nonsense.
 *
 * `Champion.recall` is the existing answer to exactly this shape — a real
 * `Spell`, deliberately outside `spells[]`, updated and drawn beside it — and
 * the passive follows it line for line.
 *
 * ## The contract core guarantees, which is narrower than "it runs"
 *
 * **Pressed exactly once per life.** Not once per match: a passive that hung
 * its effect on a buff or an event listener has lost both by the time its
 * champion respawns, so it has to be re-armed. Not once per frame either,
 * which is what "press it whenever it is READY" would degrade to for any
 * passive that completes instantly — and a passive that stacks something would
 * then stack it sixty times a second. The transition core watches is
 * dead → alive, and nothing else.
 */
class TestPassive extends Spell {
  static presses = 0;
  name = 'Test Passive';
  coolDown = 0;
  manaCost = 0;
  targetingMode = 'SELF' as const;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'SELF',
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: 0 },
    };
  }

  onSpellCast(): void {
    TestPassive.presses += 1;
  }
}

describe('Champion.passive', () => {
  let game: TestGame;
  let champion: Champion;

  const tick = (times = 1): void => {
    for (let i = 0; i < times; i++) champion.update();
  };

  beforeEach(() => {
    stubGameGlobals();
    TestPassive.presses = 0;
    game = createGame();
    champion = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
    game.setPlayer(champion);
    indexObjects(game, [champion]);
    champion.passive = new TestPassive(champion);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is armed once the champion starts updating', () => {
    expect(TestPassive.presses, 'armed before a single frame ran').toBe(0);
    tick();
    expect(TestPassive.presses).toBe(1);
  });

  it('is not armed again on every following frame', () => {
    tick(30);
    expect(TestPassive.presses).toBe(1);
  });

  it('is armed again after the champion dies and comes back', () => {
    tick();
    expect(TestPassive.presses).toBe(1);

    // The real death path, not `health = 0`: `isDead` is `deathData !== null`,
    // so emptying the health bar by hand produces a champion at zero health
    // who is not dead — and a test written that way asserts nothing about
    // respawn at all.
    champion.takeDamage(99_999, undefined, 'TRUE');
    expect(champion.isDead, 'the champion did not actually die').toBe(true);
    tick(3);
    expect(TestPassive.presses, 'a corpse re-armed its passive').toBe(1);

    champion.respawn();
    expect(champion.isDead).toBe(false);
    tick();
    expect(TestPassive.presses).toBe(2);
  });

  it('stays out of the kit, so no hotkey and no loadout slot ever reaches it', () => {
    // The whole reason it is a field rather than an eighth element. `spells[]`
    // is indexed by `SpellHotKeys`; anything in it is pressable and editable.
    expect(champion.spells).not.toContain(champion.passive);
  });

  it('is retired the same way every other spell on the champion is', () => {
    // Asserted as "the two teardown hooks ran", because that is literally what
    // `removeSpell` is — `deactivate()` then `onRemoved()`. An earlier version
    // of this case guessed at a resulting `state` instead and was green for
    // the wrong reason: a passive left behind keeps its buffs and its event
    // listeners after its champion is gone, and only these two calls take them
    // back.
    const passive = champion.passive!;
    const deactivate = vi.spyOn(passive, 'deactivate');
    const removed = vi.spyOn(passive, 'onRemoved');
    tick();

    champion.onRemoved();

    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledTimes(1);
  });

  it('costs nothing when a champion has none, which is most of them', () => {
    const plain = new Champion({ game, position: createVector(50, 0), teamId: 'red' });
    indexObjects(game, [plain]);
    expect(plain.passive).toBeNull();
    expect(() => plain.update()).not.toThrow();
  });
});
