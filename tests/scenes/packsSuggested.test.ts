import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SUGGESTED_PACKS } from '@/scenes/packs/suggestedPacks';

/**
 * The pack shelf, and the one rule it must not break.
 *
 * `SUGGESTED_PACKS` is meant to be appended to by hand — see its own header —
 * so what is checked here is shape, not wording: an entry needs an id, a
 * name, a description, and two `https://` URLs. Nothing pins copy, or every
 * retune of a description would mean editing a test.
 *
 * The rule is the last case. Being on the shelf buys a pack a button, not
 * trust: `installSuggested` fills the URL field and runs the same `checkUrl`
 * a pasted URL runs, so `PackInstallConfirm.vue`'s origin disclosure stands
 * in front of a suggested pack exactly as it stands in front of a stranger's.
 * Wiring that button straight to the install is a two-line change that looks
 * like a convenience and quietly deletes the whole security model — and
 * nothing else in `verify` would notice, because the pack it skips the
 * disclosure for is the one this repository publishes and trusts.
 */
const SRC = join(__dirname, '../../src');
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('SUGGESTED_PACKS (scenes/packs/suggestedPacks.ts)', () => {
  it('is not empty', () => {
    expect(SUGGESTED_PACKS.length).toBeGreaterThan(0);
  });

  it('every entry has an id, a name, a description and two https URLs', () => {
    for (const pack of SUGGESTED_PACKS) {
      expect(pack.id.trim().length, 'an entry has no id').toBeGreaterThan(0);
      expect(pack.name.trim().length, `"${pack.id}" has no name`).toBeGreaterThan(0);
      expect(pack.description.trim().length, `"${pack.id}" has no description`).toBeGreaterThan(0);
      expect(pack.manifestUrl.startsWith('https://'), `"${pack.id}" manifestUrl is not https`).toBe(
        true
      );
      expect(pack.repoUrl.startsWith('https://'), `"${pack.id}" repoUrl is not https`).toBe(true);
    }
  });

  it('no two entries share a manifest URL', () => {
    const seen = new Set(SUGGESTED_PACKS.map(pack => pack.manifestUrl));
    expect(seen.size).toBe(SUGGESTED_PACKS.length);
  });

  it('an entry that declares a logo declares an https one', () => {
    for (const pack of SUGGESTED_PACKS) {
      if (pack.icon === undefined) continue;
      expect(pack.icon.startsWith('https://'), `"${pack.id}" icon is not https`).toBe(true);
    }
  });
});

/**
 * The line between the two screens that show a pack.
 *
 * A shelf card may paint the pack's own logo: that entry was written into
 * core's own source next to the origin core is about to send the player to,
 * so the artwork adds no trust the listing did not already extend. The
 * install confirmation may not, and the difference is not cosmetic — the
 * manifest behind that dialog came from wherever the player pasted, and a
 * hostile pack able to paint its own logo on the screen where trust is
 * decided can dress itself up as one the player already knows. `spec §3.2`
 * says an icon is for an *installed* pack only, `resolvePackIcon` is the
 * function that honours it, and this is the scan that stops the shelf's new
 * field being plumbed one component further along by someone who reads the
 * two screens as the same screen.
 */
describe('the install confirmation wears no pack-supplied art', () => {
  const CONFIRM = join(SRC, 'scenes/packs/PackInstallConfirm.vue');

  it('names no icon at all', () => {
    const source = stripComments(readFileSync(CONFIRM, 'utf8'));
    expect(source).not.toMatch(/\bicon\b/);
  });

  it('the scan can see the plumbing it is meant to catch', () => {
    const planted = stripComments("<img :src=\"manifest.icon\" />");
    expect(planted).toMatch(/\bicon\b/);
  });
});

describe('the shelf does not shortcut the origin disclosure', () => {
  const source = stripComments(readFileSync(join(SRC, 'scenes/PacksScene.vue'), 'utf8'));

  /**
   * Every mention of `installPackNow` is inside `confirmInstall` — the one
   * function reachable only once `checkUrl` has set `pendingManifest`, i.e.
   * only once the confirmation has been shown and pressed through. It is
   * named twice in there (the dynamic-import destructure, then the call), so
   * the property is *where* it is named and not how often.
   */
  it('names installPackNow only inside the confirm path', () => {
    const body = source.match(/const confirmInstall = async \(\)[\s\S]*?\n\};/);
    expect(body, 'PacksScene.vue no longer declares confirmInstall').not.toBeNull();
    const inside = (body![0].match(/installPackNow/g) ?? []).length;
    const total = (source.match(/installPackNow/g) ?? []).length;
    expect(inside, 'confirmInstall does not call installPackNow at all').toBeGreaterThan(0);
    expect(total, `${total - inside} mention(s) of installPackNow outside confirmInstall`).toBe(
      inside
    );
  });

  /**
   * And the guard that makes the single call site unreachable without a
   * confirmation. Without it, pressing Cài could call `confirmInstall`
   * directly and the one-mention check above would still pass.
   */
  it('confirmInstall refuses to run without a manifest the player was shown', () => {
    expect(source).toMatch(/if \(installing\.value \|\| !pendingManifest\.value\) return;/);
  });

  it('the shelf button runs the same check a pasted URL runs', () => {
    const handler = source.match(/const installSuggested =[\s\S]*?\n\};/);
    expect(handler, 'PacksScene.vue no longer declares installSuggested').not.toBeNull();
    expect(handler![0]).toContain('checkUrl()');
    expect(handler![0]).not.toContain('installPackNow');
  });

  it('the scan can see the shortcut it is meant to catch', () => {
    const sample =
      'const installSuggested = (pack) => {\n  void installPackNow(pack.manifestUrl);\n};';
    const handler = sample.match(/const installSuggested =[\s\S]*?\n\};/);
    expect(handler![0]).toContain('installPackNow');
    expect(handler![0]).not.toContain('checkUrl()');
  });
});
