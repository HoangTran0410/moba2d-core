import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

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

const EDITOR = resolve(__dirname, '../../public/map-editor');
const editorFile = (path: string): string => readFileSync(resolve(EDITOR, path), 'utf8');

interface Issue {
  level: 'error' | 'warn';
  text: string;
  at?: [number, number];
}

/** Boot the editor's globals, install `terrains`, and run its validator. */
function check(terrains: string): Issue[] {
  const store = new Map<string, string>();
  const sandbox: Record<string, unknown> = {
    console,
    JSON,
    Math,
    Date,
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
    document: {
      createElement: () => ({ style: {}, appendChild() {}, click() {}, remove() {} }),
      body: { appendChild() {} },
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(editorFile('lib/decomp.min.js'), context);
  vm.runInContext(editorFile('lib/polygon-clipping.min.js'), context);
  for (const file of ['js/mapRules.js', 'js/geom.js', 'js/state.js', 'js/storage.js']) {
    vm.runInContext(editorFile(file), context);
  }

  return vm.runInContext(
    `
    E.mapName = 'Thử';
    E.mapSize = [4000, 4000];
    E.meta = { id: 'thu', factions: ['amber', 'jade'] };
    E.terrains = [${terrains}].map(normalizeTerrain);
    Store.validate();
    `,
    context
  ) as Issue[];
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
  const source = (path: string): string => editorFile(path);

  it('kicks the render loop when an issue is clicked', () => {
    const ui = source('js/ui.js');
    const body = ui.slice(ui.indexOf('function focusIssue'), ui.indexOf('function syncCheck'));

    expect(body).toContain('Cam.fitRect');
    expect(body, 'fitRect only sets a target; something has to ask for a frame').toContain(
      'requestRender()'
    );
  });

  it('keeps drawing while the marker is alive, not only while the camera moves', () => {
    const render = source('js/render.js');

    // The camera settling used to be the only reason to schedule another
    // frame, so the pulse died with it.
    expect(render).toContain('if (!settled || E.checkFocus) requestRender();');
    // And the marker has to end itself, or the loop never stops.
    expect(render).toContain('E.checkFocus = null;');
  });
});
