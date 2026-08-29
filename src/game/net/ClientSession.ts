import type Game from '@/game/Game';
import AttackableUnit, { type DeathRecap } from '@/game/gameObject/attackableUnits/AttackableUnit';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import CombatText, { DAMAGE_TEXT_COLOR } from '@/game/gameObject/helpers/CombatText';
import Pet from '@/game/gameObject/attackableUnits/Pet';
import { DEFAULT_DAMAGE_TYPE, type DamageType } from '@/game/combat/Mitigation';
import Minion, { MinionPresets } from '@/game/gameObject/attackableUnits/Minion';
import { resolveMinionTypes } from '@/game/config/mapTuning';
import { getLaneWaypoints, nextWaypointIndexFrom } from '@/game/lanes';
import { attachRecall, presetFromPlan, type KitPlan } from '@/game/preset';
import { buildHeldItem } from '@/game/economy/ItemShop';
import { contentCatalog } from '@/content/catalog';
import { loadSpells } from '@/game/spellRegistry';
import { setNetRole } from './netRole';
import { clearNetLink, netLinkLost } from './netLink';
import { disarmNetUrl } from '@/scenes/lanSignal';
import type { ClientTransport } from './transport';
import {
  decodeMessage,
  encodeMessage,
  type NetEvent,
  type NetMessage,
  type UnitSnap,
} from './protocol';

/**
 * How often this client tells the host it is still running.
 *
 * Four to a `PEER_SILENT_MS` window, so a couple of dropped frames on the
 * reliable lane are not mistaken for a sleeping phone.
 */
const PING_INTERVAL_MS = 2_000;

/**
 * How long the host may say nothing before this client stops believing what
 * is on screen.
 *
 * The host sends a snapshot every 33ms and re-sends unchanged units on a 1s
 * heartbeat, so this is thirty missed heartbeats — long enough to ride out a
 * lane change or a garbage-collection stall, short enough that a player does
 * not go on issuing orders into a match that stopped listening.
 */
const HOST_SILENT_MS = 6_000;
import { InterpolationBuffer } from './InterpolationBuffer';
import { RECALL_SLOT } from './HostSession';
import { planFromPreset } from './kitWire';
import type { NetGameHooks } from './hooks';
import type { Vec2 } from '@/game/spell/runtime/types';
import type { CastPhase } from '@/game/spell/input/SpellInputController';
import type { ChampionPresetData } from '@/game/gameObject/attackableUnits/Champion';

/**
 * Repeated right-clicks — and a held joystick — fire every tick; the host
 * needs at most a few orders a second. One window covers both, because they
 * are the same order arriving two ways and a mixed stream would otherwise
 * send at twice the rate. At champion speed 120ms of walking is well inside
 * the reconciler's noise band, so the prediction and the host stay agreed
 * between samples.
 */
const MOVE_ORDER_INTERVAL_MS = 120;
/**
 * The stick gets its own, faster window. A click is a discrete decision and
 * 8 a second is plenty of them; a held thumb is a *continuously changing
 * direction*, and sampling that 8 times a second is the whole of what the
 * host — and therefore every other player — knows about where you are going.
 * The cost of the difference is nothing: an order frame is ~45 bytes, so 20/s
 * is under 1KB/s against a snapshot stream measured at 56-90KB/s. The two
 * windows never overlap in practice either, because a phone has no mouse and
 * a desktop has no stick.
 */
const STEER_ORDER_INTERVAL_MS = 50;
/** A unit that covered more than this between snapshots blinked — snap, don't glide. */
const DASH_SNAP_UNITS = 400;
/** Own-champion drift below this is the host agreeing within noise — leave the prediction alone. */
const RECONCILE_PULL_UNITS = 60;
/** Own-champion drift above this is a host-side fact (knockback, teleport) — snap to it. */
const RECONCILE_SNAP_UNITS = 300;
/** Per-tick fraction of the remaining drift a gentle reconcile closes (per-time at 60Hz ticks). */
const RECONCILE_PULL_RATE = 0.15;

/**
 * A stat the snapshot owns, written so its **computed** value lands exactly on
 * the host's.
 *
 * The snapshot carries `stats.health.value` — the composed number, after every
 * modifier — and the client used to store it straight into `baseValue`. That
 * was right for as long as a client's champion had no modifiers of its own,
 * and stopped being right the moment items synced: a Giant's Belt now adds its
 * health on the host *and* on the client, so the client's bar read the host's
 * total plus the belt again. Nudging the base instead keeps the documented
 * invariant — the client shows the number the host reported, never one it
 * computed — whatever local modifiers exist. It also closes the same latent
 * hole for buffs, which a client has always replayed locally.
 */
interface ComposedStat {
  baseValue: number;
  baseBonus: number;
  percentBaseBonus: number;
  flatBonus: number;
  percentBonus: number;
}
export const setComposedValue = (stat: ComposedStat, target: number): void => {
  const outer = 1 + stat.percentBonus;
  const inner = 1 + stat.percentBaseBonus;
  // A -100% modifier makes the value independent of the base, so there is no
  // base that produces the target. Fall back to the old write rather than
  // divide by zero — a champion whose stat is pinned at zero either way.
  if (outer === 0 || inner === 0) {
    stat.baseValue = target;
    return;
  }
  stat.baseValue = (target / outer - stat.flatBonus) / inner - stat.baseBonus;
};

/**
 * The renderer end of a LAN match. The local `Game` is sim-gated (spec §4)
 * — no bots, no spawner, `takeDamage` and mana costs inert — and this class
 * fills the world back in from the host's stream: spawn events construct
 * *real* units, cast events press their *real* spells (which then play
 * their whole visual life locally, damage dying in the gated funnel), and
 * 30Hz snapshots, interpolated per unit of time, own every position and
 * resource bar — for every unit except the client's own champion, which is
 * **predicted**: its orders and casts execute locally the instant the key
 * lands (the intercepts send the order to the host and then let the local
 * seam run), its position never rides the playback delay, and the host
 * reconciles it — gently under `RECONCILE_PULL_UNITS` of drift, with a hard
 * snap past `RECONCILE_SNAP_UNITS` (a host-side knockback the prediction
 * could not know about). Its own cast events echoing back from the host are
 * suppressed, having already played.
 */
export class ClientSession implements NetGameHooks {
  private units = new Map<string, AttackableUnit>();
  private buffer = new InterpolationBuffer();
  /** Champion spawns whose spell chunks are still in flight — see the 'champ' case. */
  private pendingChamps = new Set<string>();
  /** Puppets that are the host's summoned pets — sized by the event, hidden from the Đội tab. */
  private petUnits = new WeakSet<AttackableUnit>();
  /**
   * The host's recap for our own champion's latest death, until the local
   * `die()` has run so it can be applied *after* it — `die` snapshots the
   * local (gated, therefore empty) damage ledger over `deathRecap`, so
   * whichever of the death snapshot and the 'died' message lands first, the
   * host's answer must be the one standing when the HUD reads it.
   */
  private pendingRecap: DeathRecap | null = null;
  private lastMoveSentAt = 0;
  private lastSteerSentAt = 0;
  /** When the host was last heard from at all, in `performance.now()` terms. */
  private lastHeardAt = performance.now();
  private lastPingAt = 0;
  /**
   * Whether the host has gone quiet for longer than a host that is running
   * ever does.
   *
   * `reactive`, and that is load-bearing rather than tidy: the HUD reads this
   * through a `computed`, and a `computed` over a plain object never
   * re-evaluates — the flag flipped, `NetLinkOverlay` was told nothing, and
   * the overlay silently never appeared. Measured exactly that way by
   * `drive-lan-reconnect.mjs`, which saw `link.lost === true` on the session
   * and no `#net-link-lost` on the page.
   *
   * Read by the HUD, which is the whole point. Before this, a client whose
   * wire died simply went on drawing the last world it was sent — so a player
   * whose phone slept came back to a champion standing peacefully in a match
   * where they had been dead for a minute, with nothing on screen suggesting
   * otherwise. A stale world shown confidently is worse than no world.
   */
  readonly link = { lost: false };
  /** e2e-readable counters — see the dev handle in the constructor. */
  readonly debugStats = { snapshotsReceived: 0, eventsApplied: 0, damageTextsShown: 0 };

  constructor(
    private readonly game: Game,
    private readonly channel: ClientTransport,
    hello: Extract<NetMessage, { t: 'hello' }>
  ) {
    game.net = this;
    // The host decided when this match is; local matchTimeMs starts there so
    // HUD clocks roughly agree (snapshots carry their own stamps regardless).
    game.matchTimeMs = hello.tm;
    game.matchRules.cooldownMultiplier = hello.rules.cooldownMultiplier;
    game.matchRules.manaFree = hello.rules.manaFree;

    // The units both sides built from the same map data, matched by
    // construction order — the host names them the same way (`HostSession.
    // idFor`), and the handshake already refused a client with a different
    // map.
    this.units.set(hello.you.id, game.player);
    game.turrets.forEach((turret, index) => this.units.set(`t${index}`, turret));
    game.monsters.forEach((monster, index) => this.units.set(`m${index}`, monster));

    for (const event of hello.roster) this.applyEvent(event);

    // Dev-only handle for the e2e driver, like the host's.
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__moba2dNet = this;
    }
  }

  // ------------------------------------------------------------- per tick

  update(): void {
    this.pingHost();
    for (const raw of this.channel.drain()) {
      const message = decodeMessage(raw);
      if (!message) continue;
      // Any frame at all, decodable or not into something we act on: the host
      // is running and reachable, which is the only question `link` asks.
      this.lastHeardAt = performance.now();
      if (message.t === 'snap') {
        this.debugStats.snapshotsReceived++;
        this.buffer.push(message, performance.now());
      } else if (message.t === 'ev') {
        this.debugStats.eventsApplied += message.ev.length;
        for (const event of message.ev) this.applyEvent(event);
      } else if (message.t === 'died') {
        this.onDied(message.recap);
      }
    }
    this.judgeLink();
    this.applyInterpolated();
  }

  /**
   * Tell the host we are still running, on a timer.
   *
   * Silence is all a host can observe about a peer that stopped — a player
   * standing still sends nothing, and neither does a phone whose screen went
   * off — and a frozen page runs no timers, so this stops the instant the tab
   * does. That is the property the host's sweep leans on
   * (`HostSession.PEER_SILENT_MS`); it is a client timer rather than a host
   * poll for exactly that reason.
   */
  private pingHost(): void {
    const now = performance.now();
    if (now - this.lastPingAt < PING_INTERVAL_MS) return;
    this.lastPingAt = now;
    this.channel.send(encodeMessage({ t: 'ping' }));
  }

  /**
   * Has the host gone quiet?
   *
   * Two independent signals, and the transport's own is not enough on its
   * own: a channel reports `closed` when something actually closed it, which
   * a network that simply stopped carrying packets never does. So silence is
   * the second test, measured against the host's snapshot cadence — it sends
   * one every 33ms and re-sends unchanged units on a 1s heartbeat, so seconds
   * of nothing is not a quiet match, it is no match.
   */
  private judgeLink(): void {
    const silent = performance.now() - this.lastHeardAt > HOST_SILENT_MS;
    const lost = silent || this.channel.closed === true;
    // Two homes for one fact, and both are load-bearing. `link` is the
    // e2e-readable handle beside `debugStats`; `netLinkLost` is the `ref` the
    // overlay actually renders off, because a plain object reached through a
    // prop and a getter did not make the component re-render — see
    // `netLink.ts`.
    this.link.lost = lost;
    if (netLinkLost.value !== lost) netLinkLost.value = lost;
  }

  /** The host's recap for our own death — apply now if the corpse is already here, else hold. */
  private onDied(raw: unknown): void {
    const recap = raw as DeathRecap;
    if (typeof recap?.seq !== 'number' || !Array.isArray(recap.entries)) return;
    if (this.game.player.isDead) this.game.player.deathRecap = recap;
    else this.pendingRecap = recap;
  }

  private applyInterpolated(): void {
    const sample = this.buffer.sample(performance.now(), DASH_SNAP_UNITS);
    if (!sample) return;
    for (const [id, snap] of sample) {
      const unit = this.units.get(id);
      if (!unit) continue;
      if (unit === this.game.player) continue; // predicted — reconciled below, never played back
      this.applyUnitSnap(unit, snap);
    }
    this.reconcileOwnChampion();
  }

  /**
   * The predicted champion against the freshest host truth. Resources and
   * life/death are host facts applied verbatim; position is corrected only
   * when it actually drifts — a gentle per-tick pull inside the band, a hard
   * snap beyond it — so local movement stays glued to the key while a
   * host-side displacement still lands.
   */
  private reconcileOwnChampion(): void {
    const latest = this.buffer.latest();
    if (!latest) return;
    const player = this.game.player;
    let snap: UnitSnap | undefined;
    for (const [id, unit] of this.units) {
      if (unit === player) {
        snap = latest.units.get(id);
        break;
      }
    }
    if (!snap) return;

    if (snap.dead && !player.isDead) {
      player.die({ reviveAfter: 3_600_000 });
      // `die` just published a recap of the local ledger, which the damage
      // gate keeps empty — the host's real one replaces it (see `onDied`).
      if (this.pendingRecap) {
        player.deathRecap = this.pendingRecap;
        this.pendingRecap = null;
      }
    } else if (!snap.dead && player.isDead) {
      player.respawn();
    }

    setComposedValue(player.stats.maxHealth, snap.maxHp);
    setComposedValue(player.stats.health, snap.hp);
    setComposedValue(player.stats.mana, snap.mp);
    // The wallet is the host's ledger; this copy only displays it.
    if (snap.gold !== undefined) player.wallet?.syncTo(snap.gold);
    if (snap.cds) {
      snap.cds.forEach((cd, slot) => {
        const spell = player.spells[slot];
        if (spell && Math.abs(spell.currentCooldown - cd) > 250) spell.currentCooldown = cd;
      });
    }

    const drift = Math.hypot(player.position.x - snap.x, player.position.y - snap.y);
    if (drift > RECONCILE_SNAP_UNITS) {
      player.teleportTo(snap.x, snap.y);
    } else if (drift > RECONCILE_PULL_UNITS) {
      const pull = RECONCILE_PULL_RATE;
      player.position.set(
        player.position.x + (snap.x - player.position.x) * pull,
        player.position.y + (snap.y - player.position.y) * pull
      );
    }
  }

  private applyUnitSnap(unit: AttackableUnit, snap: UnitSnap): void {
    // Death and revival are host facts. `die` with a far-future revive keeps
    // the local corpse timer from ever racing the snapshots; `respawn` is
    // called the moment the host shows the unit alive again, and the position
    // write below immediately moves it wherever the host actually put it.
    if (snap.dead && !unit.isDead) unit.die({ reviveAfter: 3_600_000 });
    else if (!snap.dead && unit.isDead) unit.respawn();

    unit.position.set(snap.x, snap.y);
    // Pin the walk target too, so a puppet neither strolls back toward a
    // stale order between snapshots nor plays a walk animation against its
    // own motion.
    unit.destination?.set(snap.x, snap.y);

    setComposedValue(unit.stats.maxHealth, snap.maxHp);
    setComposedValue(unit.stats.health, snap.hp);
    setComposedValue(unit.stats.mana, snap.mp);
    unit.stats.actionState = snap.actionState;

    // Puppet cooldowns run locally from cast events; the own champion's are
    // reconciled in `reconcileOwnChampion`.
  }

  // -------------------------------------------------------------- events

  /**
   * The host's bag, made real.
   *
   * Slot by slot rather than wholesale, because `equipItem`/`unequipItem` are
   * the *ownership* seam — they add and take back the stat modifier, arm and
   * retire the passive, register and remove the item's spells — and a slot
   * whose id did not change must not be run through them (`Champion.moveItem`
   * documents exactly what that costs: armour taken off and put back on, a
   * passive armed twice). A drag on the host therefore arrives here as two
   * slots that changed, which is what it is.
   */
  private applyBag(champion: Champion, ids: readonly (string | null)[]): void {
    for (let slot = 0; slot < champion.items.length; slot++) {
      const wanted = ids[slot] ?? null;
      const held = champion.items[slot];
      if ((held?.def.id ?? null) === wanted) continue;
      if (held) champion.unequipItem(slot);
      if (!wanted) continue;
      const def = contentCatalog().item(wanted);
      // An id this client's packs do not carry: leave the slot empty rather
      // than guess. The host still owns the stats that item grants, and they
      // arrive in the snapshot regardless — the bar is what goes missing.
      if (!def) continue;
      const built = buildHeldItem(champion, def);
      if (built) champion.equipItem(built, slot);
    }
  }

  private applyEvent(event: NetEvent): void {
    switch (event.k) {
      case 'champ': {
        const existing = this.units.get(event.id);
        // The own champion's kit is never played back: at boot it was built
        // from the hello's own plan, and a đổi tướng was applied locally the
        // moment the player confirmed it (`onLoadoutApplied`) — the echo
        // arriving here has already happened, like a cast echo.
        // ...unless the host imposed it: the panel on the other end owns
        // this champion as much as the player does, and refusing the change
        // here leaves the two ends playing different characters.
        if (existing === this.game.player && !event.imposed) return;
        if (existing instanceof Champion) {
          // A re-broadcast: a re-rolled or re-kitted champion, or one that
          // just switched sides — the event always carries the current team,
          // and `setTeamId` runs the same ripple the host's own switch ran.
          if (existing.teamId !== event.team) existing.setTeamId(event.team);
          existing.applyPreset(presetFromPlan(event.plan as KitPlan));
          return;
        }
        if (existing || this.pendingChamps.has(event.id)) return;
        // A summon first tries to *claim* the local twin the spell replay
        // just spawned — the pack's own Pet subclass, custom draw and all —
        // rather than building a core-Pet lookalike beside it. Synchronous
        // on purpose: the twin's spells are already in memory, and the
        // adoption grace (`NET_PET_ADOPT_GRACE_MS`) is ticking.
        if (event.pet) {
          const adopted = this.adoptLocalPet(event);
          if (adopted) {
            adopted.isNetPuppet = true;
            adopted.stats.size.baseValue = event.pet.size;
            // Re-anchor the timer on the host's remaining life, keeping the
            // age already shown — the bar must not jump backwards.
            adopted.lifeTimeMs = adopted.age + event.pet.lifeMs;
            this.petUnits.add(adopted);
            this.units.set(event.id, adopted);
            return;
          }
        }
        // A champion the host added mid-match (a bot from the Đội tab, a
        // late joiner) can name spell chunks this client has never fetched —
        // the boot only loaded the hello roster's. `presetFromPlan` is
        // synchronous and falls back to a basic attack for a class not in
        // memory, so building immediately would put a puppet on the map
        // whose kit is permanently wrong. Fetch first, build after.
        this.pendingChamps.add(event.id);
        void this.buildChampion(event);
        return;
      }
      case 'minion': {
        if (this.units.has(event.id)) return;
        // Resolved against the *active map's* roster, not core's three: a
        // map may declare its own types, and a client that fell back to
        // `melee` for every one of them would render the host's wave as the
        // wrong bodies with the wrong stats. Host and client agree on the map
        // through the handshake's own map-id check, so an unknown id here is
        // a real disagreement worth a line in the console rather than a
        // silent substitution.
        const types = resolveMinionTypes(this.game.mapTuning);
        const preset = types[event.kind] ?? MinionPresets.melee;
        if (!types[event.kind]) {
          console.warn(`[net] host spawned unknown minion type ${event.kind}`);
        }
        const minion = new Minion({
          game: this.game,
          position: createVector(event.x, event.y),
          teamId: event.team,
          lane: event.lane,
          waypoints: getLaneWaypoints(event.lane, event.team),
          preset,
          startWaypointIndex: nextWaypointIndexFrom(event.lane, event.team, event.x, event.y),
        });
        this.game.objectManager.addObject(minion);
        this.units.set(event.id, minion);
        return;
      }
      case 'bag': {
        const unit = this.units.get(event.id);
        if (unit instanceof Champion) this.applyBag(unit, event.items);
        return;
      }
      case 'gone': {
        // A spawn still fetching its chunks: dropping the pending mark is the
        // abort — `buildChampion` refuses to finish without it.
        this.pendingChamps.delete(event.id);
        const unit = this.units.get(event.id);
        if (!unit) return;
        this.units.delete(event.id);
        this.game.objectManager.removeObject(unit);
        return;
      }
      case 'dmg': {
        // The host's floated number, replayed through the same door it went
        // through there — the per-victim merge and the type colours are the
        // local `CombatText.show`'s own behaviour, not something re-derived.
        // This stream is the client's only source: its `takeDamage` is gated,
        // so nothing local ever floats a damage number.
        const unit = this.units.get(event.id);
        if (!unit || typeof event.a !== 'number') return;
        const color =
          DAMAGE_TEXT_COLOR[event.ty as DamageType] ?? DAMAGE_TEXT_COLOR[DEFAULT_DAMAGE_TYPE];
        this.debugStats.damageTextsShown++;
        CombatText.show(unit, 'damage', event.a, [...color]);
        return;
      }
      case 'atk': {
        // A champion's committed swing, replayed as pure visual — see
        // `AttackLaunchNetEvent` for why champions only. The own champion's
        // swings are predicted locally (its controller holds real orders),
        // so its echo is dropped like a cast echo.
        const attacker = this.units.get(event.id);
        const target = this.units.get(event.tid);
        if (!(attacker instanceof Champion) || attacker === this.game.player) return;
        if (attacker.isDead || !target || target.isDead) return;
        attacker.basicAttack.replayLaunch(target);
        return;
      }
      case 'cast': {
        const unit = this.units.get(event.id);
        if (!(unit instanceof Champion)) return;
        // The own champion predicted this cast locally when the key landed —
        // the echo has already played.
        if (unit === this.game.player) return;
        const spell = event.slot === RECALL_SLOT ? unit.recall : unit.spells[event.slot];
        if (!spell) return;
        const context = this.game.createSpellContext(spell, unit, { x: event.x, y: event.y });
        if (!context) return;
        spell.press(context);
        // The event says the host committed the cast; a charge pattern with
        // no wire for hold duration fires at minimum charge (spec §7).
        if (spell.state === 'CHARGING') spell.release(context);
        return;
      }
    }
  }

  /**
   * The local pet nearest the spawn event, unclaimed and on the right team —
   * the body the summoning replay just put in the world. Both ends computed
   * the spawn from the same cast aim, so the two positions agree to within
   * noise; 300 units of slack covers an interpolated caster. `_objectToBeAdd`
   * too: a pet summoned this very tick has not been flushed into `objects`.
   */
  private adoptLocalPet(event: Extract<NetEvent, { k: 'champ' }>): Pet | null {
    let best: Pet | null = null;
    let bestDistance = 300;
    const consider = (object: unknown): void => {
      if (!(object instanceof Pet) || object.isNetPuppet || object.toRemove) return;
      if (object.teamId !== event.team) return;
      const distance = Math.hypot(object.position.x - event.x, object.position.y - event.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = object;
      }
    };
    for (const object of this.game.objectManager.objects) consider(object);
    for (const object of this.game.objectManager._objectToBeAdd) consider(object);
    return best;
  }

  private async buildChampion(event: Extract<NetEvent, { k: 'champ' }>): Promise<void> {
    const plan = event.plan as KitPlan;
    await loadSpells(plan.passiveId ? [...plan.spellIds, plan.passiveId] : plan.spellIds);
    if (!this.pendingChamps.delete(event.id)) return; // 'gone' raced the fetch
    let champion: Champion;
    if (event.pet) {
      // A real `Pet`, so the puppet wears the pet's own chrome — compact
      // frame, life-timer bar — instead of a full champion frame. Its sim
      // half is gated (`Pet.update` keeps only the clock on a net client);
      // `lifeMs` is the life *remaining* at broadcast, so the bar agrees
      // with the host's. The owner is display-book-keeping here (the gated
      // update never reads it), so an untracked summoner safely falls to
      // the local player.
      const owner = (event.pet.ownerId && this.units.get(event.pet.ownerId)) || this.game.player;
      const puppet = new Pet({
        game: this.game,
        position: createVector(event.x, event.y),
        teamId: event.team,
        preset: presetFromPlan(plan),
        ownerUnit: owner,
        lifeTimeMs: event.pet.lifeMs,
      });
      puppet.isNetPuppet = true; // through `addObject`'s local-pet gate
      puppet.stats.size.baseValue = event.pet.size;
      this.petUnits.add(puppet);
      champion = puppet;
    } else {
      champion = attachRecall(
        new Champion({
          game: this.game,
          position: createVector(event.x, event.y),
          teamId: event.team,
          preset: presetFromPlan(plan),
        })
      );
    }
    this.game.objectManager.addObject(champion);
    this.units.set(event.id, champion);
    // Snapshots that arrived during the fetch were skipped for this id; the
    // next one places the puppet, tens of milliseconds away.
  }

  // ----------------------------------------------------------- intercepts

  // Every intercept sends the order and then answers `false`: the local seam
  // runs too — that is the prediction. The host's authoritative copy of the
  // outcome arrives in snapshots (and, for casts, as an echo event this
  // session drops).

  interceptPointer(point: Vec2): boolean {
    const now = performance.now();
    if (now - this.lastMoveSentAt >= MOVE_ORDER_INTERVAL_MS) {
      this.lastMoveSentAt = now;
      this.channel.send(JSON.stringify({ t: 'move', x: point.x, y: point.y }));
    }
    return false;
  }

  interceptSteer(target: Vec2 | null): boolean {
    if (!target) {
      // The release is never throttled and never dropped: a lost one leaves
      // the host walking to a point the thumb abandoned. Reopening the window
      // is part of the same thought — the next push is a new gesture and must
      // not wait out a sample the previous one paid for.
      this.lastSteerSentAt = 0;
      this.channel.send(JSON.stringify({ t: 'steer', to: null }));
      return false;
    }
    const now = performance.now();
    if (now - this.lastSteerSentAt >= STEER_ORDER_INTERVAL_MS) {
      this.lastSteerSentAt = now;
      this.channel.send(JSON.stringify({ t: 'steer', to: { x: target.x, y: target.y } }));
    }
    return false;
  }

  interceptShop(
    order:
      | { kind: 'buy'; itemId: string }
      | { kind: 'sell'; slot: number }
      | { kind: 'swap'; a: number; b: number }
      | { kind: 'undo' }
      | { kind: 'redo' }
  ): boolean {
    if (order.kind === 'buy') this.channel.send(JSON.stringify({ t: 'buy', itemId: order.itemId }));
    else if (order.kind === 'sell')
      this.channel.send(JSON.stringify({ t: 'sell', slot: order.slot }));
    else if (order.kind === 'swap')
      this.channel.send(JSON.stringify({ t: 'swap', a: order.a, b: order.b }));
    // The history is the host's, because the transactions are: a client that
    // reversed its own copy would be corrected by the next `bag` event.
    else this.channel.send(JSON.stringify({ t: order.kind }));
    // Wire-only. There is nothing here worth predicting and a great deal worth
    // getting wrong: the gold, the fountain rule and the component maths are
    // the host's, and the answer comes back as a `bag` event and a wallet in
    // the next snapshot — one frame, on a LAN.
    return true;
  }

  interceptCast(slot: number, aim: Vec2, phase: CastPhase, row?: 'item'): boolean {
    // The hold stream is 60Hz re-aiming — local-only. Press and release each
    // cross once, which is what lets the host's copy of a charge spell charge
    // for as long as the real thumb actually held it (the v1 wire had no
    // release, so the host fired every charge at minimum the instant the key
    // went down — a charged dash lurching off on press).
    if (phase === 'hold') return false;
    this.channel.send(
      JSON.stringify({
        t: phase === 'press' ? 'cast' : 'rel',
        slot,
        x: aim.x,
        y: aim.y,
        ...(row === 'item' ? { row } : {}),
      })
    );
    return false;
  }

  interceptCastCancel(slot: number, row?: 'item'): void {
    this.channel.send(JSON.stringify({ t: 'stop', slot, ...(row === 'item' ? { row } : {}) }));
  }

  interceptTeleport(point: Vec2): boolean {
    this.channel.send(JSON.stringify({ t: 'tp', x: point.x, y: point.y }));
    // `true` — wire-only, the one intercept that is. A locally-jumped body
    // sits >RECONCILE_SNAP_UNITS from the freshest snapshot and would be
    // snapped straight back on the next tick; the jump instead arrives in
    // the host's next snapshot, one interpolation delay away.
    return true;
  }

  interceptRecall(): boolean {
    this.channel.send(JSON.stringify({ t: 'recall' }));
    return false;
  }

  /**
   * The player confirmed a new kit in the panel. It was already applied
   * locally by `MatchDirector` — that is the prediction — so what is left is
   * making it real: the host applies the same plan to its authoritative
   * champion and re-broadcasts, and this session drops the echo (`applyEvent`
   * 'champ'). Without this wire the change lived only on this screen and the
   * two ends fought with two different kits.
   */
  onLoadoutApplied(unit: Champion, preset: ChampionPresetData & { avatar?: string }): void {
    if (unit !== this.game.player) return;
    this.channel.send(JSON.stringify({ t: 'loadout', plan: planFromPreset(preset) }));
  }

  /** Our own side switch, predicted by the local director — ask the host to make it real. */
  onTeamChanged(unit: Champion): void {
    if (unit !== this.game.player) return;
    this.channel.send(JSON.stringify({ t: 'team', team: unit.teamId }));
  }

  /** Everything remote — the host's own champion, its bots, other clients — for the Đội tab. */
  netRosterUnits(): Champion[] {
    const remote: Champion[] = [];
    for (const unit of this.units.values()) {
      // Not the pets: a summon is an effect with a lifespan, not a roster row.
      if (unit instanceof Champion && unit !== this.game.player && !this.petUnits.has(unit)) {
        remote.push(unit);
      }
    }
    return remote;
  }

  /** Positions of every known unit, for the e2e's cross-page comparison. */
  debugPositions(): Record<string, [number, number]> {
    const out: Record<string, [number, number]> = {};
    for (const [id, unit] of this.units) out[id] = [unit.position.x, unit.position.y];
    return out;
  }

  /**
   * Leave for good.
   *
   * `bye` before the close, and the order matters: the host cannot tell a quit
   * from a reload by watching the channel shut — both look identical — so the
   * one that is deliberate says so. Without it a quitting player's champion
   * would be held open for a reclaim that never comes; with it, a *reload*
   * (which sends nothing, because nothing runs) is what keeps the seat.
   *
   * Best-effort: a channel already dead cannot carry it, and that case is
   * exactly the one where the host's own silence sweep is the right answer
   * anyway.
   */
  close(): void {
    clearNetLink();
    try {
      this.channel.send(encodeMessage({ t: 'bye' }));
    } catch {
      /* already gone — the host's silence sweep covers this */
    }
    this.channel.close();
    this.game.net = null;
    setNetRole('off');
    // The address bar stops claiming a room the moment the room stops.
    disarmNetUrl();
  }
}
