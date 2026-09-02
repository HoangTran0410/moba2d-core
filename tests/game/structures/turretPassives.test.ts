import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TURRET_PRESET, Minion, TeamId, Turret, indexObjects } from '@/testing';
import {
  createGame,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  type TestGame,
} from '@/testing/spellWorld';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import Invisible from '@/game/gameObject/buffs/Invisible';
import {
  coreTurretPassives,
  turretPassivesFor,
  REINFORCED_ARMOR_TAKEN,
  REINFORCED_REARM_MS,
  TURRET_ARMOR_PENETRATION,
  WARMING_UP_MAX_STACKS,
  WARMING_UP_PER_STACK,
  WARMING_UP_RESET_MS,
} from '@/game/gameObject/structures/turretPassives';

/**
 * **What a tower is built carrying.**
 *
 * Three named passives, written as real buffs on the turret rather than
 * branches inside `Turret` — which is the whole point of the `TurretPassive`
 * seam. What is asserted here is that each of them is plugged into a real
 * engine seam, because that is exactly the claim that goes on reading true in a
 * file's prose long after it has stopped being true in its code: a ramp that
 * raised a field nothing reads still looks like a ramp.
 *
 * They shipped in a content pack first, and came into core unedited — the
 * cases below moved with them, which is the honest way to say the move was a
 * move. What changed is only who answers when no pack has an
 * opinion, and the last `describe` below is that half.
 */

let game: TestGame;

const turret = (teamId = TeamId.BLUE, x = 0) =>
  new Turret({
    game: game as never,
    position: createVector(x, 0),
    teamId,
    preset: { ...DEFAULT_TURRET_PRESET, passives: coreTurretPassives() },
  } as never);

const champion = (teamId: string, x = 60) =>
  new Champion({ game, teamId, position: createVector(x, 0) } as never);

/**
 * A lane written out here rather than read from `getLaneWaypoints`: lanes come
 * from the *active map*, and a checkout with no map linked answers with an
 * empty list, which `Minion` then reads `.length` off.
 */
const LANE = [
  { x: 300, y: 300 },
  { x: 900, y: 900 },
];

const minion = (teamId: string, x: number) =>
  new Minion({
    game: game as never,
    teamId,
    position: createVector(x, 0),
    lane: 'mid',
    waypoints: LANE.map(point => ({ ...point })),
  } as never);

/** Frames, at the stubbed 16ms. */
const tick = (unit: { update(): void }, frames = 1) => {
  for (let frame = 0; frame < frames; frame++) unit.update();
};

beforeEach(() => {
  installSpellObjectGlobals();
  installSketchMathGlobals();
  vi.stubGlobal('deltaTime', 16);
  game = createGame() as TestGame;
  // `AttackableUnit.isAllied` asks the world who the player is, and the fixture
  // throws rather than answering `undefined`.
  game.setPlayer(new Champion({ game, teamId: 'player-uuid' } as never) as never);
});
// Braces: the arrow would otherwise *return* `VitestUtils`, which only the
// strict typecheck program refuses — green in `npm test`, red in `verify`.
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the armour-pierce ramp', () => {
  it('pierces armour, which core reads off the attacker’s own stat', () => {
    const tower = turret();
    tower.update();
    expect(tower.stats.armorPenetration.value).toBeCloseTo(TURRET_ARMOR_PENETRATION, 6);
  });

  /**
   * The ramp goes through `stats.attackDamage`, which is what a shot actually
   * reads. A passive that tracked its own multiplier and never touched the stat
   * would ramp nothing at all.
   */
  it('gets angrier with every champion it hits, up to the ceiling', () => {
    const tower = turret();
    const diver = champion('solo');
    indexObjects(game as never, [tower, diver] as never);
    tower.update();
    const base = tower.damage;

    for (let hit = 1; hit <= WARMING_UP_MAX_STACKS + 2; hit++) {
      diver.takeDamage(1, tower as never, 'PHYSICAL');
      tower.update();
    }

    expect(tower.damage).toBeCloseTo(base * (1 + WARMING_UP_PER_STACK * WARMING_UP_MAX_STACKS), 4);
  });

  it('does not warm up on the wave it is shooting all day', () => {
    const tower = turret();
    const wave = minion('solo', 200);
    indexObjects(game as never, [tower, wave] as never);
    tower.update();
    const base = tower.damage;

    for (let hit = 0; hit < 6; hit++) {
      wave.takeDamage(1, tower as never, 'PHYSICAL');
      tower.update();
    }

    expect(tower.damage).toBeCloseTo(base, 6);
  });

  it('cools all the way down, rather than stepping down', () => {
    const tower = turret();
    const diver = champion('solo');
    indexObjects(game as never, [tower, diver] as never);
    tower.update();
    const base = tower.damage;

    diver.takeDamage(1, tower as never, 'PHYSICAL');
    tower.update();
    expect(tower.damage).toBeGreaterThan(base);

    vi.stubGlobal('deltaTime', 100);
    tick(tower, Math.ceil(WARMING_UP_RESET_MS / 100) + 2);

    expect(tower.damage).toBeCloseTo(base, 4);
  });
});

describe('the empty-lane damage floor', () => {
  it('is a wall when the lane is empty', () => {
    const tower = turret();
    indexObjects(game as never, [tower] as never);
    tower.update();

    const before = tower.stats.health.value;
    tower.takeDamage(100, undefined, 'PHYSICAL');

    expect(before - tower.stats.health.value).toBeCloseTo(100 * REINFORCED_ARMOR_TAKEN, 0);
  });

  it('is not a wall while an enemy wave is standing under it', () => {
    const tower = turret();
    const wave = minion('solo', 120);
    indexObjects(game as never, [tower, wave] as never);
    tower.update();

    const before = tower.stats.health.value;
    tower.takeDamage(100, undefined, 'PHYSICAL');

    expect(before - tower.stats.health.value).toBeCloseTo(100, 0);
  });

  /** The delay on the way back is what makes shoving a wave in worth doing. */
  it('does not snap back the instant the last minion dies', () => {
    const tower = turret();
    const wave = minion('solo', 120);
    indexObjects(game as never, [tower, wave] as never);
    tower.update();

    wave.toRemove = true;
    indexObjects(game as never, [tower] as never);
    tower.update();

    const stillOpen = tower.stats.health.value;
    tower.takeDamage(100, undefined, 'PHYSICAL');
    expect(stillOpen - tower.stats.health.value).toBeCloseTo(100, 0);

    vi.stubGlobal('deltaTime', 100);
    tick(tower, Math.ceil(REINFORCED_REARM_MS / 100) + 2);

    const rearmed = tower.stats.health.value;
    tower.takeDamage(100, undefined, 'PHYSICAL');
    expect(rearmed - tower.stats.health.value).toBeCloseTo(100 * REINFORCED_ARMOR_TAKEN, 0);
  });
});

/**
 * What a tower says about itself.
 *
 * Both of these passives shipped invisible — `hudVisible = false`, and a turret
 * has no buff bar to be visible on anyway. A tower currently taking 20% damage
 * looked exactly like one that is not, and the ramp that makes standing under
 * it progressively lethal had no tell at all. `Buff.structureMark` is what a
 * building draws instead; these pin the *states*, since the whole value is the
 * difference between a lit pip and an unlit one.
 */
describe('what a tower shows about its own passives', () => {
  const marksOn = (tower: ReturnType<typeof turret>) =>
    tower.buffs.filter(buff => !buff.toRemove).map(buff => buff.structureMark).filter(Boolean);

  it('shows nothing while the ramp is cold', () => {
    const tower = turret();
    indexObjects(game as never, [tower] as never);
    tower.update();

    const ramp = tower.buffs.find(buff => buff.name === 'Nòng Nóng Dần');
    expect(ramp, 'the ramp is not on this tower at all').toBeDefined();
    expect(ramp!.structureMark).toBeNull();
  });

  it('lights one pip per stack, and says how many there could be', () => {
    const tower = turret();
    const diver = champion('solo');
    indexObjects(game as never, [tower, diver] as never);
    tower.update();

    diver.takeDamage(1, tower as never, 'PHYSICAL');
    tower.update();
    const ramp = tower.buffs.find(buff => buff.name === 'Nòng Nóng Dần')!;

    expect(ramp.structureMark).toEqual({
      filled: 1,
      total: WARMING_UP_MAX_STACKS,
      color: expect.anything(),
    });
  });

  it('goes dark again when the tower cools', () => {
    const tower = turret();
    const diver = champion('solo');
    indexObjects(game as never, [tower, diver] as never);
    tower.update();
    diver.takeDamage(1, tower as never, 'PHYSICAL');
    tower.update();

    vi.stubGlobal('deltaTime', 100);
    tick(tower, Math.ceil(WARMING_UP_RESET_MS / 100) + 2);

    const ramp = tower.buffs.find(buff => buff.name === 'Nòng Nóng Dần')!;
    expect(ramp.structureMark).toBeNull();
  });

  it('shows the armour floor exactly while the floor is up', () => {
    // The same predicate `modifyIncomingDamage` spends against, so the picture
    // cannot claim a wall that is not there.
    const tower = turret();
    indexObjects(game as never, [tower] as never);
    tower.update();
    const armour = tower.buffs.find(buff => buff.name === 'Giáp Cường Hóa')!;
    expect(armour.structureMark).not.toBeNull();

    const wave = minion('solo', 120);
    indexObjects(game as never, [tower, wave] as never);
    tower.update();

    expect(armour.structureMark, 'a wave is standing under it').toBeNull();
  });

  it('says nothing at all for a passive that is simply always on', () => {
    // The ward. A mark that is never absent teaches nothing after the first
    // glance, and this row is only worth reading because things go out.
    const tower = turret();
    indexObjects(game as never, [tower] as never);
    tower.update();

    const eye = tower.buffs.find(buff => buff.name === 'Mắt Thần Canh Gác')!;
    expect(eye.structureMark).toBeNull();
    // And the row a cold, undived tower draws is exactly one pip group: the
    // armour floor, which is up because the lane is empty.
    expect(marksOn(tower)).toHaveLength(1);
  });
});

describe('the tower’s own true sight', () => {
  it('reveals an enemy hiding inside the lane it watches', () => {
    const tower = turret();
    const sneak = champion('solo', 200);
    // A real stealth buff: `isStealthed` is a getter over the status flags, so
    // assigning it would prove nothing about what the eye actually looks for.
    sneak.addBuff(new Invisible(5_000, sneak, sneak));
    indexObjects(game as never, [tower, sneak] as never);

    vi.stubGlobal('deltaTime', 300); // past one sweep
    sneak.update(); // the stealth buff has to be live before the sweep looks
    tower.update();

    expect(sneak.buffs.some(buff => buff.name === 'Lộ Diện')).toBe(true);
  });

  /**
   * The ring is the tower's own reach, deliberately — the wiki's is wider
   * (1100 against 775). This body sits outside the guns and *inside* that
   * wider ring, so it is the one case where the two radii disagree, and the
   * only thing that keeps `WARDENS_EYE_RATIO` at 1 rather than drifting back
   * to a copied wiki number.
   */
  it('does not light up a body it cannot shoot', () => {
    const tower = turret();
    const outside = Math.round(tower.attackRange + 40);
    expect(outside, 'the case is vacuous unless the wiki ring would have covered it').toBeLessThan(
      tower.attackRange * (1100 / 775)
    );

    const sneak = champion('solo', outside);
    sneak.addBuff(new Invisible(5_000, sneak, sneak));
    indexObjects(game as never, [tower, sneak] as never);

    vi.stubGlobal('deltaTime', 300);
    sneak.update();
    tower.update();

    expect(sneak.buffs.some(buff => buff.name === 'Lộ Diện')).toBe(false);
  });

  it('leaves an ally alone', () => {
    const tower = turret();
    const friend = champion(TeamId.BLUE, 200);
    friend.addBuff(new Invisible(5_000, friend, friend));
    indexObjects(game as never, [tower, friend] as never);

    vi.stubGlobal('deltaTime', 300);
    friend.update();
    tower.update();

    expect(friend.buffs.some(buff => buff.name === 'Lộ Diện')).toBe(false);
  });
});

/**
 * Who answers when. The list itself is above; this is the one line that decides
 * whether a map's towers get it.
 *
 * It lives in `turretPassivesFor` rather than inside `Game.spawnStructures`
 * for `neutralSlotFill`'s reason: nothing in this codebase constructs a real
 * `Game`, so a rule written inside that loop is a rule no test can reach.
 */
describe('whose list a tower is built with', () => {
  it('is core’s when no installed pack declares any', () => {
    expect(turretPassivesFor([]).map(passive => passive.name)).toEqual(
      coreTurretPassives().map(passive => passive.name)
    );
  });

  it('is the pack’s, in place of core’s, the moment one declares a list', () => {
    const mine = [{ name: 'plain', onSpawn: () => {} }];

    // Replaces, never appends: a pack with a different idea of a tower wants
    // *its* tower, and two half-towers stacked is not a third opinion.
    expect(turretPassivesFor(mine)).toEqual(mine);
    expect(turretPassivesFor(mine)).toHaveLength(1);
  });
});
