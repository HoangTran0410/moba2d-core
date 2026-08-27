import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanImports, stripComments } from '@/seams/importScan';

/**
 * The LAN lobby — reachable from the menu, before any match exists — must not
 * drag `src/game/` in.
 *
 * Same seam as `aboutBootPath.test.ts` and for the same reason: `MenuScene.ts`
 * reaches this screen with a dynamic `import()`, so it gets its own chunk and a
 * value import of a `src/game/` runtime symbol inside it would sit *behind*
 * that boundary — invisible to `menuBootPath.test.ts` and to `chunks:check`'s
 * MenuScene rule alike, and visible to a player only as "why does opening the
 * lobby fetch a megabyte".
 *
 * The temptation here is real in a way it is not on the About screen: this
 * screen's whole job is to start a networked match, so reaching for
 * `game/net/netRole` to set the role, or for `GameScene` to show it, both read
 * as the obvious thing to write. Neither is: the handover is the URL
 * (`?net=host|join&room=…`, written with `history.replaceState`) and the door
 * is `gamePreload.loadGameScene`, a function that performs the dynamic import.
 * `scenes/lanSignal.ts` exists so the broker arithmetic can be shared with
 * `src/game/net/` without an import in this direction.
 *
 * Comments are stripped before matching, or this test flags the paragraph you
 * are reading.
 */
const SRC = join(__dirname, '../../src');

const LAN_FILES = ['scenes/LanScene.ts', 'scenes/LanScene.vue', 'scenes/lanSignal.ts'];

/**
 * Static `import ... from '<spec>'` only, value ones — `import(` is dynamic,
 * `import type` is erased, and a side-effect `import 'x';` is not a shape this
 * family of tests has ever checked for.
 */
function staticImports(source: string): string[] {
  return scanImports(source)
    .filter(({ kind }) => kind === 'value')
    .map(({ specifier }) => specifier);
}

const reachesGame = (specifier: string): boolean =>
  specifier.includes('@/game/') ||
  specifier.includes('/game/') ||
  /(^|\/)GameScene$/.test(specifier);

describe('the LAN lobby boots without the game', () => {
  it('finds the files it claims to check', () => {
    for (const file of LAN_FILES) {
      expect(() => readFileSync(join(SRC, file), 'utf8'), `${file} is missing`).not.toThrow();
    }
  });

  it('no LAN-screen module statically imports the game', () => {
    const offenders: string[] = [];

    for (const file of LAN_FILES) {
      const source = stripComments(readFileSync(join(SRC, file), 'utf8'));
      for (const specifier of staticImports(source)) {
        if (reachesGame(specifier)) offenders.push(`${file} -> ${specifier}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('MenuScene reaches it only through a dynamic import', () => {
    const source = stripComments(readFileSync(join(SRC, 'scenes/MenuScene.ts'), 'utf8'));
    expect(staticImports(source).some(specifier => /LanScene/.test(specifier))).toBe(false);
    expect(source).toMatch(/import\(['"]\.\/LanScene['"]\)/);
  });

  /**
   * The lobby's own way into a match, and the reason this file does not simply
   * ban every mention of the game: `LanScene.ts` is *supposed* to reach
   * `GameScene`, through the same `gamePreload` door the menu uses, so that a
   * press collects the warm-up the menu already started instead of beginning a
   * fresh fetch.
   */
  it('starts a match through gamePreload rather than importing GameScene', () => {
    const source = stripComments(readFileSync(join(SRC, 'scenes/LanScene.ts'), 'utf8'));
    expect(source).toContain('loadGameScene');
    expect(staticImports(source)).toContain('./gamePreload');
  });

  /**
   * The handover is the URL, and it has to stay that way: it is what lets a
   * hand-typed `?net=join&room=…` and this screen be the same code path, and
   * what keeps `GameScene.startGame` the only place that knows how a session
   * is armed.
   */
  it('hands the match its net role through the URL, not through the game', () => {
    const source = stripComments(readFileSync(join(SRC, 'scenes/LanScene.vue'), 'utf8'));
    expect(source).toContain('history.replaceState');
    expect(source).toMatch(/params\.set\(['"]net['"]/);
    expect(source).toMatch(/params\.set\(['"]room['"]/);
    // And the leave path clears them, or the menu's Chơi silently hosts a LAN
    // match — the exact trap the drawer this screen replaced used to set.
    expect(source).toMatch(/params\.delete\(['"]net['"]/);
    expect(source).toMatch(/params\.delete\(['"]room['"]/);
  });

  /**
   * The lobby's wait for the host is real net code — transports, the protocol,
   * a live channel parked for the match — and it lives in `src/game/net/`
   * where it belongs. The lobby reaches it the only way it may: dynamically.
   * A static import here would be invisible in review and would put the whole
   * match in this screen's chunk.
   */
  it('waits for the host through a dynamic import of the net layer', () => {
    const source = stripComments(readFileSync(join(SRC, 'scenes/LanScene.vue'), 'utf8'));
    expect(staticImports(source).some(specifier => /lobbyJoin/.test(specifier))).toBe(false);
    expect(source).toMatch(/import\(['"]@\/game\/net\/lobbyJoin['"]\)/);
    expect(source).toContain('waitForHostToStart');
  });

  /**
   * The same rule for the other half. Hosting now opens the wire at Tạo phòng
   * so the room's player list is live, which is more net code on this screen's
   * path — and the same dynamic boundary keeps it off the chunk.
   */
  it('opens its room through a dynamic import too', () => {
    const source = stripComments(readFileSync(join(SRC, 'scenes/LanScene.vue'), 'utf8'));
    expect(staticImports(source).some(specifier => /lobbyHost/.test(specifier))).toBe(false);
    expect(source).toMatch(/import\(['"]@\/game\/net\/lobbyHost['"]\)/);
    expect(source).toContain('openRoom');
    expect(source).toContain('closeRoom');
  });

  it('the scan can see a violation it is meant to catch', () => {
    const sample = `
      import { setNetRole } from '@/game/net/netRole';
      import type Game from '@/game/Game';
      const later = () => import('./GameScene');
    `;
    expect(staticImports(sample).filter(reachesGame)).toEqual(['@/game/net/netRole']);
  });
});
