import { describe, expect, it } from 'vitest';
// @ts-expect-error — a build script, deliberately plain .mjs with no types.
import { renderInstalledPacksSource } from '../../scripts/generate-installed-packs.mjs';

const pack = (name: string) => ({ name, packageName: `@moba2d/content-${name}` });

/**
 * The barrel's text, checked without a checkout to point the generator at.
 *
 * `linked` is the reason this is worth a test of its own: it is the one field
 * whose value is a fact about the machine rather than about the pack, and the
 * failure it guards against is silent — a badge that says "linked" on a pack
 * npm installed, or stays quiet on one that cannot be committed.
 */
describe('renderInstalledPacksSource', () => {
  it('marks a pack that was linked from outside the checkout', () => {
    const source = renderInstalledPacksSource({
      packs: [pack('lol')],
      names: ['lol', 'reference'],
      linked: ['lol'],
    });

    expect(source).toContain('linked: true');
  });

  it('says nothing at all about a pack npm installed', () => {
    // Absent, not `linked: false`: every published build renders this file,
    // and a field that is always false in the one configuration that ships is
    // noise in the diff of every release.
    const source = renderInstalledPacksSource({
      packs: [pack('lol')],
      names: ['lol', 'reference'],
      linked: [],
    });

    expect(source).not.toContain('linked: true');
    expect(source).not.toContain('linked: false');
  });

  it('marks only the packs that are actually linked', () => {
    const source = renderInstalledPacksSource({
      packs: [pack('lol'), pack('dota')],
      names: ['dota', 'lol', 'reference'],
      linked: ['dota'],
    });

    const lolEntry = source.slice(source.indexOf("name: 'lol'"), source.indexOf("name: 'dota'"));
    const dotaEntry = source.slice(source.indexOf("name: 'dota'"));
    expect(lolEntry).not.toContain('linked');
    expect(dotaEntry).toContain('linked: true');
  });

  it('declares the field whether or not anything is linked', () => {
    const source = renderInstalledPacksSource({ packs: [], names: ['reference'], linked: [] });

    expect(source).toContain('readonly linked?: boolean;');
  });
});
