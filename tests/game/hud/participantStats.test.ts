/**
 * The numbers the roster tab reads out, formatted away from Vue.
 *
 * `RosterTab.vue` is a `<script setup>`, which is a setup function that reruns
 * on every mount — a bad place for anything worth asserting, and an expensive
 * place to test from. So the whole "what does a participant's card say" question
 * lives in a plain module and this suite drives it directly, the same split
 * `panelTab.ts` already uses for the tab state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import { scoreLine, statGroups } from '../../../src/game/hud/practice/participantStats';
import { createGame, stubGameGlobals, type TestGame } from '../fixtures';
import { DAMAGE_TEXT_COLOR } from '../../../src/game/gameObject/helpers/CombatText';

let game: TestGame;

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const unit = (): Champion => {
  const champion = new Champion({ game, teamId: 'subject' });
  game.setPlayer(champion);
  champion.stats.maxHealth.baseValue = 100;
  champion.stats.health.baseValue = 87.4;
  champion.stats.maxMana.baseValue = 500;
  champion.stats.mana.baseValue = 240.9;
  champion.stats.attackDamage.baseValue = 12;
  champion.stats.attackSpeed.baseValue = 0.8;
  champion.stats.attackRange.baseValue = 125;
  champion.stats.speed.baseValue = 3;
  champion.stats.critChance.baseValue = 0.25;
  champion.stats.omnivamp.baseValue = 0.1;
  champion.stats.lifesteal.baseValue = 0.15;
  champion.stats.spellVamp.baseValue = 0.2;
  champion.stats.healthRegen.baseValue = 0.06;
  return champion;
};

/** Every row across every group, so a test can look one up by label. */
const rowsOf = (champion: Champion): Record<string, string> => {
  const found: Record<string, string> = {};
  for (const group of statGroups(champion)) {
    for (const row of group.rows) found[row.label] = row.value;
  }
  return found;
};

describe('scoreLine', () => {
  it('reads the three headline numbers off the tally', () => {
    const champion = unit();
    champion.tally.kills = 2;
    champion.tally.deaths = 1;
    champion.tally.minionsKilled = 37;

    expect(scoreLine(champion)).toEqual({ kills: 2, deaths: 1, cs: 37 });
  });

  it('starts a fresh champion at zero rather than undefined', () => {
    expect(scoreLine(unit())).toEqual({ kills: 0, deaths: 0, cs: 0 });
  });
});

describe('statGroups', () => {
  it('shows pools as whole points out of their maximum', () => {
    const rows = rowsOf(unit());
    // 87.4 truncated, not rounded up to 88 — the health bar's own `~~`.
    expect(rows['Máu']).toBe('87 / 100');
    expect(rows['Năng lượng']).toBe('240 / 500');
  });

  it('says a unit has no resource rather than showing it an empty bar', () => {
    const champion = unit();
    champion.stats.maxMana.baseValue = 0;
    champion.stats.mana.baseValue = 0;

    expect(rowsOf(champion)['Năng lượng']).toBe('—');
  });

  it('states attack speed the way the swing timer means it', () => {
    // `BasicAttackController.attacksPerSecond` is the stat itself, floored at
    // 0.05. Printing anything else would put a number on screen that the timer
    // disagrees with.
    expect(rowsOf(unit())['Tốc đánh']).toBe('0.80 đòn/giây');
  });

  it('never prints a swing rate the timer could not run', () => {
    const champion = unit();
    champion.stats.attackSpeed.baseValue = 0;

    expect(rowsOf(champion)['Tốc đánh']).toBe('0.05 đòn/giây');
  });

  it('turns per-frame regeneration into per-second', () => {
    // `Stats.update` adds `healthRegen` once per frame; at 60fps 0.06 is 3.6/s.
    // Arithmetic written out here rather than derived from the same constant.
    expect(rowsOf(unit())['Hồi máu']).toBe('3.6 / giây');
  });

  it('shows chance-like stats as percentages', () => {
    const rows = rowsOf(unit());
    expect(rows['Chí mạng']).toBe('25%');
    // Three sustain rows, three labels. The panel drew one "Hút máu" while
    // omnivamp was the only vamp stat; two more arrived beside it and a row a
    // player cannot name is a row they cannot shop against.
    expect(rows['Hút máu toàn phần']).toBe('10%');
    expect(rows['Hút máu vật lý']).toBe('15%');
    expect(rows['Hút máu phép']).toBe('20%');
  });

  it('carries the tally through as its own group', () => {
    const champion = unit();
    champion.tally.damageDealt = 1234.6;
    champion.tally.damageTaken = 87;

    const rows = rowsOf(champion);
    expect(rows['Sát thương gây ra']).toBe('1235');
    expect(rows['Sát thương nhận']).toBe('87');
  });

  it('groups every row under a titled section, with no duplicate labels', () => {
    const groups = statGroups(unit());
    const labels = groups.flatMap(group => group.rows.map(row => row.label));

    expect(groups.length).toBeGreaterThan(1);
    expect(groups.every(group => group.title.length > 0 && group.rows.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

/**
 * The resistances, and the reason they carry a colour.
 *
 * `armor` and `magicResist` shipped with damage types and nothing anywhere
 * displayed either of them — a player could buy 40 armour and read the same
 * card as before. Worse, the floating numbers had just learned three colours
 * with no legend anywhere: amber, violet, white, and nothing on screen saying
 * which was which.
 *
 * These two rows are that legend. Tinting each resistance with the colour of
 * the damage it stops makes the pair self-teaching — "the violet numbers are
 * the ones this violet stat is for" — which is why the tint is read straight
 * off `DAMAGE_TEXT_COLOR` rather than restated as a hex here, where it could
 * drift away from the thing it is explaining.
 */
describe('the resistances', () => {
  const rowsOf = (title: string) =>
    statGroups(unit()).find(group => group.title === title)?.rows ?? [];

  it('are both on the card', () => {
    const labels = rowsOf('Sinh tồn').map(row => row.label);
    expect(labels).toContain('Giáp');
    expect(labels).toContain('Kháng phép');
  });

  it('report whole points', () => {
    const champion = unit();
    champion.stats.armor.baseValue = 41.6;
    const armour = statGroups(champion)
      .flatMap(group => group.rows)
      .find(row => row.label === 'Giáp');
    expect(armour?.value).toBe('42');
  });

  it('wear the colour of the damage each one stops', () => {
    const rows = rowsOf('Sinh tồn');
    const armour = rows.find(row => row.label === 'Giáp');
    const magic = rows.find(row => row.label === 'Kháng phép');

    expect(armour?.tint).toBe(`rgb(${DAMAGE_TEXT_COLOR.PHYSICAL.join(', ')})`);
    expect(magic?.tint).toBe(`rgb(${DAMAGE_TEXT_COLOR.MAGIC.join(', ')})`);
  });

  it('leaves every other row untinted, so the two that mean something stand out', () => {
    const tinted = statGroups(unit())
      .flatMap(group => group.rows)
      .filter(row => row.tint !== undefined)
      .map(row => row.label);
    expect(tinted.sort()).toEqual(['Giáp', 'Kháng phép']);
  });
});
