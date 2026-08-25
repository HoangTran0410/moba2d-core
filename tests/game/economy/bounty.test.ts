import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '@/testing';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import Minion from '@/game/gameObject/attackableUnits/Minion';
import { Lane } from '@/game/lanes';
import Pet from '@/game/gameObject/attackableUnits/Pet';
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
