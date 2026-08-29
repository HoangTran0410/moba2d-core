/**
 * Temperament, roam region and ephemeral bodies — the three seams a camp
 * needs before it can be anything other than "sits still, fights whatever
 * hit it, respawns".
 *
 * Every case here has an `aggressive` twin asserting the old behaviour is
 * untouched, because all three fields are optional and the whole promise of
 * that is that a pack written before them plays identically. A test suite
 * that only covers the new values would pass just as happily if the default
 * had silently moved.
 *
 * Deliberately free of any `packs/` import: `CampAggro.test.ts` beside this
 * reaches `packs/riot/maps/...` and is excluded from a core-alone checkout
 * for that reason (`scripts/pack-dependent-tests.mjs`). Nothing here needs a
 * real map, so nothing here borrows that exclusion.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Monster, {
  MONSTER_GIVE_UP_DELAY_MS,
  type MonsterPresetData,
} from '../../../src/game/gameObject/attackableUnits/Monster';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import TerrainType from '../../../src/game/enums/TerrainType';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

const CAMP = { x: 1_000, y: 1_000, r: 300 };

let game: TestGame;

const makeCamp = (overrides: Partial<MonsterPresetData> = {}) =>
  new Monster({
    game,
    preset: {
      name: 'Camp',
      avatar: null,
      camp: { ...CAMP },
      speed: 2,
      size: 40,
      attackRange: 50,
      reviveTime: 100,
      health: 100,
      aggroRange: 200,
      ...overrides,
    },
  });

/** A champion standing `distance` to the right of the camp point. */
const championAt = (distance: number) => {
  const champion = new Champion({ game, teamId: 'other' });
  champion.position.set(CAMP.x + distance, CAMP.y);
  return champion;
};

const gap = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
  game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
});
afterEach(() => vi.unstubAllGlobals());

describe('temperament', () => {
  it('aggressive is the default and still fights back when hit', () => {
    const camp = makeCamp();
    const champion = championAt(60);
    indexObjects(game, [camp, champion]);

    expect(camp.temperament).toBe('aggressive');
    camp.takeDamage(5, champion);

    expect(camp.phase).toBe(Monster.PHASES.ATTACK);
    expect(camp.targetLock).toBe(champion);
  });

  it('passive takes the hit and does nothing about it', () => {
    const camp = makeCamp({ temperament: 'passive' });
    const champion = championAt(60);
    indexObjects(game, [camp, champion]);

    camp.takeDamage(5, champion);

    expect(camp.phase).toBe(Monster.PHASES.IDLE);
    expect(camp.targetLock).toBeNull();
    // The damage still landed — passive is "will not fight", not "immune".
    expect(camp.stats.health.value).toBeLessThan(camp.stats.maxHealth.value);
  });

  it('passive does not join a packmate that was hit either', () => {
    // `alertCamp` reaches its mates through `aggroOn`, which is the one gate
    // temperament is enforced at. If the gate were at `takeDamage` instead,
    // this body — never touched itself — would still wake up.
    const shared = { ...CAMP };
    const hit = makeCamp({ temperament: 'passive', camp: shared });
    const mate = makeCamp({ temperament: 'passive', camp: shared });
    mate.position.set(CAMP.x + 40, CAMP.y + 40);
    const champion = championAt(60);
    indexObjects(game, [hit, mate, champion]);

    hit.takeDamage(5, champion);

    expect(mate.phase).toBe(Monster.PHASES.IDLE);
    expect(mate.targetLock).toBeNull();
  });

  it('skittish runs from a hit instead of answering it', () => {
    const camp = makeCamp({ temperament: 'skittish' });
    const champion = championAt(60);
    indexObjects(game, [camp, champion]);

    camp.takeDamage(5, champion);

    expect(camp.phase).toBe(Monster.PHASES.FLEE);
    expect(camp.targetLock).toBeNull();
  });

  it('skittish lets a champion walk right up to it', () => {
    // **This assertion is the reverse of what it used to be.** `skittish`
    // ran a proximity scan from IDLE and bolted from anyone inside
    // `aggroRange`, which made the one camp using it — a river crab —
    // unapproachable rather than shy: you could never stand next to it, and
    // the source game's crab strolls about until something actually hits it.
    // The retreat now starts where every other fight does, in `aggroOn` off
    // `takeDamage`, and IDLE has no proximity exception left in it.
    const camp = makeCamp({ temperament: 'skittish' });
    const champion = championAt(120);
    indexObjects(game, [camp, champion]);

    camp.update();

    expect(camp.phase).toBe(Monster.PHASES.IDLE);
  });

  it('an aggressive camp still ignores a champion that only walked close', () => {
    const camp = makeCamp();
    const champion = championAt(120);
    indexObjects(game, [camp, champion]);

    camp.update();

    expect(camp.phase).toBe(Monster.PHASES.IDLE);
  });

  it('and gives up the chase once the threat is outside that aggro range', () => {
    // What `aggroRange` still answers now that the idle scan is gone: not
    // "does this startle me" but "is the thing I am running from still near
    // enough to keep running from". Asserted through `nearestThreat`, which is
    // the one query `updateFlee` re-runs on its own beat.
    const camp = makeCamp({ temperament: 'skittish', aggroRange: 100 });
    const near = championAt(60);
    indexObjects(game, [camp, near]);
    expect(camp.nearestThreat()).toBe(near);

    near.position.set(CAMP.x + 260, CAMP.y);
    indexObjects(game, [camp, near]);
    expect(camp.nearestThreat()).toBeNull();
  });

  it('cannot see a champion hiding in a bush, so it stops running from one', () => {
    // The threat scan goes through `PredefinedFilters.visibleTo`, which is
    // what `check-seams`' `target-vision` rule requires of any query that
    // picks a unit. A camp has `visionRadius = 0` and still sees normally —
    // `Vision.viewIsClear` range-gates only borrowed eyes — so what the gate
    // actually buys here is bush cover. It used to keep a crab from startling;
    // with the proximity scan gone it is what lets a chased one calm down when
    // its pursuer ducks into the brush.
    const camp = makeCamp({ temperament: 'skittish' });
    const champion = championAt(120);
    indexObjects(game, [camp, champion]);
    expect(camp.nearestThreat()).toBe(champion);

    champion.isInsideBush = true;
    expect(camp.nearestThreat()).toBeNull();
  });

  it('but a hit from that bush still sends it running', () => {
    // Being unable to *see* someone is not being unable to feel the damage:
    // `takeDamage` reaches `aggroOn` directly and never consults the scan.
    const camp = makeCamp({ temperament: 'skittish' });
    const champion = championAt(120);
    champion.isInsideBush = true;
    indexObjects(game, [camp, champion]);

    camp.takeDamage(5, champion);

    expect(camp.phase).toBe(Monster.PHASES.FLEE);
  });

  it('flees away from the threat, not just somewhere', () => {
    const camp = makeCamp({ temperament: 'skittish' });
    const champion = championAt(60);
    indexObjects(game, [camp, champion]);

    camp.takeDamage(5, champion);

    // No navigation in this context, so `navigateTo` degrades to a straight
    // `moveTo` and the ordered point is the destination.
    expect(gap(camp.destination, champion.position)).toBeGreaterThan(
      gap(camp.position, champion.position)
    );
  });

  it('turns for home once nothing is chasing it any more', () => {
    const camp = makeCamp({ temperament: 'skittish' });
    const champion = championAt(60);
    indexObjects(game, [camp, champion]);
    camp.takeDamage(5, champion);
    expect(camp.phase).toBe(Monster.PHASES.FLEE);

    // The threat leaves the world entirely, so the next scan finds nothing.
    indexObjects(game, [camp]);
    const ticks = Math.ceil(MONSTER_GIVE_UP_DELAY_MS / 16) + 20;
    for (let i = 0; i < ticks; i++) camp.update();

    expect(camp.phase).toBe(Monster.PHASES.BACK_TO_CAMP);
  });

  it('keeps fleeing while the threat is still there', () => {
    const camp = makeCamp({ temperament: 'skittish' });
    const champion = championAt(60);
    indexObjects(game, [camp, champion]);
    camp.takeDamage(5, champion);

    // Long past the give-up delay, but the champion never leaves.
    const ticks = Math.ceil(MONSTER_GIVE_UP_DELAY_MS / 16) + 20;
    for (let i = 0; i < ticks; i++) {
      // The camp runs; keep the champion on top of it so it stays a threat.
      champion.position.set(camp.position.x + 60, camp.position.y);
      camp.update();
    }

    expect(camp.phase).toBe(Monster.PHASES.FLEE);
  });
});

describe('roam region', () => {
  it('defaults to the camp circle', () => {
    const camp = makeCamp();
    expect(camp.roam).toEqual({ kind: 'camp' });
    expect(camp.roamContains(CAMP.x + 100, CAMP.y)).toBe(true);
    expect(camp.roamContains(CAMP.x + 500, CAMP.y)).toBe(false);
  });

  it('a terrain roam asks the map which points are in the layer', () => {
    const camp = makeCamp({ roam: { kind: 'terrain', layer: TerrainType.WATER as 'water' } });
    const containsPoint = vi.fn((x: number) => x < CAMP.x);
    (game as unknown as { terrainMap: unknown }).terrainMap = { containsPoint };

    // Well outside the camp circle, so a camp-circle answer would be `false`
    // for both — this only passes if the layer is what was consulted.
    expect(camp.roamContains(CAMP.x - 900, CAMP.y)).toBe(true);
    expect(camp.roamContains(CAMP.x + 900, CAMP.y)).toBe(false);
    expect(containsPoint).toHaveBeenCalledWith(CAMP.x - 900, CAMP.y, TerrainType.WATER);
  });

  it('falls back to the camp circle when the map cannot answer', () => {
    // A headless context, or a map whose layer was edited away. The camp has
    // to behave like an ordinary one, not freeze with nowhere legal to stand.
    const camp = makeCamp({ roam: { kind: 'terrain', layer: 'water' } });
    expect(camp.roamContains(CAMP.x + 100, CAMP.y)).toBe(true);
    expect(camp.roamContains(CAMP.x + 900, CAMP.y)).toBe(false);
  });

  it('leashes against the region rather than the radius', () => {
    const camp = makeCamp({ roam: { kind: 'terrain', layer: 'water' } });
    (game as unknown as { terrainMap: unknown }).terrainMap = {
      containsPoint: (x: number) => x < CAMP.x,
    };

    // Inside the layer but 900px from home: a camp-radius leash would call
    // this outside and walk it back.
    camp.position.set(CAMP.x - 900, CAMP.y);
    expect(camp.isOutsideCamp()).toBe(false);

    camp.position.set(CAMP.x + 10, CAMP.y);
    expect(camp.isOutsideCamp()).toBe(true);
  });

  it('a flee destination stays inside the region', () => {
    const camp = makeCamp({ temperament: 'skittish', roam: { kind: 'terrain', layer: 'water' } });
    (game as unknown as { terrainMap: unknown }).terrainMap = {
      containsPoint: (x: number) => x < CAMP.x,
    };
    // Pushed against the eastern edge of the water with the threat to the
    // west, so "directly away" is the one direction that leaves the layer.
    camp.position.set(CAMP.x - 10, CAMP.y);
    const champion = new Champion({ game, teamId: 'other' });
    champion.position.set(CAMP.x - 200, CAMP.y);
    indexObjects(game, [camp, champion]);

    camp.takeDamage(5, champion);

    expect(camp.destination.x).toBeLessThan(CAMP.x);
  });
});

describe('ephemeral bodies', () => {
  it('an ordinary camp still comes back', () => {
    const camp = makeCamp({ reviveTime: 100 });
    const champion = championAt(60);
    indexObjects(game, [camp, champion]);

    camp.takeDamage(9_999, champion);
    expect(camp.isDead).toBe(true);
    expect(camp.toRemove).toBe(false);

    for (let i = 0; i < 20; i++) camp.update();

    expect(camp.isDead).toBe(false);
    expect(camp.toRemove).toBe(false);
  });

  it('an ephemeral body is retired instead', () => {
    const child = makeCamp({ ephemeral: true, reviveTime: 100 });
    const champion = championAt(60);
    indexObjects(game, [child, champion]);

    child.takeDamage(9_999, champion);

    expect(child.isDead).toBe(true);
    expect(child.toRemove).toBe(true);
  });

  it('and does not come back even if something keeps updating it', () => {
    // `toRemove` is honoured on ObjectManager's *next* pass, while the revive
    // timer runs in this one — so the corpse can outlive its own reviveTime
    // by a tick. It must still not stand up.
    const child = makeCamp({ ephemeral: true, reviveTime: 100 });
    const champion = championAt(60);
    indexObjects(game, [child, champion]);
    child.takeDamage(9_999, champion);

    for (let i = 0; i < 40; i++) child.update();

    expect(child.isDead).toBe(true);
    expect(child.toRemove).toBe(true);
  });
});
