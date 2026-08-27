import type Game from '@/game/Game';
import type GameObject from '@/game/gameObject/GameObject';
import AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import Champion, {
  DEFAULT_CHAMPION_ATTACK,
  DEFAULT_CHAMPION_DEFENCE,
} from '@/game/gameObject/attackableUnits/Champion';
import Minion from '@/game/gameObject/attackableUnits/Minion';
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
import { allSpellIds, loadSpells, spellClassOfId } from '@/game/spellRegistry';
import { setNetRole } from './netRole';
import { NetChannel, parseHostFrame, relayUrl } from './NetChannel';
import {
  decodeMessage,
  encodeMessage,
  type NetEvent,
  type NetMessage,
  type UnitSnap,
} from './protocol';
import type { NetGameHooks } from './hooks';
import type { Vec2 } from '@/game/spell/runtime/types';

/** ~15Hz — LoL runs its whole sim at 30Hz; half of that for state that interpolates. */
const SNAPSHOT_INTERVAL_MS = 66;
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
  private pendingEvents: NetEvent[] = [];
  /** e2e-readable counters — see the dev handle in the constructor. */
  readonly debugStats = { snapshotsSent: 0, eventsSent: 0, castsSeen: 0 };
  private lastSnapshotAt = 0;
  private stopCastListener: () => void;
  /** class -> catalogue id, for deriving a KitPlan from a live champion. Rebuilt on miss (chunks stream in). */
  private classIds = new Map<unknown, string>();

  constructor(
    private readonly game: Game,
    private readonly channel: NetChannel,
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

    // Dev-only handle for the e2e driver (`tests/e2e/drive-lan-sync.mjs`),
    // the same convention as `window.__lol2d`. Stripped from production.
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__lol2dNet = this;
    }
  }

  static async attach(
    game: Game,
    request: { server: string; room: string },
    plan: MatchPlan | null
  ): Promise<HostSession> {
    const channel = new NetChannel(relayUrl(request.server, request.room, 'host'));
    await channel.ready();
    return new HostSession(game, channel, plan);
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
    };
  }

  /**
   * A serializable kit for a champion whose original plan is gone — a random
   * bot after a respawn re-roll. The class -> id reverse map recovers the
   * spell ids; the tunings fall to defaults and the portrait to a
   * placeholder, which the spec's own cuts section owns up to.
   */
  private planFromLiveChampion(unit: Champion): KitPlan {
    for (const spell of unit.spells) {
      if (!this.classIds.has(spell.constructor)) {
        this.classIds.clear();
        for (const id of allSpellIds()) {
          const spellClass = spellClassOfId(id);
          if (spellClass) this.classIds.set(spellClass, id);
        }
        break;
      }
    }
    return {
      name: unit.name,
      avatar: '',
      attack: DEFAULT_CHAMPION_ATTACK,
      defence: DEFAULT_CHAMPION_DEFENCE,
      spellIds: unit.spells.map(spell => this.classIds.get(spell.constructor) ?? 'BasicAttack'),
    };
  }

  // ------------------------------------------------------------ per tick

  update(): void {
    this.applyClientFrames();
    this.discover();
    if (this.game.matchTimeMs - this.lastSnapshotAt >= SNAPSHOT_INTERVAL_MS) {
      this.lastSnapshotAt = this.game.matchTimeMs;
      this.flushEvents();
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
  }

  private flushEvents(): void {
    if (this.pendingEvents.length === 0) return;
    this.debugStats.eventsSent += this.pendingEvents.length;
    this.broadcast({ t: 'ev', ev: this.pendingEvents });
    this.pendingEvents = [];
  }

  // ----------------------------------------------------- clients & orders

  private applyClientFrames(): void {
    for (const raw of this.channel.drain()) {
      const frame = parseHostFrame(raw);
      if (!frame) continue;
      if (frame.sys === 'joined' && frame.id) {
        void this.onClientJoined(frame.id);
        continue;
      }
      if (frame.sys === 'left' && frame.id) {
        // v1: the champion stays, idle — a rejoin story is future work.
        this.clients.delete(frame.id);
        continue;
      }
      if (!frame.from || typeof frame.data !== 'string') continue;
      const message = decodeMessage(frame.data);
      const champion = this.clients.get(frame.from);
      if (!message || !champion || champion.isDead) continue;
      this.applyOrder(champion, message);
    }
  }

  private applyOrder(champion: Champion, message: NetMessage): void {
    if (message.t === 'move') {
      issuePointerOrder(champion, this.game.objectManager, { x: message.x, y: message.y });
      return;
    }
    if (message.t === 'cast') {
      const spell = champion.spells[message.slot];
      if (!spell) return;
      const context = this.game.createSpellContext(spell, champion, {
        x: message.x,
        y: message.y,
      });
      if (context) {
        spell.press(context);
        // A charge held by a remote thumb has no release wire in v1: fire at
        // minimum charge, the same shortcut the client's puppets take.
        if (spell.state === 'CHARGING') spell.release(context);
      }
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
    this.channel.send(JSON.stringify({ to: 'all', data: encodeMessage(message) }));
  }

  private sendTo(clientId: string, message: NetMessage): void {
    this.channel.send(JSON.stringify({ to: clientId, data: encodeMessage(message) }));
  }

  // The host intercepts nothing: its own input drives the match directly.
  interceptPointer(_point: Vec2): boolean {
    return false;
  }
  interceptCast(_slot: number, _aim: Vec2): boolean {
    return false;
  }
  interceptRecall(): boolean {
    return false;
  }

  /** Positions of every tracked unit, for the e2e's cross-page comparison. */
  debugPositions(): Record<string, [number, number]> {
    const out: Record<string, [number, number]> = {};
    for (const [id, unit] of this.tracked) out[id] = [unit.position.x, unit.position.y];
    return out;
  }

  /** The first remote client's champion, for the e2e's order assertions. */
  debugRemote(): { x: number; y: number; cooldowns: number[] } | null {
    const champion = this.clients.values().next().value as Champion | undefined;
    if (!champion) return null;
    return {
      x: champion.position.x,
      y: champion.position.y,
      cooldowns: champion.spells.map(spell => spell.currentCooldown),
    };
  }

  close(): void {
    this.stopCastListener();
    this.channel.close();
    this.game.net = null;
    setNetRole('off');
  }
}
