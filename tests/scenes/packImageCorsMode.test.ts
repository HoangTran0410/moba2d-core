import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One URL must be asked for one way.
 *
 * Pack art is cross-origin now, and the app reaches for the same picture
 * through two different doors: p5's `loadImage`, which opens with
 * `fetch(path, { mode: 'cors' })` to sniff the content type before it builds
 * an `<img>`, and the HUD/roster/packs screens, which put the file straight
 * into a DOM `<img>`. An `<img>` with no `crossorigin` attribute is a
 * **`no-cors`** request, and Chrome keeps one HTTP cache entry per URL
 * whichever mode filled it — so the `no-cors` copy, which carries no recorded
 * `Access-Control-Allow-Origin`, refuses the next `cors` reader. The reported
 * console error named a host that sends `access-control-allow-origin: *` on
 * every response, measured with `curl`; the header was never the problem.
 *
 * `verify-pack-failure-paths.mjs` measures the live consequence in a browser —
 * seven pack images fetched both ways in a single match. This is the cheap
 * half: the rule itself, checked in milliseconds, so the next `<img>` someone
 * adds cannot quietly reopen it.
 *
 * Only bound sources are in scope. A literal `src="..."` is core's own file at
 * a path the bundler wrote, and can never be a pack URL.
 */
const SRC = join(process.cwd(), 'src');

const vueFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...vueFiles(path));
    else if (name.endsWith('.vue')) out.push(path);
  }
  return out;
};

/** Every `<img …>` tag in a file, as raw text. */
const imgTags = (source: string): string[] => source.match(/<img\b[^>]*>/g) ?? [];

/**
 * Comments stripped before matching. The first run of this file counted the
 * `new Image()` inside the very doc comment explaining why `new Image()` needs
 * `crossOrigin`, and reported the fixed code as broken — a scan flagging its
 * own documentation.
 */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('pack art is requested in one CORS mode', () => {
  it('every <img> with a bound src declares crossorigin', () => {
    const offenders: string[] = [];
    for (const file of vueFiles(SRC)) {
      for (const tag of imgTags(readFileSync(file, 'utf8'))) {
        if (!/:src\b|v-bind:src\b/.test(tag)) continue;
        if (/crossorigin/.test(tag)) continue;
        offenders.push(`${file.slice(SRC.length + 1)}: ${tag.replace(/\s+/g, ' ').slice(0, 80)}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('the canvas repaint decodes through a CORS-mode image too', () => {
    const source = code(readFileSync(join(SRC, 'managers', 'AssetManager.ts'), 'utf8'));
    // The one `new Image()` in the codebase, and it feeds `drawImage` — so it
    // both shares the cache entry and decides whether the canvas is tainted.
    const constructions = source.match(/new Image\(\)/g) ?? [];
    expect(constructions).toHaveLength(1);
    expect(source).toMatch(/element\.crossOrigin = 'anonymous';/);
  });

  it('the worker refuses to cache an opaque pack response', () => {
    const source = code(readFileSync(join(SRC, 'sw.ts'), 'utf8'));
    /**
     * The pack route alone. The Font Awesome CDN route above it allows status
     * 0 on purpose and must keep doing so — that script is genuinely served
     * without CORS, and an opaque copy of it is the only offline copy there
     * can be. Checking the file as a whole flagged that deliberate line, which
     * is how this assertion learned to name its own scope.
     */
    const start = source.indexOf('isPackRequest(url.href');
    expect(start, 'the pack route moved — this scan no longer points at it').toBeGreaterThan(-1);
    const packRoute = source.slice(start, source.indexOf('\n);', start));
    // Status 0 is an opaque body. `CacheFirst` would serve it to the next
    // reader, and every pack consumer reads in `cors` mode.
    expect(packRoute).toMatch(/statuses:\s*\[\s*200\s*\]/);
    expect(packRoute).not.toMatch(/statuses:\s*\[\s*0\s*,/);
  });
});
