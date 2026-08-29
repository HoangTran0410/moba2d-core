import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Monster, {
  MONSTER_HOME_TOLERANCE,
} from '../../../src/game/gameObject/attackableUnits/Monster';
import { MonsterClaw } from '../../../src/game/gameObject/attackableUnits/monsterAttacks';

/**
 * Every claw this camp's world holds, settled or not.
 *
 * A camp's damage no longer lands on the frame it swings — `launchAttack`
 * hands it to an object that resolves on its own clock
 * (`monsterAttacks.ts`) — so "did it swing" is a question about the object,
 * and `ObjectManager.addObject` parks that in `_objectToBeAdd` until its own
 * next `update()`.
 */
const clawsThrown = (camp: Monster): MonsterClaw[] => {
  const manager = camp.game.objectManager as unknown as {
    objects: unknown[];
    _objectToBeAdd: unknown[];
  };
  return [...manager.objects, ...manager._objectToBeAdd].filter(
    object => object instanceof MonsterClaw
  ) as MonsterClaw[];
};
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Airborne from '../../../src/game/gameObject/buffs/Airborne';
import Stun from '../../../src/game/gameObject/buffs/Stun';
import { createGame, indexObjects, stubGameGlobals, TEST_AVATAR_KEY, type TestGame } from '../fixtures';

const CAMP = { x: 1_000, y: 1_000, r: 300 };

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
      ...overrides,
    },
  } as ConstructorParameters<typeof Monster>[0]);

describe('Monster', () => {
  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
  });
  afterEach(() => vi.unstubAllGlobals());

  describe('leashing home', () => {
    /**
     * The arrival test used to be a flat `< 10px` bullseye. Camp points sit
     * ~100px apart (the three wolves, the four raptors) while
     * `UnitCollisionSystem` holds two bodies `bodyRadius + bodyRadius` apart,
     * so the small ones physically cannot reach the exact point their preset
     * names. A camp that never arrives never leaves BACK_TO_CAMP — it keeps
     * the walking-home regen rate and, far worse, never runs `updateIdle`
     * again, so it stops re-aggroing on proximity for the rest of the match
     * while standing on its own camp.
     */
    it('counts as home once it is within its own body radius of the camp point', () => {
      const camp = makeCamp();
      indexObjects(game, [camp]);
      camp.phase = Monster.PHASES.BACK_TO_CAMP;

      // 40px out: past the old flat threshold, inside this body's radius
      camp.position.set(CAMP.x + camp.stats.size.value / 2 - 1, CAMP.y);
      camp.updateBackToCamp();

      expect(camp.phase).toBe(Monster.PHASES.IDLE);
    });

    it('keeps walking while it is still further out than that', () => {
      const camp = makeCamp();
      indexObjects(game, [camp]);
      camp.phase = Monster.PHASES.BACK_TO_CAMP;

      camp.position.set(CAMP.x + camp.stats.size.value, CAMP.y);
      camp.updateBackToCamp();

      expect(camp.phase).toBe(Monster.PHASES.BACK_TO_CAMP);
    });

    it('never lets the tolerance fall below its floor, however small the body', () => {
      const camp = makeCamp({ size: 4 });
      indexObjects(game, [camp]);
      camp.phase = Monster.PHASES.BACK_TO_CAMP;

      camp.position.set(CAMP.x + MONSTER_HOME_TOLERANCE - 1, CAMP.y);
      camp.updateBackToCamp();

      expect(camp.phase).toBe(Monster.PHASES.IDLE);
    });

    it('gives up a chase that drags it past its leash radius, after the grace delay', () => {
      const camp = makeCamp();
      const champion = new Champion({ game, teamId: 'other' });
      indexObjects(game, [camp, champion]);
      vi.stubGlobal('deltaTime', 16);

      camp.aggroOn(champion);
      expect(camp.phase).toBe(Monster.PHASES.ATTACK);

      // Well past the chase leash (camp.r 300 + MONSTER_CHASE_MARGIN 350 = 650).
      camp.position.set(CAMP.x + 900, CAMP.y);
      champion.position.set(camp.position.x + 20, camp.position.y);

      // Still chasing during the give-up grace.
      camp.updateAttack();
      expect(camp.phase).toBe(Monster.PHASES.ATTACK);

      // Once the delay is spent, it turns for home.
      camp._giveUpTimer = 0;
      camp.updateAttack();
      expect(camp.phase).toBe(Monster.PHASES.BACK_TO_CAMP);
      expect(camp.targetLock).toBeNull();
    });
  });

  /**
   * A camp swings on its own timer rather than through `BasicAttackController`,
   * which is where the `canAttack` gate lives for champions. Left ungated, every
   * crowd control a player spends on a camp bought nothing: the knock-up lifted
   * it, greyed nothing, and it kept hitting on the beat right through.
   */
  describe('crowd control', () => {
    const engage = (camp: Monster, champion: Champion) => {
      champion.position.set(CAMP.x + 20, CAMP.y);
      camp.aggroOn(champion);
      camp._attackCooldown = 0;
    };

    /**
     * How many swings have actually been thrown.
     *
     * A camp's damage no longer lands on the frame it swings — `launchAttack`
     * hands it to a `MonsterClaw`/`MonsterSpit`/`MonsterBreath` that resolves
     * on its own clock (`monsterAttacks.ts`). So "did the control stop it" is
     * a question about the swing, not about the health bar: reading health
     * here would now pass for a camp that swung freely and simply had not
     * connected yet.
     */
    const swings = (): number => {
      const manager = game.objectManager as unknown as {
        objects: unknown[];
        _objectToBeAdd: unknown[];
      };
      return [...manager.objects, ...manager._objectToBeAdd].filter(
        object => object instanceof MonsterClaw
      ).length;
    };

    it('does not swing while it is knocked up', () => {
      const camp = makeCamp();
      const champion = new Champion({ game, teamId: 'other' });
      indexObjects(game, [camp, champion]);
      engage(camp, champion);
      const health = champion.stats.health.value;

      camp.addBuff(new Airborne(2_000, champion, camp));
      camp.updateBuffs();
      camp.updateAttack();

      expect(champion.stats.health.value).toBe(health);
      expect(swings()).toBe(0);
    });

    it('does not swing while it is stunned', () => {
      const camp = makeCamp();
      const champion = new Champion({ game, teamId: 'other' });
      indexObjects(game, [camp, champion]);
      engage(camp, champion);
      const health = champion.stats.health.value;

      camp.addBuff(new Stun(2_000, champion, camp));
      camp.updateBuffs();
      camp.updateAttack();

      expect(champion.stats.health.value).toBe(health);
    });

    it('swings again the moment the control ends, with nothing banked', () => {
      const camp = makeCamp();
      const champion = new Champion({ game, teamId: 'other' });
      indexObjects(game, [camp, champion]);
      engage(camp, champion);

      const buff = new Airborne(2_000, champion, camp);
      camp.addBuff(buff);
      camp.updateBuffs();
      camp.updateAttack();

      expect(swings(), 'the camp swung while it was in the air').toBe(0);

      buff.deactivateBuff();
      camp.updateBuffs();
      camp.updateAttack();

      expect(swings()).toBe(1);
    });
  });

  /**
   * Baron is `speed: 0` — scenery with a long reach. Nothing walks it home, so
   * a displacement (Thresh Q, Blitzcrank Q, Lee Sin R, an Anivia wall) used to
   * strand it for the rest of the match: past its 100px camp radius
   * `updateAttack` bounces it into BACK_TO_CAMP, which it can never leave, and a
   * camp in BACK_TO_CAMP never runs `updateIdle` again — so it stops aggroing,
   * stops swinging, and stops showing a swing flash. It holds its camp point the
   * way a turret holds its foundation instead.
   */
  describe('an immovable camp holds its camp point', () => {
    const makeBaron = () => makeCamp({ speed: 0, camp: { ...CAMP, r: 100 } });

    it('is back on its camp point by the end of the frame it was displaced in', () => {
      const baron = makeBaron();
      indexObjects(game, [baron]);
      expect(baron.isImmovable).toBe(true);

      baron.teleportTo(CAMP.x + 400, CAMP.y);
      baron.update();

      expect(baron.position.x).toBe(CAMP.x);
      expect(baron.position.y).toBe(CAMP.y);
      expect(baron.destination.x).toBe(CAMP.x);
    });

    it('never falls into the leash phase it could not walk out of', () => {
      const baron = makeBaron();
      const champion = new Champion({ game, teamId: 'other' });
      champion.position.set(CAMP.x + 60, CAMP.y);
      indexObjects(game, [baron, champion]);
      baron.aggroOn(champion);

      baron.teleportTo(CAMP.x + 400, CAMP.y);
      for (let i = 0; i < 10; i++) baron.update();

      expect(baron.phase).toBe(Monster.PHASES.ATTACK);
      expect(baron.targetLock).toBe(champion);
    });

    it('still swings after being dragged, because it never left', () => {
      const baron = makeBaron();
      const champion = new Champion({ game, teamId: 'other' });
      champion.position.set(CAMP.x + 60, CAMP.y);
      indexObjects(game, [baron, champion]);
      baron.aggroOn(champion);

      baron.teleportTo(CAMP.x + 400, CAMP.y);
      baron.update();
      baron._attackCooldown = 0;
      // Counted from here: `update()` above already ran a full frame, and this
      // is about the swing that follows the displacement, not that one.
      const before = clawsThrown(baron);
      baron.updateAttack();

      const thrown = clawsThrown(baron);
      expect(thrown).toHaveLength(before.length + 1);
      expect(thrown[thrown.length - 1].target).toBe(champion);
    });

    it('leaves a camp with legs to walk its own way home', () => {
      const wolf = makeCamp();
      indexObjects(game, [wolf]);

      wolf.teleportTo(CAMP.x + 400, CAMP.y);
      wolf.update();

      expect(wolf.position.x).toBe(CAMP.x + 400);
    });
  });

  /**
   * The other half of "it never came back": a camp shoved while nothing is
   * chasing it stays in IDLE, and IDLE only ever scanned for champions. A wolf
   * pushed out of its pit by a wall or a hook stood wherever it was dumped for
   * the rest of the match.
   */
  describe('a camp displaced with nothing chasing it walks home', () => {
    it('leaves IDLE once it is off its camp point', () => {
      const camp = makeCamp();
      indexObjects(game, [camp]);
      expect(camp.phase).toBe(Monster.PHASES.IDLE);

      camp.teleportTo(CAMP.x + 500, CAMP.y);
      camp._scanCooldown = 0;
      camp.updateIdle();

      expect(camp.phase).toBe(Monster.PHASES.BACK_TO_CAMP);
    });

    it('actually gets there', () => {
      const camp = makeCamp();
      indexObjects(game, [camp]);

      camp.teleportTo(CAMP.x + 500, CAMP.y);
      for (let i = 0; i < 400; i++) camp.update();

      const distance = Math.hypot(camp.position.x - CAMP.x, camp.position.y - CAMP.y);
      expect(distance).toBeLessThanOrEqual(camp.stats.size.value / 2);
      expect(camp.phase).toBe(Monster.PHASES.IDLE);
    });

    it('stays idle while it is standing on its camp', () => {
      const camp = makeCamp();
      indexObjects(game, [camp]);

      camp._scanCooldown = 0;
      camp.updateIdle();

      expect(camp.phase).toBe(Monster.PHASES.IDLE);
    });
  });

  /**
   * A camp's leash used to be measured only from the camp to *itself* — a
   * chase drags it out of its circle and it goes home. Nothing ever asked where
   * the target had got to, which is fine for a camp with legs and completely
   * broken for one without: Baron never moves, so it never leaves its circle,
   * so it never let go. A player could teleport across the map, come back
   * minutes later, and still be the thing Baron was aiming at — and a Shaco
   * clone standing right on top of it was never even considered, because the
   * scan that would have found it only runs in IDLE.
   */
  describe('letting a target go', () => {
    const makeBaron = () =>
      makeCamp({ speed: 0, camp: { ...CAMP, r: 100 }, attackRange: 400, aggroRange: 480 });

    it('drops a champion that has left the camp area entirely', () => {
      const baron = makeBaron();
      const champion = new Champion({ game, teamId: 'other' });
      champion.position.set(CAMP.x + 60, CAMP.y);
      indexObjects(game, [baron, champion]);
      baron.aggroOn(champion);

      // half the map away, held for longer than the give-up grace
      champion.position.set(CAMP.x + 3_000, CAMP.y);
      for (let i = 0; i < Math.ceil(baron.giveUpDelayMs / 16) + 2; i++) baron.updateAttack();

      expect(baron.targetLock).toBeNull();
      expect(baron.phase).not.toBe(Monster.PHASES.ATTACK);
    });

    /**
     * A deliberate reversal, and the rule it replaces is worth stating.
     *
     * A rooted camp used to drop its target the *frame* it stepped outside
     * reach, on the grounds that a camp with no legs cannot close a gap and
     * holding a lock is a promise it can never keep. True, and it produced
     * the bug that got it changed: dropping the lock puts the camp straight
     * into BACK_TO_CAMP, whose regen rate is `health / 60` applied per frame —
     * a full bar in one second. So a step over an invisible line, on any
     * rooted boss in the game, was a free complete heal.
     *
     * The leash ends this fight now, the same as it does for a camp with legs.
     * All being rooted changes is that it waits where it stands.
     */
    it('holds a target it can see but could never walk to', () => {
      const baron = makeBaron();
      const champion = new Champion({ game, teamId: 'other' });
      champion.position.set(CAMP.x + 60, CAMP.y);
      indexObjects(game, [baron, champion]);
      baron.aggroOn(champion);

      // inside the leash circle, a hair past everything it can reach
      champion.position.set(CAMP.x + 470, CAMP.y);
      for (let i = 0; i < 200; i++) baron.updateAttack();

      expect(baron.targetLock).toBe(champion);
      expect(baron.phase).toBe(Monster.PHASES.ATTACK);
    });

    it('no longer takes the next thing that walks up — it waits to be hit', () => {
      const baron = makeBaron();
      const clone = new Champion({ game, teamId: 'clone' });
      clone.position.set(CAMP.x + 80, CAMP.y);
      indexObjects(game, [baron, clone]);

      // Camps stopped scanning for champions in IDLE, so one standing right on
      // top of the camp is ignored — a change from the old proximity aggro.
      baron._scanCooldown = 0;
      for (let i = 0; i < 4; i++) baron.update();
      expect(baron.phase).toBe(Monster.PHASES.IDLE);
      expect(baron.targetLock).toBeNull();

      // It wakes only once that champion actually damages it.
      baron.takeDamage(5, clone);
      expect(baron.phase).toBe(Monster.PHASES.ATTACK);
      expect(baron.targetLock).toBe(clone);
    });

    it('still lets a camp with legs chase a target out of reach', () => {
      const wolf = makeCamp();
      const champion = new Champion({ game, teamId: 'other' });
      champion.position.set(CAMP.x + 40, CAMP.y);
      indexObjects(game, [wolf, champion]);
      wolf.aggroOn(champion);

      // past its 50px reach, still well inside the camp circle it may fight in
      champion.position.set(CAMP.x + 200, CAMP.y);
      wolf.updateAttack();

      expect(wolf.targetLock).toBe(champion);
      expect(wolf.phase).toBe(Monster.PHASES.ATTACK);
      expect(wolf.destination.x).toBeGreaterThan(wolf.position.x);
    });

    it('drops a target that outruns the chase leash, after the grace delay', () => {
      const wolf = makeCamp();
      const champion = new Champion({ game, teamId: 'other' });
      champion.position.set(CAMP.x + 40, CAMP.y);
      indexObjects(game, [wolf, champion]);
      vi.stubGlobal('deltaTime', 16);
      wolf.aggroOn(champion);

      // Far past the chase leash (camp.r 300 + MONSTER_CHASE_MARGIN 350 = 650).
      champion.position.set(CAMP.x + 900, CAMP.y);
      wolf.updateAttack();
      expect(wolf.phase).toBe(Monster.PHASES.ATTACK); // still pursuing in the grace window

      wolf._giveUpTimer = 0;
      wolf.updateAttack();
      expect(wolf.targetLock).toBeNull();
    });
  });

});
