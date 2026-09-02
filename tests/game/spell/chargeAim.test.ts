import { beforeEach, describe, expect, it, vi } from 'vitest';

import Spell from '../../../src/game/gameObject/Spell';
import type AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import type { CastSpec } from '../../../src/game/spell/runtime/types';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  pressSpell,
  releaseSpell,
  type TestGame,
} from '../../../src/testing/spellWorld';

/**
 * Where a charged ability points while a **thumb** is holding it.
 *
 * `Spell.aimPoint` has a branch for the live charge preview, and it read
 * `game.worldMouse`. On a mouse that is the right answer by definition: the
 * cursor *is* where the player is pointing. On a phone it is the worst
 * possible answer — `worldMouse` is where the finger is physically pressing,
 * which for a spell being charged is the ability button in the corner of the
 * screen. So every HOLD_RELEASE ability fired at its own button and ignored
 * the drag, which is what a player reported: "nó vẫn trỏ hướng touch chứ ko
 * phải hướng chọn từ controls".
 *
 * The touch layer already publishes the drag — `TouchControls.aimFor` →
 * `host.setSlotAim` → `Game.touchAim` — and `Game.createContext` already
 * prefers it over the mouse when building the opening press. `liveAimFor` is
 * that same question asked once more, for the two moments the opening press
 * cannot answer: the frames while the charge is growing, and the release.
 *
 * The release matters and is easy to miss: `SpellRuntime.releaseCast` calls
 * `onRelease` **before** it moves the state off `CHARGING`, so a hook reading
 * `this.aimPoint` — which is how every charged spell in the shipped packs
 * aims its projectile — takes this branch too.
 */

/** The champion is at the origin; the drag points straight up the map. */
const DRAG_AIM = { x: 0, y: -430 } as const;

/**
 * A thumb resting on the W button, bottom-right of a 1280x900 screen, in the
 * world coordinates the camera puts under it. Nowhere near `DRAG_AIM`, which
 * is the entire point: if the fix regresses, the assertions land here instead.
 */
const THUMB_ON_BUTTON = { x: 1180, y: 820 } as const;

class ChargedBolt extends Spell {
  aimWhileCharging: { x: number; y: number } | null = null;
  aimAtRelease: { x: number; y: number } | null = null;

  get castSpec(): CastSpec {
    return {
      activation: 'HOLD_RELEASE',
      targeting: 'DIRECTION',
      charge: { maxDurationMs: 4000, releaseAtMax: false },
      resource: { commitAt: 'release', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: 0 },
    } as CastSpec;
  }

  onChargeUpdate() {
    this.aimWhileCharging = { x: this.aimPoint.x, y: this.aimPoint.y };
  }

  onRelease() {
    this.aimAtRelease = { x: this.aimPoint.x, y: this.aimPoint.y };
  }
}

describe('a charged spell aims where the drag points, not where the finger is', () => {
  let game: TestGame;
  let caster: AttackableUnit;

  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    game = createGame();
    caster = createUnit(game, 0);
    game.setPlayer(caster);
  });

  const withTouch = (liveAim: { x: number; y: number } | undefined) => {
    Object.assign(game, {
      worldMouse: { ...THUMB_ON_BUTTON },
      liveAimFor: () => liveAim,
    });
  };

  it('follows the drag while charging, not the button under the thumb', () => {
    withTouch({ ...DRAG_AIM });
    const spell = new ChargedBolt(caster);

    expect(pressSpell(spell, { at: { ...DRAG_AIM } })).toBe(true);
    expect(spell.state).toBe('CHARGING');

    vi.stubGlobal('deltaTime', 16);
    spell.update();

    expect(spell.aimWhileCharging).toMatchObject(DRAG_AIM);
  });

  it('releases along the drag, which is the shot the player actually sees', () => {
    withTouch({ ...DRAG_AIM });
    const spell = new ChargedBolt(caster);

    pressSpell(spell, { at: { ...DRAG_AIM } });
    releaseSpell(spell, { at: { ...DRAG_AIM } });

    expect(spell.aimAtRelease).toMatchObject(DRAG_AIM);
  });

  it('still follows the mouse when nothing is dragging — the desktop path', () => {
    // `liveAimFor` answers `undefined` for a slot no thumb is on, and on a
    // desktop there is no touch aim at all. The cursor must stay in charge
    // there, or the preview would freeze at the opening press.
    withTouch(undefined);
    const spell = new ChargedBolt(caster);

    pressSpell(spell, { at: { ...DRAG_AIM } });
    expect(spell.state).toBe('CHARGING');

    expect(spell.aimPoint).toMatchObject(THUMB_ON_BUTTON);
  });

  it('never lets a bot read the player controls', () => {
    // The owner check this branch already carries, kept honest: a bot
    // charging the same spell aims from its own cast context. Both the mouse
    // and the touch aim belong to the human.
    withTouch({ ...DRAG_AIM });
    const bot = createUnit(game, 300, 'red');
    const spell = new ChargedBolt(bot);

    pressSpell(spell, { caster: bot, at: { x: 500, y: 0 } });
    expect(spell.state).toBe('CHARGING');

    expect(spell.aimPoint).toMatchObject({ x: 500, y: 0 });
  });
});
