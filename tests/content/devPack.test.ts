import { describe, it, expect } from 'vitest';
import { isDevPackUrl } from '@/content/devPack';

/**
 * The predicate that decides whether a pack is somebody's work in progress.
 *
 * It is the whole of the dev-pack rule's blast radius: everything else keys
 * off this one answer, so the only way the rule can leak onto a real player's
 * install is for this function to say yes to a host it should not. That is
 * why the refusals below are the longer list.
 */
describe('isDevPackUrl', () => {
  it('accepts the loopback hosts a pack author actually serves from', () => {
    for (const url of [
      'http://localhost:5174/manifest.json',
      'http://127.0.0.1:5174/manifest.json',
      'http://[::1]:5174/manifest.json',
      // A dev server behind TLS is still a dev server.
      'https://localhost:5174/manifest.json',
      // RFC 6761 reserves the whole `.localhost` TLD for loopback, and
      // browsers treat it as a trustworthy origin the same way.
      'http://my-pack.localhost:5174/manifest.json',
    ]) {
      expect(isDevPackUrl(url), url).toBe(true);
    }
  });

  it('refuses a public host that merely reads like loopback', () => {
    for (const url of [
      // The one that matters: a substring test would hand a stranger's host
      // every exemption this rule grants.
      'https://localhost.attacker.com/manifest.json',
      'https://127.0.0.1.attacker.com/manifest.json',
      'https://notlocalhost/manifest.json',
      'https://localhost-packs.example/manifest.json',
      'https://example.com/localhost/manifest.json',
      'https://moba2d-packs.github.io/lol/manifest.json',
    ]) {
      expect(isDevPackUrl(url), url).toBe(false);
    }
  });

  it('refuses what it cannot parse rather than guessing', () => {
    for (const url of ['', 'not a url', '//localhost/manifest.json', 'localhost:5174']) {
      expect(isDevPackUrl(url), JSON.stringify(url)).toBe(false);
    }
  });
});
