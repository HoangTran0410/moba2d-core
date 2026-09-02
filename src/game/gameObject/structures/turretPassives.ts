import { Circle } from '@/libs/quadtree';
import Buff from '@/game/gameObject/Buff';
import StatAmp from '@/game/gameObject/buffs/StatAmp';
import { createReveal } from '@/game/gameObject/buffs/TrueSight';
import AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import Minion from '@/game/gameObject/attackableUnits/Minion';
import { PredefinedFilters } from '@/game/managers/ObjectManager';
import type { TurretPassive } from './Turret';

/**
 * What a tower is built carrying.
 *
 * A turret is not a health bar with a gun. It has three named behaviours — an
 * armour-piercing ramp that punishes standing under one, a floor that makes
 * diving without a wave pointless, and true sight over the lane — and all three
 * are written as **real buffs on the turret** rather than as branches inside
 * `Turret` itself. That is what `TurretPassive` is for, and writing them this
 * way is what makes each one visible to everything that already argues with a
 * buff: a cleanse, a stat modifier, the damage funnel.
 *
 * ## Core's, with a pack still able to say otherwise
 *
 * These began as one pack's `turretPassives`, on the reasoning that a pack's
 * idea of a tower is that pack's. What that actually produced was a map drawn
 * in core's own editor whose towers were cardboard unless a particular pack
 * happened to be installed — a tower's behaviour is not flavour, it is the rule
 * that decides whether a dive is a play or a coin flip.
 *
 * So this is the floor. `Game.spawnStructures` uses it when no installed pack
 * declares any passives of its own, and a pack that declares a list replaces it
 * wholesale — see `ContentPackCode.turretPassives`. Replaces rather than adds
 * to, deliberately: a pack that wants a different tower wants *its* tower, and
 * two half-towers stacked is not a third opinion, it is a bug.
 *
 * What is *not* here, deliberately: which body a turret shoots first, and how
 * far it will answer for an ally under attack. Those are rules about how the
 * engine picks a target — `Turret.LADDER` and `TURRET_DEFEND_RANGE_RATIO` — not
 * passives, and a pack that could redefine them would be a pack that changes
 * what "a turret" means for everybody who plays against it.
 *
 * ## Ranges are ratios, never absolute distances
 *
 * A turret's reach is the map's to set (`TurretStats.attackRange`), so every
 * radius below is written as *its share of that reach*. Scale-free, and it
 * survives a map that widens the reach — a copied pixel count would be a tower
 * that watches three screens on one map and half a lane on another.
 */

/**
 * The eye sees exactly as far as the tower shoots.
 *
 * A ring wider than the reach is the one thing here deliberately not done:
 * vision the tower cannot punish is vision it hands to whoever walks the edge
 * of it, and on a canvas this size a wider ring reaches most of the way to the
 * next tower. Revealing only what it can shoot keeps the passive readable — if
 * you are lit up, you are already being hit.
 */
const WARDENS_EYE_RATIO = 1;
/** Minions within roughly a wave's standing distance switch the floor off. */
const REINFORCED_MINION_RATIO = 1;

/** The armour-pen ramp: a flat pierce, plus a bonus that grows while it fires. */
export const TURRET_ARMOR_PENETRATION = 0.3;
export const WARMING_UP_PER_STACK = 0.5;
export const WARMING_UP_MAX_STACKS = 3;
export const WARMING_UP_RESET_MS = 5_000;

/** What is left of a hit while the lane is empty. */
export const REINFORCED_ARMOR_TAKEN = 0.2;
export const REINFORCED_REARM_MS = 3_000;

/** How often the eye sweeps for anything hiding. Not every frame; nothing moves that fast. */
const EYE_SWEEP_MS = 250;

/**
 * The half of a turret these passives read.
 *
 * `Buff.targetUnit` is an `AttackableUnit` — the base every buff is written
 * against — and `attackRange` is a turret's own. Named once here rather than
 * cast twice inline, so the two radius calculations below cannot drift into
 * asking different questions.
 */
type TurretBody = AttackableUnit & { attackRange: number };

/**
 * The tower gets angrier the longer you stand under it.
 *
 * The ramp is a separate `StatAmp` swapped out on each change rather than a
 * number mutated in place: `Stats` reads its modifiers when they are added and
 * removed, so editing a live bonus object is a change nothing recomputes.
 */
class TurretWarmingUp extends Buff {
  name = 'Nòng Nóng Dần';
  description =
    'Mỗi đòn trúng tướng khiến trụ mạnh thêm <span class="buff">50%</span>, ' +
    'tối đa <span class="buff">150%</span>. Hết cộng dồn sau ' +
    '<span class="time">5 giây</span> không đánh trúng tướng nào.';
  hudVisible = false;

  private warmth = 0;
  private sinceHit = 0;
  private ramp: StatAmp | null = null;

  onDamageDealt(_swung: number, _landed: number, victim: unknown): void {
    if (!(victim instanceof Champion)) return;
    this.sinceHit = 0;
    if (this.warmth >= WARMING_UP_MAX_STACKS) return;
    this.warmth += 1;
    this.applyRamp();
  }

  onUpdate(): void {
    if (this.warmth === 0) return;
    this.sinceHit += deltaTime;
    if (this.sinceHit < WARMING_UP_RESET_MS) return;
    // All of it at once: the tower cools down, it does not step down.
    this.warmth = 0;
    this.applyRamp();
  }

  private applyRamp(): void {
    // `deactivateBuff`, not `toRemove`: the flag only marks a buff for the
    // sweep, while `onDeactivate` is what takes the modifier back off the
    // stats. Setting the flag alone left the ramp applied for ever.
    if (this.ramp) this.ramp.deactivateBuff();
    this.ramp = null;
    if (this.warmth === 0) return;
    const ramp = new StatAmp(0, this.targetUnit, this.targetUnit);
    ramp.name = 'Nòng Nóng Dần';
    ramp.stackId = 'core_turret_warming_up_ramp';
    ramp.hudVisible = false;
    ramp.bonuses = { attackDamage: { percentBonus: WARMING_UP_PER_STACK * this.warmth } };
    this.targetUnit.addBuff(ramp);
    this.ramp = ramp;
  }
}

/**
 * A tower alone in its lane is not a health bar you can chew through, it is a
 * wall. Bring a wave or bring nothing.
 *
 * The delay on the way *back* is what makes shoving a wave in worth doing: the
 * floor does not snap on the instant the last minion dies.
 */
class TurretReinforcedArmor extends Buff {
  name = 'Giáp Cường Hóa';
  description =
    'Khi không có lính địch bên cạnh, trụ chỉ nhận ' +
    '<span class="buff">20%</span> sát thương. Bật lại sau ' +
    '<span class="time">3 giây</span> kể từ khi lính địch cuối cùng rời đi.';
  hudVisible = false;

  private rearmMs = 0;

  onUpdate(): void {
    if (this.enemyMinionsNear()) this.rearmMs = REINFORCED_REARM_MS;
    else if (this.rearmMs > 0) this.rearmMs -= deltaTime;
  }

  modifyIncomingDamage(damage: number): number {
    return this.rearmMs > 0 ? damage : damage * REINFORCED_ARMOR_TAKEN;
  }

  private enemyMinionsNear(): boolean {
    const turret = this.targetUnit as TurretBody;
    const game = turret.game;
    if (!game?.objectManager) return true; // no world to ask: never a free wall
    const found = game.objectManager.queryObjects({
      area: new Circle({
        x: turret.position.x,
        y: turret.position.y,
        r: turret.attackRange * REINFORCED_MINION_RATIO,
      }),
      filters: [
        PredefinedFilters.type(Minion),
        PredefinedFilters.excludeDead,
        (unit: { teamId?: string }) => unit.teamId !== turret.teamId,
      ],
    });
    return found.length > 0;
  }
}

/**
 * Nothing hides in a lane a tower is watching.
 *
 * Swept rather than continuous: it re-reveals every quarter second, and each
 * reveal outlives the sweep, so a unit that steps out is dark again a beat
 * later rather than the frame after.
 */
class TurretWardensEye extends Buff {
  name = 'Mắt Thần Canh Gác';
  description =
    'Trụ có <span class="buff">Mắt Thần</span> quanh mình — không gì ẩn mình ' +
    'được trong tầm của nó.';
  hudVisible = false;

  private sinceSweep = EYE_SWEEP_MS;

  onUpdate(): void {
    this.sinceSweep += deltaTime;
    if (this.sinceSweep < EYE_SWEEP_MS) return;
    this.sinceSweep = 0;

    const turret = this.targetUnit as TurretBody;
    const game = turret.game;
    if (!game?.objectManager) return;

    // Narrowed to bodies: `queryObjects` answers with `GameObject`s, and a
    // particle system has no `addBuff` to reveal it with.
    const hiding = game.objectManager.queryObjects({
      area: new Circle({
        x: turret.position.x,
        y: turret.position.y,
        r: turret.attackRange * WARDENS_EYE_RATIO,
      }),
      filters: [
        PredefinedFilters.type(AttackableUnit),
        PredefinedFilters.excludeDead,
        (unit: { teamId?: string; isStealthed?: boolean }) =>
          unit.teamId !== turret.teamId && unit.isStealthed === true,
      ],
    }) as TurretBody[];

    for (const unit of hiding) {
      unit.addBuff(
        createReveal({
          stackId: 'core_turret_wardens_eye',
          durationMs: EYE_SWEEP_MS * 2,
          source: turret,
          target: unit,
        })
      );
    }
  }
}

/**
 * Core's three, in the order they are applied. Built per call rather than held
 * as a frozen array because each entry closes over nothing — the cost is three
 * object literals at spawn time, and a shared mutable array reaching a pack is
 * a worse trade than that.
 */
export const coreTurretPassives = (): TurretPassive[] => [
  {
    name: 'Xuyên Giáp Trụ',
    onSpawn(turret) {
      const pierce = new StatAmp(0, turret, turret);
      pierce.name = 'Xuyên Giáp Trụ';
      pierce.stackId = 'core_turret_armor_pen';
      pierce.hudVisible = false;
      pierce.bonuses = { armorPenetration: { baseBonus: TURRET_ARMOR_PENETRATION } };
      turret.addBuff(pierce);

      const warming = new TurretWarmingUp(0, turret, turret);
      warming.stackId = 'core_turret_warming_up';
      turret.addBuff(warming);
    },
  },
  {
    name: 'Giáp Cường Hóa',
    onSpawn(turret) {
      const wall = new TurretReinforcedArmor(0, turret, turret);
      wall.stackId = 'core_turret_reinforced_armor';
      turret.addBuff(wall);
    },
  },
  {
    name: 'Mắt Thần Canh Gác',
    onSpawn(turret) {
      const eye = new TurretWardensEye(0, turret, turret);
      eye.stackId = 'core_turret_wardens_eye_aura';
      turret.addBuff(eye);
    },
  },
];

/**
 * Which list a turret is actually built with: the pack's if any pack declared
 * one, core's otherwise.
 *
 * A function beside the list rather than two lines inside
 * `Game.spawnStructures`, for the reason `preset.ts`'s `neutralSlotFill` gives
 * about `spawnJungle`: nothing in this codebase constructs a real `Game`, so a
 * rule written inside that loop is a rule no test can reach.
 *
 * Emptiness is the whole signal, and it is the honest one: `PackRegistry`
 * concatenates every installed pack's list, so "nobody had an opinion" and
 * "somebody declared an empty list" arrive here as the same thing — and they
 * mean the same thing too, since a pack that wants a plain tower is asking for
 * *fewer* rules than core has, not for a different set.
 */
export const turretPassivesFor = (
  packDeclared: readonly TurretPassive[]
): readonly TurretPassive[] => (packDeclared.length > 0 ? packDeclared : coreTurretPassives());
