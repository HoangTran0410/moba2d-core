import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { E, normalizeTerrain } from '@/mapEditor/state';
import { MapRules } from '@/mapEditor/mapRules';
import { Store } from '@/mapEditor/storage';
import { installEditorVendorGlobals } from './editorVendor';

// `storage.ts` reports through the editor's toasts; this suite is about what
// it *found*, not how it said so.
vi.mock('@/mapEditor/ui', () => ({
  UI: new Proxy({}, { get: () => () => {} }),
}));

vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem() {},
  removeItem() {},
});

/**
 * The editor's own check, on the rules the pack's push gate cares about.
 *
 * Reported after a push was blocked: the editor said **0 lỗi · 2 cảnh báo**
 * and `npm run verify` in the pack refused the map for a lane running three
 * pixels *inside* a wall. Both were telling the truth about different things —
 * the editor's `validate()` had only ever checked schema and topology (ids,
 * factions, lane direction, muster points, the map frame), and "can a minion
 * body actually walk this" is geometry nobody asked about.
 *
 * The numbers here are the pack's, not the editor's: `MIN_CLEARANCE` and the
 * two turret floors are stated in `lol/tests/maps/Lanes.test.ts`, and if the
 * two copies drift the editor goes green over a map the gate rejects, which is
 * exactly the failure this exists to end. That drift is what the cases below
 * are really pinning — a check that fires is easy, a check that fires *at the
 * same threshold as the gate* is the point.
 *
 * Driven through the real editor in a `vm`, the way `localMaps.test.ts` drives
 * the real publisher: the editor is plain browser JavaScript with no modules,
 * so nothing here can import it and no type checker will ever compare the two.
 */

installEditorVendorGlobals();

/**
 * `Store.validate()` over a set of terrains — an import now, where this used
 * to build a `vm` sandbox and run four of the editor's classic scripts into
 * it.
 *
 * The fixtures below are still written as *source text*, because that is what
 * they had to be when they were spliced into a script string, and there are
 * about thirty of them. Parsing them here keeps this change to the harness;
 * turning them into plain values is a separate, purely mechanical edit that
 * would bury the one that matters.
 */
function check(
  terrains: string,
  factions = `['amber', 'jade']`,
  tuning = 'undefined'
): Issue[] {
  const build = new Function(`return { terrains: [${terrains}], factions: ${factions}, tuning: ${tuning} };`);
  const fixture = build() as { terrains: unknown[]; factions: string[]; tuning: unknown };

  E.mapName = 'Thử';
  E.mapSize = [4000, 4000];
  E.meta = { id: 'thu', factions: fixture.factions, tuning: fixture.tuning as never };
  E.terrains = fixture.terrains.map(normalizeTerrain);
  return Store.validate() as Issue[];
}

/** A lane from `a` to `b`, with the muster points that keep it warning-free. */
const laneThrough = (points: number[][]): string => `
  { type: 'lane', position: [0, 0], polygon: ${JSON.stringify(points)},
    props: { id: 'mid', from: 'amber', to: 'jade' } },
  { type: 'spawn', position: [200, 200], props: { faction: 'amber', r: 150 } },
  { type: 'spawn', position: [3800, 3800], props: { faction: 'jade', r: 150 } },
  { type: 'minion', position: [400, 400], props: { faction: 'amber', lane: 'mid' } },
  { type: 'minion', position: [3600, 3600], props: { faction: 'jade', lane: 'mid' } }
`;

/** A 400×400 block whose centre is `(x, y)`. */
const block = (x: number, y: number): string =>
  `{ type: 'wall', position: [${x - 200}, ${y - 200}],
     polygon: [[0,0],[400,0],[400,400],[0,400]] }`;

/** `MapRules` on its own, with none of the editor around it. */
function loadMapRules(): { structureIssues(map: Record<string, unknown>): Issue[] } {
  return MapRules as never;
}

const errors = (issues: Issue[]): Issue[] => issues.filter(issue => issue.level === 'error');
const about = (issues: Issue[], word: string): Issue[] =>
  issues.filter(issue => issue.text.includes(word));

describe('the editor checks what the push gate checks', () => {
  it('passes a lane with open ground either side of it', () => {
    // The control. Without it every case below could be a validator that
    // simply complains about everything.
    const issues = check(`${laneThrough([[200, 200], [3800, 3800]])}, ${block(3000, 600)}`);
    expect(errors(issues)).toEqual([]);
  });

  it('refuses a lane that runs through a wall', () => {
    // The report, at its own scale: a lane straight through a block.
    const issues = errors(check(`${laneThrough([[200, 200], [3800, 3800]])}, ${block(2000, 2000)}`));

    expect(about(issues, 'tường').length).toBeGreaterThan(0);
    expect(about(issues, 'XUYÊN tường').length).toBeGreaterThan(0);
  });

  it('refuses one that merely grazes a wall, at the gate’s own threshold', () => {
    // 20px of clearance — a lane a person would call "beside the wall", and
    // one the pack's `MIN_CLEARANCE` of 40 rejects because half a minion is
    // already inside it. If the editor's number ever drifts below the gate's,
    // this is the case that goes quiet.
    const issues = errors(check(`${laneThrough([[0, 2000], [4000, 2000]])}, ${block(2000, 1780)}`));

    expect(about(issues, 'hở tường').length).toBeGreaterThan(0);
  });

  it('refuses a waypoint a minion could never stand on', () => {
    // Sitting on the turret. `TURRET_BLOCKED_RADIUS` holds the body 63px out
    // and `WAYPOINT_TOLERANCE` is 40, so it never registers arrival and grinds
    // against the tower until the match ends.
    const issues = errors(
      check(
        `${laneThrough([[200, 200], [2000, 2000], [3800, 3800]])},
         { type: 'structure', position: [2010, 2000], props: { faction: 'amber', kind: 'turret' } }`
      )
    );

    expect(about(issues, 'waypoint').length).toBeGreaterThan(0);
  });

  it('refuses a lane that walks past a turret without touching a waypoint', () => {
    // Both ends clear the tower and the run between them does not — the
    // "minions hug the turret and walk around it" report, invisible to any
    // check that only reads the waypoints.
    const issues = errors(
      check(
        `${laneThrough([[0, 2000], [4000, 2000]])},
         { type: 'structure', position: [2000, 2050], props: { faction: 'amber', kind: 'turret' } }`
      )
    );

    expect(about(issues, 'sát tâm trụ').length).toBeGreaterThan(0);
  });

  it('says where, in world coordinates, for every geometric complaint', () => {
    // The other half of the report: a sentence describing a fault inside a
    // 6400×6400 frame, with nothing to click, is the machine making a person
    // search for something it already found. `ui.js` turns `at` into a row
    // that flies the camera there.
    const issues = errors(check(`${laneThrough([[200, 200], [3800, 3800]])}, ${block(2000, 2000)}`));

    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(Array.isArray(issue.at), issue.text).toBe(true);
      expect(Number.isFinite(issue.at![0]) && Number.isFinite(issue.at![1])).toBe(true);
    }
  });

  it('gives a position to the checks that already existed, too', () => {
    // They were `{ level, text }` and nothing else, so the panel could only
    // ever print them.
    const issues = check(
      `${laneThrough([[200, 200], [3800, 3800]])},
       { type: 'minion', position: [1500, 900], props: { faction: 'amber', lane: 'khong-co' } }`
    );
    const orphan = issues.find(issue => issue.text.includes('không tồn tại'));

    expect(orphan).toBeTruthy();
    expect(orphan!.at).toEqual([1500, 900]);
  });
});

/**
 * The rules that replaced a pack's coordinate tables.
 *
 * `lol/tests/maps/Lanes.test.ts` used to carry, written out by hand: the three
 * points of blue's top turret row, the exact coordinate every lane starts at,
 * and the claim that each row holds eleven turrets. None of that is a rule —
 * it is a photograph of the map on the day somebody measured it, and dragging
 * a single turret in the editor turned nine assertions red without one of them
 * naming anything that was actually wrong. That is the state the map was in
 * when this was written: twelve turrets a side, lanes starting at the mouth of
 * the base rather than on the fountain, and a push blocked by arithmetic.
 *
 * What replaced them are questions about *relationships*, which survive the map
 * being edited: does a lane join two different bases, does every turret have a
 * wave that walks past it, does a wave form up somewhere it can stand. They run
 * here, in the editor, so a person sees them on the canvas — which is the half
 * that was missing when the gate and the tool disagreed.
 */
describe('the structural rules, on slots rather than on coordinates', () => {
  it('passes the map the lane cases are built on', () => {
    // The control again, for this group: every case below has to be the rule
    // firing, not the fixture being unsound.
    const issues = check(laneThrough([[200, 200], [3800, 3800]]));
    expect(errors(issues)).toEqual([]);
  });

  it('refuses a lane with both ends at the same base', () => {
    // Replaces `expect(path[0]).toEqual(BLUE_FOUNTAIN)`. The old assertion
    // could not tell a lane that had been redrawn to start at the mouth of the
    // base — a real and deliberate edit — from one that had been cut in half.
    const issues = errors(check(laneThrough([[200, 200], [900, 300]])));

    expect(about(issues, 'không nối hai nhà').length).toBe(1);
  });

  it('refuses a second lane drawn back to front', () => {
    // `getLaneWaypoints` reverses one team's copy of the list, so a lane whose
    // points run the other way sends that team's whole wave home.
    const issues = errors(
      check(
        `${laneThrough([[200, 200], [3800, 3800]])},
         { type: 'lane', position: [0, 0], polygon: [[3700, 3700], [300, 300]],
           props: { id: 'top', from: 'jade', to: 'amber' } }`
      )
    );

    expect(about(issues, 'ngược chiều').length).toBe(1);
  });

  it('refuses a turret standing where no wave will ever walk', () => {
    // Replaces the two hand-written turret-to-lane tables. What they were
    // really guarding is this: a turret nothing pushes is a turret that stands
    // until the match ends.
    const issues = errors(
      check(
        `${laneThrough([[200, 200], [3800, 3800]])},
         { type: 'structure', position: [3000, 800], props: { faction: 'amber', kind: 'turret' } }`
      )
    );

    expect(about(issues, 'không nằm trên lane nào').length).toBe(1);
  });

  it('leaves a turret inside its own base alone', () => {
    // The other half of that rule, and the reason it needs `BASE_RADIUS` at
    // all: all three lanes leave through one gate, so inside the base "which
    // lane owns this turret" has no answer and does not need one.
    const issues = errors(
      check(
        `${laneThrough([[200, 200], [3800, 3800]])},
         { type: 'structure', position: [200, 800], props: { faction: 'amber', kind: 'turret' } }`
      )
    );

    expect(about(issues, 'không nằm trên lane nào')).toEqual([]);
  });

  it('refuses a lane that passes the enemy’s turrets before its own', () => {
    // Replaces the `blueAlong`/`redAlong` sort, which needed the tables to
    // know which turret belonged to whom. The factions are on the slots.
    const issues = errors(
      check(
        `${laneThrough([[200, 200], [3800, 3800]])},
         { type: 'structure', position: [1000, 1000], props: { faction: 'jade', kind: 'turret' } },
         { type: 'structure', position: [3000, 3000], props: { faction: 'amber', kind: 'turret' } }`
      )
    );

    expect(about(issues, 'TRƯỚC trụ').length).toBe(1);
  });

  it('refuses a muster point buried in a wall', () => {
    // Replaces "the muster point equals the midpoint of the two turrets
    // nearest the fountain" — a formula belonging to `musterPointFor`, deleted
    // long ago. The map declares the point outright now and a person drags it,
    // so what is left to be true of it is that a wave can stand there.
    const issues = errors(
      check(`${laneThrough([[200, 200], [3800, 3800]])}, ${block(400, 400)}`)
    );

    expect(about(issues, 'vòng rải quân').length).toBe(1);
  });

  it('refuses a muster point sitting on a turret', () => {
    // A body inside a turret is shoved out by `UnitCollisionSystem` on the
    // frame it appears, which reads as the wave exploding outward on spawn.
    const issues = errors(
      check(
        `${laneThrough([[200, 200], [3800, 3800]])},
         { type: 'structure', position: [400, 400], props: { faction: 'amber', kind: 'turret' } }`
      )
    );

    expect(about(issues, 'chồng lên thân trụ').length).toBe(1);
  });

  it('names a faction the engine will not seat, and says what it costs', () => {
    /**
     * The editor's own faction list is unbounded (its palette carries four)
     * and `validate.ts` only checks that a slot names one the map declared.
     * Core's bridge, `preset.ts`'s `teamIdOfFaction`, is positional and two
     * deep: `factions[0]` is blue, `factions[1]` is red, everything after is
     * `undefined` — and a slot with no team is dropped when the match is
     * built. No error, no warning, just a turret that is not there.
     *
     * That is precisely the shape this whole module exists to end: one side
     * accepts, the other silently discards.
     */
    const issues = errors(
      check(
        `${laneThrough([[200, 200], [3800, 3800]])},
         { type: 'structure', position: [1000, 1000], props: { faction: 'lam', kind: 'turret' } }`,
        `['amber', 'jade', 'lam']`
      )
    );
    const unseated = about(issues, 'không được xếp vào đội nào');

    expect(unseated).toHaveLength(1);
    expect(unseated[0].text).toContain('lam');
    expect(unseated[0].at).toEqual([1000, 1000]);
  });

  it('says nothing about the two factions it does seat', () => {
    const issues = errors(
      check(
        `${laneThrough([[200, 200], [3800, 3800]])},
         { type: 'structure', position: [1000, 1000], props: { faction: 'jade', kind: 'turret' } }`,
        `['amber', 'jade', 'lam']`
      )
    );

    expect(about(issues, 'không được xếp vào đội nào')).toEqual([]);
  });

  it('refuses a camp whose twin has drifted further than the camp is wide', () => {
    // The tolerance is the camp's own radius, and it is the only threshold in
    // this group nobody chose: a mirror image landing inside the camp is one
    // no player can measure. The 1px the pack used to demand is not a rule
    // about fairness, it is a rule about whether the map was produced by a
    // script.
    //
    // (3200, 3000) misses all three of the frame's symmetries: its half-turn
    // image is 200px away and both flips are further still. A pair that is a
    // mirror under *any* of them is left alone — Twisted Treeline is built on
    // the vertical flip, and the first draft of this rule, which only knew the
    // half-turn, reported that map's whole jungle as broken.
    const issues = errors(
      check(
        `${laneThrough([[200, 200], [3800, 3800]])},
         { type: 'neutral', position: [1000, 1000], props: { role: 'gromp', r: 50 } },
         { type: 'neutral', position: [3200, 3000], props: { role: 'gromp', r: 50 } }`
      )
    );

    expect(about(issues, 'không phải ảnh đối xứng').length).toBe(1);
  });

  it('accepts a twin that drifted less than that', () => {
    const issues = errors(
      check(
        `${laneThrough([[200, 200], [3800, 3800]])},
         { type: 'neutral', position: [1000, 1000], props: { role: 'gromp', r: 50 } },
         { type: 'neutral', position: [3030, 3000], props: { role: 'gromp', r: 50 } }`
      )
    );

    expect(about(issues, 'không phải ảnh đối xứng')).toEqual([]);
  });
});

/**
 * A minion type declared and never fielded.
 *
 * `MinionTuning.types` **replaces** core's three rather than merging into
 * them, and a wave's formation is a list of ids. So there are two ways to end
 * up with minions that exist in the file and not in the match, and both are
 * completely silent — `MinionSpawner.spawn` meets an id its roster does not
 * hold, returns `null`, and logs nothing:
 *
 *   - a map that declares a roster and no formation, where core's default
 *     names melee/ranged/cannon and the new roster supplies none of them, so
 *     **every wave is empty**;
 *   - a map that adds a fourth type and forgets to field it.
 *
 * The second is the likely one, because the editor has a button that seeds
 * core's three and another that adds a type — so the natural way to use the
 * feature lands exactly on it.
 */
describe('a minion roster that can never take the field', () => {
  const roster = (types: string, waves = '') =>
    `{ minions: { types: { ${types} }${waves} } }`;
  const grunt = `grunt: { name: 'Lính Nặng', style: 'melee', speed: 2.6, size: 34,
      health: 200, damage: 8, attackInterval: 1100, attackRange: 40, aggroRange: 300 }`;

  it('refuses a declared roster with no formation at all', () => {
    const issues = errors(
      check(laneThrough([[200, 200], [3800, 3800]]), `['amber', 'jade']`, roster(grunt))
    );

    expect(about(issues, 'MỌI WAVE SẼ RỖNG')).toHaveLength(1);
  });

  it('names the one type a formation forgot', () => {
    const issues = errors(
      check(
        laneThrough([[200, 200], [3800, 3800]]),
        `['amber', 'jade']`,
        roster(`${grunt}, siege: { name: 'Xe', style: 'cannon', speed: 2.6, size: 38,
          health: 300, damage: 10, attackInterval: 1650, attackRange: 300, aggroRange: 360 }`,
          `, waves: { composition: ['grunt', 'grunt'] }`)
      )
    );
    const orphan = about(issues, 'không bao giờ ra sân');

    expect(orphan).toHaveLength(1);
    expect(orphan[0].text).toContain('siege');
  });

  it('says nothing when every declared type is fielded', () => {
    const issues = errors(
      check(
        laneThrough([[200, 200], [3800, 3800]]),
        `['amber', 'jade']`,
        roster(grunt, `, waves: { composition: ['grunt', 'grunt', 'grunt'] }`)
      )
    );

    expect(about(issues, 'ra sân')).toEqual([]);
    expect(about(issues, 'WAVE')).toEqual([]);
  });

  it('says nothing at all about a map that declares no roster', () => {
    // The overwhelmingly common case: core's three, core's formation. A check
    // that spoke here would be noise on every map ever drawn.
    const issues = errors(check(laneThrough([[200, 200], [3800, 3800]])));
    expect(about(issues, 'ra sân')).toEqual([]);
  });
});

/**
 * The editor draws on demand, and that is a trap for anything timed.
 *
 * `render.js`'s loop schedules the next frame only while the camera reports
 * itself unsettled (`Cam.step`). Two things follow, and a player met both:
 * clicking an issue set the camera's target and nothing moved, because
 * `fitRect` does not start a loop; and once the camera *did* arrive the loop
 * stopped, freezing the marker mid-pulse at exactly the moment somebody
 * started looking at it.
 *
 * A source scan rather than a rendered frame: the editor is `<script>` tags
 * over a canvas and there is nothing here to drive one. What can be checked
 * is that the two lines exist, which is what was missing.
 */
describe('the focus animation keeps its own frames coming', () => {
  const source = (name: string): string =>
    readFileSync(resolve(__dirname, '../../src/mapEditor', name), 'utf8');

  it('kicks the render loop when an issue is clicked', () => {
    const ui = source('ui.ts');
    const body = ui.slice(ui.indexOf('function focusIssue'), ui.indexOf('function syncCheck'));

    expect(body).toContain('Cam.fitRect');
    expect(body, 'fitRect only sets a target; something has to ask for a frame').toContain(
      'requestRender()'
    );
  });

  it('keeps drawing while the marker is alive, not only while the camera moves', () => {
    const render = source('render.ts');

    // The camera settling used to be the only reason to schedule another
    // frame, so the pulse died with it.
    expect(render).toContain('if (!settled || E.checkFocus) requestRender();');
    // And the marker has to end itself, or the loop never stops.
    expect(render).toContain('E.checkFocus = null;');
  });
});

/**
 * Furniture has to stand on the ground too.
 *
 * The camp rule ("một bãi nằm trong tường … người ta phát hiện ra chuyện đó
 * trong một trận đấu") had been there for a while and turrets and fountains
 * had nothing, which is backwards: a camp inside a wall is at least a *body*,
 * and every body is swept out of walls now (`TerrainMap.update`). A turret and
 * a fountain are `isImmovable` map furniture — nothing sweeps them, nothing
 * displaces them, and there is no mechanism in a match that could ever fix one.
 * They do not get stuck in a wall; they live there.
 *
 * Centre only, matching the camp rule. Turrets are drawn hard against the edge
 * of a lane on purpose, and a rule that failed on a touching edge would fire on
 * almost every real map.
 */
describe('a turret or a fountain drawn inside a wall', () => {
  it('is an error for the turret', () => {
    const issues = check(`
      ${laneThrough([[400, 400], [3600, 3600]])},
      ${block(2_000, 800)},
      { type: 'structure', position: [2000, 800], props: { faction: 'amber', kind: 'turret' } }
    `);

    expect(about(errors(issues), 'Trụ của phe').length).toBe(1);
  });

  it('and for the fountain, where it costs a respawn every time', () => {
    // `Fountain.randomPointInside` scatters around the centre, so a centre in
    // the wall is a whole respawn area in the wall.
    const issues = check(`
      { type: 'lane', position: [0, 0], polygon: [[400, 400], [3600, 3600]],
        props: { id: 'mid', from: 'amber', to: 'jade' } },
      { type: 'spawn', position: [2000, 800], props: { faction: 'amber', r: 150 } },
      { type: 'spawn', position: [3800, 3800], props: { faction: 'jade', r: 150 } },
      { type: 'minion', position: [400, 400], props: { faction: 'amber', lane: 'mid' } },
      { type: 'minion', position: [3600, 3600], props: { faction: 'jade', lane: 'mid' } },
      ${block(2_000, 800)}
    `);

    expect(about(errors(issues), 'Bệ đá của phe').length).toBe(1);
  });

  /**
   * And the wall is read whichever way it was handed over.
   *
   * Every rule below `prepareWalls` reads a vertex as `pts[i][0]`. Handed a
   * polygon of `{x, y}` — which is the shape `MapGeometry.terrain.wall`
   * actually uses, so the shape somebody will naturally pass — `bounds()`
   * returned NaN, the NaN box intersected nothing, and **the whole wall
   * vanished from every check**. No error, no warning: a map full of walls
   * graded clean.
   *
   * Driven straight at `MapRules` rather than through the editor, because the
   * editor only ever stores pairs — the shape that broke is the one a *caller*
   * supplies, and `lol/tests/maps/mapRules.test.ts` converts by hand today
   * precisely because it had to.
   */
  it('reads a wall given as points as well as one given as pairs', () => {
    const box: [number, number][] = [
      [1_800, 600],
      [2_200, 600],
      [2_200, 1_000],
      [1_800, 1_000],
    ];
    const turret = { x: 2_000, y: 800, faction: 'amber' };
    const rules = loadMapRules();

    const asPairs = rules.structureIssues({ walls: [box], turrets: [turret] });
    const asPoints = rules.structureIssues({
      walls: [box.map(([x, y]) => ({ x, y }))],
      turrets: [turret],
    });

    expect(asPairs.length, 'the fixture does not trip the rule at all').toBe(1);
    expect(asPoints.map(issue => issue.text)).toEqual(asPairs.map(issue => issue.text));
  });

  it('says nothing when they are merely next to one', () => {
    // The falsification, and the case that decides whether the rule is usable:
    // a turret hard against the edge of a wall is how maps are actually drawn.
    const issues = check(`
      ${laneThrough([[400, 400], [3600, 3600]])},
      ${block(2_000, 800)},
      { type: 'structure', position: [2210, 800], props: { faction: 'amber', kind: 'turret' } }
    `);

    expect(about(issues, 'nằm TRONG tường')).toEqual([]);
  });
});
