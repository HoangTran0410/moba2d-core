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
 * `reference` is core's fallback map, not core's opinion about what to play.
 * It wins only when it is the whole of what is installed — which is exactly
 * the `verify-core-alone.mjs` case, where it has to.
 */
const map = (id: string) => ({ id, name: id });

describe('defaultMapId', () => {
  it('prefers a content pack’s map over core’s reference arena', () => {
    expect(defaultMapId([map('reference:proving-grounds'), map('lol:summoners-rift')])).toBe(
      'lol:summoners-rift'
    );
  });

  it('does not depend on install order', () => {
    expect(defaultMapId([map('lol:summoners-rift'), map('reference:proving-grounds')])).toBe(
      'lol:summoners-rift'
    );
  });

  it('falls back to the reference arena when it is all there is', () => {
    expect(defaultMapId([map('reference:proving-grounds')])).toBe('reference:proving-grounds');
  });

  it('keeps install order between two content packs', () => {
    expect(defaultMapId([map('a:one'), map('b:two')])).toBe('a:one');
  });

  it('answers null for an empty catalogue rather than inventing an id', () => {
    expect(defaultMapId([])).toBeNull();
  });
});
