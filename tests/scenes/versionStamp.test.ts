import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/seams/importScan';

/**
 * The menu's version stamp carries **two** numbers, and they answer different
 * questions.
 *
 * `__APP_VERSION__` is the build clock (`2026.8.25.19.0`) — which build am I
 * on, for "spell X is broken on my machine". `__CORE_VERSION__` is core's
 * semver, and it is the number a content pack's `coreRange` is compared
 * against. They are deliberately not the same value; `scripts/version.mjs`
 * explains why the clock is not semver.
 *
 * The core number is shown because of the failure that put it there. A pack
 * install refused with *"pack lol needs core >=1.4.0, this is 1.3.0"*, on a
 * machine whose `package.json` said 1.4.0 — a dev server that had been up
 * since before the bump was serving the old define. There was **nowhere in the
 * running app** to see which core it actually was, so the only way to find out
 * was to read the refusal, and the refusal is exactly what was in doubt.
 *
 * Hence the rule this file enforces: the stamp must print the *same identifier*
 * the compatibility check reads. A hand-copied literal, or a second source for
 * the same fact, would put the menu and the refusal one bump apart — which is
 * the state that made this hard to diagnose in the first place.
 *
 * Comments are stripped before matching, or this test flags the paragraph you
 * are reading.
 */

const SRC = join(process.cwd(), 'src');
const source = (rel: string) => stripComments(readFileSync(join(SRC, rel), 'utf8'));

describe('the menu version stamp', () => {
  const menu = source('scenes/MenuScene.vue');

  it('prints the build clock', () => {
    expect(menu).toContain('__APP_VERSION__');
  });

  it('prints core’s own version beside it', () => {
    expect(menu).toContain('__CORE_VERSION__');
  });

  it('reads the same identifier the pack check reads, not a copy of it', () => {
    // The whole point. `packSource.ts` is where a refusal's "this is X" comes
    // from; if the menu got its number anywhere else the two could disagree,
    // and the menu would be confirming a lie.
    expect(source('content/packSource.ts')).toContain('__CORE_VERSION__');
  });

  it('does not hardcode a version literal anywhere in the menu', () => {
    // A stamp that says `1.4.0` because someone typed it is worse than no
    // stamp: it is a number that looks authoritative and stops moving.
    expect(menu, 'the menu names a semver literal').not.toMatch(/['"`]\d+\.\d+\.\d+['"`]/);
  });
});
