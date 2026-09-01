/**
 * The LAN wire format — plain JSON, versioned by shape rather than number
 * for v1. Everything here is pure data and pure functions so the format is
 * testable without a socket, a game, or a browser
 * (`tests/game/net/netProtocol.test.ts` pins it by hand).
 *
 * Snapshots ride as arrays per unit rather than keyed objects: at 15Hz with
 * ~40 live units the field names would be most of the bytes. Positions are
 * rounded to a tenth of a world unit — far below a pixel at any zoom — which
 * is what keeps the JSON affordable on a LAN without inventing a binary
 * format v1 does not need (spec §7).
 */

/** One tracked unit's state inside a snapshot. */
export interface UnitSnap {
  id: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  mp: number;
  dead: boolean;
  /** `Stats.actionState` verbatim — the movement/combat bitmask the HUD and draw paths read. */
  actionState: number;
  /**
   * Champions a *client* is playing, only: `currentCooldown` per kit slot, ms.
   * Every other champion's were being sent to be thrown away — puppet
   * cooldowns run locally off cast events.
   */
  cds?: number[];
  /**
   * The same champions' wallet balance. It rides with `cds` and is packed
   * beside it because the two have exactly one audience — the player whose
   * champion it is, reading their own HUD. Nobody is shown anyone else's gold,
   * so there is no reason for it to cross for anyone else.
   */
  gold?: number;
}

/** A champion entering the world — enough for a client to construct the real thing. */
export interface ChampionSpawnEvent {
  k: 'champ';
  id: string;
  team: string;
  x: number;
  y: number;
  /** A `KitPlan` — already plain serializable data (`preset.ts`). Typed loose here so the protocol stays dependency-free. */
  plan: unknown;
  /**
   * Present when the unit is a summoned `Pet` (a bear, a decoy clone). The
   * client builds a real `Pet` puppet — compact frame and life-timer bar
   * included — with its sim half gated (`Pet.update` returns early on a net
   * client: brain, leash and expiry are host facts arriving as snapshots and
   * 'gone'). `size` is the body (a subclass constructor fact no plan names),
   * `lifeMs` the life *remaining* at broadcast so the timer bar agrees with
   * the host's, `ownerId` the summoner when tracked. The *local* twin is
   * suppressed: the summoning spell also plays out in the client's own sim,
   * and without the gate every summon stood twice (the real-looking local
   * ghost the host knew nothing about, beside an avatar-less puppet).
   */
  pet?: { size: number; lifeMs: number; ownerId?: string };
  /**
   * The host imposed this, rather than echoing back something the client did
   * to itself.
   *
   * A client ignores champ events aimed at its *own* champion, because they
   * are normally the echo of a đổi tướng it already applied locally — playing
   * it back would re-apply what is already true. But the host is the
   * authority, and its panel can change a client's champion too: that event
   * has to land, or the two ends spend the rest of the match disagreeing
   * about who the player is.
   */
  imposed?: true;
}

export interface MinionSpawnEvent {
  k: 'minion';
  id: string;
  team: string;
  lane: string;
  kind: string;
  x: number;
  y: number;
}

/**
 * What is in a champion's bag, by qualified item id, one entry per slot and
 * `null` for an empty one.
 *
 * An event rather than a snapshot field because a bag changes on a purchase
 * and then not again for a minute, while a snapshot is thirty frames a second
 * of things that move. The client rebuilds the real `HeldItem` from the id —
 * the same `buildHeldItem` a purchase uses — so the icons, the passives, the
 * actives and the stat modifiers are the genuine articles rather than a
 * picture of them.
 */
export interface BagEvent {
  k: 'bag';
  id: string;
  items: (string | null)[];
}

/** The unit left the world entirely (corpse swept, not merely dead). */
export interface GoneEvent {
  k: 'gone';
  id: string;
}

/**
 * Whether anybody is still driving this champion.
 *
 * Not a state of the *unit* — it is fully in the match either way, and can be
 * killed while `on` is false, because a body that became invulnerable the
 * moment its phone locked would be an exploit worth causing on purpose. It is
 * a fact about the wire, and it exists so the other players can tell a
 * champion that is standing still on purpose from one whose player is gone.
 *
 * The host derives it from silence, not from a close: a backgrounded tab stops
 * running without closing anything, which is exactly the case a `gone` could
 * never describe (`HostSession.sweepLostPeers`).
 */
export interface LinkEvent {
  k: 'link';
  id: string;
  on: boolean;
}

/**
 * A damage number over `id`'s head — the post-mitigation figure the host's
 * own `CombatText` just floated. A client cannot compute any of these (its
 * `takeDamage` is gated shut), so without this stream a LAN client's match
 * has no floating numbers at all. Rides the ordinary per-tick event flush;
 * the client replays it through the same `CombatText.show`, whose per-victim
 * merge then behaves exactly as it does on the host.
 */
export interface DamageNumberNetEvent {
  k: 'dmg';
  id: string;
  /** The shown (post-mitigation, pre-pool-cap) number. */
  a: number;
  /** `DamageType` — picks the colour, and with it the merge key. */
  ty: string;
}

/**
 * A champion committed a basic attack on `tid`. Champions only: their swings
 * come from `BasicAttackController`, which never fires on a client's
 * order-less puppets — while minions, monsters and turrets run their own
 * local swing timers on both ends and need no forwarding (forwarding them
 * would double every bolt). The client replays through
 * `BasicAttackController.replayLaunch`; the carrier's damage dies in the
 * gated funnel.
 */
export interface AttackLaunchNetEvent {
  k: 'atk';
  id: string;
  tid: string;
}

/**
 * A champion changed form: `stance` is the pack's own id, or `null` back to
 * the base kit. `slots` maps a **slot index** to the qualified spell id now
 * filling it — keyed rather than positional, because slot 0 is the basic
 * attack (`SpellSlot`) and a positional list is how the host and the client
 * end up disagreeing about which three abilities changed.
 *
 * An event and not a snapshot field, for the same reason `BagEvent` is one: a
 * form changes twice a fight and then not at all, while a snapshot is thirty
 * frames a second of things that move. Diffed in `discover` and *also* carried
 * in the hello, again like the bag — a diff only speaks on change, so a
 * champion already transformed when a client joined would never announce it,
 * and that client would spend the form looking at the wrong four icons.
 *
 * The ids rather than the classes because a client resolves them through the
 * same registry a spawn does, and may have to `loadSpells` a chunk it has
 * never fetched — a form's abilities are their own lazy chunks, exactly like
 * every other spell in a pack.
 */
export interface StanceEvent {
  k: 'stance';
  id: string;
  stance: string | null;
  slots: Record<string, string>;
}

/** A committed cast — the client plays the spell's visual half from this. */
export interface CastEvent {
  k: 'cast';
  id: string;
  slot: number;
  x: number;
  y: number;
}

export type NetEvent =
  | ChampionSpawnEvent
  | MinionSpawnEvent
  | GoneEvent
  | LinkEvent
  | BagEvent
  | StanceEvent
  | CastEvent
  | DamageNumberNetEvent
  | AttackLaunchNetEvent;

export type NetMessage =
  | { t: 'snap'; tm: number; units: UnitSnap[] }
  | { t: 'ev'; ev: NetEvent[] }
  | {
      t: 'hello';
      tm: number;
      mapId: string;
      rules: { cooldownMultiplier: number; manaFree: boolean };
      you: { id: string; team: string; plan: unknown };
      roster: NetEvent[];
      /**
       * The manifest URLs of every content pack the host has installed.
       *
       * A client that lacks the host's pack used to be told
       * *"host plays on lol:summoners-rift, which this client does not have
       * installed"* and dropped — a dead end for the ordinary case of a
       * friend opening the game for the first time, since the pack is a URL
       * and installing it is something the client can simply *do*. The map is
       * only the half that failed loudest: the roster's spells come from the
       * same packs.
       *
       * Optional so a host on an older build still hands out a usable hello;
       * the client then fails the way it always did.
       */
      packs?: string[];
      /**
       * `Game.matchSeed` — the one random number both ends derive from.
       *
       * A client *builds* the jungle rather than receiving it (see `you`
       * above: the two sides are matched by construction order), so anything a
       * pack randomises has to start from a number the host chose. Optional
       * for the same reason `packs` is: a host on an older build hands out a
       * usable hello, and a client that gets none keeps the seed it drew
       * itself — which is exactly the behaviour that shipped before this
       * field, so nothing gets worse.
       */
      seed?: number;
    }
  | { t: 'move'; x: number; y: number }
  /**
   * The virtual joystick: `to` is the world point the thumb is pushing
   * toward — the lookahead `Game.steerPlayer` computes — and `null` is the
   * thumb lifting.
   *
   * Deliberately *not* folded into `move`. The host applies `move` through
   * `issuePointerOrder`, which promotes a point landing on an enemy into an
   * attack order: right for a right-click, wrong for a stick, where the
   * lookahead is only "the way I am pushing" and sweeping it across a minion
   * would make the champion charge in. A steer drops the standing attack
   * order instead, exactly as `steerPlayer` does locally.
   *
   * The release carries as much as the push. Without it the host's copy walks
   * on to a lookahead point the thumb has already abandoned, and
   * reconciliation drags the client along behind it — the stick would let go
   * and the champion would keep going.
   */
  | { t: 'steer'; to: { x: number; y: number } | null }
  /**
   * `row` picks which bar the slot indexes: the kit by default, the bag when
   * it says `'item'`. Both rows count from zero, so without it an item active
   * in slot 1 fires the champion's Q — which is what a LAN client's item
   * actives did, for as long as they were purely local and therefore did
   * nothing at all.
   */
  | { t: 'cast'; slot: number; x: number; y: number; row?: 'item' }
  /** Release the charge `cast` started, aimed where the drag ended. Without it, min-charge only. */
  | { t: 'rel'; slot: number; x: number; y: number; row?: 'item' }
  /** The player called a running charge off — mirror of the local cancel. */
  | { t: 'stop'; slot: number; row?: 'item' }
  /**
   * The shop, from a client. All three go to the host and come back as
   * facts — a `bag` event and the wallet in the next snapshot — because the
   * gold and the fountain rule are the host's, and a client that spent its
   * own copy of either would be shopping in a shop that does not exist.
   */
  | { t: 'buy'; itemId: string }
  | { t: 'sell'; slot: number }
  | { t: 'swap'; a: number; b: number }
  /**
   * Take back / redo the last transaction. Carries nothing: the history is
   * the host's, one stack per champion, recorded inside `buyItem`/`sellItem`
   * — so "the last one" is a fact the host already holds and a client naming
   * a step could only get wrong. See `economy/ShopHistory.ts`.
   */
  | { t: 'undo' }
  | { t: 'redo' }
  /** The client changed its own kit (đổi tướng); `plan` is a `KitPlan` (`kitWire.ts` validates). */
  | { t: 'loadout'; plan: unknown }
  /** The minimap's tap-teleport — wire-only on a client, or reconciliation just snaps it back. */
  | { t: 'tp'; x: number; y: number }
  /** The client switched its own side (Đội tab). Host validates against its own team ids. */
  | { t: 'team'; team: string }
  /**
   * Host → one client: your champion died, and this is its recap — killer
   * plus the last seconds' damage ledger, which only the host's sim ever
   * wrote (`AttackableUnit.deathRecap`; a client's `takeDamage` is gated).
   */
  | { t: 'died'; recap: unknown }
  | { t: 'recall' }
  /**
   * Client → host, first frame after the channels open: who this is, for the
   * lobby's player list. It is the *only* message either side sends before a
   * match exists, and it is deliberately not part of the hello: the hello is
   * the host telling a client what match it has joined, and at this point
   * there is no match — the host is still looking at its room code.
   *
   * A host that has already started ignores it (`HostSession` decodes it and
   * finds nothing to do), which is exactly right: a late joiner is not
   * entering a lobby, it is entering a game.
   */
  | { t: 'iam'; name: string; seat?: string; packs?: string[] }
  /**
   * Client → host, on a timer: still here.
   *
   * Silence is the only thing a host can observe about a peer that stopped
   * running, and without this it cannot tell *idle* from *gone* — a player
   * standing still sends nothing, and so does a phone whose screen went off.
   * `reliable.onclose` is not the answer on its own: it is what a clean
   * departure sends, and a backgrounded mobile tab makes no such departure,
   * which is how a champion came to stand in a match its player had left
   * (`HostSession.PEER_LOST_MS`).
   *
   * A frozen page runs no timers, so the silence starts immediately and ends
   * the moment the tab is resumed — the property this relies on, and the
   * reason it is a client timer rather than a host poll.
   *
   * Optional in every sense: a client on an older build simply never sends
   * one, and `HostSession` treats a peer it has never heard a ping from as
   * one it cannot judge, rather than sweeping it.
   */
  | { t: 'ping' }
  /**
   * Client → host: I am leaving on purpose.
   *
   * The one thing a closing channel cannot say for itself. A host sees the
   * same `left` whether the tab was closed, the page reloaded, or the network
   * dropped — and the right answer differs: a player who *quit* should take
   * their champion with them, while a page that reloaded is about to come
   * straight back and wants it kept (`netSeat.ts`).
   *
   * Without this the reconnect cannot work at all, because reconnecting *is* a
   * reload: the channel closes cleanly on the way out, the host sweeps, and
   * the returning player finds nothing left to reclaim. So departure is
   * announced and absence is inferred, rather than both being guessed from
   * one event.
   */
  | { t: 'bye' }
  /**
   * Host → one client: you are out.
   *
   * Sent before the socket is dropped, and it is not a courtesy. On a wire
   * that holds a connection per peer the drop alone would do
   * (`RtcHostTransport.dropPeer`), but a *relay* host has no frame for closing
   * somebody else's socket — the relay's protocol does not carry one — so
   * without this a kicked joiner keeps a live channel to a room that has
   * forgotten it, and sits in a lobby it is no longer in.
   *
   * The client leaves on its own when it reads this, which makes the two
   * transports behave the same from the player's side.
   */
  | { t: 'kicked' }
  /**
   * Host → everyone, whenever the room's membership changes: who is in it.
   *
   * Broadcast rather than addressed, so one message serves every screen, and
   * `host: true` is how each client knows which row is the person who
   * decides when the match starts. Nobody is told which row is *itself* —
   * the list is short and both ends already know their own name.
   */
  | { t: 'lobby'; players: LobbyPlayer[] };

/** One row of the lobby's player list. */
export interface LobbyPlayer {
  id: string;
  name: string;
  host?: boolean;
  /**
   * Set only while a peer is *not* simply present — mid-handshake, or one
   * whose handshake died (`transport.ts`'s `PeerLink`). Absent is the normal
   * case, which keeps an ordinary roster exactly the shape it has always been.
   *
   * **Host-side only, by construction.** `decodeMessage` rebuilds each row
   * from `id`/`name`/`host` and drops everything else, so this never survives
   * the wire — which is right twice over: a peer that cannot be reached cannot
   * receive the broadcast that describes it, and a client has no use for the
   * host's view of somebody else's handshake.
   */
  link?: 'connecting' | 'failed';
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

type UnitRow = [string, number, number, number, number, number, number, number, ...number[]];

const packUnit = (unit: UnitSnap): UnitRow => {
  const row: UnitRow = [
    unit.id,
    round1(unit.x),
    round1(unit.y),
    Math.round(unit.hp),
    Math.round(unit.maxHp),
    Math.round(unit.mp),
    unit.dead ? 1 : 0,
    unit.actionState,
  ];
  // The tail is "this is a client's own champion": gold first, then one
  // cooldown per kit slot. They are written and read together because they are
  // sent together — for exactly the champions a client is playing — which is
  // what keeps a variable-length tail unambiguous without a length field.
  if (unit.cds || unit.gold !== undefined) {
    row.push(Math.round(unit.gold ?? 0));
    if (unit.cds) row.push(...unit.cds.map(cd => Math.round(cd)));
  }
  return row;
};

const unpackUnit = (row: unknown): UnitSnap | null => {
  if (!Array.isArray(row) || row.length < 8 || typeof row[0] !== 'string') return null;
  const numbers = row.slice(1);
  if (!numbers.every(value => typeof value === 'number')) return null;
  const unit: UnitSnap = {
    id: row[0],
    x: row[1],
    y: row[2],
    hp: row[3],
    maxHp: row[4],
    mp: row[5],
    dead: row[6] === 1,
    actionState: row[7],
  };
  if (row.length > 8) {
    unit.gold = row[8] as number;
    if (row.length > 9) unit.cds = row.slice(9) as number[];
  }
  return unit;
};

export const encodeMessage = (message: NetMessage): string => {
  if (message.t === 'snap') {
    return JSON.stringify({ t: 'snap', tm: message.tm, u: message.units.map(packUnit) });
  }
  return JSON.stringify(message);
};

/**
 * Tolerant by design: a frame from a mismatched build, a relay system
 * notice, or plain garbage answers `null` and the session skips it — a
 * malformed packet must never take the match down.
 */
export const decodeMessage = (raw: unknown): NetMessage | null => {
  if (typeof raw !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const message = parsed as Record<string, unknown>;
  switch (message.t) {
    case 'snap': {
      if (typeof message.tm !== 'number' || !Array.isArray(message.u)) return null;
      const units: UnitSnap[] = [];
      for (const row of message.u) {
        const unit = unpackUnit(row);
        if (unit) units.push(unit);
      }
      return { t: 'snap', tm: message.tm, units };
    }
    case 'ev':
      return Array.isArray(message.ev) ? (parsed as NetMessage) : null;
    case 'hello':
      return typeof message.mapId === 'string' && typeof message.you === 'object'
        ? (parsed as NetMessage)
        : null;
    case 'steer': {
      // `null` is the release and is a whole message, not a missing field —
      // an absent `to` is a malformed frame and must not read as "let go".
      if (message.to === null) return { t: 'steer', to: null };
      if (typeof message.to !== 'object') return null;
      const { x, y } = message.to as Record<string, unknown>;
      return typeof x === 'number' && typeof y === 'number' ? { t: 'steer', to: { x, y } } : null;
    }
    case 'move':
    case 'tp':
      return typeof message.x === 'number' && typeof message.y === 'number'
        ? (parsed as NetMessage)
        : null;
    case 'died':
      return typeof message.recap === 'object' && message.recap !== null
        ? (parsed as NetMessage)
        : null;
    case 'team':
      return typeof message.team === 'string' ? { t: 'team', team: message.team } : null;
    case 'iam':
      // The seat is rebuilt field by field like every other decoded frame, and
      // bounded like the name beside it: it is matched against a map key on
      // the host, so an unbounded string off the wire has no business becoming
      // one. A frame from a client that predates seats simply carries none.
      return typeof message.name === 'string'
        ? {
            t: 'iam',
            name: message.name.slice(0, 40),
            ...(typeof message.seat === 'string' && message.seat
              ? { seat: message.seat.slice(0, 64) }
              : {}),
            // The client's own pack list, so the host can offer to install
            // what it is missing — the mirror of `hello.packs`, which has
            // always gone the other way. Bounded in both directions because
            // it is a list off the wire that a person will be shown.
            ...(Array.isArray(message.packs)
              ? {
                  packs: message.packs
                    .filter((url): url is string => typeof url === 'string')
                    .slice(0, 16)
                    .map(url => url.slice(0, 512)),
                }
              : {}),
          }
        : null;
    case 'ping':
      return { t: 'ping' };
    case 'bye':
      return { t: 'bye' };
    case 'kicked':
      return { t: 'kicked' };
    case 'lobby': {
      if (!Array.isArray(message.players)) return null;
      const players: LobbyPlayer[] = [];
      for (const row of message.players) {
        if (typeof row !== 'object' || row === null) continue;
        const { id, name, host } = row as Record<string, unknown>;
        if (typeof id !== 'string' || typeof name !== 'string') continue;
        players.push({ id, name: name.slice(0, 40), host: host === true });
      }
      return { t: 'lobby', players };
    }
    case 'cast':
    case 'rel':
      return typeof message.slot === 'number' ? (parsed as NetMessage) : null;
    case 'stop':
      return typeof message.slot === 'number'
        ? { t: 'stop', slot: message.slot, ...(message.row === 'item' ? { row: 'item' } : {}) }
        : null;
    case 'buy':
      return typeof message.itemId === 'string' ? { t: 'buy', itemId: message.itemId } : null;
    case 'sell':
      return typeof message.slot === 'number' ? { t: 'sell', slot: message.slot } : null;
    case 'swap':
      return typeof message.a === 'number' && typeof message.b === 'number'
        ? { t: 'swap', a: message.a, b: message.b }
        : null;
    case 'loadout':
      return typeof message.plan === 'object' && message.plan !== null
        ? (parsed as NetMessage)
        : null;
    case 'undo':
    case 'redo':
      return { t: message.t };
    case 'recall':
      return { t: 'recall' };
    default:
      return null;
  }
};
