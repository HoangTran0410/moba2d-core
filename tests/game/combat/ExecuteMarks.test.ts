/**
 * The promise the mark makes.
 *
 * `drawExecuteMarks` paints a ring on every enemy the player's ready execute
 * spells would kill. The whole value of that is that it is *true* — a mark on
 * someone who survives the cast is worse than no mark, because it is the thing
 * the player last-hits by. So the set it paints is the set `pickExecuteTarget`
 * would choose from, computed by the same two methods, and it goes empty the
 * moment the spell cannot actually be cast.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Spell from '../../../src/game/gameObject/Spell';
import SpellState from '../../../src/game/enums/SpellState';
import { executeMarks, executeMarkTargets } from '../../../src/game/combat/ExecuteMarks';
import type { ExecuteFallback } from '../../../src/game/combat/ExecuteTargeting';
import type AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

/**
 * A minimal execute-capable spell, built for this test rather than borrowed
 * from any installed content pack's own catalogue.
 *
 * Content-pack-and-repo-split batch 6 task 10, fix round 1: this file used
 * to exercise `ExecuteMarks`/`ExecuteTargeting` through real `Nasus_Q`,
 * `ChoGath_R` and `Flash` — which stopped existing in this repository the
 * moment `packs/riot/` became a repository of its own, and dormant coverage
 * of an engine mechanism (not a fact about any pack's content) is the wrong
 * outcome. `ExecuteMarks`/`ExecuteTargeting` only ever ask a spell for three
 * things — `executeCandidates()`, `executeDamageAgainst(target)`, and the
 * ordinary `Spell` fields every spell already carries (`state`, `manaCost`,
 * `disabled`) — so a fixture that answers exactly those questions exercises
 * the same mechanism a real execute ability does, permanently, regardless of
 * which content pack (if any) is installed.
 *
 * `damage` is a flat 20 rather than per-target logic: every "doomed" fixture
 * below is 8 effective health (20 kills it) and the one "healthy" fixture is
 * 100 (20 does not), which is all the lethality boundary this suite needs to
 * cross to prove the aggregation rules below it.
 */
class FixtureExecuteSpell extends Spell {
  protected targetingMode = 'DIRECTION' as const;
  coolDown = 1000;
  manaCost = 40;
  executeFallback: ExecuteFallback = 'nearest';
  damage = 20;

  executeCandidates(): AttackableUnit[] {
    const owner = this.owner as AttackableUnit;
    return (owner.game.objectManager.objects as AttackableUnit[]).filter(
      unit => unit !== owner && unit.teamId !== owner.teamId
    );
  }

  executeDamageAgainst(): number {
    return this.damage;
  }
}

/** Carries neither execute method — the negative case `isExecuteSpell` must reject. */
class FixtureOrdinarySpell extends Spell {
  protected targetingMode = 'DIRECTION' as const;
  coolDown = 1000;
}

let game: TestGame;

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const caster = (): Champion => {
  const unit = new Champion({ game, teamId: 'caster' });
  unit.position.set(0, 0);
  unit.destination.set(0, 0);
  unit.stats.mana.baseValue = 500;
  unit.stats.maxMana.baseValue = 500;
  game.setPlayer(unit);
  return unit;
};

const enemy = (x: number, health: number): Champion => {
  const unit = new Champion({ game, teamId: `enemy-${x}` });
  unit.position.set(x, 0);
  unit.destination.set(x, 0);
  unit.stats.maxHealth.baseValue = 100;
  unit.stats.health.baseValue = health;
  return unit;
};

describe('executeMarkTargets', () => {
  it('marks the enemy a ready execute spell would finish', () => {
    const nasus = caster();
    const doomed = enemy(60, 8);
    nasus.spells = [new FixtureExecuteSpell(nasus)];
    indexObjects(game, [nasus, doomed]);

    expect(executeMarkTargets(nasus)).toEqual([doomed]);
  });

  it('marks nobody who survives the cast', () => {
    const nasus = caster();
    const healthy = enemy(60, 100);
    nasus.spells = [new FixtureExecuteSpell(nasus)];
    indexObjects(game, [nasus, healthy]);

    expect(executeMarkTargets(nasus)).toEqual([]);
  });

  it('stays on through the cooldown, and says the key is not live', () => {
    // Measured, not argued: gating the mark on `isCastableNow` left it visible
    // for 7 frames out of 481 while Q was being spammed, every blank frame down
    // to `state === COOLDOWN`. "Who can I finish next" is the question you are
    // asking *while* the ability is down.
    const nasus = caster();
    const doomed = enemy(60, 8);
    const spell = new FixtureExecuteSpell(nasus);
    nasus.spells = [spell];
    indexObjects(game, [nasus, doomed]);

    expect(executeMarks(nasus)).toEqual([{ unit: doomed, ready: true }]);

    spell.state = SpellState.COOLDOWN;
    expect(executeMarks(nasus)).toEqual([{ unit: doomed, ready: false }]);
  });

  it('does the same when the pool cannot pay for the cast', () => {
    const chogath = caster();
    const doomed = enemy(80, 8);
    const spell = new FixtureExecuteSpell(chogath);
    chogath.spells = [spell];
    indexObjects(game, [chogath, doomed]);

    expect(executeMarks(chogath)).toEqual([{ unit: doomed, ready: true }]);
    chogath.stats.mana.baseValue = spell.manaCost - 1;
    expect(executeMarks(chogath)).toEqual([{ unit: doomed, ready: false }]);
  });

  it('drops a spell the match has switched off entirely', () => {
    const nasus = caster();
    const doomed = enemy(60, 8);
    const spell = new FixtureExecuteSpell(nasus);
    spell.disabled = true;
    nasus.spells = [spell];
    indexObjects(game, [nasus, doomed]);

    expect(executeMarks(nasus)).toEqual([]);
  });

  it('reports one mark as live when either spell that finds it is up', () => {
    const hybrid = caster();
    const doomed = enemy(70, 8);
    const down = new FixtureExecuteSpell(hybrid);
    down.state = SpellState.COOLDOWN;
    hybrid.spells = [down, new FixtureExecuteSpell(hybrid)];
    indexObjects(game, [hybrid, doomed]);

    expect(executeMarks(hybrid)).toEqual([{ unit: doomed, ready: true }]);
  });

  it('marks a unit once even when two spells could finish it', () => {
    const hybrid = caster();
    const doomed = enemy(70, 8);
    hybrid.spells = [new FixtureExecuteSpell(hybrid), new FixtureExecuteSpell(hybrid)];
    indexObjects(game, [hybrid, doomed]);

    expect(executeMarkTargets(hybrid)).toEqual([doomed]);
  });

  it('ignores spells that are not execute spells at all', () => {
    const blinker = caster();
    const doomed = enemy(60, 8);
    blinker.spells = [new FixtureOrdinarySpell(blinker)];
    indexObjects(game, [blinker, doomed]);

    expect(executeMarkTargets(blinker)).toEqual([]);
  });

  it('goes quiet while the caster is dead', () => {
    const nasus = caster();
    const doomed = enemy(60, 8);
    nasus.spells = [new FixtureExecuteSpell(nasus)];
    indexObjects(game, [nasus, doomed]);

    nasus.die({ attacker: undefined, reviveAfter: 5_000 });
    expect(executeMarkTargets(nasus)).toEqual([]);
  });
});
