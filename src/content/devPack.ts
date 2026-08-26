/**
 * Whether a pack is somebody's work in progress, served from their own machine.
 *
 * A pack author does not clone core. They scaffold a repository with
 * `moba2d-pack-new`, build it, serve `dist/` locally, and install it into the
 * *hosted* game by pasting a `http://localhost:…/manifest.json` — see
 * `docs/PACK_AUTHORING.md`. Everything core does to make a published pack
 * survive its host moving underneath it then works against them: the manifest
 * is pinned so the next boot needs no network, and the service worker claims
 * the pack's base so its files are answered from cache. Both are exactly right
 * for a player on a train and exactly wrong for someone who just rebuilt.
 *
 * So a pack served from loopback is treated as what it is: never pinned, never
 * cached, re-read from the host on every boot. The cost is that a dev pack has
 * no offline story, which is not a cost — nobody is offline from their own
 * laptop. `PacksScene.vue` labels such a row so the trade is visible where the
 * pack is listed rather than only here.
 *
 * **This predicate is the whole blast radius of that rule**, which is why it
 * compares a parsed `hostname` and never the raw string. `localhost.attacker.
 * com` contains "localhost"; a substring test would hand a stranger's host
 * every exemption above, and the host would be one a player was shown and
 * approved, so nothing downstream would look wrong.
 */

/** The loopback names a browser itself treats as a trustworthy origin. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isDevPackUrl(manifestUrl: string): boolean {
  let host: string;
  try {
    host = new URL(manifestUrl).hostname;
  } catch {
    // Not a URL at all. Nothing that reaches here has been fetched, so the
    // honest answer is "not a dev pack" and the caller's ordinary path —
    // which will fail to fetch it too — reports the real problem.
    return false;
  }
  // `.localhost` is reserved for loopback by RFC 6761, so `my-pack.localhost`
  // is as local as `localhost`. The leading dot is load-bearing:
  // `localhost.attacker.com` does not end with it.
  return LOOPBACK.has(host) || host.endsWith('.localhost');
}
