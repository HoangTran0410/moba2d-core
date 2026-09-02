import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '@/testing';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import Minion from '@/game/gameObject/attackableUnits/Minion';
import { Lane } from '@/game/lanes';
import Pet from '@/game/gameObject/attackableUnits/Pet';
import Turret from '@/game/gameObject/structures/Turret';
import { CHAMPION_BOUNTY, MINION_BOUNTY } from '@/game/economy/Wallet';
import { PASSIVE_GOLD_PER_SECOND, STARTING_GOLD } from '@/game/economy/Wallet';

/**
 * Who gets paid, and for what.
 *
 * The crediting site is `AttackableUnit.die`, beside the kill ledger it
 * already keeps, and it asks the **victim** what it is worth — `goldBounty`,
 * the same shape as `killCredit` and for the same reason. An `instanceof` at
 * the crediting site is how a `Pet` (which extends `Champion`) ends up paying
 * out a champion bounty, and this codebase has already shipped that bug once
 * on the KDA side.
 *
 * The killer answers with a wallet or with `null`, which is the other half of
 * the same idea: a minion that last-hits another minion is not banking
 * anything, and nothing at the crediting site has to know that.
 */
describe('a corpse is worth gold to whoever made it', () => {
  let game: TestGame;

  const kill = (
    victim: { takeDamage: (n: number, a: unknown, t: 'TRUE') => void },
    killer: unknown
  ) => victim.takeDamage(99_999, killer as never, 'TRUE');

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    hasPlayer = false;
  });
  afterEach(() => vi.unstubAllGlobals());

  /**
   * Floating combat text measures its zoom against `game.player`, and
   * `takeDamage` is how everything in this file dies — so the first champion
   * built in any case here becomes the player. The fixture *throws* rather
   * than answering undefined when there is none, which is why this is a flag
   * rather than a `if (!game.player)`.
   */
  let hasPlayer = false;

  const champion = (x: number, teamId: string): Champion => {
    const unit = new Champion({ game, position: createVector(x, 0), teamId });
    if (!hasPlayer) {
      game.setPlayer(unit);
      hasPlayer = true;
    }
    indexObjects(game, [unit]);
    return unit;
  };

  /** A lane minion needs a lane and a path; nothing here cares which. */
  const minion = (x: number, teamId: string): Minion => {
    const unit = new Minion({
      game,
      position: createVector(x, 0),
      teamId,
      lane: Lane.MID,
      waypoints: [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
      ],
    } as ConstructorParameters<typeof Minion>[0]);
    indexObjects(game, [unit]);
    return unit;
  };

  const petOf = (owner: Champion, teamId: string): Pet => {
    const unit = new Pet({
      game,
      position: createVector(90, 0),
      teamId,
      ownerUnit: owner,
      lifeTimeMs: 5_000,
    } as never);
    indexObjects(game, [unit]);
    return unit;
  };

  it('gives a champion a wallet, and starts it at the match’s starting gold', () => {
    expect(champion(0, 'blue').wallet?.balance).toBe(STARTING_GOLD);
  });

  it('pays a champion for a minion it finished off', () => {
    const killer = champion(0, 'blue');
    const victim = minion(50, 'red');

    const before = killer.wallet!.balance;
    kill(victim, killer);

    expect(killer.wallet!.balance).toBe(before + MINION_BOUNTY);
  });

  it('pays a great deal more for a champion', () => {
    const killer = champion(0, 'blue');
    const victim = champion(50, 'red');

    const before = killer.wallet!.balance;
    kill(victim, killer);

    expect(killer.wallet!.balance).toBe(before + CHAMPION_BOUNTY);
    expect(CHAMPION_BOUNTY).toBeGreaterThan(MINION_BOUNTY);
  });

  it('leaves the victim’s own gold alone — dying is not a fine', () => {
    const killer = champion(0, 'blue');
    const victim = champion(50, 'red');
    const before = victim.wallet!.balance;

    kill(victim, killer);

    expect(victim.wallet!.balance).toBe(before);
  });

  it('pays nothing for a pet, which is not a champion however it is declared', () => {
    // `Pet extends Champion`, so without an explicit bounty of its own every
    // decoy clone would be a 200-gold kill. The same trap `killCredit = 'none'`
    // already exists for, one field over.
    const killer = champion(0, 'blue');
    const pet = petOf(champion(70, 'red'), 'red');

    const before = killer.wallet!.balance;
    kill(pet, killer);

    expect(killer.wallet!.balance).toBe(before);
  });

  it('gives a pet no wallet of its own', () => {
    const pet = petOf(champion(0, 'blue'), 'blue');
    expect(pet.wallet).toBeNull();
  });

  it('pays the owner when their pet lands the last hit', () => {
    // A clone farming a wave is the player farming a wave. Before this, the
    // gold simply evaporated: `killer.wallet?.earn(...)` and a `Pet` whose
    // wallet is `null` on purpose, so the `?.` swallowed the whole bounty
    // and nobody — not the pet, not the owner, not the team — was paid.
    // Reported from a real match, and the hole covers every summon any
    // installed pack ships — a clone, a shadow, a box — not one champion's.
    const owner = champion(0, 'blue');
    const pet = petOf(owner, 'blue');
    const victim = minion(50, 'red');

    const before = owner.wallet!.balance;
    kill(victim, pet);

    expect(owner.wallet!.balance).toBe(before + MINION_BOUNTY);
  });

  it('still pays nobody for a turret’s last hit', () => {
    // The other half of the same rule, and it does not move: a turret has no
    // owner to walk up to, so its last hit denies the gold — which is the
    // behaviour, not an oversight.
    const bystander = champion(0, 'blue');
    const turret = new Turret({ game, position: createVector(40, 0), teamId: 'blue' });
    indexObjects(game, [turret]);
    const victim = minion(50, 'red');

    const before = bystander.wallet!.balance;
    kill(victim, turret);

    expect(bystander.wallet!.balance).toBe(before);
  });

  it('pays nobody when nobody killed it', () => {
    champion(0, 'blue');
    expect(() => kill(minion(50, 'red'), undefined)).not.toThrow();
  });

  it('does not pay a unit for killing itself', () => {
    const suicide = champion(0, 'blue');
    const before = suicide.wallet!.balance;
    kill(suicide, suicide);
    expect(suicide.wallet!.balance).toBe(before);
  });

  it('pays only once, however many times the corpse is hit again', () => {
    // `die` is reachable on a corpse — `Champion.die` runs cleanup that is safe
    // to repeat — which is exactly why the kill ledger beside this only counts
    // on the transition.
    const killer = champion(0, 'blue');
    const victim = minion(50, 'red');

    const before = killer.wallet!.balance;
    kill(victim, killer);
    victim.die({ attacker: killer, reviveAfter: 1_000 });
    victim.die({ attacker: killer, reviveAfter: 1_000 });

    expect(killer.wallet!.balance).toBe(before + MINION_BOUNTY);
  });
});

describe('passive income', () => {
  let game: TestGame;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
  });
  afterEach(() => vi.unstubAllGlobals());

  const champion = (): Champion => {
    const unit = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
    game.setPlayer(unit);
    indexObjects(game, [unit]);
    return unit;
  };

  const withPlayer = (): Champion => champion();

  it('accrues while the champion updates', () => {
    const unit = champion();
    const before = unit.wallet!.balance;
    // The fixture's `deltaTime` is 16ms; 63 frames is a little over a second.
    for (let i = 0; i < 63; i++) unit.update();
    expect(unit.wallet!.balance).toBe(before + PASSIVE_GOLD_PER_SECOND);
  });

  it('keeps paying a dead champion', () => {
    // Deliberate, and the same call League makes: income is the floor under a
    // player who is losing, and the moment it stops while they are dead it
    // stops hardest exactly when they need it.
    const unit = champion();
    unit.takeDamage(99_999, undefined, 'TRUE');
    expect(unit.isDead).toBe(true);

    const before = unit.wallet!.balance;
    for (let i = 0; i < 63; i++) unit.update();

    expect(unit.wallet!.balance).toBe(before + PASSIVE_GOLD_PER_SECOND);
  });

  it('is not banked by a minion, which has no wallet to bank it in', () => {
    withPlayer();
    const unit = new Minion({
      game,
      position: createVector(50, 0),
      teamId: 'red',
      lane: Lane.MID,
      waypoints: [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
      ],
    } as ConstructorParameters<typeof Minion>[0]);
    indexObjects(game, [unit]);
    expect(unit.wallet).toBeNull();
    expect(() => unit.update()).not.toThrow();
  });
});

/**
 * Seeing the money.
 *
 * A kill paid a bounty into a wallet and nothing on screen said so — the
 * balance simply jumped, and a player watching a wave die had no way to tell a
 * last hit from a missed one at the moment it happened. That is the whole
 * skill a last hit *is*.
 *
 * It floats over the **earner**, not the victim, which is the opposite of
 * every other combat text: damage and heals describe what happened to the unit
 * they sit above, and gold describes what someone else got out of it.
 */
describe('the gold a kill pays is shown', () => {
  let game: TestGame;
  let hasPlayer = false;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    hasPlayer = false;
  });
  afterEach(() => vi.unstubAllGlobals());

  const champion = (x: number, teamId: string): Champion => {
    const unit = new Champion({ game, position: createVector(x, 0), teamId });
    if (!hasPlayer) {
      game.setPlayer(unit);
      hasPlayer = true;
    }
    indexObjects(game, [unit]);
    return unit;
  };

  const goldTexts = () =>
    [...game.objectManager.objects, ...game.objectManager._objectToBeAdd].filter(
      (object: any) => object?.constructor?.name === 'CombatText' && object.text?.startsWith('+')
    ) as any[];

  it('floats over the killer, not the corpse', () => {
    const killer = champion(0, 'blue');
    const victim = champion(50, 'red');

    victim.takeDamage(99_999, killer, 'TRUE');

    const texts = goldTexts().filter(t => t.owner === killer);
    expect(texts, 'nothing said where the gold went').toHaveLength(1);
    expect(texts[0].amount).toBe(CHAMPION_BOUNTY);
    expect(goldTexts().filter(t => t.owner === victim)).toHaveLength(0);
  });

  it('says nothing when nothing was earned', () => {
    // A pet is worth 0, and "+0" over someone's head is a number that means
    // "you got nothing" while looking exactly like a reward.
    const killer = champion(0, 'blue');
    const pet = new Pet({
      game,
      position: createVector(90, 0),
      teamId: 'red',
      ownerUnit: champion(70, 'red'),
      lifeTimeMs: 5_000,
    } as never);
    indexObjects(game, [pet]);

    pet.takeDamage(99_999, killer, 'TRUE');

    expect(goldTexts().filter(t => t.owner === killer)).toHaveLength(0);
  });

  it('keeps its own colour, so it never reads as a heal', () => {
    // Green already means "you got health back" on exactly this unit, in
    // exactly this place on screen.
    const killer = champion(0, 'blue');
    champion(50, 'red').takeDamage(99_999, killer, 'TRUE');

    const text = goldTexts().find(t => t.owner === killer)!;
    const distanceFromHealGreen = Math.hypot(
      ...(text.textColor as number[]).map((channel: number, i: number) => channel - [0, 255, 0][i])
    );
    expect(distanceFromHealGreen).toBeGreaterThan(120);
  });
})
