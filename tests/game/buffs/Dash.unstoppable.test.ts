import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import Dash from '../../../src/game/gameObject/buffs/Dash';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  type TestGame,
} from '../spell/fixtures';

/**
 * A charge that says it cannot be stopped, against the thing that was stopping
 * it.
 *
 * `cancelable = false` reads like "nothing interrupts this", and for a long
 * time it was the only word a dash had for the idea. It is narrower than it
 * looks: all it does is skip the `foreignControlBuff` check in `Dash.onUpdate`,
 * so a stun or a root landing mid-flight no longer ends the flight. It says
 * nothing at all about a *second dash*.
 *
 * And a displacement is a second dash. Every pull, knockback and throw in every
 * pack is `new Dash(...)` applied to the victim, `Dash.buffAddType` is
 * `REPLACE_EXISTING`, and `stackId` is the constructor — so the incoming pull
 * and the outgoing charge share a stack, `addBuff` deactivates the charge to
 * make room, and the charge ends without anything having asked whether it
 * could be ended. Reported from a real match: Malphite's ultimate says "Không
 * thể cản phá bởi các hiệu ứng khống chế" on the card and Temari's W drag and
 * R throw both stopped it dead.
 *
 * `unstoppable` is the word for the thing the card was promising, and this is
 * what it has to mean.
 */
describe('an unstoppable dash', () => {
  let game: TestGame;

  beforeEach(() => {
    installSketchMathGlobals();
    installSpellObjectGlobals();
    game = createGame();
  });

  /** A self-cast charge, mid-flight, of the shape Malphite R builds. */
  const charge = (unit: ReturnType<typeof createUnit>, destination: { x: number; y: number }) => {
    const dash = new Dash(3_000, unit, unit);
    dash.unstoppable = true;
    dash.dashDestination = createVector(destination.x, destination.y);
    dash.dashSpeed = 15;
    unit.addBuff(dash);
    return dash;
  };

  /** A displacement of the shape every pull and throw in the packs builds. */
  const displace = (
    victim: ReturnType<typeof createUnit>,
    by: ReturnType<typeof createUnit>,
    to: { x: number; y: number }
  ) => {
    const dash = new Dash(400, by, victim);
    dash.dashDestination = createVector(to.x, to.y);
    dash.dashSpeed = 8;
    dash.cancelable = false;
    dash.buffsToCheckCancel = [];
    victim.addBuff(dash);
    return dash;
  };

  it('survives a displacement that would have replaced it', () => {
    const malphite = createUnit(game, 0);
    const temari = createUnit(game, 400, 'red');

    const ult = charge(malphite, { x: 350, y: 0 });
    expect(malphite.buffs).toContain(ult);

    displace(malphite, temari, { x: -200, y: 0 });

    expect(ult.toRemove, 'the charge was ended by a pull it is supposed to ignore').toBe(false);
    expect(malphite.buffs).toContain(ult);
  });

  it('keeps its own destination, so the pull moves nothing', () => {
    const malphite = createUnit(game, 0);
    const temari = createUnit(game, 400, 'red');

    const ult = charge(malphite, { x: 350, y: 0 });
    displace(malphite, temari, { x: -200, y: 0 });

    // One dash in flight, and it is his: two `Dash` buffs writing `position` in
    // the same frame is the other half of the bug — whichever updated last won,
    // which is a coin toss dressed up as a mechanic.
    const dashes = malphite.buffs.filter(buff => buff instanceof Dash && !buff.toRemove);
    expect(dashes).toEqual([ult]);
    expect(ult.dashDestination?.x).toBe(350);
  });

  it('does not make a unit immune to being displaced afterwards', () => {
    const malphite = createUnit(game, 0);
    const temari = createUnit(game, 400, 'red');

    const ult = charge(malphite, { x: 350, y: 0 });
    ult.deactivateBuff();
    malphite.updateBuffs?.();

    const pull = displace(malphite, temari, { x: -200, y: 0 });
    expect(pull.toRemove, 'the immunity outlived the charge that granted it').toBe(false);
  });

  it('leaves an ordinary dash replaceable, the way every displacement expects', () => {
    const victim = createUnit(game, 0);
    const puller = createUnit(game, 400, 'red');

    const first = new Dash(3_000, victim, victim);
    first.dashDestination = createVector(350, 0);
    victim.addBuff(first);

    displace(victim, puller, { x: -200, y: 0 });

    // Nothing claimed to be unstoppable, so the newest displacement wins — the
    // behaviour every pull, knockback and throw in the packs is written against.
    expect(first.toRemove).toBe(true);
  });
});
