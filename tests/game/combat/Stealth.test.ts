/**
 * Stealth has to hide you from everything that picks targets, not just from a
 * champion's right-click.
 *
 * `ActionState.STEALTHED` was read in exactly one place in the whole engine —
 * `BasicAttackController`, so a player could not *order* an attack on a
 * stealthed unit — and nowhere else. Every scan that acquires a target on its
 * own went through `canTakeDamageFromTeam`, which knows about teams, death and
 * targetability but not about being invisible. So Twitch Q dimmed the sprite to
 * alpha 20 and changed nothing: the wave, the camps, the turrets and the bots
 * all kept chasing and hitting a champion nobody could see.
 *
 * The bush rule (`visibleTo`) is deliberately left off the bots — see the note
 * on that filter. Stealth is the other case entirely: it is an ability the
 * player spent a cast and a cooldown on, and a bot that ignores it makes the
 * ability worthless against the only opponents in the match.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Minion from '../../../src/game/gameObject/attackableUnits/Minion';
import Monster from '../../../src/game/gameObject/attackableUnits/Monster';
import Turret from '../../../src/game/gameObject/structures/Turret';
import Invisible from '../../../src/game/gameObject/buffs/Invisible';
import TrueSight from '../../../src/game/gameObject/buffs/TrueSight';
import TeamId from '../../../src/game/enums/TeamId';
import { Lane, getLaneWaypoints } from '../../../src/game/lanes';
import Spell from '../../../src/game/gameObject/Spell';
import type { CastSpec } from '../../../src/game/spell/runtime/types';
import { createGame, indexObjects, stubGameGlobals, TEST_AVATAR_KEY, type TestGame } from '../fixtures';
import { installSketchMathGlobals, installSpellObjectGlobals, pressSpell } from '../spell/fixtures';

const CAMP = { x: 1_000, y: 1_000, r: 300 };

let game: TestGame;

/** Puts a live stealth on `unit` and settles the status flags it implies. */
const vanish = (unit: Champion) => {
  unit.addBuff(new Invisible(5_000, unit, unit));
  unit.updateBuffs();
  expect(unit.isStealthed).toBe(true);
};

const reveal = (unit: Champion, revealer: Champion) => {
  unit.addBuff(new TrueSight(5_000, revealer, unit));
  unit.updateBuffs();
};

const makeMinion = (teamId: string, x: number, y = 0) =>
  new Minion({
    game,
    teamId,
    position: createVector(x, y),
    waypoints: getLaneWaypoints(Lane.MID, teamId),
    lane: Lane.MID,
  });

const makeCamp = () =>
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
    },
  } as ConstructorParameters<typeof Monster>[0]);

describe('nothing acquires a target it cannot see', () => {
  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a minion walks past a stealthed champion', () => {
    const minion = makeMinion(TeamId.BLUE, 0);
    const champion = new Champion({ game, teamId: 'solo', position: createVector(60, 0) });
    indexObjects(game, [minion, champion]);

    expect(minion.findTarget()?.unit).toBe(champion);

    vanish(champion);
    expect(minion.findTarget()).toBeNull();
  });

  it('a jungle camp drops a target that vanishes mid-fight', () => {
    // Camps no longer wake on proximity at all, so the stealth-relevant rule is
    // the other end: a camp already fighting a champion lets go the moment it
    // can no longer see them (updateAttack's isStealthed check).
    const camp = makeCamp();
    const champion = new Champion({ game, teamId: 'other' });
    champion.position.set(CAMP.x + 40, CAMP.y);
    indexObjects(game, [camp, champion]);
    camp.aggroOn(champion);
    expect(camp.phase).toBe(Monster.PHASES.ATTACK);

    vanish(champion);
    camp.updateAttack();
    expect(camp.phase).toBe(Monster.PHASES.BACK_TO_CAMP);
    expect(camp.targetLock).toBeNull();
  });

  it('a turret holds its fire', () => {
    const turret = new Turret({ game, position: createVector(0, 0), teamId: TeamId.BLUE });
    const champion = new Champion({ game, teamId: 'solo', position: createVector(120, 0) });
    indexObjects(game, [turret, champion]);

    expect(turret.findTarget()?.unit).toBe(champion);

    vanish(champion);
    expect(turret.findTarget()).toBeNull();
  });

  it('a bot loses interest too — the ability is spent on the bots more than anything', () => {
    const bot = new AIChampion({ game, teamId: 'bot', position: createVector(0, 0) });
    const champion = new Champion({ game, teamId: 'solo', position: createVector(150, 0) });
    indexObjects(game, [bot, champion]);

    expect(bot.findAttackTarget()).toBe(champion);

    vanish(champion);
    expect(bot.findAttackTarget()).toBeNull();
  });

  it('sees it again the moment true sight strips the stealth', () => {
    const minion = makeMinion(TeamId.BLUE, 0);
    const champion = new Champion({ game, teamId: 'solo', position: createVector(60, 0) });
    indexObjects(game, [minion, champion]);

    vanish(champion);
    expect(minion.findTarget()).toBeNull();

    reveal(champion, minion as never);
    expect(champion.isStealthed).toBe(false);
    expect(minion.findTarget()?.unit).toBe(champion);
  });
});

describe('a target that vanishes mid-fight is let go', () => {
  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a minion drops the lock rather than keeping it until the next scan', () => {
    const minion = makeMinion(TeamId.BLUE, 0);
    const champion = new Champion({ game, teamId: 'solo', position: createVector(60, 0) });
    indexObjects(game, [minion, champion]);
    minion.targetLock = champion;
    minion.phase = Minion.PHASES.ATTACK;

    vanish(champion);
    minion.updateAttack();

    expect(minion.targetLock).toBeNull();
  });

  it('a camp goes home rather than swinging at nothing', () => {
    const camp = makeCamp();
    const champion = new Champion({ game, teamId: 'other' });
    champion.position.set(CAMP.x + 40, CAMP.y);
    indexObjects(game, [camp, champion]);
    camp.aggroOn(champion);
    camp._attackCooldown = 0;
    const health = champion.stats.health.value;

    vanish(champion);
    camp.updateAttack();

    expect(camp.targetLock).toBeNull();
    expect(champion.stats.health.value).toBe(health);
  });
});

/**
 * **Acting gives you away** — the other half of stealth, and the half this
 * engine did not have.
 *
 * Everything above is the *observer* side: nothing acquires what it cannot
 * see. With no rule on the acting side, a champion who vanished stayed
 * untargetable while standing in a fight and swinging: not a repositioning
 * tool, a permanent immunity to being answered. `combat/StealthBreak.ts` has
 * the rule and the two seams it hangs on.
 */
describe('acting gives a hidden champion away', () => {
  /** A cast with nothing in it, so the press itself is what is under test. */
  class Poke extends Spell {
    name = 'Poke';
    coolDown = 0;
    manaCost = 0;
    lockoutMs = 0;

    get castSpec(): CastSpec {
      return {
        activation: 'PRESS',
        targeting: 'SELF',
        castTimeMs: 0,
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'start', durationMs: this.lockoutMs },
      };
    }

    onSpellCast(): void {}
  }

  /** The shape every vanishing ability has: the cast is what hides you. */
  class Vanish extends Poke {
    name = 'Vanish';

    onSpellCast(): void {
      this.owner.addBuff(new Invisible(5_000, this.owner, this.owner));
    }
  }

  beforeEach(() => {
    stubGameGlobals();
    installSpellObjectGlobals();
    installSketchMathGlobals();
    game = createGame();
    game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const hidden = (teamId: string, x = 0): Champion => {
    const champion = new Champion({ game, teamId, position: createVector(x, 0) });
    champion.stats.attackRange.baseValue = 300;
    vanish(champion);
    return champion;
  };

  /** Settle the flags the way a frame would, then read. */
  const stillHidden = (champion: Champion): boolean => {
    champion.updateBuffs();
    return champion.isStealthed;
  };

  it('a swing ends it — at the swing, not at the hit', () => {
    const champion = hidden('solo');
    const victim = new Champion({ game, teamId: 'other', position: createVector(120, 0) });
    indexObjects(game, [champion, victim]);

    // `launch` is the commit. A ranged attacker's bolt is still in the air
    // here, which is exactly the stretch the victim is trying to read.
    champion.basicAttack.launch(victim, champion.basicAttack.reachTo(victim));

    expect(stillHidden(champion)).toBe(false);
  });

  it('a cast ends it', () => {
    const champion = hidden('solo');
    indexObjects(game, [champion]);

    expect(pressSpell(new Poke(champion))).toBe(true);

    expect(stillHidden(champion)).toBe(false);
  });

  /**
   * The one case a naive cast seam gets wrong, and it is the common one: the
   * ability granting the stealth is itself a cast, so ending every stealth on
   * every press would undo the vanishing with the press that cast it. The
   * snapshot in `Spell.press` is what makes this pass.
   */
  it('the cast that grants the stealth does not undo its own work', () => {
    const champion = new Champion({ game, teamId: 'solo' });
    indexObjects(game, [champion]);

    expect(pressSpell(new Vanish(champion))).toBe(true);

    expect(stillHidden(champion)).toBe(true);
  });

  it('a refused cast leaves it alone', () => {
    const champion = hidden('solo');
    indexObjects(game, [champion]);

    const poke = new Poke(champion);
    poke.lockoutMs = 5_000;
    expect(pressSpell(poke)).toBe(true);
    vanish(champion);

    // Into the cooldown: an AI champion does this several times a second, and
    // a key pressed into a lockout is not an action.
    expect(pressSpell(poke)).toBe(false);
    expect(stillHidden(champion)).toBe(true);
  });

  it('an ability that opts out leaves it alone — the shape recall uses', () => {
    const champion = hidden('solo');
    indexObjects(game, [champion]);

    const quiet = new Poke(champion);
    quiet.breaksStealth = false;
    expect(pressSpell(quiet)).toBe(true);

    expect(stillHidden(champion)).toBe(true);
  });

  /**
   * **Damage does not break it**, deliberately: a poison applied before the
   * champion vanished goes on ticking, and every tick is damage the hidden
   * unit dealt. Hanging the rule on `onDamageDealt` — the obvious place —
   * would leave a damage-over-time kit unable to use its own stealth at all.
   */
  it('damage the hidden champion is still dealing does not break it', () => {
    const champion = hidden('solo');
    const victim = new Champion({ game, teamId: 'other', position: createVector(120, 0) });
    indexObjects(game, [champion, victim]);

    victim.takeDamage(20, champion, 'MAGIC');

    expect(stillHidden(champion)).toBe(true);
  });
});
