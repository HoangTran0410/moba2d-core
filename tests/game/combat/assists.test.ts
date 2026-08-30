/**
 * Who else had a hand in it.
 *
 * The scoreboard knew kills, deaths and farm, and nothing about the shape of a
 * team fight: a support who spent every cooldown setting up a kill finished the
 * match indistinguishable from one who stood at the fountain. There was no
 * assist because there was no record of *participation* — `recentAttacker`
 * remembered one attacker for 1.5 seconds (a turret's aggro rule) and
 * `recentDamageLog` remembered names for a death recap, capped at a number of
 * entries that silently drops the earliest body in a long fight.
 *
 * So the ledger is a third thing, and these are the decisions it encodes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Minion from '../../../src/game/gameObject/attackableUnits/Minion';
import Pet from '../../../src/game/gameObject/attackableUnits/Pet';
import Turret from '../../../src/game/gameObject/structures/Turret';
import Shield from '../../../src/game/gameObject/buffs/Shield';
import { ASSIST_GOLD_SHARE, ASSIST_WINDOW_MS } from '../../../src/game/config/tuningDefaults';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

let game: TestGame;

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const champion = (teamId: string): Champion => {
  const unit = new Champion({ game, teamId });
  unit.stats.maxHealth.baseValue = 1000;
  unit.stats.health.baseValue = 1000;
  return unit;
};

/** Two on blue, one on red, all indexed and all with wallets. */
const skirmish = () => {
  const killer = champion('team-blue');
  const helper = champion('team-blue');
  const victim = champion('team-red');
  game.setPlayer(killer);
  indexObjects(game, [killer, helper, victim]);
  return { killer, helper, victim };
};

const finish = (victim: Champion, killer: Champion): void => {
  victim.takeDamage(victim.stats.health.value + 500, killer, 'PHYSICAL');
};

describe('an assist', () => {
  it('credits everyone on the killer’s side who hurt the victim in the window', () => {
    const { killer, helper, victim } = skirmish();

    helper.takeDamage(0, victim); // noise: the helper being hit is not participation
    victim.takeDamage(30, helper, 'MAGIC');
    finish(victim, killer);

    expect(helper.tally.assists, 'the helper was not credited').toBe(1);
    expect(killer.tally.kills).toBe(1);
    expect(killer.tally.assists, 'the killer assisted their own kill').toBe(0);
  });

  it('pays the helper a share of the bounty on top of what the killer got', () => {
    const { killer, helper, victim } = skirmish();
    victim.goldBounty = 200;
    const killerBefore = killer.wallet!.balance;
    const helperBefore = helper.wallet!.balance;

    victim.takeDamage(30, helper);
    finish(victim, killer);

    // Added, not carved out: the killer's own purse is untouched by the fact
    // that somebody helped. See `ASSIST_GOLD_SHARE`.
    expect(killer.wallet!.balance - killerBefore).toBe(200);
    expect(helper.wallet!.balance - helperBefore).toBe(200 * ASSIST_GOLD_SHARE);
  });

  it('forgets a participant once the window has passed', () => {
    const { killer, helper, victim } = skirmish();

    victim.takeDamage(30, helper);
    game.matchTimeMs = ASSIST_WINDOW_MS + 1;
    finish(victim, killer);

    expect(helper.tally.assists).toBe(0);
  });

  it('counts a hit a shield swallowed whole', () => {
    const { killer, helper, victim } = skirmish();
    const shield = new Shield(10_000, victim, victim);
    shield.amount = 500;
    victim.addBuff(shield);

    victim.takeDamage(40, helper);
    finish(victim, killer);

    // Spending an ability on somebody is participation whether or not a bubble
    // was up at the time — the same rule the turret's ally-protection aggro
    // already follows a few lines above in `takeDamage`.
    expect(helper.tally.assists).toBe(1);
  });

  it('does not credit the other side of a three-way fight', () => {
    const { killer, victim } = skirmish();
    const thirdParty = champion('team-green');
    indexObjects(game, [thirdParty]);

    victim.takeDamage(30, thirdParty);
    finish(victim, killer);

    expect(thirdParty.tally.assists, 'credit for a kill is a team fact').toBe(0);
  });

  it('still credits a helper who died in the fight', () => {
    const { killer, helper, victim } = skirmish();

    victim.takeDamage(30, helper);
    helper.die({ attacker: victim, reviveAfter: 0 });
    finish(victim, killer);

    // They committed and lost, which is not nothing. The gold sits in a wallet
    // that outlives the corpse.
    expect(helper.tally.assists).toBe(1);
  });

  it('does not pay twice when die() runs again on the corpse', () => {
    const { killer, helper, victim } = skirmish();

    victim.takeDamage(30, helper);
    finish(victim, killer);
    victim.die({ attacker: killer, reviveAfter: 0 });

    expect(helper.tally.assists).toBe(1);
  });
});

describe('what an assist is awarded for', () => {
  it('a turret, even though nobody’s kill count moves for one', () => {
    const killer = champion('team-blue');
    const helper = champion('team-blue');
    const turret = new Turret({ game, position: createVector(), teamId: 'team-red' });
    turret.stats.maxHealth.baseValue = 400;
    turret.stats.health.baseValue = 400;
    turret.goldBounty = 150;
    game.setPlayer(killer);
    indexObjects(game, [killer, helper, turret]);

    turret.takeDamage(50, helper);
    turret.takeDamage(1000, killer);

    expect(helper.tally.assists, '"who helped take that tower" is a real question').toBe(1);
    expect(killer.tally.kills, 'a turret paid out as a champion kill').toBe(0);
  });

  it('not a minion, which is farm rather than a fight', () => {
    const killer = champion('team-blue');
    const helper = champion('team-blue');
    const minion = new Minion({ game, teamId: 'team-red', waypoints: [{ x: 0, y: 0 }] });
    minion.stats.maxHealth.baseValue = 100;
    minion.stats.health.baseValue = 100;
    game.setPlayer(killer);
    indexObjects(game, [killer, helper, minion]);

    minion.takeDamage(20, helper);
    minion.takeDamage(500, killer);

    expect(helper.tally.assists).toBe(0);
  });

  it('not a pet, which is a Champion only by inheritance', () => {
    const killer = champion('team-blue');
    const helper = champion('team-blue');
    const owner = champion('team-red');
    const pet = new Pet({ game, ownerUnit: owner, lifeTimeMs: 10_000, teamId: 'team-red' });
    pet.stats.maxHealth.baseValue = 100;
    pet.stats.health.baseValue = 100;
    game.setPlayer(killer);
    indexObjects(game, [killer, helper, owner, pet]);

    pet.takeDamage(20, helper);
    pet.takeDamage(500, killer);

    // The same trap `killCredit` documents: `Pet extends Champion`, so
    // anything the base turns on the pet has to turn off again.
    expect(helper.tally.assists).toBe(0);
  });
});
