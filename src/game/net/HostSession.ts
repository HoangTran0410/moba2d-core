import type Game from '@/game/Game';
import type GameObject from '@/game/gameObject/GameObject';
import AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import Champion, {
  DEFAULT_CHAMPION_ATTACK,
  DEFAULT_CHAMPION_DEFENCE,
} from '@/game/gameObject/attackableUnits/Champion';
import type { DamageNumberEvent } from '@/game/gameObject/attackableUnits/AttackableUnit';
import type { AttackLaunchEvent } from '@/game/combat/BasicAttackController';
import Minion from '@/game/gameObject/attackableUnits/Minion';
import Pet from '@/game/gameObject/attackableUnits/Pet';
import Monster from '@/game/gameObject/attackableUnits/Monster';
import Turret from '@/game/gameObject/structures/Turret';
import type Spell from '@/game/gameObject/Spell';
import EventType from '@/game/enums/EventType';
import TeamId from '@/game/enums/TeamId';
import { issuePointerOrder } from '@/game/input/PointerOrders';
import {
  attachRecall,
  planRandomKit,
  presetFromPlan,
  type KitPlan,
  type MatchPlan,
} from '@/game/preset';
import { loadSpells, spellIdOfClass } from '@/game/spellRegistry';
import { asKitPlan, planFromPreset } from './kitWire';
import { notePeerPacks } from '@/content/peerPacks';
import { isMatchTeamId } from '@/game/config/MatchTeams';
import { setNetRole, type NetUrlRequest } from './netRole';
import { disarmNetUrl } from '@/scenes/lanSignal';
import { readInstalledPacks } from '@/content/installedPackStore';
import { buyItem, sellItem } from '@/game/economy/ItemShop';
import { redoShop, undoShop } from '@/game/economy/ShopHistory';
import { contentCatalog } from '@/content/catalog';
import type { CastPhase } from '@/game/spell/input/SpellInputController';
import type { ChampionPresetData } from '@/game/gameObject/attackableUnits/Champion';
import { RelayHostTransport, type HostFrameEvent, type HostTransport } from './transport';
import { RtcHostTransport } from './RtcTransport';
import { takeHostedTransport } from './lobbyHost';
import {
  decodeMessage,
  encodeMessage,
  type NetEvent,
  type NetMessage,
  type UnitSnap,
} from './protocol';
import type { NetGameHooks } from './hooks';
import type { Vec2 } from '@/game/spell/runtime/types';

/** 30Hz — LoL's own simulation quantum; LAN bandwidth makes the doubling free. */
const SNAPSHOT_INTERVAL_MS = 33;
/** The bar a wire slot indexes — the kit unless the message says the bag. */
const spellOnRow = (champion: Champion, slot: number, row: 'item' | undefined): Spell | undefined =>
  row === 'item' ? (champion.items[slot]?.active ?? undefined) : champion.spells[slot];

/** A bag as it goes on the wire: one qualified id per slot, `null` for empty. */
const bagOf = (champion: Champion): (string | null)[] => {
  const ids: (string | null)[] = [];
  for (const held of champion.items) ids.push(held?.def.id ?? null);
  return ids;
};

/**
 * A champion's form as it goes on the wire: the stance id and the ids of the
 * spells standing in the slots it swapped.
 *
 * Reads the *live* `spells[]` rather than anything the stance remembered,
 * because that array is what the client has to end up matching — and it is
 * the same array `HostSession` already addresses casts and cooldowns by
 * index into.
 */
export const stanceSignatureOf = (stance: {
  stance: string | null;
  slots: Record<string, string>;
}): string =>
  // `null` gets a marker of its own rather than folding to `''`. A pack may
  // legally name a form with the empty string, and collapsing the two would
  // make leaving *that* form a change the diff cannot see.
  //
  // Slots are sorted before joining: `Object.entries` order is insertion
  // order, so the same form built in a different order would otherwise look
  // like a change and re-send every tick it was rebuilt.
  `${stance.stance === null ? '\u0000none' : stance.stance}\u0000${Object.entries(stance.slots)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([slot, id]) => `${slot}:${id}`)
    .join('\u0000')}`;

const stanceOf = (
  champion: Champion
): { stance: string | null; slots: Record<string, string> } => {
  const slots: Record<string, string> = {};
  // Only the slots the stance actually took, which the champion already has
  // to remember in order to give them back — so the wire says exactly what
  // changed rather than restating a whole kit the client already has.
  for (const index of champion.stanceSlots) {
    const spell = champion.spells[index];
    slots[String(index)] = spellIdOfClass(spell?.constructor as never) ?? 'BasicAttack';
  }
  return { stance: champion.stance, slots };
};

/** What this host has installed, so a joiner can install the same. */
const installedManifestUrls = (): string[] => {
  const urls: string[] = [];
  for (const record of readInstalledPacks()) urls.push(record.manifestUrl);
  return urls;
};

/**
 * How long a unit may go unmentioned before it is re-sent whether it changed
 * or not — the floor under `snapshotUnits`' delta on a lane that drops.
 */
const SNAPSHOT_HEARTBEAT_MS = 1000;

/**
 * How long a peer may go completely silent before its champion is treated as
 * unattended.
 *
 * Clients ping on a timer (`protocol.ts`'s `ping`), and a page that is not
 * running does not run timers — so silence past a few ping intervals means the
 * tab is frozen, backgrounded or gone, not that the player is standing still.
 * Generous enough to ride out a lane change or a lock screen glance; short
 * enough that the other players see the ⏸ before they wonder.
 */
const PEER_SILENT_MS = 8_000;

/**
 * How long an unattended champion is kept for its player to come back to.
 *
 * The champion is *held*, not frozen out of the match: it stands there and can
 * still be killed, because a body that becomes invulnerable the moment its
 * phone sleeps is an exploit. What the hold buys is that reconnecting inside
 * this window gives the player their own champion back — the gold, the bag and
 * the death they missed — instead of a fresh one beside their own corpse.
 *
 * A *clean* departure is not this case and never waits: `left` still sweeps at
 * once (`handleEvent`), because a player who pressed Thoát has said what they
 * want. This window is only for the departure that sends nothing, which is
 * every backgrounded phone.
 */
const PEER_LOST_MS = 120_000;

/**
 * How long `onClientJoined` waits to learn which seat a joiner is in.
 *
 * The seat rides `iam`, which a client sends as its first frame — so this is
 * nearly always already answered by the time the joiner's spell chunks have
 * loaded, and the wait costs nothing. It exists for the ordering it cannot
 * assume: build a champion before the seat is known and a reconnecting player
 * gets a second one, which is the bug this whole mechanism is about. A client
 * too old to send a seat simply spends this long joining.
 */
const SEAT_GRACE_MS = 1_500;
/** The recall pseudo-slot in cast events: `Champion.recall` deliberately lives outside `spells[]`. */
export const RECALL_SLOT = 100;

/**
 * The authoritative end of a LAN match. Attached to a fully-constructed,
 * otherwise ordinary `Game` — the host's match is not gated in any way; this
 * class only *observes* it (snapshots, cast events, unit discovery by
 * diffing `objectManager.objects` against its own id map, so no spawner or
 * spell ever needed a hook) and *feeds* it remote players' orders through
 * the same seams local input uses.
 */
export class HostSession implements NetGameHooks {
  private ids = new Map<GameObject, string>();
  private tracked = new Map<string, AttackableUnit>();
  /** Champion name at last broadcast — a random bot re-rolls its kit on respawn, and the client needs the new one. */
  private championNames = new Map<Champion, string>();
  private championPlans = new Map<Champion, KitPlan>();
  private nextId = 1;
  private clients = new Map<string, Champion>();
  /**
   * Seat → the champion that seat holds, which is not the same map as
   * `clients` above and is the whole point: `clients` is keyed by *peer id*,
   * one per `RTCPeerConnection`, so a player who reconnects arrives under a
   * name the host has never seen and used to be handed a second champion
   * while the first went on standing in the match. See `netSeat.ts`.
   */
  private seats = new Map<string, Champion>();
  /** Which seat a live peer is sitting in, learned from its `iam`. */
  private seatOfPeer = new Map<string, string>();
  /** When each live peer was last heard from at all — any frame counts. */
  private heardAt = new Map<string, number>();
  /**
   * A champion whose player stopped talking without ever saying goodbye, and
   * the match time it went quiet. Held rather than swept so the player can
   * take it back; swept once `PEER_LOST_MS` says nobody is coming.
   */
  private vacated = new Map<Champion, number>();
  /**
   * Peers that announced a deliberate departure (`bye`) — so the `left` that
   * follows sweeps rather than holding the seat open for a return that was
   * never coming.
   */
  private quitting = new Set<string>();
  /** Joins parked until their `iam` arrives — see `SEAT_GRACE_MS`. */
  private seatWaiters = new Map<string, (seat: string | null) => void>();
  /** Last `deathRecap.seq` forwarded per client champion — see `forwardClientDeaths`. */
  private sentRecapSeq = new WeakMap<Champion, number>();
  private pendingEvents: NetEvent[] = [];
  /** e2e-readable counters — see the dev handle in the constructor. */
  readonly debugStats = { snapshotsSent: 0, eventsSent: 0, castsSeen: 0 };
  private lastSnapshotAt = 0;
  /** Bag contents at last broadcast, per champion — see `discover`. */
  private bagSignatures = new WeakMap<Champion, string>();
  private stanceSignatures = new WeakMap<Champion, string>();
  /** The champion whose side change is a client's own doing — see `onTeamChanged`. */
  private teamEchoFor: Champion | null = null;
  /** Per-unit "what we last put on the wire, and when" — see `snapshotUnits`. */
  private lastRowSent = new Map<string, { row: string; at: number }>();
  private stopCastListener: () => void;
  private stopDamageListener: () => void;
  private stopAttackListener: () => void;
  private stopAnnounceListener: () => void;

  constructor(
    private readonly game: Game,
    private readonly transport: HostTransport,
    plan: MatchPlan | null
  ) {
    setNetRole('host');
    game.net = this;

    // The roster the match booted with, with its real plans — the player
    // first (it is the first `addObject` in the constructor), then the bots
    // in construction order, which is `plan.bots` order.
    this.track(game.player, plan?.player ?? null);
    const bots = game.director.bots();
    bots.forEach((bot, index) => this.track(bot, plan?.bots[index] ?? null));

    this.stopCastListener = game.eventManager.on(EventType.ON_POST_CAST_SPELL, (spell: Spell) =>
      this.onCast(spell)
    );
    // Every damage number the host floats, forwarded — a client's own
    // `takeDamage` is gated, so this stream is the only source it has.
    // Batched into the ordinary per-tick event flush, not sent per hit.
    this.stopDamageListener = game.eventManager.on(
      EventType.ON_TAKE_DAMAGE,
      (hit: DamageNumberEvent) => {
        const id = this.ids.get(hit.unit);
        if (!id) return;
        this.pendingEvents.push(
          hit.crit
            ? { k: 'dmg', id, a: hit.amount, ty: hit.type, c: 1 }
            : { k: 'dmg', id, a: hit.amount, ty: hit.type }
        );
      }
    );
    // Every kill the feed announces, forwarded: a client's deaths arrive as a
    // snapshot flag with no killer attached, so it cannot narrate them itself.
    // The unit references stay here; the wire carries names, art and ids.
    this.stopAnnounceListener = game.announcer.onAnnounce(announcement => {
      const { killerUnit, victimUnit, ...wire } = announcement;
      const kid = killerUnit ? this.ids.get(killerUnit) : undefined;
      const vid = victimUnit ? this.ids.get(victimUnit) : undefined;
      this.pendingEvents.push({ k: 'ann', a: { ...wire, kid, vid } });
    });
    // Champion swings, forwarded — the one attack the client cannot produce
    // locally: minions/monsters/turrets swing on their own timers there, but
    // a champion's controller fires only on orders, which puppets never hold.
    this.stopAttackListener = game.eventManager.on(
      EventType.ON_ATTACK_LAUNCH,
      (swing: AttackLaunchEvent) => {
        if (!(swing.attacker instanceof Champion)) return;
        const id = this.ids.get(swing.attacker);
        const tid = this.ids.get(swing.target);
        if (id && tid) this.pendingEvents.push({ k: 'atk', id, tid });
      }
    );

    // Orders apply the instant the wire delivers them — between ticks, not
    // queued to one. JS's single thread makes this safe (a message handler
    // never lands inside a half-finished tick), and it shaves the last
    // 0-16ms off remote input.
    transport.setImmediate(event => this.handleEvent(event));

    // Dev-only handle for the e2e driver (`tests/e2e/drive-lan-sync.mjs`),
    // the same convention as `window.__moba2d`. Stripped from production.
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__moba2dNet = this;
    }
  }

  static async attach(
    game: Game,
    request: NetUrlRequest,
    plan: MatchPlan | null
  ): Promise<HostSession> {
    // The lobby's own room, when the host came through it — already open,
    // already holding whoever was waiting in it. Taking it rather than
    // dialling again is what makes "wait for your friends, then start" work
    // at all: a second connection would reclaim the room from the first
    // (`scripts/net-relay.mjs`: "last host wins") and every client sitting in
    // the lobby would be talking to a socket nobody reads.
    //
    // The transport it hands back replays one `joined` per waiting peer the
    // moment the constructor subscribes — see `lobbyHost.ts`, which is where
    // that has to happen, because `joined` is the only thing that makes this
    // class build a champion for a client.
    const held = takeHostedTransport(request);
    if (held) return new HostSession(game, held, plan);

    // The room's player-facing name in the lobby's same-network listing.
    const roomName = `Trận của ${game.player.name}`;
    const transport =
      request.transport === 'ws'
        ? await RelayHostTransport.connect(request.server, request.room, roomName)
        : await RtcHostTransport.connect(request.server, request.room, roomName);
    return new HostSession(game, transport, plan);
  }

  // ------------------------------------------------------------- tracking

  /** Deterministic ids for the units both sides build from the same map data. */
  private idFor(unit: AttackableUnit): string {
    if (unit instanceof Turret) return `t${this.game.turrets.indexOf(unit)}`;
    if (unit instanceof Monster) return `m${this.game.monsters.indexOf(unit)}`;
    return `u${this.nextId++}`;
  }

  private track(unit: AttackableUnit, plan: KitPlan | null): string {
    const id = this.idFor(unit);
    this.ids.set(unit, id);
    this.tracked.set(id, unit);
    if (unit instanceof Champion) {
      this.championNames.set(unit, unit.name);
      const kitPlan = plan ?? this.planFromLiveChampion(unit);
      this.championPlans.set(unit, kitPlan);
      this.pendingEvents.push(this.championEvent(id, unit));
    } else if (unit instanceof Minion) {
      this.pendingEvents.push({
        k: 'minion',
        id,
        team: unit.teamId,
        lane: unit.lane,
        kind: unit.kind,
        x: unit.position.x,
        y: unit.position.y,
      });
    }
    return id;
  }

  private championEvent(id: string, unit: Champion, imposed = false): NetEvent {
    return {
      k: 'champ',
      id,
      ...(imposed ? { imposed: true as const } : {}),
      team: unit.teamId,
      x: unit.position.x,
      y: unit.position.y,
      plan: this.championPlans.get(unit) ?? this.planFromLiveChampion(unit),
      // A summon carries its looks and its clock — the facts a plan cannot:
      // body size is the pet subclass's own constructor decision, and the
      // remaining life is what keeps the client's timer bar honest.
      ...(unit instanceof Pet
        ? {
            pet: {
              size: unit.stats.size.baseValue,
              lifeMs: unit.remainingMs,
              ownerId: this.ids.get(unit.ownerUnit),
            },
          }
        : {}),
    };
  }

  /**
   * A serializable kit for a champion whose original plan is gone — a random
   * bot after a respawn re-roll. `spellIdOfClass` recovers the spell ids; the
   * tunings fall to defaults and the portrait to a placeholder, which the
   * spec's own cuts section owns up to. A champion whose kit change came
   * through `onLoadoutApplied` never needs this — that path carries the real
   * preset.
   */
  private planFromLiveChampion(unit: Champion): KitPlan {
    return {
      name: unit.name,
      // The live handle keeps its pack asset key, so the puppet gets the real
      // portrait — a pet used to cross as `''` and stand there as "1 tướng
      // không avatar". `null` (core's own default body) still falls to ''.
      avatar: unit.avatar?.key ?? '',
      attack: DEFAULT_CHAMPION_ATTACK,
      defence: DEFAULT_CHAMPION_DEFENCE,
      spellIds: unit.spells.map(spell => spellIdOfClass(spell.constructor) ?? 'BasicAttack'),
    };
  }

  // ------------------------------------------------------------ per tick

  update(): void {
    this.applyClientFrames();
    this.sweepLostPeers();
    this.discover();
    this.forwardClientDeaths();
    // Events flush every tick (and casts flush inside `onCast` the moment
    // they commit) — holding them to the snapshot cadence was measured as
    // the largest slice of the v1 input latency (66ms of a 67ms total).
    this.flushEvents();
    if (this.game.matchTimeMs - this.lastSnapshotAt >= SNAPSHOT_INTERVAL_MS) {
      this.lastSnapshotAt = this.game.matchTimeMs;
      this.debugStats.snapshotsSent++;
      this.broadcast({ t: 'snap', tm: this.game.matchTimeMs, units: this.snapshotUnits() });
    }
  }

  /** New units get spawn events; vanished units get `gone`. Nothing is hooked — the world is diffed. */
  private discover(): void {
    const seen = new Set<AttackableUnit>();
    for (const object of this.game.objectManager.objects) {
      if (!(object instanceof AttackableUnit)) continue;
      const trackable =
        object instanceof Champion ||
        object instanceof Minion ||
        object instanceof Monster ||
        object instanceof Turret;
      if (!trackable) continue;
      seen.add(object);
      if (!this.ids.has(object)) {
        this.track(object, null);
        continue;
      }
      // A random bot that respawned as somebody else: re-broadcast its kit.
      if (object instanceof Champion && this.championNames.get(object) !== object.name) {
        this.championNames.set(object, object.name);
        this.championPlans.set(object, this.planFromLiveChampion(object));
        this.pendingEvents.push(this.championEvent(this.ids.get(object)!, object));
      }
      // And the bag, diffed the same hook-free way the world itself is: a
      // purchase, a sale, a combine and a drag all end as a different list of
      // ids in the same slots, and none of them has to know a socket exists.
      if (object instanceof Champion) {
        const bag = bagOf(object);
        const signature = bag.join('|');
        if (this.bagSignatures.get(object) !== signature) {
          this.bagSignatures.set(object, signature);
          this.pendingEvents.push({ k: 'bag', id: this.ids.get(object)!, items: bag });
        }
        // And the form, diffed the same hook-free way: entering, leaving and
        // swapping straight from one form to another all end as a different
        // pair of (stance, slot ids), and none of them has to know a socket
        // exists. The spell ids are part of the signature, not just the
        // stance id, so a pack that swaps a form's contents without renaming
        // the form still crosses.
        const stance = stanceOf(object);
        const stanceSignature = stanceSignatureOf(stance);
        if (this.stanceSignatures.get(object) !== stanceSignature) {
          this.stanceSignatures.set(object, stanceSignature);
          this.pendingEvents.push({ k: 'stance', id: this.ids.get(object)!, ...stance });
        }
      }
    }
    for (const [unit, id] of this.ids) {
      const attackable = unit as AttackableUnit;
      if (!seen.has(attackable) && (attackable.toRemove || !this.stillQueued(attackable))) {
        this.ids.delete(unit);
        this.tracked.delete(id);
        this.lastRowSent.delete(id);
        this.pendingEvents.push({ k: 'gone', id });
      }
    }
  }

  /** A unit spawned this very tick sits in `_objectToBeAdd` until the next pass — not gone. */
  private stillQueued(unit: AttackableUnit): boolean {
    return this.game.objectManager._objectToBeAdd.includes(unit);
  }

  /**
   * A snapshot carries what changed, plus a heartbeat.
   *
   * A snapshot used to be every tracked unit every 33ms, which for a turret
   * meant re-sending a position that is a constant for the whole match and a
   * health bar that moves for maybe twenty seconds of it — measured at ~27%
   * of a 5v5 snapshot, forever, for nothing. Idle jungle camps are the same
   * shape, and so is every corpse.
   *
   * Omission is safe because `InterpolationBuffer.sample` walks the *newest*
   * snapshot and leaves anything missing from it alone: an absent unit keeps
   * the state it was last given rather than vanishing. Champions and marching
   * minions change every tick and are therefore in every snapshot anyway, so
   * nothing that moves is affected.
   *
   * The heartbeat is what makes it safe on the *lossy* lane. A delta that is
   * dropped is a fact the client never hears, so every unit is re-sent at
   * least this often regardless — one second of a stale turret bar is the
   * worst a lost packet can now cost, and it costs it to one unit rather than
   * to the frame.
   */
  private snapshotUnits(): UnitSnap[] {
    const units: UnitSnap[] = [];
    // Only a champion a *client* is playing needs cooldowns: the client reads
    // them for its own HUD and throws away every other champion's, because
    // puppet cooldowns run locally off cast events (`ClientSession.
    // applyUnitSnap` says so). Bots and the host's own champion were paying
    // an array of numbers a tick for nobody.
    const clientChampions = new Set<Champion>(this.clients.values());
    const now = this.game.matchTimeMs;
    for (const [id, unit] of this.tracked) {
      const snap: UnitSnap = {
        id,
        x: unit.position.x,
        y: unit.position.y,
        hp: unit.stats.health.value,
        maxHp: unit.stats.maxHealth.value,
        mp: unit.stats.mana.value,
        dead: !!unit.isDead,
        actionState: unit.stats.actionState,
      };
      if (unit instanceof Champion && clientChampions.has(unit)) {
        snap.cds = unit.spells.map(spell => spell.currentCooldown);
        snap.gold = unit.wallet?.balance ?? 0;
      }
      const row = JSON.stringify(snap);
      const last = this.lastRowSent.get(id);
      if (last && last.row === row && now - last.at < SNAPSHOT_HEARTBEAT_MS) continue;
      this.lastRowSent.set(id, { row, at: now });
      units.push(snap);
    }
    return units;
  }

  /**
   * A dead client deserves to know what killed it. The recap ledger is
   * written only where damage actually resolves — here, `takeDamage` being
   * gated on clients — so each client champion's `deathRecap` is forwarded
   * the tick it changes, and the client overlays it on its own (empty) one.
   * `seq` is the dedupe: one message per death, not one per tick spent dead.
   */
  private forwardClientDeaths(): void {
    for (const [clientId, champion] of this.clients) {
      const recap = champion.deathRecap;
      if (!recap || this.sentRecapSeq.get(champion) === recap.seq) continue;
      this.sentRecapSeq.set(champion, recap.seq);
      this.sendTo(clientId, { t: 'died', recap });
    }
  }

  private onCast(spell: Spell): void {
    const owner = spell.owner as AttackableUnit | undefined;
    if (!owner || !(owner instanceof Champion)) return;
    const id = this.ids.get(owner);
    if (!id) return;
    let slot = owner.spells.indexOf(spell);
    if (slot < 0) {
      if (spell === owner.recall) slot = RECALL_SLOT;
      else return; // an item active — items are not synced in v1
    }
    const aim = spell.castContext?.cursorWorld ?? owner.position;
    this.debugStats.castsSeen++;
    this.pendingEvents.push({ k: 'cast', id, slot, x: aim.x, y: aim.y });
    // On the wire this tick, not the next snapshot: a cast is the single
    // most latency-visible event in the game.
    this.flushEvents();
  }

  private flushEvents(): void {
    if (this.pendingEvents.length === 0) return;
    this.debugStats.eventsSent += this.pendingEvents.length;
    this.broadcast({ t: 'ev', ev: this.pendingEvents });
    this.pendingEvents = [];
  }

  // ----------------------------------------------------- clients & orders

  /** Anything queued before the immediate handler was armed. */
  private applyClientFrames(): void {
    for (const event of this.transport.drain()) this.handleEvent(event);
  }

  private handleEvent(event: HostFrameEvent): void {
    if (event.kind === 'joined') {
      void this.onClientJoined(event.peerId);
      return;
    }
    if (event.kind === 'left') {
      // A *clean* departure — the channel closed, so the player pressed Thoát
      // or shut the tab, and has said what they want. The champion goes with
      // them: marked for the ordinary sweep, which `discover()` notices and
      // broadcasts as 'gone', so every other client's puppet disappears too.
      //
      // Deliberately not the reconnect case, and the distinction is the fix.
      // A backgrounded phone closes nothing — it simply stops — so it never
      // reaches here, and `sweepLostPeers()` below is what eventually judges
      // it. Holding *this* case open for a reclaim would leave a body standing
      // for two minutes after someone deliberately quit.
      const champion = this.clients.get(event.peerId);
      const deliberate = this.quitting.delete(event.peerId);
      this.releasePeer(event.peerId);
      this.clients.delete(event.peerId);
      if (!champion) return;
      if (!deliberate) {
        // A close nobody announced: a reload, a crash, a network that went
        // away. Reconnecting *is* a reload — the overlay does exactly that —
        // so sweeping here would delete the champion a returning player is
        // about to ask for, milliseconds before they ask. Hold the seat and
        // let `sweepLostPeers` be the one that eventually gives up.
        this.vacated.set(champion, this.game.matchTimeMs);
        this.pendingEvents.push(this.linkEvent(champion, false));
        return;
      }
      this.vacated.delete(champion);
      for (const [seat, held] of this.seats) if (held === champion) this.seats.delete(seat);
      champion.toRemove = true;
      this.championNames.delete(champion);
      this.championPlans.delete(champion);
      return;
    }
    const message = decodeMessage(event.raw);
    if (!message) return;
    // Anything at all from a peer proves it is still running, which is the
    // only thing `sweepLostPeers` can observe. Above the champion gate on
    // purpose: a peer whose champion is still being built, and one whose
    // champion is gone, are both still alive.
    this.heardAt.set(event.peerId, this.game.matchTimeMs);
    if (message.t === 'ping') return;
    if (message.t === 'bye') {
      this.quitting.add(event.peerId);
      return;
    }
    if (message.t === 'iam') {
      this.onSeatDeclared(event.peerId, message.seat ?? null, message.packs);
      return;
    }
    const champion = this.clients.get(event.peerId);
    if (!champion) return;
    // A kit change is legal on a corpse — picking the next champion while
    // waiting to respawn is half the point of a practice lobby — so it is
    // routed above the dead-champion gate every *order* stops at.
    if (message.t === 'loadout') {
      void this.onClientLoadout(champion, message.plan);
      return;
    }
    if (champion.isDead) return;
    this.applyOrder(champion, message);
  }

  /**
   * A client changed its own kit. The mirror of `onLoadoutApplied`'s send:
   * validate the plan (wire data is `unknown`), fetch the spell chunks this
   * host may never have seen (a champion the host player never picked), then
   * apply and re-broadcast so every other client's puppet follows. The full
   * bars mirror `MatchDirector.applyLoadout`'s own contract — the try-out
   * starts at full — through the same `refill` the panel uses.
   */
  private async onClientLoadout(champion: Champion, raw: unknown): Promise<void> {
    const plan = asKitPlan(raw);
    if (!plan) return;
    await loadSpells(plan.passiveId ? [...plan.spellIds, plan.passiveId] : plan.spellIds);
    if (champion.toRemove || !this.ids.has(champion)) return;
    champion.applyPreset(presetFromPlan(plan));
    this.game.director.refill(champion);
    this.championNames.set(champion, champion.name);
    this.championPlans.set(champion, plan);
    this.pendingEvents.push(this.championEvent(this.ids.get(champion)!, champion));
  }

  private applyOrder(champion: Champion, message: NetMessage): void {
    if (message.t === 'move') {
      issuePointerOrder(champion, this.game.objectManager, { x: message.x, y: message.y });
      return;
    }
    if (message.t === 'steer') {
      // The stick's own semantics rather than `move`'s: no promotion to an
      // attack order, and the standing one drops. This mirrors
      // `Game.steerPlayer` onto the authoritative copy — the two must agree
      // or the client predicts a walk while the host plants a chase.
      if (!message.to) {
        champion.stopMovement();
        return;
      }
      champion.basicAttack?.clear();
      champion.moveTo(message.to.x, message.to.y);
      return;
    }
    if (message.t === 'cast') {
      const spell = spellOnRow(champion, message.slot, message.row);
      if (!spell) return;
      const context = this.game.createSpellContext(spell, champion, {
        x: message.x,
        y: message.y,
      });
      // Press only. A charge now charges here for as long as the remote
      // thumb actually holds it — the 'rel' below is the other half — and
      // a charge the client abandons still resolves by the spell's own max:
      // `releaseAtMax` fires it, anything else cancels on MAX_DURATION.
      if (context) spell.press(context);
      return;
    }
    if (message.t === 'rel') {
      const spell = spellOnRow(champion, message.slot, message.row);
      // Guarded on the state, not trusted: the two ends drift (a host-side
      // stun cancelled the charge the client thinks it is still holding).
      if (!spell || spell.state !== 'CHARGING') return;
      const context = this.game.createSpellContext(spell, champion, {
        x: message.x,
        y: message.y,
      });
      // The release re-aims at where the drag ended; if no context resolves,
      // the charge keeps running and the max-duration rule settles it.
      if (context) spell.release(context);
      return;
    }
    if (message.t === 'stop') {
      const spell = spellOnRow(champion, message.slot, message.row);
      if (spell?.state === 'CHARGING') spell.cancel('PLAYER_CANCEL');
      return;
    }
    if (message.t === 'buy') {
      // Every rule re-checked here and nowhere else: `buyItem` is the same
      // door the host's own panel presses, so a client cannot buy from the
      // river, out of gold it does not have, or into a full bag.
      // A client may name an id this host has never loaded; the catalog says so.
      const def = contentCatalog().item(message.itemId);
      if (def) buyItem(champion, def, this.game, 'PLAYER');
      return;
    }
    if (message.t === 'sell') {
      sellItem(champion, message.slot, this.game, 'PLAYER');
      return;
    }
    if (message.t === 'swap') {
      champion.moveItem(message.a, message.b);
      return;
    }
    if (message.t === 'undo' || message.t === 'redo') {
      // Same door as `buy`/`sell`, and for the same reason: the history is
      // recorded inside those two, so the host holds one per champion and a
      // client's undo reverses that client's own last transaction.
      const reverse = message.t === 'undo' ? undoShop : redoShop;
      reverse(champion, this.game, 'PLAYER');
      return;
    }
    if (message.t === 'team') {
      // Through the director — the same single writer the panel uses — whose
      // `onTeamChanged` hook then re-broadcasts the side to every client.
      if (isMatchTeamId(message.team)) {
        this.teamEchoFor = champion;
        try {
          this.game.director.setTeam(champion, message.team);
        } finally {
          this.teamEchoFor = null;
        }
      }
      return;
    }
    if (message.t === 'tp') {
      // The minimap's practice-tool jump, exactly as the host player has it —
      // `teleportTo` clears path state and `TerrainMap.update()` pushes a
      // body out of any wall on the next tick.
      champion.teleportTo(message.x, message.y);
      return;
    }
    if (message.t === 'recall') {
      const spell = champion.recall;
      if (!spell) return;
      if (spell.state === 'CHANNELING') {
        spell.cancel('PLAYER_CANCEL');
        return;
      }
      const context = this.game.createSpellContext(spell, champion, champion.position);
      if (context) spell.press(context);
    }
  }

  /**
   * A joiner gets a freshly-rolled champion on the smaller team, then a
   * `hello` carrying the map, the rules, its own kit and the whole roster —
   * after which it is just another order source.
   */
  /** "Somebody is / is no longer driving this champion", for every other screen. */
  private linkEvent(champion: Champion, on: boolean): NetEvent {
    return { k: 'link', id: this.ids.get(champion) ?? '', on };
  }

  /**
   * A client told us what content it has. Offer, never install.
   *
   * The reverse direction of `hello.packs` — and deliberately not the same
   * reflex. See `content/peerPacks.ts` for why a host asks where a client
   * simply acts: a client picked its host, a host is picked by whoever has the
   * room code, and a pack is code.
   */
  private onClientPacks(manifestUrls: string[]): void {
    notePeerPacks(manifestUrls);
  }

  /**
   * A joiner said who it is: its seat, and what content it has.
   *
   * `iam` used to be lobby-only — `HostSession` decoded it and found nothing
   * to do, on the reading that "a late joiner is not entering a lobby, it is
   * entering a game". That is still true of the *name*; it is not true of the
   * seat, which is the only thing that tells a running match that this peer is
   * somebody it already knows.
   */
  private onSeatDeclared(peerId: string, seat: string | null, packs?: string[]): void {
    if (seat) this.seatOfPeer.set(peerId, seat);
    if (packs?.length) this.onClientPacks(packs);
    const waiting = this.seatWaiters.get(peerId);
    if (waiting) {
      this.seatWaiters.delete(peerId);
      waiting(seat);
    }
  }

  /**
   * Which seat this peer is in, waiting up to `SEAT_GRACE_MS` to be told.
   *
   * Resolves the moment `iam` lands, so the common path pays nothing. The
   * timer is the floor for a client that never sends one.
   */
  private awaitSeat(peerId: string): Promise<string | null> {
    const known = this.seatOfPeer.get(peerId);
    if (known !== undefined) return Promise.resolve(known);
    return new Promise<string | null>(resolve => {
      const settle = (seat: string | null): void => resolve(seat);
      this.seatWaiters.set(peerId, settle);
      setTimeout(() => {
        if (this.seatWaiters.get(peerId) !== settle) return;
        this.seatWaiters.delete(peerId);
        resolve(this.seatOfPeer.get(peerId) ?? null);
      }, SEAT_GRACE_MS);
    });
  }

  /** Forget everything keyed by a peer id, without touching its champion. */
  private releasePeer(peerId: string): void {
    this.seatOfPeer.delete(peerId);
    this.heardAt.delete(peerId);
    const waiting = this.seatWaiters.get(peerId);
    if (waiting) {
      this.seatWaiters.delete(peerId);
      waiting(null);
    }
  }

  /**
   * The judgement a closed channel cannot make.
   *
   * Runs every tick and is two separate decisions with two separate clocks.
   * A peer that has gone quiet past `PEER_SILENT_MS` is *unattended*: its
   * champion stays in the match, still killable, and is marked so the lobby
   * and the other players can see why it is standing still. Only once
   * `PEER_LOST_MS` has passed is it swept — which is what finally ends the
   * body that used to stand there for the rest of the match because its phone
   * had locked and no `close` was ever sent.
   *
   * A peer that has never sent a single frame is not judged at all: it has no
   * `heardAt` entry, and treating "never heard from" as "gone" would sweep a
   * client on an older build that does not ping.
   */
  private sweepLostPeers(): void {
    const now = this.game.matchTimeMs;
    for (const [peerId, champion] of this.clients) {
      const heard = this.heardAt.get(peerId);
      if (heard === undefined) continue;
      if (now - heard < PEER_SILENT_MS) {
        if (this.vacated.delete(champion)) this.pendingEvents.push(this.linkEvent(champion, true));
        continue;
      }
      if (!this.vacated.has(champion)) {
        this.vacated.set(champion, now);
        this.pendingEvents.push(this.linkEvent(champion, false));
      }
    }
    for (const [champion, since] of this.vacated) {
      if (now - since < PEER_LOST_MS) continue;
      this.vacated.delete(champion);
      // The seat goes with it: past this point there is nothing left to
      // reclaim, so a returning player should be given a fresh champion
      // rather than handed a corpse that is about to be swept.
      for (const [seat, held] of this.seats) if (held === champion) this.seats.delete(seat);
      for (const [peerId, held] of this.clients) {
        if (held !== champion) continue;
        this.clients.delete(peerId);
        this.releasePeer(peerId);
      }
      champion.toRemove = true;
      this.championNames.delete(champion);
      this.championPlans.delete(champion);
    }
  }

  /**
   * Throw a player out, by the unit id every screen already knows them by.
   *
   * The host's own control, for the case the clocks above are too patient for
   * — someone who will not come back, or should not. Everything a sweep does,
   * at once, including dropping the wire so a client that *is* still running
   * learns it has been removed rather than sitting on a channel nobody reads.
   */
  kickUnit(unitId: string): boolean {
    const champion = this.tracked.get(unitId);
    if (!(champion instanceof Champion)) return false;
    let found = false;
    for (const [peerId, held] of this.clients) {
      if (held !== champion) continue;
      found = true;
      this.clients.delete(peerId);
      this.releasePeer(peerId);
      this.transport.dropPeer?.(peerId);
    }
    if (!found && !this.vacated.has(champion)) return false;
    this.vacated.delete(champion);
    for (const [seat, held] of this.seats) if (held === champion) this.seats.delete(seat);
    champion.toRemove = true;
    this.championNames.delete(champion);
    this.championPlans.delete(champion);
    return true;
  }

  /** Every champion a client is (or was) driving, for the lobby's own rows. */
  netClientRows(): Array<{ id: string; name: string; attached: boolean }> {
    const rows: Array<{ id: string; name: string; attached: boolean }> = [];
    const seen = new Set<Champion>();
    for (const champion of this.clients.values()) {
      if (seen.has(champion)) continue;
      seen.add(champion);
      const id = this.ids.get(champion);
      if (id === undefined) continue;
      rows.push({ id, name: champion.name, attached: !this.vacated.has(champion) });
    }
    return rows;
  }

  private async onClientJoined(clientId: string): Promise<void> {
    // Which seat, before anything is built. A champion made first and matched
    // to a seat afterwards is the bug itself: the player gets a second body
    // and their own goes on standing in the match.
    const seat = await this.awaitSeat(clientId);
    const reclaimed = seat === null ? undefined : this.seats.get(seat);
    const canReclaim =
      reclaimed !== undefined && !reclaimed.toRemove && !this.clients.has(clientId);

    let champion: Champion;
    let plan: KitPlan;
    let team: string;
    let id: string;

    if (canReclaim && reclaimed) {
      // The same body, the same gold, the same corpse if they died while their
      // phone was asleep. Nothing is rebuilt: the champion never left the
      // match, it was only unattended (`sweepLostPeers`), and handing back a
      // *copy* would be the second-champion bug wearing the right name.
      champion = reclaimed;
      plan = this.championPlans.get(champion) ?? this.planFromLiveChampion(champion);
      team = champion.teamId;
      id = this.ids.get(champion) ?? `u${this.nextId++}`;
      this.ids.set(champion, id);
      this.tracked.set(id, champion);
      this.vacated.delete(champion);
      this.clients.set(clientId, champion);
      await loadSpells(plan.spellIds);
      this.pendingEvents.push(this.linkEvent(champion, true));
    } else {
      team = this.smallerTeam();
      // The AI respawn re-roll's own plan shape: one coherent random champion,
      // summoners defaulted off the installed shelf — no summoner named here,
      // which is what keeps core's vocabulary boundary clean.
      plan = planRandomKit();
      await loadSpells(plan.spellIds);

      champion = attachRecall(
        new Champion({
          game: this.game,
          position: this.game.randomSpawnPoint(team),
          teamId: team,
          preset: presetFromPlan(plan),
        })
      );
      this.game.objectManager.addObject(champion);
      id = `u${this.nextId++}`;
      this.ids.set(champion, id);
      this.tracked.set(id, champion);
      this.championNames.set(champion, champion.name);
      this.championPlans.set(champion, plan);
      this.clients.set(clientId, champion);
      if (seat !== null) this.seats.set(seat, champion);
    }
    // Counted from now either way: a reclaiming peer that goes quiet again must
    // start its own silence, not inherit the one that sent it away.
    this.heardAt.set(clientId, this.game.matchTimeMs);

    const roster: NetEvent[] = [];
    for (const [unitId, unit] of this.tracked) {
      if (unit instanceof Champion) {
        roster.push(this.championEvent(unitId, unit));
        // The bag has to be in the hello, not left to `discover`'s diff: the
        // diff only speaks when something *changes*, and a champion that
        // bought its boots before this client arrived would never change
        // again — the joiner would spend the match looking at an empty bar.
        const bag = bagOf(unit);
        for (const id of bag) {
          if (id === null) continue;
          roster.push({ k: 'bag', id: unitId, items: bag });
          break;
        }
        // Same reasoning one line up, and the same trap: a champion that
        // transformed before this client arrived would never change again,
        // so the joiner would watch a Kurama-mode Naruto cast base-form
        // abilities for the rest of the form.
        const stance = stanceOf(unit);
        if (stance.stance !== null) roster.push({ k: 'stance', id: unitId, ...stance });
      } else if (unit instanceof Minion) {
        roster.push({
          k: 'minion',
          id: unitId,
          team: unit.teamId,
          lane: unit.lane,
          kind: unit.kind,
          x: unit.position.x,
          y: unit.position.y,
        });
      }
    }
    // Everyone else learns about the new champion through the ordinary event
    // stream; the joiner's copy arrives inside its own hello roster. A
    // reclaimed champion is already on every screen, so this re-announces what
    // they have — harmless, and cheaper than a second code path — while the
    // `link` event pushed above is what actually changes for them.
    this.pendingEvents.push(this.championEvent(id, champion));

    this.sendTo(clientId, {
      t: 'hello',
      tm: this.game.matchTimeMs,
      mapId: this.game.activeMapId,
      rules: {
        cooldownMultiplier: this.game.matchRules.cooldownMultiplier,
        manaFree: this.game.matchRules.manaFree,
      },
      you: { id, team, plan },
      roster,
      packs: installedManifestUrls(),
      // The host's seed is the match's seed. Every client derives the same
      // drake rotation — and anything else a pack randomises — from it, which
      // is the only way two independently-built jungles agree (`matchSeed.ts`).
      seed: this.game.matchSeed,
    });
  }

  private smallerTeam(): string {
    let blue = 0;
    let red = 0;
    for (const unit of this.tracked.values()) {
      if (!(unit instanceof Champion)) continue;
      if (unit.teamId === TeamId.BLUE) blue++;
      else if (unit.teamId === TeamId.RED) red++;
    }
    return blue <= red ? TeamId.BLUE : TeamId.RED;
  }

  // -------------------------------------------------------------- plumbing

  private broadcast(message: NetMessage): void {
    // Snapshots ride the lossy lane where the transport has one: each is
    // superseded 33ms later and the client's buffer drops stale arrivals by
    // match time, so a retransmit would only ever deliver the past.
    if (message.t === 'snap') this.transport.broadcastUnreliable(encodeMessage(message));
    else this.transport.broadcast(encodeMessage(message));
  }

  private sendTo(clientId: string, message: NetMessage): void {
    this.transport.sendTo(clientId, encodeMessage(message));
  }

  // The host intercepts nothing: its own input drives the match directly.
  interceptPointer(_point: Vec2): boolean {
    return false;
  }
  interceptSteer(_target: Vec2 | null): boolean {
    return false;
  }
  interceptCast(_slot: number, _aim: Vec2, _phase: CastPhase, _row?: 'item'): boolean {
    return false;
  }
  interceptCastCancel(_slot: number, _row?: 'item'): void {}
  interceptShop(): boolean {
    return false;
  }
  interceptTeleport(_point: Vec2): boolean {
    return false;
  }
  interceptRecall(): boolean {
    return false;
  }

  /** The remote players' champions — the Đội tab's read-only LAN rows. */
  netRosterUnits(): Champion[] {
    return [...this.clients.values()];
  }

  /** A live side switch — the champ event carries the team, so re-broadcast it. */
  onTeamChanged(unit: Champion): void {
    const id = this.ids.get(unit);
    // `setTeam` is reached two ways — the host's panel, and a client asking to
    // switch its own side. Only the first is something to impose back on the
    // client that owns this champion; the second it already did to itself.
    if (id) this.pendingEvents.push(this.championEvent(id, unit, unit !== this.teamEchoFor));
  }

  /**
   * The host's own panel gave a live champion a new kit. Broadcast the real
   * plan — `discover`'s name check would eventually notice a *renamed*
   * champion and fall back to the lossy live-champion reverse, but a kit
   * edit that keeps the name (one swapped slot) it would never see at all,
   * and the client's copy would fight the host's for the rest of the match.
   * Updating `championNames` here is also what keeps `discover` from
   * broadcasting the same change twice.
   */
  onLoadoutApplied(unit: Champion, preset: ChampionPresetData & { avatar?: string }): void {
    const id = this.ids.get(unit);
    if (!id) return;
    this.championNames.set(unit, unit.name);
    this.championPlans.set(unit, planFromPreset(preset));
    // Always imposed: a client's own đổi tướng lands in `onClientLoadout`,
    // which applies the preset directly and broadcasts for itself, so nothing
    // that reaches this hook came from a client.
    this.pendingEvents.push(this.championEvent(id, unit, true));
  }

  /** Positions of every tracked unit, for the e2e's cross-page comparison. */
  debugPositions(): Record<string, [number, number]> {
    const out: Record<string, [number, number]> = {};
    for (const [id, unit] of this.tracked) out[id] = [unit.position.x, unit.position.y];
    return out;
  }

  /** The first remote client's champion, for the e2e's order assertions. */
  debugRemote(): {
    x: number;
    y: number;
    cooldowns: number[];
    name: string;
    kit: string[];
    team: string;
  } | null {
    const champion = this.clients.values().next().value as Champion | undefined;
    if (!champion) return null;
    return {
      x: champion.position.x,
      y: champion.position.y,
      cooldowns: champion.spells.map(spell => spell.currentCooldown),
      // Identity, for the đổi-tướng/đổi-phe probes: after a client changes
      // its own kit or side, the host's authoritative copy must match.
      name: champion.name,
      kit: champion.spells.map(spell => spell.constructor.name),
      team: champion.teamId,
    };
  }

  close(): void {
    this.stopCastListener();
    this.stopDamageListener();
    this.stopAttackListener();
    this.stopAnnounceListener();
    this.transport.close();
    this.game.net = null;
    setNetRole('off');
    // The address bar stops claiming a room the moment the room stops.
    disarmNetUrl();
  }
}
