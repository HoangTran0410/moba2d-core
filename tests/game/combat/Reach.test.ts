import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: {
    get: () => undefined,
    getAsset: () => undefined,
    placeholder: () => undefined,
    renderable: () => undefined,
    ensure: () => Promise.resolve(undefined),
    ensureMany: () => Promise.resolve(undefined),
  },
}));

import { Circle } from '../../../src/libs/quadtree';
import {
  DEFAULT_BODY_RADIUS,
  bodyRadiusOf,
  bodyReachBonus,
  effectiveRange,
  withinRange,
} from '../../../src/game/combat/Reach';
import { DEFAULT_UNIT_SIZE, MAX_UNIT_SIZE } from '../../../src/game/gameObject/Stats';
import Spell from '../../../src/game/gameObject/Spell';
import ObjectManager, { PredefinedFilters } from '../../../src/game/managers/ObjectManager';
import TargetResolver from '../../../src/game/spell/targeting/TargetResolver';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import { Rectangle } from '../../../src/libs/quadtree';
import EventManager from '../../../src/managers/EventManager';
import { TestVector, installSpellObjectGlobals } from '../spell/fixtures';

/**
 * The size an enemy's centre is held at by body separation, which is what a
 * caster-centred range has to clear before it can select anybody at all.
 * `UnitCollisionSystem` pushes until `bodyRadius(a) + bodyRadius(b)`.
 */
const separationGap = (casterSize: number, targetSize: number): number =>
  casterSize / 2 + targetSize / 2;

const sized = (size: number, x = 0, y = 0) => ({
  position: new TestVector(x, y),
  stats: { size: { value: size } },
});

interface QueriedArea {
  readonly r: number;
}

/** A caster whose object manager records the circles its spells ask for. */
function createProbeCaster(size: number) {
  const queried: QueriedArea[] = [];
  const owner = {
    position: new TestVector(0, 0),
    destination: new TestVector(0, 0),
    teamId: 'blue',
    isDead: false,
    stats: { size: { value: size } },
    bodyRadius: size / 2,
    moveTo: vi.fn(),
    game: {
      worldMouse: { x: 0, y: 0 },
      eventManager: new EventManager(),
      objectManager: {
        addObject: vi.fn(),
        queryObjects: (options: { area?: QueriedArea }) => {
          if (options.area) queried.push(options.area);
          return [];
        },
      },
    },
  };
  return { owner, queried };
}

/**
 * Three fixture spells, built for this test rather than borrowed from any
 * installed content pack's own catalogue.
 *
 * Content-pack-and-repo-split batch 6 task 10, fix round 1: this file used
 * to run this same regression guard against ten real spells
 * (`LeeSin_R`, `Warwick_Q`, `Alistar_W`, `ChoGath_R`, `Nasus_Q`, `Ignite`,
 * `Shaco_E`, `Zed_R`, `Nocturne_R`, `LeeSin_W`), each exercising one of a
 * handful of *shapes* a targeting query takes — a self-centred enemy scan
 * triggered by a named method, the same triggered directly by `onSpellCast`,
 * and an ally scan. All ten stopped existing in this repository the moment
 * `packs/riot/` became a repository of its own, and a body-size-aware range
 * query is core's own mechanism (`Reach.ts`), not a fact about any pack's
 * content — so it is worth guarding here regardless of which pack, if any,
 * is installed. These three fixtures reproduce the real shapes exactly —
 * `new Circle({ x, y, r: effectiveRange(range, owner) })` handed to
 * `ObjectManager.queryObjects`, the identical call every real spell above
 * made — so the property under test (a real query call site correctly
 * threading `effectiveRange` rather than the raw authored number) is
 * exercised through the same integration path, not asserted against
 * `effectiveRange` in isolation the way "the rule itself" below already
 * does.
 */
class FixtureEnemyScanSpell extends Spell {
  protected targetingMode = 'DIRECTION' as const;
  coolDown = 500;
  range = 400;

  findNearestEnemy(): unknown {
    const found = this.owner.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: effectiveRange(this.range, this.owner),
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });
    return found[0] ?? null;
  }
}

class FixtureAllyScanSpell extends Spell {
  protected targetingMode = 'DIRECTION' as const;
  coolDown = 500;
  range = 350;

  findNearestAlly(): unknown {
    const found = this.owner.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: effectiveRange(this.range, this.owner),
      }),
      filters: [PredefinedFilters.teamId(this.owner.teamId)],
    });
    return found[0] ?? null;
  }
}

class FixtureCastTriggeredScanSpell extends Spell {
  protected targetingMode = 'DIRECTION' as const;
  coolDown = 500;
  range = 80;

  onSpellCast(): void {
    this.owner.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: effectiveRange(this.range, this.owner),
      }),
      filters: [
        PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
        PredefinedFilters.visibleTo(this.owner),
      ],
    });
  }
}

/**
 * Every query shape whose selection radius can be provoked with one call.
 * The function is what actually issues the query; `range` is read off the
 * instance rather than duplicated here, matching how the real spells this
 * replaced were structured.
 */
const selectionSpells: readonly {
  name: string;
  build: (owner: unknown) => { range: number; select: () => unknown };
}[] = [
  {
    name: 'a self-centred enemy scan',
    build: owner => {
      const spell = new FixtureEnemyScanSpell(owner);
      return { range: spell.range, select: () => spell.findNearestEnemy() };
    },
  },
  {
    name: 'a self-centred ally scan',
    build: owner => {
      const spell = new FixtureAllyScanSpell(owner);
      return { range: spell.range, select: () => spell.findNearestAlly() };
    },
  },
  {
    name: 'a cast-triggered scan',
    build: owner => {
      const spell = new FixtureCastTriggeredScanSpell(owner);
      return { range: spell.range, select: () => spell.onSpellCast() };
    },
  },
];

describe('size-aware reach', () => {
  beforeEach(() => installSpellObjectGlobals());
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('the rule itself', () => {
    it('derives the default body from the champion default in Stats', () => {
      expect(DEFAULT_BODY_RADIUS).toBe(DEFAULT_UNIT_SIZE / 2);
    });

    it('is a no-op between two default bodies', () => {
      const caster = sized(DEFAULT_UNIT_SIZE);
      const target = sized(DEFAULT_UNIT_SIZE);

      for (const authored of [80, 150, 200, 350, 500, 1_200]) {
        expect(effectiveRange(authored, caster, target)).toBe(authored);
      }
    });

    it('adds the caster excess and nothing else', () => {
      const grown = sized(MAX_UNIT_SIZE);
      const excess = MAX_UNIT_SIZE / 2 - DEFAULT_BODY_RADIUS;

      expect(bodyReachBonus(grown)).toBe(excess);
      expect(effectiveRange(80, grown, sized(DEFAULT_UNIT_SIZE))).toBe(80 + excess);
    });

    it('adds the target excess too, so a grown victim is still reachable', () => {
      const excess = MAX_UNIT_SIZE / 2 - DEFAULT_BODY_RADIUS;

      expect(effectiveRange(80, sized(DEFAULT_UNIT_SIZE), sized(MAX_UNIT_SIZE))).toBe(80 + excess);
      expect(effectiveRange(80, sized(MAX_UNIT_SIZE), sized(MAX_UNIT_SIZE))).toBe(80 + excess * 2);
    });

    it('never lets a body smaller than default shorten a spell', () => {
      const minion = sized(34);
      const wisp = sized(1);

      expect(bodyReachBonus(minion)).toBe(0);
      expect(bodyReachBonus(wisp)).toBe(0);
      expect(effectiveRange(80, sized(DEFAULT_UNIT_SIZE), minion)).toBe(80);
      expect(effectiveRange(80, wisp, wisp)).toBe(80);
    });

    it('treats an unreadable body as a default one', () => {
      expect(bodyRadiusOf(undefined)).toBe(DEFAULT_BODY_RADIUS);
      expect(bodyRadiusOf(null)).toBe(DEFAULT_BODY_RADIUS);
      expect(bodyRadiusOf({})).toBe(DEFAULT_BODY_RADIUS);
      expect(effectiveRange(80)).toBe(80);
    });

    it('accepts a radius already in hand', () => {
      expect(bodyRadiusOf(MAX_UNIT_SIZE / 2)).toBe(MAX_UNIT_SIZE / 2);
      expect(effectiveRange(80, MAX_UNIT_SIZE / 2, DEFAULT_BODY_RADIUS)).toBe(
        80 + MAX_UNIT_SIZE / 2 - DEFAULT_BODY_RADIUS
      );
    });
  });

  describe('withinRange, for sites that measure centre to centre themselves', () => {
    it('matches the authored range exactly between default bodies', () => {
      const caster = sized(DEFAULT_UNIT_SIZE, 0, 0);

      expect(withinRange(500, caster, sized(DEFAULT_UNIT_SIZE, 500, 0))).toBe(true);
      expect(withinRange(500, caster, sized(DEFAULT_UNIT_SIZE, 501, 0))).toBe(false);
    });

    it('reaches further once a body has grown', () => {
      const grown = sized(MAX_UNIT_SIZE, 0, 0);

      expect(withinRange(500, grown, sized(DEFAULT_UNIT_SIZE, 520, 0))).toBe(true);
      expect(withinRange(500, sized(DEFAULT_UNIT_SIZE, 0, 0), sized(MAX_UNIT_SIZE, 520, 0))).toBe(
        true
      );
      expect(
        withinRange(500, sized(DEFAULT_UNIT_SIZE, 0, 0), sized(DEFAULT_UNIT_SIZE, 520, 0))
      ).toBe(false);
    });

    it('calls a unit with no position out of range rather than at the origin', () => {
      expect(withinRange(500, sized(DEFAULT_UNIT_SIZE), {})).toBe(false);
      expect(withinRange(500, {}, sized(DEFAULT_UNIT_SIZE))).toBe(false);
    });
  });

  // The regression guard that matters most: at default size every query shape
  // must still ask for exactly the number it was authored with.
  describe('no balance drift at default size', () => {
    for (const spell of selectionSpells) {
      it(`${spell.name} queries its authored range unchanged`, () => {
        const { owner, queried } = createProbeCaster(DEFAULT_UNIT_SIZE);
        const { range, select } = spell.build(owner);

        select();

        expect(queried).toHaveLength(1);
        expect(queried[0].r).toBe(range);
      });
    }
  });

  describe('a grown caster keeps its reach', () => {
    for (const spell of selectionSpells) {
      it(`${spell.name} widens by the caster excess only`, () => {
        const { owner, queried } = createProbeCaster(MAX_UNIT_SIZE);
        const { range, select } = spell.build(owner);

        select();

        expect(queried[0].r).toBe(range + MAX_UNIT_SIZE / 2 - DEFAULT_BODY_RADIUS);
      });
    }
  });
});

/**
 * The bug this describe block was named for was Lee Sin R's own: 80 units
 * from the caster's centre, against a separation that parks a full-size
 * Cho'Gath's victim 110 away. `FixtureCastTriggeredScanSpell` above
 * reproduces the exact query Lee Sin R issued (`effectiveRange`-sized
 * `Circle`, `canTakeDamageFromTeam` + `visibleTo` filters, triggered by
 * `onSpellCast`) against a real quadtree, so the query's own surface test
 * against the victim's body is still part of the answer this proves.
 */
describe('a cast-triggered scan reaches past body separation', () => {
  beforeEach(() => installSpellObjectGlobals());
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createWorld() {
    const camera = {
      getBoundingBox: () => new Rectangle({ x: -5_000, y: -5_000, w: 10_000, h: 10_000 }),
    };
    return new ObjectManager({ mapSize: 10_000, camera });
  }

  /** Runs the fixture spell's own query against a real world. */
  function whatTheScanWouldFind(casterSize: number, victimSize: number) {
    const manager = createWorld();
    const game = {
      mapSize: 10_000,
      camera: {
        getBoundingBox: () => new Rectangle({ x: -5_000, y: -5_000, w: 10_000, h: 10_000 }),
      },
      objectManager: manager,
      eventManager: new EventManager(),
      player: { teamId: 'blue' },
      randomSpawnPoint: () => createVector(),
      createSpellContext: () => undefined,
      worldMouse: { x: 1_000, y: 0 },
    };

    const gap = separationGap(casterSize, victimSize);
    const victim = new AttackableUnit({
      game: game as never,
      position: createVector(gap, 0),
      teamId: 'red',
    });
    victim.stats.size.baseValue = victimSize;
    victim.animatedValues.size = victimSize;

    manager.objects = [victim];
    manager._objectsTree.clear();
    manager._objectsTree.insert(victim.getDisplayBoundingBox());

    const found: unknown[] = [];
    const owner = {
      position: new TestVector(0, 0),
      teamId: 'blue',
      isDead: false,
      stats: { size: { value: casterSize } },
      bodyRadius: casterSize / 2,
      moveTo: vi.fn(),
      game: {
        ...game,
        objectManager: {
          addObject: vi.fn(),
          queryObjects: (options: Parameters<ObjectManager['queryObjects']>[0]) => {
            found.push(...manager.queryObjects(options));
            return [];
          },
        },
      },
    };

    const spell = new FixtureCastTriggeredScanSpell(owner);
    spell.onSpellCast();

    // what the spell asked for, and what the raw authored number would have found
    const rawFound = manager.queryObjects({
      area: new Circle({ x: 0, y: 0, r: spell.range }),
      filters: [PredefinedFilters.canTakeDamageFromTeam('blue')],
    });

    return { found, rawFound, gap, range: spell.range };
  }

  it('finds a default enemy at default size, exactly as it always did', () => {
    const { found, rawFound } = whatTheScanWouldFind(DEFAULT_UNIT_SIZE, DEFAULT_UNIT_SIZE);

    expect(found).toHaveLength(1);
    // unchanged: the authored 80 already sufficed between two default bodies
    expect(rawFound).toHaveLength(1);
  });

  it('finds an enemy that a grown caster holds at arms length', () => {
    const { found, rawFound, gap, range } = whatTheScanWouldFind(MAX_UNIT_SIZE, DEFAULT_UNIT_SIZE);

    // the gap separation enforces is wider than the authored range plus the
    // victim's own body, which is why the raw query comes back empty
    expect(gap).toBeGreaterThan(range + DEFAULT_BODY_RADIUS);
    expect(rawFound).toHaveLength(0);
    expect(found).toHaveLength(1);
  });

  it('finds a grown enemy that a default caster holds at arms length', () => {
    const { found, rawFound } = whatTheScanWouldFind(DEFAULT_UNIT_SIZE, MAX_UNIT_SIZE);

    // the target end already came free with the query's surface test, so this
    // one was never broken — it must stay working
    expect(rawFound).toHaveLength(1);
    expect(found).toHaveLength(1);
  });

  it('finds an enemy when both bodies are at the ceiling', () => {
    const { found, rawFound } = whatTheScanWouldFind(MAX_UNIT_SIZE, MAX_UNIT_SIZE);

    expect(rawFound).toHaveLength(0);
    expect(found).toHaveLength(1);
  });
});

/**
 * The UNIT branch of TargetResolver is the one gate every targeted ability
 * shares, and it measures centre to centre with no surface test of its own, so
 * it has to correct both ends itself.
 */
describe('TargetResolver honours both bodies', () => {
  beforeEach(() => installSpellObjectGlobals());
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const request = (caster: unknown, candidate: unknown, range: number) => ({
    spellId: 'test',
    activationId: 'test',
    startedAtMs: 0,
    caster,
    casterTeamId: 'blue',
    origin: { x: 0, y: 0 },
    cursorWorld: (candidate as { position: { x: number; y: number } }).position,
    range,
    targetTeam: 'ENEMY' as const,
    queryCandidates: () => [candidate],
    isTargetable: () => true,
    getTargetInfo: (value: unknown) => ({
      position: (value as { position: { x: number; y: number } }).position,
      teamId: 'red',
      selectionRadius: 30,
    }),
  });

  const enemy = (size: number, distance: number) => ({
    position: { x: distance, y: 0 },
    stats: { size: { value: size } },
    teamId: 'red',
  });

  it('refuses a target one unit past the authored range at default size', () => {
    const caster = sized(DEFAULT_UNIT_SIZE);

    expect(
      TargetResolver.resolve('UNIT', request(caster, enemy(DEFAULT_UNIT_SIZE, 500), 500)).ok
    ).toBe(true);
    expect(
      TargetResolver.resolve('UNIT', request(caster, enemy(DEFAULT_UNIT_SIZE, 501), 500)).ok
    ).toBe(false);
  });

  it('accepts the same target once either body has grown', () => {
    expect(
      TargetResolver.resolve(
        'UNIT',
        request(sized(MAX_UNIT_SIZE), enemy(DEFAULT_UNIT_SIZE, 520), 500)
      ).ok
    ).toBe(true);
    expect(
      TargetResolver.resolve(
        'UNIT',
        request(sized(DEFAULT_UNIT_SIZE), enemy(MAX_UNIT_SIZE, 520), 500)
      ).ok
    ).toBe(true);
  });

  it('leaves POINT casts on the authored number, ground has no body', () => {
    const pointRequest = {
      ...request(sized(MAX_UNIT_SIZE), enemy(DEFAULT_UNIT_SIZE, 520), 500),
      cursorWorld: { x: 520, y: 0 },
    };

    expect(TargetResolver.resolve('POINT', pointRequest).ok).toBe(false);
  });
});

/**
 * Rammus Q's own surface-to-surface rule ("Rammus Q deliberately stays off
 * this module — its circle is not a range, it is the ball's own body")
 * deliberately has no fixture-spell replacement here: `reachTo` is
 * `Rammus_Q_Object`'s own method, not a shared engine mechanism, so it is a
 * fact about that spell's own design rather than about `Reach.ts`. It never
 * needed migrating — `packs/riot/tests/spells/Rammus_Q.test.ts` (`reaches
 * past the gap body separation enforces`, `still reaches when the caster
 * has grown and the enemy has not`, `measures reach against a body radius,
 * falling back to the collision radius`) already covers exactly this, in
 * the pack's own suite, unchanged by this file leaving.
 */
