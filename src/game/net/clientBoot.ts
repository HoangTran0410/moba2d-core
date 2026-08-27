import { loadSpells } from '@/game/spellRegistry';
import { contentCatalog } from '@/content/catalog';
import type { KitPlan, MatchPlan } from '@/game/preset';
import type { ActiveMap } from '@/content/ContentPack';
import type Game from '@/game/Game';
import { setNetRole, type NetUrlRequest } from './netRole';
import { RelayClientTransport } from './transport';
import { RtcClientTransport } from './RtcTransport';
import { decodeMessage, type NetMessage } from './protocol';
import { ClientSession } from './ClientSession';

/**
 * Everything a net client must have in hand *before* `new Game(...)` can
 * run: the host's hello (which decides the map, the rules, the team and the
 * kit), that map's geometry, and the spell chunks for every champion in the
 * roster. `GameScene.startGame` awaits this in place of its own local
 * planning, constructs the `Game`, then calls `attach` — mirroring the
 * plan-then-load-then-construct order the offline path documents.
 */
export interface NetClientMatch {
  activeMap: ActiveMap;
  plan: MatchPlan;
  attach(game: Game): ClientSession;
}

export const startNetClientMatch = async (request: NetUrlRequest): Promise<NetClientMatch> => {
  const channel =
    request.transport === 'ws'
      ? await RelayClientTransport.connect(request.server, request.room)
      : await RtcClientTransport.connect(request.server, request.room);

  const hello = await channel.waitFor(raw => {
    const message = decodeMessage(raw);
    return message?.t === 'hello' ? (message as Extract<NetMessage, { t: 'hello' }>) : null;
  });

  const yourPlan = hello.you.plan as KitPlan;
  // The gates in AttackableUnit/Spell/MinionSpawner/Game key off this, so it
  // must be set before the constructor runs.
  setNetRole('client', { playerTeam: hello.you.team });

  // Every kit in the roster, so puppets cast their real spells rather than
  // `classForId`'s basic-attack fallback on first contact.
  const spellIds = new Set<string>(yourPlan.spellIds);
  for (const event of hello.roster) {
    if (event.k === 'champ') {
      for (const id of (event.plan as KitPlan).spellIds) spellIds.add(id);
    }
  }
  await loadSpells([...spellIds]);

  const maps = contentCatalog().maps();
  const summary = maps.find(map => map.id === hello.mapId);
  if (!summary) {
    channel.close();
    setNetRole('off');
    throw new Error(`net: host plays on ${hello.mapId}, which this client does not have installed`);
  }
  const geometry = await contentCatalog().loadMapGeometry(summary.id);
  if (!geometry) {
    channel.close();
    setNetRole('off');
    throw new Error(`net: map ${hello.mapId} has no geometry`);
  }

  return {
    activeMap: { ...summary, ...geometry },
    plan: { player: yourPlan, bots: [] },
    attach: game => new ClientSession(game, channel, hello),
  };
};
