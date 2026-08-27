import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals, type TestGame } from '@/testing';
import Pet from '@/game/gameObject/attackableUnits/Pet';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import { setNetRole } from '@/game/net/netRole';

/**
 * `ObjectManager.addObject`'s pet gate: a LAN client's world holds no
 * locally-born pets. The summoning spell plays out in the client's sim too,
 * but the authoritative summon arrives from the host as a spawn event —
 * without the refusal every summon stood twice ("client hiện 1 pet + 1 tướng
 * không avatar, host chỉ có pet").
 */
describe('the net-client pet gate', () => {
  let game: TestGame;
  let owner: Champion;

  const pet = (): Pet =>
    new Pet({
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
  });

  afterEach(() => {
    setNetRole('off');
    vi.unstubAllGlobals();
  });

  it('refuses a pet on a net client, and only a pet', () => {
    setNetRole('client', { playerTeam: 'blue' });
    const summon = pet();
    game.objectManager.addObject(summon);
    expect(game.objectManager._objectToBeAdd).not.toContain(summon);

    // A champion (an ordinary puppet) still enters — the gate reads the pet
    // marker, not the class tree.
    game.objectManager.addObject(owner);
    expect(game.objectManager._objectToBeAdd).toContain(owner);

    // And the one pet a client does hold — the host's rebuilt summon,
    // flagged by `ClientSession` — passes.
    const puppet = pet();
    puppet.isNetPuppet = true;
    game.objectManager.addObject(puppet);
    expect(game.objectManager._objectToBeAdd).toContain(puppet);
  });

  it('changes nothing offline and on a host', () => {
    const offline = pet();
    game.objectManager.addObject(offline);
    expect(game.objectManager._objectToBeAdd).toContain(offline);

    setNetRole('host');
    const hosted = pet();
    game.objectManager.addObject(hosted);
    expect(game.objectManager._objectToBeAdd).toContain(hosted);
  });
});
