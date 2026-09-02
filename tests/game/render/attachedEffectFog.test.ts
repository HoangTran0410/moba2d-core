/**
 * An effect that rides a body is hidden with that body.
 *
 * `ObjectManager.draw` applied the fog to `AttackableUnit` and to nothing
 * else. That was right while every other drawable was a projectile, a decal
 * or a burst — none of which say where anybody is. It stopped being right the
 * moment effects started riding bodies: a cloak, a shell, an eye, a victim on
 * fire.
 *
 * Reported from a real match: "đứng trong vùng tối... vẫn thấy vfx + ko thấy
 * người". The champion went dark behind a wall and its aura kept painting, so
 * the one thing fog exists to hide was drawn a hundred pixels across — worse
 * than no fog, because the player could see exactly where an enemy was and
 * not that it was a champion at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ObjectManager from '../../../src/game/managers/ObjectManager';
import SpellObject from '../../../src/game/gameObject/SpellObject';
import Champion, {
  type ChampionPresetData,
} from '../../../src/game/gameObject/attackableUnits/Champion';
import { Rectangle } from '../../../src/libs/quadtree';
import { createGame, stubGameGlobals, type TestGame } from '../fixtures';

const camera = {
  getBoundingBox: () => new Rectangle({ x: 0, y: 0, w: 4_000, h: 4_000 }),
  constantSize: (pixels: number) => pixels,
  currentScale: 1,
};

const PRESET: ChampionPresetData = {
  name: 'T',
  spells: [],
  attack: { damage: 10, attacksPerSecond: 1, range: 100 },
};

let drawn = 0;

/** A cloak: art with no life of its own, glued to whoever is wearing it. */
class Cloak extends SpellObject {
  draw(): void {
    drawn++;
  }
}

/** A projectile: in the world on its own terms, anchored to nobody. */
class Bolt extends SpellObject {
  draw(): void {
    drawn++;
  }
}

const scene = (attach: boolean) => {
  const game: TestGame = createGame();
  const wearer = new Champion({
    game,
    position: createVector(100, 100),
    teamId: 'red',
    preset: PRESET,
  });
  const effect = attach ? new Cloak(wearer).attachTo(wearer) : new Bolt(wearer);
  const manager = new ObjectManager({ mapSize: 4_000, camera } as never);
  manager.objects = [effect];
  for (const object of manager.objects) {
    manager._objectsTree.insert(object.getDisplayBoundingBox());
  }
  return { manager, wearer };
};

beforeEach(() => {
  stubGameGlobals();
  drawn = 0;
});
afterEach(() => vi.unstubAllGlobals());

describe('fog reaches the effects that ride a body', () => {
  it('draws the cloak while its wearer is visible', () => {
    const { manager, wearer } = scene(true);
    wearer.visibleToPlayerTeam = true;

    manager.draw();

    expect(drawn).toBe(1);
  });

  it('hides the cloak the moment its wearer goes dark', () => {
    const { manager, wearer } = scene(true);
    wearer.visibleToPlayerTeam = false;

    manager.draw();

    expect(drawn).toBe(0);
  });

  it('leaves an unattached effect alone, whatever anyone can see', () => {
    // The other half, and the one worth guarding: a skillshot flying through
    // fog is *meant* to be visible, and so is every ground decal and every
    // burst. Anchoring is opt-in through `attachTo`, so nothing that does not
    // ride a body pays anything or changes at all.
    const { manager, wearer } = scene(false);
    wearer.visibleToPlayerTeam = false;

    manager.draw();

    expect(drawn).toBe(1);
  });
});
