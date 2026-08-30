import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import { DAMAGE_TEXT_COLOR } from '@/game/gameObject/helpers/CombatText';
import { STAT_ICON } from '@/game/hud/statIcons';

/**
 * What a roster card says about a participant.
 *
 * A plain module rather than logic inside `RosterTab.vue`, for the reason at the
 * bottom of CLAUDE.md's Code Style: `<script setup>` *is* the setup function, it
 * reruns on every mount, and none of this wants to be re-derived by Vue or
 * tested through a mount. The tab renders what this returns and owns no
 * formatting of its own.
 *
 * Everything is read live off the unit. The practice panel holds the match
 * paused while it is open, so these are a snapshot by construction — which is
 * the honest thing for a stat sheet to be.
 */

/** How many times `Stats.update` — and so regeneration — runs in a second. */
import { FRAMES_PER_SECOND } from '@/game/gameObject/Stats';

/**
 * `BasicAttackController.attacksPerSecond`'s floor, restated here rather than
 * imported so the display cannot quietly diverge into showing a swing rate the
 * timer would refuse to run. If that floor ever moves, this test goes red:
 * `tests/game/hud/participantStats.test.ts`.
 */
const MIN_ATTACKS_PER_SECOND = 0.05;

export interface StatRow {
  label: string;
  value: string;
  /**
   * A Font Awesome class (`fa-heart`, …) rendered beside the label — a visual
   * anchor to scan by, with the word kept so an unfamiliar icon is never the
   * only thing carrying the meaning. The text is the source of truth.
   *
   * The strings used to be written here, one literal per row. They live in
   * `src/game/hud/statIcons.ts` now, because the shop's filter chips draw the
   * same stats and a second hand-written list would have been a second list to
   * keep in step — with nothing able to notice when it stopped being kept.
   */
  icon: string;
  /**
   * A CSS colour for the value, or absent — which is every row but two.
   *
   * It exists for the resistances, and it is a legend rather than decoration:
   * damage numbers learned three colours (`DAMAGE_TEXT_COLOR`) with nothing on
   * screen saying which was which, and tinting each resistance with the colour
   * of the damage it stops makes the pair teach each other. Read straight off
   * that constant, never restated as a hex, so the explanation cannot drift
   * away from the thing it explains.
   */
  tint?: string;
}

export interface StatGroup {
  title: string;
  rows: StatRow[];
}

export interface ScoreLine {
  kills: number;
  deaths: number;
  /** Minions and camps — the CS number. */
  cs: number;
}

/** The three headline numbers, always on the card. */
export function scoreLine(unit: AttackableUnit): ScoreLine {
  const tally = unit.tally;
  return { kills: tally.kills, deaths: tally.deaths, cs: tally.minionsKilled };
}

/** Truncated, not rounded — the same `~~` the health bar prints. */
const pool = (current: number, max: number): string => (max > 0 ? `${~~current} / ${~~max}` : '—');

const whole = (value: number): string => String(Math.round(value));

const percent = (fraction: number): string => `${Math.round(fraction * 100)}%`;

const cssColor = (rgb: readonly [number, number, number]): string => `rgb(${rgb.join(', ')})`;

/** One decimal, and no trailing `.0` to make a round number look measured. */
const perSecond = (perFrame: number): string =>
  `${Number((perFrame * FRAMES_PER_SECOND).toFixed(1))} / giây`;

/**
 * Everything else, in sections. Ordered the way a player asks: can I survive,
 * can I hit back, can I get there, and what have I actually done.
 */
export function statGroups(unit: AttackableUnit): StatGroup[] {
  const stats = unit.stats;
  const tally = unit.tally;

  return [
    {
      title: 'Sinh tồn',
      rows: [
        { icon: STAT_ICON.health, label: 'Máu', value: pool(stats.health.value, stats.maxHealth.value) },
        {
          icon: STAT_ICON.mana,
          label: 'Năng lượng',
          value: pool(stats.mana.value, stats.maxMana.value),
        },
        { icon: STAT_ICON.healthRegen, label: 'Hồi máu', value: perSecond(stats.healthRegen.value) },
        { icon: STAT_ICON.manaRegen, label: 'Hồi năng lượng', value: perSecond(stats.manaRegen.value) },
        {
          icon: STAT_ICON.armor,
          label: 'Giáp',
          value: whole(stats.armor.value),
          tint: cssColor(DAMAGE_TEXT_COLOR.PHYSICAL),
        },
        {
          icon: STAT_ICON.magicResist,
          label: 'Kháng phép',
          value: whole(stats.magicResist.value),
          tint: cssColor(DAMAGE_TEXT_COLOR.MAGIC),
        },
      ],
    },
    {
      title: 'Tấn công',
      rows: [
        { icon: STAT_ICON.attackDamage, label: 'Sát thương', value: whole(stats.attackDamage.value) },
        {
          icon: STAT_ICON.attackSpeed,
          label: 'Tốc đánh',
          value: `${Math.max(MIN_ATTACKS_PER_SECOND, stats.attackSpeed.value).toFixed(2)} đòn/giây`,
        },
        { icon: STAT_ICON.attackRange, label: 'Tầm đánh', value: whole(stats.attackRange.value) },
        { icon: STAT_ICON.critChance, label: 'Chí mạng', value: percent(stats.critChance.value) },
        {
          icon: STAT_ICON.omnivamp,
          label: 'Hút máu toàn phần',
          value: percent(stats.omnivamp.value),
        },
        {
          icon: STAT_ICON.lifesteal,
          label: 'Hút máu vật lý',
          value: percent(stats.lifesteal.value),
        },
        { icon: STAT_ICON.spellVamp, label: 'Hút máu phép', value: percent(stats.spellVamp.value) },
      ],
    },
    {
      title: 'Phép thuật',
      rows: [
        // Untinted, like every row but the two resistances. A tint here reads
        // as "this row is a damage type", and the panel spends that signal on
        // `Giáp`/`Kháng phép` alone so a player can find them at a glance —
        // `participantStats.test.ts` holds it to exactly those two.
        {
          icon: STAT_ICON.abilityPower,
          label: 'Sức mạnh phép',
          value: percent(stats.abilityPower.value),
        },
        {
          icon: STAT_ICON.cooldownReduction,
          label: 'Giảm hồi chiêu',
          value: percent(stats.cooldownReduction.value),
        },
      ],
    },
    {
      title: 'Cơ động',
      rows: [
        { icon: STAT_ICON.speed, label: 'Tốc chạy', value: whole(stats.speed.value) },
        { icon: STAT_ICON.size, label: 'Kích thước', value: whole(stats.size.value) },
        { icon: STAT_ICON.visionRadius, label: 'Tầm nhìn', value: whole(stats.visionRadius.value) },
      ],
    },
    {
      title: 'Thành tích',
      rows: [
        { icon: STAT_ICON.kills, label: 'Hạ gục', value: whole(tally.kills) },
        { icon: STAT_ICON.deaths, label: 'Bị hạ', value: whole(tally.deaths) },
        { icon: STAT_ICON.minionsKilled, label: 'Lính & quái', value: whole(tally.minionsKilled) },
        { icon: STAT_ICON.damageDealt, label: 'Sát thương gây ra', value: whole(tally.damageDealt) },
        { icon: STAT_ICON.damageTaken, label: 'Sát thương nhận', value: whole(tally.damageTaken) },
      ],
    },
  ];
}
