/**
 * Who the kill belongs to when somebody else lands the last hit.
 *
 * The bug this file pins: you spend every cooldown taking an enemy champion to
 * 40 health, a caster minion behind you lands the last 30, and the scoreboard
 * says nobody killed anybody. The kill, the whole bounty and the spree all
 * went to a unit with no wallet and a tally that dies with the wave — and the
 * same held for a turret and for a jungle camp.
 *
 * League's rule, and now this one: **a champion finished off by something that
 * is not a champion is booked to the last enemy champion who hurt them**,
 * inside `killCreditWindowMs`. The last hit still decides who *farms*; it no
 * longer decides who *won a fight*.
 *
 * The gate is the victim's own `killCredit`, which is why farm is safe: a
 * minion is `'minion'` and is never redirected, and neither is a dragon taken
 * off you by the enemy's smite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import Minion from '@/game/gameObject/attackableUnits/Minion';
import Monster from '@/game/gameObject/attackableUnits/Monster';
import Pet from '@/game/gameObject/attackableUnits/Pet';
import Turret from '@/game/gameObject/structures/Turret';
import EventType from '@/game/enums/EventType';
import type { UnitDeathEvent } from '@/game/gameObject/attackableUnits/AttackableUnit';
import { ASSIST_GOLD_SHARE, KILL_CREDIT_WINDOW_MS } from '@/game/config/tuningDefaults';
import {
  createGame,
  indexObjects,
  stubGameGlobals,
  TEST_AVATAR_KEY,
  type TestGame,
} from '@/testing';

let game: TestGame;
let hasPlayer = false;

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
  hasPlayer = false;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Floating combat text measures its zoom against `game.player`, and the
 * fixture *throws* rather than answering undefined — so the first champion any
 * case builds becomes the player.
 */
const champion = (teamId: string): Champion => {
  const unit = new Champion({ game, teamId });
  unit.stats.maxHealth.baseValue = 1000;
  unit.stats.health.baseValue = 1000;
  unit.goldBounty = 200;
  if (!hasPlayer) {
    game.setPlayer(unit);
    hasPlayer = true;
  }
  indexObjects(game, [...game.objectManager.objects, unit]);
  return unit;
};

const minion = (teamId: string): Minion => {
  const unit = new Minion({ game, teamId, waypoints: [{ x: 0, y: 0 }] });
  unit.stats.maxHealth.baseValue = 100;
  unit.stats.health.baseValue = 100;
  indexObjects(game, [...game.objectManager.objects, unit]);
  return unit;
};

const turret = (teamId: string): Turret => {
  const unit = new Turret({ game, position: createVector(), teamId });
  indexObjects(game, [...game.objectManager.objects, unit]);
  return unit;
};

/** A camp body. `TEST_AVATAR_KEY` is core's own art — never a pack's. */
const monster = (): Monster => {
  const unit = new Monster({
    game,
    preset: {
      name: 'Wolf',
      avatar: TEST_AVATAR_KEY,
      camp: { x: 1_000, y: 1_000, r: 300 },
      speed: 2,
      size: 40,
      attackRange: 50,
      reviveTime: 100,
      health: 100,
    },
  } as ConstructorParameters<typeof Monster>[0]);
  indexObjects(game, [...game.objectManager.objects, unit]);
  return unit;
};

/** Whatever it is, it lands the blow that ends this. */
const finish = (victim: { takeDamage: Champion['takeDamage'] }, killer: unknown) =>
  victim.takeDamage(99_999, killer as never, 'TRUE');

describe('a champion executed by something that is not a champion', () => {
  it('books the kill to the enemy champion who was fighting them', () => {
    const attacker = champion('team-blue');
    const victim = champion('team-red');
    const wave = minion('team-blue');

    victim.takeDamage(400, attacker, 'MAGIC');
    game.matchTimeMs = 3_000;
    finish(victim, wave);

    expect(attacker.tally.kills, 'the minion kept a kill it cannot spend').toBe(1);
    expect(wave.tally.kills).toBe(0);
    expect(victim.tally.deaths).toBe(1);
  });

  it('pays them the whole bounty, not a share of it', () => {
    const attacker = champion('team-blue');
    const victim = champion('team-red');
    victim.goldBounty = 200;
    const wave = minion('team-blue');
    const before = attacker.wallet!.balance;

    victim.takeDamage(400, attacker, 'MAGIC');
    finish(victim, wave);

    // The bounty follows the kill. Before this it was earned by
    // `killer.wallet?.earn(...)` on a minion, which has no wallet — the gold
    // was not redirected, it was destroyed.
    expect(attacker.wallet!.balance - before).toBe(200);
  });

  it('does the same for a turret', () => {
    const attacker = champion('team-blue');
    const victim = champion('team-red');
    const tower = turret('team-blue');

    victim.takeDamage(400, attacker, 'MAGIC');
    finish(victim, tower);

    expect(attacker.tally.kills, 'diving under a tower stopped paying').toBe(1);
    expect(tower.tally.kills).toBe(0);
  });

  it('does the same for a jungle camp', () => {
    const attacker = champion('team-blue');
    const victim = champion('team-red');
    const wolf = monster();

    victim.takeDamage(400, attacker, 'MAGIC');
    finish(victim, wolf);

    expect(attacker.tally.kills).toBe(1);
  });

  it('does the same when nothing at all is named as the killer', () => {
    const attacker = champion('team-blue');
    const victim = champion('team-red');

    victim.takeDamage(400, attacker, 'MAGIC');
    // A nameless tick, a self-inflicted cost: `die` with no attacker. Whoever
    // was fighting them still killed them.
    victim.die({ attacker: undefined, reviveAfter: 0 });

    expect(attacker.tally.kills).toBe(1);
  });

  it('books it to whoever hit most recently, not to whoever hit first', () => {
    const early = champion('team-blue');
    const late = champion('team-blue');
    const victim = champion('team-red');
    const wave = minion('team-blue');

    victim.takeDamage(400, early, 'MAGIC');
    game.matchTimeMs = 2_000;
    victim.takeDamage(100, late, 'MAGIC');
    game.matchTimeMs = 3_000;
    finish(victim, wave);

    // The ledger is a `Map` and `Map` keeps *insertion* order, so the last
    // entry is the first attacker to arrive. Reading it off the end would have
    // handed this to `early`, and been right half the time by accident.
    expect(late.tally.kills).toBe(1);
    expect(early.tally.kills).toBe(0);
    expect(early.tally.assists, 'the earlier one still helped').toBe(1);
  });

  it('leaves the assists to everyone else on that side', () => {
    const attacker = champion('team-blue');
    const helper = champion('team-blue');
    const victim = champion('team-red');
    victim.goldBounty = 200;
    const wave = minion('team-blue');
    const before = helper.wallet!.balance;

    victim.takeDamage(300, helper, 'MAGIC');
    game.matchTimeMs = 1_000;
    victim.takeDamage(300, attacker, 'MAGIC');
    finish(victim, wave);

    expect(attacker.tally.kills).toBe(1);
    expect(helper.tally.assists).toBe(1);
    expect(helper.tally.kills).toBe(0);
    expect(helper.wallet!.balance - before).toBe(Math.round(200 * ASSIST_GOLD_SHARE));
  });

  it('credits the summoner when the hit that earns it came from their pet', () => {
    const owner = champion('team-blue');
    const victim = champion('team-red');
    const wave = minion('team-blue');
    const pet = new Pet({ game, ownerUnit: owner, lifeTimeMs: 10_000, teamId: 'team-blue' });
    indexObjects(game, [...game.objectManager.objects, pet]);

    victim.takeDamage(400, pet, 'MAGIC');
    finish(victim, wave);

    // Two corrections stacked: the ledger already books a pet's chip damage to
    // its owner, so the execution rule reads the owner straight out of it.
    expect(owner.tally.kills).toBe(1);
    expect(pet.tally.kills).toBe(0);
  });

  it('names the champion in the death recap headline too', () => {
    const attacker = champion('team-blue');
    attacker.name = 'Vera';
    const victim = champion('team-red');
    const tower = turret('team-blue');

    victim.takeDamage(400, attacker, 'MAGIC');
    finish(victim, tower);

    // Two screens must not disagree about one death. What actually swung is
    // still in the recap's own rows, which is the part that is a damage log.
    expect(victim.deathRecap!.killerName).toBe('Vera');
  });

  it('names the champion in the death event the kill feed reads', () => {
    const attacker = champion('team-blue');
    const victim = champion('team-red');
    const tower = turret('team-blue');
    const seen: UnitDeathEvent[] = [];
    game.eventManager.on(EventType.ON_DIE, (event: UnitDeathEvent) => seen.push(event));

    victim.takeDamage(400, attacker, 'MAGIC');
    finish(victim, tower);

    expect(seen).toHaveLength(1);
    // Two different questions, two fields: the recap names what swung, the
    // feed and the spree read `creditedTo`.
    expect(seen[0].killer, 'the turret really did land it').toBe(tower);
    expect(seen[0].creditedTo).toBe(attacker);
  });
});

describe('what the execution rule must not touch', () => {
  it('leaves farm to the last hit', () => {
    const player = champion('team-blue');
    const wave = minion('team-blue');
    const enemy = minion('team-red');
    const before = player.wallet!.balance;

    enemy.takeDamage(60, player, 'MAGIC');
    finish(enemy, wave);

    // Last-hitting is the skill the lane is made of. A champion who chips a
    // minion and lets their own wave finish it has not farmed it.
    expect(player.tally.minionsKilled).toBe(0);
    expect(player.wallet!.balance).toBe(before);
  });

  it('leaves a champion’s last hit alone, because a kill steal is a real thing', () => {
    const stealer = champion('team-blue');
    const helper = champion('team-blue');
    const victim = champion('team-red');

    victim.takeDamage(900, helper, 'MAGIC');
    game.matchTimeMs = 1_000;
    finish(victim, stealer);

    expect(stealer.tally.kills).toBe(1);
    expect(helper.tally.kills).toBe(0);
    expect(helper.tally.assists).toBe(1);
  });

  it('forgets a champion whose last hit is older than the window', () => {
    const attacker = champion('team-blue');
    const victim = champion('team-red');
    const wave = minion('team-blue');

    victim.takeDamage(400, attacker, 'MAGIC');
    game.matchTimeMs = KILL_CREDIT_WINDOW_MS + 1;
    finish(victim, wave);

    expect(attacker.tally.kills, 'a hit from a minute ago is not a kill').toBe(0);
  });

  it('leaves the kill with the last hit when the map sets the window to 0', () => {
    game.mapTuning = { economy: { killCreditWindowMs: 0 } };
    const attacker = champion('team-blue');
    const victim = champion('team-red');
    const wave = minion('team-blue');

    victim.takeDamage(400, attacker, 'MAGIC');
    finish(victim, wave);

    expect(attacker.tally.kills).toBe(0);
  });

  it('does not carry a fight into the next life', () => {
    const attacker = champion('team-blue');
    const victim = champion('team-red');
    const wave = minion('team-blue');

    victim.takeDamage(400, attacker, 'MAGIC');
    finish(victim, wave);
    victim.respawn();
    game.matchTimeMs = 4_000;
    finish(victim, wave);

    // The ledger is cleared on the death that read it. Without that, a
    // champion who respawns and walks into the same wave hands a second kill
    // to somebody who only ever fought the previous life.
    expect(attacker.tally.kills).toBe(1);
    expect(victim.tally.deaths).toBe(2);
  });
});
