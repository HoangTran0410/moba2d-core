import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AreaSpellObject from '../../../src/game/gameObject/spellObjects/AreaSpellObject';
import { createGame, createUnit, installSpellObjectGlobals } from './fixtures';

describe('AreaSpellObject', () => {
  beforeEach(installSpellObjectGlobals);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fires area enter tick and exit callbacks in order', () => {
    const game = createGame();
    const owner = createUnit(game);
    const target = createUnit(game, 5, 'red');
    const events: string[] = [];
    const area = new AreaSpellObject(owner, { x: 0, y: 0 }, 10, {
      candidates: () => [target],
      tickEveryMs: 100,
      onEnter: () => events.push('enter'),
      onTick: () => events.push('tick'),
      onExit: () => events.push('exit'),
    });

    area.update(50);
    area.update(50);
    target.position.x = 100;
    area.update(1);

    expect(events).toEqual(['enter', 'tick', 'exit']);
  });

  it('stands where its centre is, not where its caster was', () => {
    // `SpellObject` seeds `position` from the owner and this class answers
    // every geometric question from `center`, so the two used to disagree for
    // anything reading the zone from outside. `FogOfWar` is that outside:
    // it builds its revealer list off `obj.position`, so a lit zone — a ward,
    // a shrine — was painted around whoever made it instead of around itself.
    const game = createGame();
    const owner = createUnit(game);
    owner.position.set(900, -400);

    const area = new AreaSpellObject(owner, { x: 120, y: 60 }, 10, { candidates: () => [] });

    expect(area.position.x).toBe(120);
    expect(area.position.y).toBe(60);
  });

  it('and follows a centre that moves, because a caller may pass a live one', () => {
    const game = createGame();
    const owner = createUnit(game);
    const centre = { x: 0, y: 0 };
    const area = new AreaSpellObject(owner, centre, 10, { candidates: () => [] });

    centre.x = 350;
    centre.y = -75;
    area.update(16);

    expect(area.position.x).toBe(350);
    expect(area.position.y).toBe(-75);
  });

  it('grows an area radius over its configured duration', () => {
    const game = createGame();
    const area = new AreaSpellObject(createUnit(game), { x: 10, y: 20 }, 10, {
      candidates: () => [],
      radiusAt: elapsedMs => 10 + elapsedMs / 100,
    });

    area.update(500);

    expect(area.radius).toBe(15);
    expect(area.center).toEqual({ x: 10, y: 20 });
  });

  it('caps growth and ticks at the remaining duration on a long frame', () => {
    const game = createGame();
    const owner = createUnit(game);
    const target = createUnit(game, 0, 'red');
    target.stats.size.baseValue = 0;
    const onTick = vi.fn();
    const radiusAt = vi.fn((elapsedMs: number) => elapsedMs / 10);
    const area = new AreaSpellObject(owner, { x: 0, y: 0 }, 0, {
      candidates: () => [target],
      durationMs: 250,
      tickEveryMs: 100,
      radiusAt,
      onTick,
    });

    area.update(1_000);

    expect(area.elapsedMs).toBe(250);
    expect(area.radius).toBe(25);
    expect(radiusAt).toHaveBeenLastCalledWith(250);
    expect(onTick).toHaveBeenCalledTimes(2);
    expect(area.toRemove).toBe(true);
  });

  it.each([
    ['tickEveryMs', { tickEveryMs: Number.NaN }],
    ['tickEveryMs', { tickEveryMs: Number.POSITIVE_INFINITY }],
    ['durationMs', { durationMs: Number.NaN }],
    ['durationMs', { durationMs: Number.POSITIVE_INFINITY }],
  ])('rejects a non-finite %s', (_field, options) => {
    const game = createGame();
    expect(() => new AreaSpellObject(createUnit(game), { x: 0, y: 0 }, 10, options)).toThrow(
      `${_field} must be finite and greater than 0`
    );
  });
});
