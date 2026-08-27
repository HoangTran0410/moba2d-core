import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '@/testing';
import Pet, { NET_PET_ADOPT_GRACE_MS } from '@/game/gameObject/attackableUnits/Pet';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import { setNetRole } from '@/game/net/netRole';

/**
 * A LAN client's pets: the summoning replay spawns the pack subclass locally
 * (its custom draw is the whole reason it is kept), `ClientSession` adopts it
 * for the host's spawn event, and `Pet.update` keeps only the clock — brain,
 * leash and expiry are host facts. A local pet the host never claims within
 * the grace was a misprediction, removed quietly with no parting gift.
 */
describe('a pet on a net client', () => {
  let game: TestGame;
  let owner: Champion;
  let expired: number;

  class PartingGift extends Pet {
    onExpire(): void {
      expired++;
    }
  }

  const pet = (): PartingGift =>
    new PartingGift({
      game,
      position: createVector(0, 0),
      teamId: 'blue',
      ownerUnit: owner,
      lifeTimeMs: 10_000,
    });

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    owner = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
    game.setPlayer(owner);
    indexObjects(game, [owner]);
    expired = 0;
  });

  afterEach(() => {
    setNetRole('off');
    vi.unstubAllGlobals();
  });

  it('removes an unclaimed local pet after the grace, without its parting gift', () => {
    setNetRole('client', { playerTeam: 'blue' });
    const ghost = pet();

    ghost.age = NET_PET_ADOPT_GRACE_MS - 100; // > one stubbed frame from the line
    ghost.update();
    expect(ghost.toRemove).toBe(false);

    ghost.age = NET_PET_ADOPT_GRACE_MS;
    ghost.update();
    expect(ghost.toRemove).toBe(true);
    // A misprediction owes nobody an explosion.
    expect(expired).toBe(0);
  });

  it('keeps an adopted puppet alive at any age, brain off', () => {
    setNetRole('client', { playerTeam: 'blue' });
    const puppet = pet();
    puppet.isNetPuppet = true;

    puppet.age = NET_PET_ADOPT_GRACE_MS * 10; // far past both grace and lifetime
    puppet.update();

    // Expiry is the host's call, arriving as 'gone' — never the local clock's.
    expect(puppet.toRemove).toBe(false);
    expect(expired).toBe(0);
  });

  it('expires normally offline, parting gift included', () => {
    const summon = pet();
    summon.age = summon.lifeTimeMs;
    summon.update();

    expect(summon.toRemove).toBe(true);
    expect(expired).toBe(1);
  });
});
