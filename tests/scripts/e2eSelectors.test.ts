/**
 * An `id` renamed in `src/` costs nothing until somebody runs the browser.
 *
 * `#config-btn` is the worked example. The menu used to carry a Cấu hình link;
 * `MenuScene.ts` then made Chơi open the setup panel directly and the link
 * went away. One script noticed — `drive-menu-flow.mjs` now asserts the id is
 * *absent* — and seven did not, leaving eleven unguarded `page.click(
 * '#config-btn')` calls spread over six files. Every one of them is a
 * thirty-second auto-wait that ends in a timeout, and none of them said so,
 * because `npm run verify` runs no Playwright script at all: the scripts are
 * manual instruments, so a rule about them is only enforced if something
 * inside the Vitest suite enforces it. That is the same argument
 * `e2eHarness.test.ts` opens with, and this is its sibling.
 *
 * So: a static scan, milliseconds, in the gate — CLAUDE.md's idiom #2.
 *
 * ## Only the calls that hang
 *
 * The scan reads `#id` out of the Playwright calls that **throw or hang** when
 * the element is missing (`click`, `waitForSelector`, `fill`, `$eval`, …), and
 * deliberately ignores the ones that answer `null` or `false`:
 * `page.$`, `page.isVisible`, and `document.querySelector` inside an
 * `evaluate`. That is not a technicality, it is the whole distinction between
 * the two ways a script mentions an id it cannot find:
 *
 *   - `await page.click('#config-btn')` — broken, silently, for weeks.
 *   - `check('no Cấu hình link any more', (await page.$('#config-btn')) === null)`
 *     — `drive-menu-flow.mjs:32`, a deliberate assertion *about* the absence.
 *   - `document.querySelector('#stats')` — `drive-touch-controls.mjs`, asking
 *     "is anything profiler-shaped on screen" about a stats.js that was
 *     removed on purpose. A missing element is the answer, not a failure.
 *
 * Flagging the last two would be flagging scripts for being right.
 *
 * ## What counts as an id `src/` can render
 *
 * Three shapes, because the app uses three: a literal `id="…"` in a template
 * or in `index.html` (where the scene roots live — `#menu-scene`,
 * `#pregame-scene`), an `element.id = …` assignment in a `.ts` (`RenderGuard`
 * builds its overlay by hand and names it through an `OVERLAY_ID` constant, so
 * the constant is resolved rather than the assignment being read literally),
 * and a *computed* binding, `:id="`practice-tab-${item.id}`"`, which cannot be
 * enumerated and so contributes a prefix instead. A selector matches a prefix
 * the same way from the other side: `` page.click(`#packs-tab-${name}`) ``
 * is checked as "some id in `src/` starts with `packs-tab-`".
 *
 * ## What this does not catch
 *
 * A script asserting on a *neighbouring* screen — `drive-lan-lobby.mjs` used
 * to check the menu's link shape, which is how a copy edit inside the LAN
 * lobby came back reporting a menu failure. That check named `'config-btn'`
 * as a bare string in a list, never as a selector, so no scan of selectors
 * can see it. The rule against it is in CLAUDE.md and is a rule for authors.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPOSITORY = fileURLToPath(new URL('../..', import.meta.url));
const E2E_DIRECTORY = join(REPOSITORY, 'tests/e2e');

/**
 * Playwright calls that throw or hang on a selector matching nothing — the
 * ones whose failure costs a timeout rather than a `null`. See the header for
 * why `$`, `isVisible` and `querySelector` are pointedly absent.
 */
const BLOCKING_CALL =
  /\.(?:click|waitForSelector|locator|fill|check|inputValue|textContent|getAttribute|dispatchEvent|\$eval|\$\$eval)\(\s*(['"`])([^'"`]*)\1/g;

/** `#id`, ending at whatever CSS or template syntax follows it. */
const SELECTOR_ID = /#([a-zA-Z][\w-]*)(\$\{)?/g;

/** Comments first, or the scan flags the prose that documents it. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\n]*?\/\/[^\n]*$/gm, '');

const walk = (directory: string): string[] =>
  readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

/** Every id `src/` and `index.html` can put in the DOM, plus computed prefixes. */
const collectRenderableIds = (): { ids: Set<string>; prefixes: string[] } => {
  const ids = new Set<string>();
  const prefixes = new Set<string>();

  const sources = [...walk(join(REPOSITORY, 'src')), join(REPOSITORY, 'index.html')].filter(path =>
    ['.vue', '.ts', '.html'].includes(extname(path))
  );

  for (const path of sources) {
    const source = readFileSync(path, 'utf8');

    for (const [, id] of source.matchAll(/\bid="([a-zA-Z][\w-]*)"/g)) ids.add(id);
    for (const [, id] of source.matchAll(/\.id\s*=\s*['"`]([a-zA-Z][\w-]*)['"`]/g)) ids.add(id);

    // `box.id = OVERLAY_ID` — resolved against the constant in the same file,
    // because reading the assignment literally would lose `#render-crash`.
    for (const [, constant] of source.matchAll(/\.id\s*=\s*([A-Z][A-Z0-9_]*)\s*;/g)) {
      const declaration = new RegExp(`\\b${constant}\\s*=\\s*['"\`]([a-zA-Z][\\w-]*)['"\`]`).exec(
        source
      );
      if (declaration) ids.add(declaration[1]);
    }

    // `:id="`practice-tab-${item.id}`"` and `:id="'pregame-input-mode-' + x"`.
    for (const [, prefix] of source.matchAll(/:id="[`']([a-zA-Z][\w-]*?)(?:\$\{|'\s*\+)/g)) {
      prefixes.add(prefix);
    }
  }

  return { ids, prefixes: [...prefixes] };
};

const { ids: renderable, prefixes: renderablePrefixes } = collectRenderableIds();

const scripts = readdirSync(E2E_DIRECTORY).filter(name => name.endsWith('.mjs'));

/** The ids one script waits on, each with the selector it was written as. */
const blockingIds = (name: string): { id: string; computed: boolean }[] => {
  const source = stripComments(readFileSync(join(E2E_DIRECTORY, name), 'utf8'));
  const found = new Map<string, boolean>();

  for (const [, , selector] of source.matchAll(BLOCKING_CALL)) {
    for (const [, id, interpolated] of selector.matchAll(SELECTOR_ID)) {
      found.set(id, found.get(id) === true || interpolated !== undefined);
    }
  }

  return [...found].map(([id, computed]) => ({ id, computed }));
};

const isRenderable = ({ id, computed }: { id: string; computed: boolean }): boolean => {
  if (renderable.has(id)) return true;
  // `#practice-difficulty-easy-${row}` against a `practice-difficulty-` binding:
  // the selector is narrower than the binding, which is the usual direction.
  if (renderablePrefixes.some(prefix => id.startsWith(prefix))) return true;
  if (!computed) return false;
  // The other direction, only open to a computed selector, which names a
  // prefix rather than an id: `` `#packs-tab-${name}` `` is satisfied by the
  // literal `packs-tab-installed`, and `#practice-tab-${id}` by the binding it
  // was written from.
  return (
    [...renderable].some(known => known.startsWith(id)) ||
    renderablePrefixes.some(prefix => prefix.startsWith(id))
  );
};

describe('every id a tests/e2e script waits on is an id src/ can render', () => {
  it('found ids in src, so the scan cannot pass by knowing nothing', () => {
    expect(renderable.size).toBeGreaterThan(50);
    expect(renderable).toContain('play-btn');
  });

  it('found scripts to check, so the scan cannot pass by reading nothing', () => {
    expect(scripts.length).toBeGreaterThanOrEqual(40);
    expect(scripts.flatMap(blockingIds).length).toBeGreaterThan(50);
  });

  it.each(scripts)('%s waits on no id that src/ has stopped rendering', name => {
    const dead = blockingIds(name)
      .filter(entry => !isRenderable(entry))
      .map(entry => `#${entry.id}${entry.computed ? '${…}' : ''}`);

    expect(dead).toEqual([]);
  });
});
