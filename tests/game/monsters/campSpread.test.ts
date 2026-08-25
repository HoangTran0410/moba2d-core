import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Monster from '@/game/gameObject/attackableUnits/Monster';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import {
  createGame,
  indexObjects,
  stubGameGlobals,
  TEST_AVATAR_KEY,
  type TestGame,
} from '../fixtures';

/**
 * Every body in a camp has its own spot in it, and keeps it.
 *
 * Reported from a real match: the wolf pit and the raptor pit rendered as one
 * pile of overlapping bodies fighting for a single point, when a jungle camp
 * is supposed to be spread across its clearing. The pack's layout was never
 * the problem — its `offset`s are lifted from the real map — but only the
 * *initial* placement ever used them. Every other line that answered "where
 * does this body belong" read `camp`, which is the **slot**: one point shared
 * by the whole camp, held by reference so `alertCamp` can match on identity.
 *
 * So the pile assembled itself three ways, and a camp needs only one of them:
 *
 *   - `respawn()` put every member back on the slot centre, so the layout
 *     survived exactly until the camp was first cleared;
 *   - `isOutsideCamp()` measured from the slot with the slot's own radius, and
 *     a raptor whose offset is 195px from a camp of radius 100 is *born*
 *     outside it — so it walked to the middle on its first idle tick, having
 *     never been touched;
 *   - `goBackToCamp()` and the arrived check both aimed at the slot, so any
 *     camp that ever aggroed came home to the middle.
 *
 * `home` is that missing per-body point. `camp` keeps meaning the shared
 * territory — the leash, the chase radius, the alert circle — because those
 * really are questions about the camp and not about one wolf.
 */
const SLOT = { x: 1_000, y: 1_000, r: 100 };

let game: TestGame;

const member = (offsetX: number, offsetY: number, overrides: Record<string, unknown> = {}) =>
  new Monster({
    game,
    preset: {
      name: 'Wolf',
      avatar: TEST_AVATAR_KEY,
      camp: SLOT,
      home: { x: SLOT.x + offsetX, y: SLOT.y + offsetY },
      speed: 2,
      size: 40,
      attackRange: 50,
      reviveTime: 100,
      health: 100,
      ...overrides,
    },
  } as ConstructorParameters<typeof Monster>[0]);

describe('a camp keeps its layout', () => {
  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('stands each body on its own spot, not on the slot centre', () => {
    const wolf = member(-83, -51);
    expect(wolf.position.x).toBe(SLOT.x - 83);
    expect(wolf.position.y).toBe(SLOT.y - 51);
  });

  it('puts a body back on its own spot after it respawns', () => {
    // The half that made the pile permanent: the layout used to survive
    // exactly until the camp was first cleared.
    const wolf = member(40, 97);
    indexObjects(game, [wolf]);
    wolf.position.set(SLOT.x + 400, SLOT.y);

    wolf.respawn();

    expect(wolf.position.x).toBe(SLOT.x + 40);
    expect(wolf.position.y).toBe(SLOT.y + 97);
  });

  it('does not think a body further from the slot than its radius has wandered off', () => {
    // A raptor sits 195px from a camp of radius 100. Measured from the slot it
    // is outside its own camp from the moment it spawns, and walks to the
    // middle on its first idle tick having never been touched.
    const raptor = member(195, -15);
    indexObjects(game, [raptor]);
    expect(
      raptor.isOutsideCamp(),
      'a body standing exactly where it belongs read as displaced'
    ).toBe(false);
  });

  it('still knows when a body really has been dragged off its spot', () => {
    const wolf = member(0, 0);
    indexObjects(game, [wolf]);
    wolf.position.set(SLOT.x + SLOT.r + 50, SLOT.y);
    expect(wolf.isOutsideCamp()).toBe(true);
  });

  it('walks home to its own spot, not to the middle', () => {
    const wolf = member(-83, -51);
    indexObjects(game, [wolf]);
    wolf.position.set(SLOT.x + 500, SLOT.y + 500);

    wolf.goBackToCamp();

    expect(wolf.destination.x).toBeCloseTo(SLOT.x - 83, 5);
    expect(wolf.destination.y).toBeCloseTo(SLOT.y - 51, 5);
  });

  it('counts as arrived at its own spot, and not at the slot centre', () => {
    const wolf = member(-83, -51);
    indexObjects(game, [wolf]);
    wolf.phase = Monster.PHASES.BACK_TO_CAMP;

    // Standing on the slot centre — 97px from where this body belongs, which
    // is well outside its own body radius.
    wolf.position.set(SLOT.x, SLOT.y);
    wolf.update();
    expect(wolf.phase, 'a body idled in the middle of the camp instead of on its spot').toBe(
      Monster.PHASES.BACK_TO_CAMP
    );

    wolf.position.set(SLOT.x - 83, SLOT.y - 51);
    wolf.update();
    expect(wolf.phase).toBe(Monster.PHASES.IDLE);
  });

  it('leaves a camp of one exactly where it always was', () => {
    // `home` defaults to the slot, so every existing single-body camp — and
    // every pack written before this field existed — is untouched.
    const boss = new Monster({
      game,
      preset: {
        name: 'Boss',
        avatar: TEST_AVATAR_KEY,
        camp: SLOT,
        speed: 0,
        size: 120,
        attackRange: 200,
        reviveTime: 100,
        health: 800,
      },
    } as ConstructorParameters<typeof Monster>[0]);

    expect(boss.position.x).toBe(SLOT.x);
    expect(boss.position.y).toBe(SLOT.y);
  });

  it('shares one leash circle across the whole camp, wherever each body stands', () => {
    // The other half of the split: `camp` still means the shared territory. A
    // wolf 97px off-centre must not get a leash centred on itself, or two
    // members of one camp would chase to different distances.
    const wolf = member(40, 97);
    const greater = member(0, 0);
    expect(wolf.chaseLeashRange()).toBe(greater.chaseLeashRange());
  });
});
