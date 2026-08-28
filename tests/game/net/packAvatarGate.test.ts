import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '@/testing';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import { presetFromPlan } from '@/game/preset';
import { asKitPlan } from '@/game/net/kitWire';

/**
 * A kit whose portrait belongs to a pack *this* machine has not installed.
 *
 * Packs are installed per player, not per match, so a LAN host and its client
 * routinely hold different content — that is the whole point of installing one
 * at runtime. The kit still crosses the wire as plain data (`kitWire.ts`), and
 * `avatar` is a bare asset key: `'lol:champ_jhin'` from a client that has the
 * pack, arriving at a host that does not.
 *
 * `asKitPlan`'s own header already states the tolerance the rest of the plan
 * gets — *"Ids are only checked to be strings, not to exist"*, because
 * `loadSpells` and `classForId` both fall back rather than fail. The avatar
 * was the one field that never got it: it goes straight to
 * `AssetManager.get`, which throws `Unknown asset key "…"` for a pack it has
 * never heard of, and the host's whole match goes down because a *client*
 * pressed đổi tướng.
 *
 * The fix is not to reject the kit — the client is entitled to its own
 * champion, and the host cannot play a match it just refused half of. It is
 * to draw the portrait the host *can* draw: `AssetManager.placeholder` already
 * renders initials on a colour, which is what every not-yet-loaded portrait in
 * the game shows anyway.
 */
describe('a kit whose portrait names a pack this machine does not have', () => {
  let game: TestGame;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Exactly what `HostSession.onKitChanged` hands `Champion.applyPreset`. */
  const jhinFromAPackWeLack = () =>
    presetFromPlan(
      asKitPlan({
        name: 'Jhin',
        avatar: 'lol:champ_jhin',
        attack: { damage: 60, range: 550, speed: 0.7 },
        defence: { armor: 30, magicResist: 30, health: 640 },
        spellIds: ['BasicAttack'],
      })!
    );

  it('applies to a live champion instead of taking the match down', () => {
    const champion = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
    game.setPlayer(champion);
    indexObjects(game, [champion]);

    expect(() => champion.applyPreset(jhinFromAPackWeLack())).not.toThrow();
    expect(champion.name).toBe('Jhin');
  });

  it('still leaves something to draw, rather than no portrait at all', () => {
    const champion = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
    game.setPlayer(champion);
    indexObjects(game, [champion]);
    champion.applyPreset(jhinFromAPackWeLack());

    expect(champion.avatar, 'a champion with no handle draws nothing at all').toBeTruthy();
  });

  it('builds a champion from one at spawn, the path a joining client takes', () => {
    expect(
      () =>
        new Champion({
          game,
          position: createVector(0, 0),
          teamId: 'blue',
          preset: jhinFromAPackWeLack(),
        })
    ).not.toThrow();
  });
});
