import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Monster from '../../../src/game/gameObject/attackableUnits/Monster';
import {
  BREATH_WINDUP_MS,
  CLAW_WINDUP_MS,
  DEFAULT_MONSTER_ATTACK_COLOR,
  MONSTER_MELEE_REACH,
  LASH_IMPACT_MS,
  LASH_WINDUP_MS,
  MonsterBreath,
  MonsterClaw,
  MonsterLash,
  MonsterSpit,
} from '../../../src/game/gameObject/attackableUnits/monsterAttacks';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import SpellObject from '../../../src/game/gameObject/SpellObject';
import { createGame, stubGameGlobals, TEST_AVATAR_KEY, type TestGame } from '../fixtures';

/**
 * A camp's basic attack, from the swing to the damage.
 *
 * The behaviour under test is a change, not an addition: `updateAttack` used
 * to call `target.takeDamage()` on the frame the cooldown allowed a swing and
 * draw a 180ms line as the only evidence. Damage now belongs to an object with
 * a travel time, so *when* it lands is the thing worth pinning — a
 * `MonsterClaw` that struck in its constructor would look identical in every
 * screenshot and would be the old bug back again.
 *
 * Timing constants are imported, so retuning a wind-up is not editing a test.
 */

const CAMP = { x: 1_000, y: 1_000, r: 300 };
/** Every frame in this file, matching `stubGameGlobals`' own `deltaTime`. */
const FRAME_MS = 16;

let game: TestGame;

const makeCamp = (overrides: Record<string, unknown> = {}) =>
  new Monster({
    game,
    preset: {
      name: 'Camp',
      avatar: TEST_AVATAR_KEY,
      camp: { ...CAMP },
      speed: 2,
      size: 80,
      attackRange: 50,
      reviveTime: 100,
      health: 300,
      damage: 12,
      ...overrides,
    },
  } as ConstructorParameters<typeof Monster>[0]);

/**
 * Everything the world has been handed, settled or not.
 *
 * `ObjectManager.addObject` pushes to `_objectToBeAdd` and only moves it into
 * `objects` on the manager's own `update()`, so an attack spawned this frame is
 * in neither list a test would think to read.
 */
const spawned = <T extends SpellObject>(kind: new (...args: never[]) => T): T => {
  const manager = game.objectManager as unknown as {
    objects: unknown[];
    _objectToBeAdd: unknown[];
  };
  const found = [...manager.objects, ...manager._objectToBeAdd].find(o => o instanceof kind);
  expect(found, `the camp spawned no ${kind.name}`).toBeTruthy();
  return found as T;
};

/** Puts a champion in reach and clears the cooldown, without swinging yet. */
const engage = (camp: Monster, distance: number): Champion => {
  const champion = new Champion({ game, teamId: 'other' });
  champion.position.set(CAMP.x + distance, CAMP.y);
  camp.aggroOn(champion);
  camp._attackCooldown = 0;
  return champion;
};

/** Runs an attack object for `ms`, one stubbed frame at a time. */
const advance = (object: { update(): void }, ms: number): void => {
  for (let elapsed = 0; elapsed <= ms; elapsed += FRAME_MS) object.update();
};

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
  game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
});
afterEach(() => vi.unstubAllGlobals());

describe('which attack a camp uses', () => {
  it('claws when its reach is body-to-body', () => {
    const camp = makeCamp({ attackRange: MONSTER_MELEE_REACH });
    const champion = engage(camp, 60);

    camp.updateAttack();

    expect(camp.attackStyle).toBe('melee');
    expect(spawned(MonsterClaw).target).toBe(champion);
  });

  it('spits when its reach is longer than that', () => {
    // Where every boss camp lands: a reach in the hundreds, and until now a
    // thin stroke as the only sign it had hit you.
    const camp = makeCamp({ attackRange: MONSTER_MELEE_REACH + 1, speed: 0 });
    const champion = engage(camp, 120);

    camp.updateAttack();

    expect(camp.attackStyle).toBe('ranged');
    expect(spawned(MonsterSpit).target).toBe(champion);
  });

  it('breathes when the pack said so, whatever its reach says', () => {
    const camp = makeCamp({ attackRange: 320, attackStyle: 'breath', speed: 0 });
    engage(camp, 200);

    camp.updateAttack();

    expect(spawned(MonsterBreath)).toBeTruthy();
  });

  it('lashes when the pack said so, whatever its reach says', () => {
    const camp = makeCamp({ attackRange: 220, attackStyle: 'lash', speed: 0 });
    const champion = engage(camp, 150);

    camp.updateAttack();

    expect(spawned(MonsterLash).target).toBe(champion);
  });

  /**
   * The two declared styles stay declared. `lash` sits at a reach a camp would
   * otherwise spit from, so deriving it — even for a segmented body — would
   * change what every existing camp does the moment somebody gives it a spine.
   */
  it('is never guessed from reach the way melee and ranged are', () => {
    expect(makeCamp({ attackRange: 40 }).attackStyle).toBe('melee');
    expect(makeCamp({ attackRange: 400 }).attackStyle).toBe('ranged');
  });

  it('paints in the colour the camp declared, or the old amber', () => {
    const declared = makeCamp({ attackColor: [10, 20, 30] });
    engage(declared, 60);
    declared.updateAttack();
    expect(spawned(MonsterClaw).color).toEqual([10, 20, 30]);

    game = createGame();
    game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
    const plain = makeCamp();
    engage(plain, 60);
    plain.updateAttack();
    expect(spawned(MonsterClaw).color).toEqual([...DEFAULT_MONSTER_ATTACK_COLOR]);
  });
});

describe('when the damage lands', () => {
  it('is not the frame the camp swings on', () => {
    // The whole change. Before this, `updateAttack` billed the target itself.
    const camp = makeCamp();
    const champion = engage(camp, 60);
    const health = champion.stats.health.value;

    camp.updateAttack();

    expect(champion.stats.health.value).toBe(health);
  });

  it('is the end of the claw\'s wind-up', () => {
    const camp = makeCamp();
    const champion = engage(camp, 60);
    const health = champion.stats.health.value;
    camp.updateAttack();
    const claw = spawned(MonsterClaw);

    advance(claw, CLAW_WINDUP_MS - FRAME_MS * 2);
    expect(champion.stats.health.value, 'the claw struck during its wind-up').toBe(health);

    advance(claw, FRAME_MS * 3);
    expect(champion.stats.health.value).toBe(health - camp.damage);
  });

  it('is the end of the breath\'s wind-up', () => {
    const camp = makeCamp({ attackRange: 320, attackStyle: 'breath', speed: 0 });
    const champion = engage(camp, 200);
    const health = champion.stats.health.value;
    camp.updateAttack();
    const breath = spawned(MonsterBreath);

    advance(breath, BREATH_WINDUP_MS - FRAME_MS * 2);
    expect(champion.stats.health.value, 'the cone struck before it opened').toBe(health);

    advance(breath, FRAME_MS * 3);
    expect(champion.stats.health.value).toBe(health - camp.damage);
  });

  /**
   * Deliberately **not** the end of the wind-up, unlike the claw and the cone.
   * The wind-up is the tail rearing back; the damage belongs at the crack, when
   * the tip is furthest out. Land it earlier and the camp hurts you before its
   * tail has left its own body.
   */
  it('is the crack of the lash, not the end of its wind-up', () => {
    const camp = makeCamp({ attackRange: 220, attackStyle: 'lash', speed: 0 });
    const champion = engage(camp, 150);
    const health = champion.stats.health.value;
    camp.updateAttack();
    const lash = spawned(MonsterLash);

    advance(lash, LASH_WINDUP_MS);
    expect(champion.stats.health.value, 'the tail struck while still rearing').toBe(health);

    advance(lash, LASH_IMPACT_MS - LASH_WINDUP_MS + FRAME_MS * 2);
    expect(champion.stats.health.value).toBe(health - camp.damage);
  });

  it('is the spit\'s arrival, not its launch', () => {
    const camp = makeCamp({ attackRange: 400, speed: 0 });
    const champion = engage(camp, 300);
    const health = champion.stats.health.value;
    camp.updateAttack();
    const spit = spawned(MonsterSpit);

    spit.update();
    expect(champion.stats.health.value, 'the spit hit before it travelled').toBe(health);

    for (let frame = 0; frame < 300 && !spit.toRemove; frame += 1) spit.update();
    expect(champion.stats.health.value).toBe(health - camp.damage);
  });

  it('lands exactly once, however long the animation runs', () => {
    const camp = makeCamp();
    const champion = engage(camp, 60);
    const health = champion.stats.health.value;
    camp.updateAttack();
    const claw = spawned(MonsterClaw);

    advance(claw, CLAW_WINDUP_MS * 4);

    expect(champion.stats.health.value).toBe(health - camp.damage);
  });

  it('never lands at all if the target left during the wind-up', () => {
    // A travel time the target cannot escape is a worse animation than none:
    // it teaches players their dodge does nothing.
    const camp = makeCamp();
    const champion = engage(camp, 60);
    const health = champion.stats.health.value;
    camp.updateAttack();
    const claw = spawned(MonsterClaw);

    champion.position.set(CAMP.x + 3_000, CAMP.y);
    advance(claw, CLAW_WINDUP_MS * 2);

    expect(champion.stats.health.value).toBe(health);
  });

  it('never lands on a corpse', () => {
    const camp = makeCamp({ attackRange: 400, speed: 0 });
    const champion = engage(camp, 300);
    camp.updateAttack();
    const spit = spawned(MonsterSpit);

    champion.takeDamage(99_999, camp);
    expect(champion.isDead, 'the champion survived, so nothing here is tested').toBe(true);
    const health = champion.stats.health.value;

    for (let frame = 0; frame < 300 && !spit.toRemove; frame += 1) spit.update();

    // The projectile has to give up rather than track a body that will have
    // respawned somewhere else by the time it arrives.
    expect(champion.stats.health.value).toBe(health);
    expect(spit.toRemove).toBe(true);
  });
});

describe('the attack objects paint past their own centre', () => {
  /**
   * `GameObject.getDisplayBoundingBox` derives its box from `visionRadius`,
   * which is 0 here — so a claw or a cone that did not state its own extent
   * would be culled the moment the camp's centre left the screen, which for a
   * 400px cone is most of the time it is on fire.
   */
  it('so each one states a box wider than a point', () => {
    const camp = makeCamp({ attackRange: 320, attackStyle: 'breath', speed: 0 });
    engage(camp, 200);
    camp.updateAttack();

    const box = spawned(MonsterBreath).getDisplayBoundingBox();
    expect(box.w).toBeGreaterThan(camp.attackRange);
  });

  it('including the tail, which reaches its whole length out', () => {
    const camp = makeCamp({ attackRange: 220, attackStyle: 'lash', speed: 0 });
    engage(camp, 150);
    camp.updateAttack();

    const box = spawned(MonsterLash).getDisplayBoundingBox();
    expect(box.w).toBeGreaterThan(camp.attackRange);
  });
});
