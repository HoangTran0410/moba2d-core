import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bin = resolve(repoRoot, 'node_modules/.bin/moba2d-generate-maps');

/**
 * `moba2d-generate-maps` turns an export from core's own map editor into the
 * two halves a pack ships. The rules it enforces are about *core's* format —
 * `public/map-editor/` writes it — which is why the generator lives here
 * rather than in whichever pack was bitten by them.
 *
 * It was bitten for real. An editor export carries `id`, `name`, `size`,
 * `factions` and `authoring` alongside the geometry, and both call sites
 * built an active map as `{ ...summary, ...geometry }`, so every one of those
 * keys won. `"id": "map-nhap-vao"` — the name a map was drawn under in the
 * editor — became `Game.activeMapId`, went out as the `mapId` in a LAN hello,
 * and a client looking for it in a catalogue holding `lol:twisted-treeline`
 * missed. **A host on that map could not be joined at all.**
 * `src/content/activeMap.ts` closed that from core's side; this closes it
 * from the pack's, by never copying the field in the first place.
 *
 * Every test here spawns the real bin symlink against a synthetic `mkdtemp`
 * tree — never a real pack's `maps/`, whose contents are free to change and
 * which would make core's own `npm run verify` depend on a pack's data.
 * `checkSeams.bin.test.ts` beside this one records what that fixture costs.
 */
const EXPORT = {
  id: 'map-nhap-vao',
  name: 'Twisted Treeline',
  size: 6400,
  factions: [{ id: 'blue' }, { id: 'red' }],
  terrain: { wall: [[{ x: 0, y: 0 }]], bush: [], water: [] },
  slots: { spawn: [{ faction: 'blue', x: 1, y: 2, r: 3 }], minion: [], structure: [], neutral: [] },
  lanes: [{ id: 'mid', from: 'blue', to: 'red', waypoints: [{ x: 0, y: 0 }] }],
  authoring: { terrain: { wall: [[{ x: 0, y: 0 }]] } },
};

let root: string | undefined;

const packWith = async (files: Record<string, unknown>): Promise<string> => {
  root = await mkdtemp(join(tmpdir(), 'moba2d-generate-maps-'));
  await mkdir(join(root, 'maps'));
  for (const [name, data] of Object.entries(files)) {
    await writeFile(join(root, 'maps', name), JSON.stringify(data, null, 2));
  }
  return root;
};

const run = (cwd: string, ...args: string[]) => spawnSync(bin, args, { cwd, encoding: 'utf8' });

const geometryOf = (cwd: string, base: string) =>
  JSON.parse(readFileSync(join(cwd, 'generated/maps', `${base}.geometry.json`), 'utf8'));

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe('moba2d-generate-maps bin', () => {
  it('exists as an executable npm-managed symlink', () => {
    expect(existsSync(bin)).toBe(true);
  });

  /**
   * Resolved against the invoking shell's directory, not against the script's
   * own — the second bug `checkSeams.bin.test.ts` documents, which this bin
   * avoids by construction (`resolve(process.cwd(), …)`) and which nothing
   * else would notice.
   */
  it('writes geometry and meta for an editor export, relative to the invoking directory', async () => {
    const cwd = await packWith({ 'twistedTreeline_map.json': EXPORT });

    const result = run(cwd);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(existsSync(join(cwd, 'generated/maps/twistedTreeline.geometry.json'))).toBe(true);
    expect(existsSync(join(cwd, 'generated/maps/mapMeta.ts'))).toBe(true);
  });

  it('ships exactly terrain, slots and lanes — never the id that cost a map', async () => {
    const cwd = await packWith({ 'twistedTreeline_map.json': EXPORT });
    run(cwd);

    expect(Object.keys(geometryOf(cwd, 'twistedTreeline'))).toEqual(['terrain', 'slots', 'lanes']);
  });

  /**
   * `authoring` is what lets the editor re-open a shipped map and merge its
   * cut polygons back into the shapes they were drawn as, so it stays in the
   * repository — and it is 9.4KB of 71KB for the real Twisted Treeline, so it
   * does not go out to a player.
   */
  it('leaves authoring in the source and out of the bundle', async () => {
    const cwd = await packWith({ 'twistedTreeline_map.json': EXPORT });
    run(cwd);

    expect('authoring' in geometryOf(cwd, 'twistedTreeline')).toBe(false);
    expect(
      JSON.parse(readFileSync(join(cwd, 'maps/twistedTreeline_map.json'), 'utf8')).authoring
    ).toBeDefined();
  });

  it('writes the picker half with no polygons and no id', async () => {
    const cwd = await packWith({ 'twistedTreeline_map.json': EXPORT });
    run(cwd);

    const meta = readFileSync(join(cwd, 'generated/maps/mapMeta.ts'), 'utf8');
    expect(meta).toMatch(/"name":"Twisted Treeline"/);
    expect(meta).toMatch(/"size":6400/);
    expect(meta).not.toMatch(/map-nhap-vao/);
    expect(meta).not.toMatch(/terrain|wall|slots/);
  });

  it("carries a map's own tuning into the picker half, not the geometry", async () => {
    // `tuning` is declared on `MapSummary`, so it has to arrive with the name
    // and the size or `ActiveMap` never sees it. The geometry file is exactly
    // terrain/slots/lanes by construction, which is what would have dropped it.
    const cwd = await packWith({
      'twistedTreeline_map.json': {
        ...EXPORT,
        tuning: { turrets: { damage: 40 }, terrain: { water: { speedMultiplier: 0.5 } } },
      },
    });
    run(cwd);

    const meta = readFileSync(join(cwd, 'generated/maps/mapMeta.ts'), 'utf8');
    expect(meta).toMatch(/"tuning":\{"turrets":\{"damage":40\}/);
    expect(Object.keys(geometryOf(cwd, 'twistedTreeline'))).not.toContain('tuning');
  });

  it('omits the key entirely for a map that tunes nothing', async () => {
    // So a pack that has not opted in generates byte-identically to before
    // this existed, and its staleness check stays quiet.
    const cwd = await packWith({ 'twistedTreeline_map.json': EXPORT });
    run(cwd);

    // The quoted key, not the bare word: the generated header comment
    // legitimately mentions tuning, and asserting on prose would make this
    // case fail the next time that sentence is reworded.
    expect(readFileSync(join(cwd, 'generated/maps/mapMeta.ts'), 'utf8')).not.toMatch(/"tuning"/);
  });

  /**
   * `lanes: undefined` is not the same shape as no `lanes` key: the engine
   * tests for the field on a map with no lanes, and a present-but-undefined
   * key answers a different question.
   */
  it('omits lanes entirely for a map that has none', async () => {
    const { lanes: _lanes, ...noLanes } = EXPORT;
    const cwd = await packWith({ 'arena_map.json': noLanes });
    run(cwd);

    expect('lanes' in geometryOf(cwd, 'arena')).toBe(false);
  });

  /**
   * A pack names these files itself — the editor's own download is
   * `moba2d-map-export.json` — so matching the glob is not a promise about
   * what is inside. Summoner's Rift spent its first life as a file whose root
   * was `wall`/`bush`/`water`/`turret1`/`turret2`, with slots and lanes
   * computed from it in TypeScript rather than read.
   */
  it('leaves a matching file that is not an editor export alone', async () => {
    const cwd = await packWith({
      'twistedTreeline_map.json': EXPORT,
      'summoner_map.json': { wall: [], bush: [], water: [], turret1: [], turret2: [] },
    });
    run(cwd);

    expect(existsSync(join(cwd, 'generated/maps/summoner.geometry.json'))).toBe(false);
    expect(readFileSync(join(cwd, 'generated/maps/mapMeta.ts'), 'utf8')).not.toMatch(/summoner:/);
  });

  it('passes --check when the generated data is current, and fails once the source moves', async () => {
    const cwd = await packWith({ 'twistedTreeline_map.json': EXPORT });
    run(cwd);

    expect(run(cwd, '--check').status).toBe(0);

    await writeFile(
      join(cwd, 'maps/twistedTreeline_map.json'),
      JSON.stringify({ ...EXPORT, size: 6300 }, null, 2)
    );
    const stale = run(cwd, '--check');

    expect(stale.status).toBe(1);
    expect(stale.stderr).toMatch(/stale/);
    expect(stale.stderr).toMatch(/mapMeta\.ts/);
  });

  it('writes nothing under --check', async () => {
    const cwd = await packWith({ 'twistedTreeline_map.json': EXPORT });

    expect(run(cwd, '--check').status).toBe(1);
    expect(existsSync(join(cwd, 'generated/maps'))).toBe(false);
  });

  /**
   * Wiring `maps:generate` into a pack's scripts is the declaration that it
   * has maps drawn in core's editor, which is what makes "found none" worth
   * failing over rather than a silent pass. It is also why the scaffold does
   * *not* wire it: `moba2d-pack-new` writes a hand-written TypeScript map and
   * no export at all, so a scaffolded pack's first `verify` would be red.
   */
  it('fails, rather than passing quietly, when there is nothing to read', async () => {
    root = await mkdtemp(join(tmpdir(), 'moba2d-generate-maps-empty-'));
    await mkdir(join(root, 'maps'));

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/nothing was checked/);
  });

  it('says the same thing when the maps directory is absent, not an ENOENT stack', async () => {
    root = await mkdtemp(join(tmpdir(), 'moba2d-generate-maps-none-'));

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).not.toMatch(/ENOENT/);
    expect(result.stderr).toMatch(/nothing was checked/);
  });

  it('honours --maps and --out for a pack laid out differently', async () => {
    root = await mkdtemp(join(tmpdir(), 'moba2d-generate-maps-layout-'));
    await mkdir(join(root, 'worlds'));
    await writeFile(join(root, 'worlds/arena_map.json'), JSON.stringify(EXPORT));

    const result = run(root, '--maps=worlds', '--out=built');

    expect(result.status).toBe(0);
    expect(existsSync(join(root, 'built/arena.geometry.json'))).toBe(true);
  });
});
