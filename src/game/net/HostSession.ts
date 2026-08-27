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
import { isMatchTeamId } from '@/game/config/MatchTeams';
import { setNetRole, type NetUrlRequest } from './netRole';
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
  /** Last `deathRecap.seq` forwarded per client champion — see `forwardClientDeaths`. */
  private sentRecapSeq = new WeakMap<Champion, number>();
  private pendingEvents: NetEvent[] = [];
  /** e2e-readable counters — see the dev handle in the constructor. */
  readonly debugStats = { snapshotsSent: 0, eventsSent: 0, castsSeen: 0 };
  private lastSnapshotAt = 0;
  private stopCastListener: () => void;
  private stopDamageListener: () => void;
  private stopAttackListener: () => void;

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
        if (id) this.pendingEvents.push({ k: 'dmg', id, a: hit.amount, ty: hit.type });
      }
    );
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
    // the same convention as `window.__lol2d`. Stripped from production.
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__lol2dNet = this;
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

  private championEvent(id: string, unit: Champion): NetEvent {
    return {
      k: 'champ',
      id,
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
    }
    for (const [unit, id] of this.ids) {
      const attackable = unit as AttackableUnit;
      if (!seen.has(attackable) && (attackable.toRemove || !this.stillQueued(attackable))) {
        this.ids.delete(unit);
        this.tracked.delete(id);
        this.pendingEvents.push({ k: 'gone', id });
      }
    }
  }

  /** A unit spawned this very tick sits in `_objectToBeAdd` until the next pass — not gone. */
  private stillQueued(unit: AttackableUnit): boolean {
    return this.game.objectManager._objectToBeAdd.includes(unit);
  }

  private snapshotUnits(): UnitSnap[] {
    const units: UnitSnap[] = [];
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
      if (unit instanceof Champion) {
        snap.cds = unit.spells.map(spell => spell.currentCooldown);
      }
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
      // The champion leaves with its player: marked for the ordinary sweep,
      // which `discover()` then notices and broadcasts as 'gone', so every
      // other client's puppet disappears too. A returning player is simply a
      // new joiner with a fresh champion — v1's whole rejoin story.
      const champion = this.clients.get(event.peerId);
      this.clients.delete(event.peerId);
      if (champion) {
        champion.toRemove = true;
        this.championNames.delete(champion);
        this.championPlans.delete(champion);
      }
      return;
    }
    const message = decodeMessage(event.raw);
    const champion = this.clients.get(event.peerId);
    if (!message || !champion) return;
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
      const spell = champion.spells[message.slot];
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
      const spell = champion.spells[message.slot];
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
      const spell = champion.spells[message.slot];
      if (spell?.state === 'CHARGING') spell.cancel('PLAYER_CANCEL');
      return;
    }
    if (message.t === 'team') {
      // Through the director — the same single writer the panel uses — whose
      // `onTeamChanged` hook then re-broadcasts the side to every client.
      if (isMatchTeamId(message.team)) this.game.director.setTeam(champion, message.team);
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
  private async onClientJoined(clientId: string): Promise<void> {
    const team = this.smallerTeam();
    // The AI respawn re-roll's own plan shape: one coherent random champion,
    // summoners defaulted off the installed shelf — no summoner named here,
    // which is what keeps core's vocabulary boundary clean.
    const plan = planRandomKit();
    await loadSpells(plan.spellIds);

    const champion = attachRecall(
      new Champion({
        game: this.game,
        position: this.game.randomSpawnPoint(team),
        teamId: team,
        preset: presetFromPlan(plan),
      })
    );
    this.game.objectManager.addObject(champion);
    const id = `u${this.nextId++}`;
    this.ids.set(champion, id);
    this.tracked.set(id, champion);
    this.championNames.set(champion, champion.name);
    this.championPlans.set(champion, plan);
    this.clients.set(clientId, champion);

    const roster: NetEvent[] = [];
    for (const [unitId, unit] of this.tracked) {
      if (unit instanceof Champion) roster.push(this.championEvent(unitId, unit));
      else if (unit instanceof Minion) {
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
    // stream; the joiner's copy arrives inside its own hello roster.
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
  interceptCast(_slot: number, _aim: Vec2, _phase: CastPhase): boolean {
    return false;
  }
  interceptCastCancel(_slot: number): void {}
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
    if (id) this.pendingEvents.push(this.championEvent(id, unit));
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
    this.pendingEvents.push(this.championEvent(id, unit));
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
    this.transport.close();
    this.game.net = null;
    setNetRole('off');
  }
}
