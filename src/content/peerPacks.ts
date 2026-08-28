import { ref } from 'vue';
import { readInstalledPacks } from './installedPackStore';

/**
 * Content the *other* players have and this machine does not.
 *
 * Packs install per player, not per match. A host and its client routinely
 * hold different content — that is what installing one at runtime is for —
 * and until now only one direction of that was handled: `hello.packs` tells a
 * joining client what the host has, and `clientBoot.ts` installs the lot
 * before the match is built. Nothing went the other way, so a host whose
 * client picked a champion from a pack the host had never downloaded showed a
 * placeholder tile for the rest of the match and never said why.
 *
 * ## Why the host asks and the client does not
 *
 * The client's auto-install is defensible because a client *chose* that host:
 * joining a room is a deliberate act aimed at one person, the way opening a
 * link is. A host is in the opposite position — rooms are listed in a public
 * directory and anyone with the code may join — so "install whatever a peer
 * names" would let any joiner put a URL of their choosing into a host's
 * `import()`. A content pack is not data: it is spell classes, real code, run
 * on the machine that installs it.
 *
 * So this side offers rather than acts. The host sees which pack, from which
 * origin, and presses. That is one press per unfamiliar pack per lifetime of
 * the install, against the alternative of a room code being enough to run code
 * on a stranger's machine.
 *
 * Dependency-free apart from `vue` and the store it reads, for the same reason
 * `packHealth.ts` is: both the menu's chunk and the match's chunk reach this,
 * and `scripts/check-chunks.mjs` forbids the edge that a heavier import would
 * create.
 */

/** One pack a peer is playing with that this machine cannot resolve. */
export interface PeerPack {
  manifestUrl: string;
  /** Filled in once fetched; the URL is all that is known before that. */
  name?: string;
  /** `true` while this machine is fetching and installing it. */
  installing?: boolean;
  /** Set when an attempted install failed, so the row can offer a retry. */
  failed?: boolean;
}

/**
 * The offers currently outstanding. Empty is the ordinary case — everybody
 * has the same content — and nothing renders.
 */
export const peerPacks = ref<PeerPack[]>([]);

/** Dismissed for this match; the player said no and should not be asked again. */
export const peerPacksDismissed = ref(false);

/**
 * Note what a peer says it has, keeping only what this machine lacks.
 *
 * Called with the peer's whole list rather than a diff, because the peer does
 * not know what we have — and comparing here means the check is against
 * storage as it is *now*, so a pack installed between two peers arriving stops
 * being offered without anyone having to withdraw it.
 *
 * Only ever adds. A row is removed by installing it or by dismissing the lot;
 * a second client arriving with the same pack must not reset a row the host is
 * already part-way through.
 */
export function notePeerPacks(manifestUrls: readonly string[]): void {
  const installed = new Set(readInstalledPacks().map(record => record.manifestUrl));
  const offered = new Set(peerPacks.value.map(pack => pack.manifestUrl));
  const added: PeerPack[] = [];
  for (const manifestUrl of manifestUrls) {
    if (!manifestUrl || installed.has(manifestUrl) || offered.has(manifestUrl)) continue;
    offered.add(manifestUrl);
    added.push({ manifestUrl });
  }
  if (added.length) peerPacks.value = [...peerPacks.value, ...added];
}

/** The origin a row is asking to run code from — the part worth reading. */
export function peerPackOrigin(manifestUrl: string): string {
  try {
    return new URL(manifestUrl).origin;
  } catch {
    return manifestUrl;
  }
}

export function forgetPeerPack(manifestUrl: string): void {
  peerPacks.value = peerPacks.value.filter(pack => pack.manifestUrl !== manifestUrl);
}

function patchPeerPack(manifestUrl: string, patch: Partial<PeerPack>): void {
  peerPacks.value = peerPacks.value.map(pack =>
    pack.manifestUrl === manifestUrl ? { ...pack, ...patch } : pack
  );
}

/**
 * Fetch and install one offered pack, because the player asked.
 *
 * `runtimePacks` is imported **dynamically**, never at the top of this file:
 * it reaches `ContentApi` and `install.ts`, i.e. the engine, and a static
 * import here would drag the whole match into the menu's chunk with nothing on
 * screen looking wrong. Exactly the rule `packHealth.ts`'s own consumers
 * follow, and `scripts/check-chunks.mjs` is what enforces it.
 *
 * Answers whether it worked rather than throwing: the caller is a button.
 */
export async function acceptPeerPack(manifestUrl: string): Promise<boolean> {
  patchPeerPack(manifestUrl, { installing: true, failed: false });
  try {
    const [{ fetchPackManifest }, { installPackNow }] = await Promise.all([
      import('./packSource'),
      import('./runtimePacks'),
    ]);
    const manifest = await fetchPackManifest(manifestUrl);
    await installPackNow(manifestUrl, manifest);
    forgetPeerPack(manifestUrl);
    return true;
  } catch (error) {
    console.warn(`net: could not install a peer's pack ${manifestUrl}`, error);
    patchPeerPack(manifestUrl, { installing: false, failed: true });
    return false;
  }
}

export function resetPeerPacksForTests(): void {
  peerPacks.value = [];
  peerPacksDismissed.value = false;
}
