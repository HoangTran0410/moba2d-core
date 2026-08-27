import type Game from '@/game/Game';
import AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import Minion, { MinionPresets, type MinionKind } from '@/game/gameObject/attackableUnits/Minion';
import { getLaneWaypoints, nextWaypointIndexFrom } from '@/game/lanes';
import { attachRecall, presetFromPlan, type KitPlan } from '@/game/preset';
import { setNetRole } from './netRole';
import type { NetChannel } from './NetChannel';
import { decodeMessage, type NetEvent, type NetMessage, type UnitSnap } from './protocol';
import { InterpolationBuffer } from './InterpolationBuffer';
import { RECALL_SLOT } from './HostSession';
import type { NetGameHooks } from './hooks';
import type { Vec2 } from '@/game/spell/runtime/types';

/** Repeated right-clicks fire every tick; the host needs at most a few orders a second. */
const MOVE_ORDER_INTERVAL_MS = 120;
/** A unit that covered more than this between snapshots blinked — snap, don't glide. */
const DASH_SNAP_UNITS = 400;

/**
 * The renderer end of a LAN match. The local `Game` is sim-gated (spec §4)
 * — no bots, no spawner, `takeDamage` and mana costs inert — and this class
 * fills the world back in from the host's stream: spawn events construct
 * *real* units, cast events press their *real* spells (which then play
 * their whole visual life locally, damage dying in the gated funnel), and
 * 15Hz snapshots, interpolated per unit of time, own every position and
 * resource bar. Own input never executes locally; it is serialized to the
 * host through the three `Game` intercepts and comes back as ordinary
 * events like everyone else's.
 */
export class ClientSession implements NetGameHooks {
  private units = new Map<string, AttackableUnit>();
  private buffer = new InterpolationBuffer();
  private lastMoveSentAt = 0;
  /** e2e-readable counters — see the dev handle in the constructor. */
  readonly debugStats = { snapshotsReceived: 0, eventsApplied: 0 };

  constructor(
    private readonly game: Game,
    private readonly channel: NetChannel,
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
      (window as unknown as Record<string, unknown>).__lol2dNet = this;
    }
  }

  // ------------------------------------------------------------- per tick

  update(): void {
    for (const raw of this.channel.drain()) {
      const message = decodeMessage(raw);
      if (!message) continue;
      if (message.t === 'snap') {
        this.debugStats.snapshotsReceived++;
        this.buffer.push(message, performance.now());
      } else if (message.t === 'ev') {
        this.debugStats.eventsApplied += message.ev.length;
        for (const event of message.ev) this.applyEvent(event);
      }
    }
    this.applyInterpolated();
  }

  private applyInterpolated(): void {
    const sample = this.buffer.sample(performance.now(), DASH_SNAP_UNITS);
    if (!sample) return;
    for (const [id, snap] of sample) {
      const unit = this.units.get(id);
      if (!unit) continue;
      this.applyUnitSnap(unit, snap);
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

    unit.stats.maxHealth.baseValue = snap.maxHp;
    unit.stats.health.baseValue = snap.hp;
    unit.stats.mana.baseValue = snap.mp;
    unit.stats.actionState = snap.actionState;

    // Cooldowns: authoritative only for the own champion's HUD — puppets run
    // theirs locally from cast events, and stomping those every 66ms would
    // reset mid-flight spell runtimes for no visible gain.
    if (unit === this.game.player && snap.cds) {
      snap.cds.forEach((cd, slot) => {
        const spell = this.game.player.spells[slot];
        if (spell && Math.abs(spell.currentCooldown - cd) > 250) spell.currentCooldown = cd;
      });
    }
  }

  // -------------------------------------------------------------- events

  private applyEvent(event: NetEvent): void {
    switch (event.k) {
      case 'champ': {
        const existing = this.units.get(event.id);
        if (existing instanceof Champion) {
          // A re-broadcast kit (a random bot re-rolled on respawn).
          existing.applyPreset(presetFromPlan(event.plan as KitPlan));
          return;
        }
        if (existing) return;
        const champion = attachRecall(
          new Champion({
            game: this.game,
            position: createVector(event.x, event.y),
            teamId: event.team,
            preset: presetFromPlan(event.plan as KitPlan),
          })
        );
        this.game.objectManager.addObject(champion);
        this.units.set(event.id, champion);
        return;
      }
      case 'minion': {
        if (this.units.has(event.id)) return;
        const kind = (event.kind in MinionPresets ? event.kind : 'melee') as MinionKind;
        const minion = new Minion({
          game: this.game,
          position: createVector(event.x, event.y),
          teamId: event.team,
          lane: event.lane,
          waypoints: getLaneWaypoints(event.lane, event.team),
          preset: MinionPresets[kind],
          startWaypointIndex: nextWaypointIndexFrom(event.lane, event.team, event.x, event.y),
        });
        this.game.objectManager.addObject(minion);
        this.units.set(event.id, minion);
        return;
      }
      case 'gone': {
        const unit = this.units.get(event.id);
        if (!unit) return;
        this.units.delete(event.id);
        this.game.objectManager.removeObject(unit);
        return;
      }
      case 'cast': {
        const unit = this.units.get(event.id);
        if (!(unit instanceof Champion)) return;
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

  // ----------------------------------------------------------- intercepts

  interceptPointer(point: Vec2): boolean {
    const now = performance.now();
    if (now - this.lastMoveSentAt >= MOVE_ORDER_INTERVAL_MS) {
      this.lastMoveSentAt = now;
      this.channel.send(JSON.stringify({ t: 'move', x: point.x, y: point.y }));
    }
    return true;
  }

  interceptCast(slot: number, aim: Vec2): boolean {
    this.channel.send(JSON.stringify({ t: 'cast', slot, x: aim.x, y: aim.y }));
    return true;
  }

  interceptRecall(): boolean {
    this.channel.send(JSON.stringify({ t: 'recall' }));
    return true;
  }

  /** Positions of every known unit, for the e2e's cross-page comparison. */
  debugPositions(): Record<string, [number, number]> {
    const out: Record<string, [number, number]> = {};
    for (const [id, unit] of this.units) out[id] = [unit.position.x, unit.position.y];
    return out;
  }

  close(): void {
    this.channel.close();
    this.game.net = null;
    setNetRole('off');
  }
}
