import { describe, expect, it } from 'vitest';
import { defaultMapId } from '@/content/defaultMap';

/**
 * Which world a player who has never opened the map picker lands in.
 *
 * It used to be `maps[0]` — install order — and that answered correctly only
 * by accident: the content pack was bundled and installed first, so its map
 * was index 0. Moving the pack to a runtime install flipped the order, core's
 * own `reference` pack went first, and a fresh player pressing Chơi arrived in
 * the 2400px test arena (5 terrain polygons, 3 structures) instead of the
 * 6400px map they installed a pack to get. `verify-map-picker.mjs` is what
 * caught it; nothing in the unit suite could, because install order is not a
 * thing a unit test observes.
 *
 * The fix for that was "prefer a content pack's map"; the answer now is the
 * reference pack's, and the difference is the map rather than the reasoning.
 * That 2400px arena was a navigation fixture nobody would choose to play —
 * core does not ship it any more. `reference:aram` is a real 4000px map drawn
 * in core's own editor, it is what `PregameConfig`'s `DEFAULT_MAP_ID` names,
 * and a game with two different answers to "what do we play when nobody said"
 * is the thing `content/defaultMap.ts`'s header was written against.
 *
 * Install order still decides the rest, and only the rest.
 */
const map = (id: string) => ({ id, name: id });

describe('defaultMapId', () => {
  it('prefers core’s own map over an installed pack’s', () => {
    expect(defaultMapId([map('reference:aram'), map('lol:summoners-rift')])).toBe(
      'reference:aram'
    );
  });

  it('does not depend on install order', () => {
    expect(defaultMapId([map('lol:summoners-rift'), map('reference:aram')])).toBe(
      'reference:aram'
    );
  });

  it('is the same map when it is all there is', () => {
    // The `verify-core-alone.mjs` case, and no longer a special one: the
    // answer a core-only checkout gets is the answer everybody gets.
    expect(defaultMapId([map('reference:aram')])).toBe('reference:aram');
  });

  it('keeps install order between two content packs', () => {
    // Only reachable with the reference pack absent, which `content/install.ts`
    // says cannot happen — kept because this function is a leaf that must
    // answer a list it is handed rather than a list it assumes.
    expect(defaultMapId([map('a:one'), map('b:two')])).toBe('a:one');
  });

  it('answers null for an empty catalogue rather than inventing an id', () => {
    expect(defaultMapId([])).toBeNull();
  });
});
