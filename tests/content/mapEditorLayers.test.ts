import { describe, expect, it } from 'vitest';
import { E, KIND, TYPES, normalizeTerrain, pickTerrain } from '@/mapEditor/state';

/**
 * Every object kind the editor can draw has to be visible, pickable and
 * paintable the moment it exists.
 *
 * `E.visible` gates three separate things — `pickTerrain` (click), `pickInRect`
 * (marquee) and both of `render.ts`'s draw loops — and it gated them through a
 * hand-written object literal listing eight of the nine kinds. `decor` shipped
 * without its line, and `undefined` is falsy, so a decor slot was invisible and
 * unclickable from the first frame. It read as the editor *deleting* it: the
 * one circle a user saw was the selection overlay, and clicking anywhere else
 * dropped the selection and with it the only thing still being drawn.
 *
 * The literal is derived from `KIND` now. This holds that, because the next
 * kind will be added by somebody who has never read this file.
 */

describe('every editor kind is a layer', () => {
  it('has a visibility default, so it can be clicked and drawn', () => {
    for (const kind of TYPES) {
      expect(E.visible[kind], `${kind} has no entry in E.visible`).toBe(true);
    }
  });

  it('covers exactly the kinds that exist — no stale entries either', () => {
    expect(Object.keys(E.visible).sort()).toEqual([...TYPES].sort());
    expect(TYPES.sort()).toEqual(Object.keys(KIND).sort());
  });

  /**
   * The end of it: a marker of each kind, dropped on the canvas, is found by
   * the same lookup a mouse click runs. `decor` failed this and nothing else
   * in the suite noticed.
   */
  it('and a marker of any kind is found under the cursor', () => {
    const at = { x: 2_000, y: 2_000 };
    for (const kind of TYPES) {
      if (KIND[kind].shape === 'poly' || KIND[kind].shape === 'line') continue;
      E.terrains = [normalizeTerrain({ type: kind, position: [at.x, at.y] })];
      expect(pickTerrain(at.x, at.y), `${kind} is not clickable`).toBe(E.terrains[0]);
    }
    E.terrains = [];
  });
});
