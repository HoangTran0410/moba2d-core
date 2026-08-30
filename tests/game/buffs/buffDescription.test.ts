import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import Stun from '../../../src/game/gameObject/buffs/Stun';
import Taunt from '../../../src/game/gameObject/buffs/Taunt';
import Slow from '../../../src/game/gameObject/buffs/Slow';
import Shield from '../../../src/game/gameObject/buffs/Shield';
import DamageOverTime from '../../../src/game/gameObject/buffs/DamageOverTime';
import StatAmp from '../../../src/game/gameObject/buffs/StatAmp';
import type AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  createUnit,
  installSpellObjectGlobals,
  installSketchMathGlobals,
  type TestGame,
} from '../spell/fixtures';

/**
 * The buff row said the name and the clock, and the clock is the half a player
 * can already see.
 *
 * `Buff.description` has existed and been rendered by the hover panel for as
 * long as the panel has — `v-html`, into the same `.body` element a spell
 * description goes into — and not one buff in core or in either installed pack
 * ever set it. So "Bùa Xanh · còn 62 giây" was the whole tooltip, and six
 * unlabelled icons under the portrait were a row you could only learn by being
 * hit by each of them once and remembering the picture.
 *
 * The rule this file holds is the split: **a control effect's sentence is
 * derived from the flags it sets, a number's sentence is written by the buff
 * that owns the number.** The derivation asks the same three predicates
 * `Stats.updateActionState` obeys, so a stun cannot say one thing while doing
 * another — which a hand-written Vietnamese copy of those lists absolutely
 * could, silently, the first time a flag moved.
 */
describe('a buff says what it does', () => {
  let game: TestGame;
  let unit: AttackableUnit;

  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('createVector', (x = 0, y = 0) => new (p5 as any).Vector(x, y));
    game = createGame();
    unit = createUnit(game, 0, 'blue');
  });

  const describeOf = (buff: { activateBuff(): void; description: string | null }): string => {
    buff.activateBuff();
    return buff.description ?? '';
  };

  it('names all three actions a stun takes away', () => {
    const said = describeOf(new Stun(1_000, unit, unit));
    expect(said).toContain('di chuyển');
    expect(said).toContain('đánh thường');
    expect(said).toContain('dùng chiêu');
  });

  it('and takes only casting from a taunt, which is the whole of that effect', () => {
    // The one control effect in the engine that appears in exactly one of the
    // three lists: it spends the swings and the walking itself rather than
    // stopping them. A tooltip that flattened it into "không thể làm gì" would
    // be describing a stun.
    const said = describeOf(new Taunt(1_000, unit, unit));
    expect(said).toContain('dùng chiêu');
    expect(said).not.toContain('di chuyển');
    expect(said).toContain('khiêu khích');
  });

  it('reads the slow percentage off the buff rather than a written-down copy', () => {
    const slow = new Slow(1_000, unit, unit);
    slow.percent = 0.25;
    expect(describeOf(slow)).toContain('25%');
  });

  it('states the pool a shield is actually standing behind', () => {
    const shield = new Shield(1_000, unit, unit);
    shield.amount = 60;
    expect(describeOf(shield)).toContain('60');
  });

  it('gives a burn its damage type, in the word and in the colour', () => {
    const burn = new DamageOverTime(3_000, unit, unit);
    burn.damagePerTick = 6;
    burn.tickInterval = 500;
    burn.damageType = 'PHYSICAL';

    const said = describeOf(burn);
    expect(said).toContain('sát thương vật lý');
    // The class the stylesheet paints amber, so the tooltip is the colour of
    // the number that will come off the bar.
    expect(said).toContain('class="damage physical"');
    expect(said).toContain('0.5 giây');
  });

  it('lists what a stat buff grants, from the object it built its modifier from', () => {
    const amp = new StatAmp(1_000, unit, unit);
    amp.bonuses = { attackDamage: { flatBonus: 8 }, armor: { flatBonus: 15 } };

    const said = describeOf(amp);
    expect(said).toContain('+8 Sát thương');
    expect(said).toContain('+15 Giáp');
  });

  /**
   * The five bonus slots are not two kinds of number split down the middle.
   *
   * `Stat.value` is
   * `((baseValue + baseBonus) * (1 + percentBaseBonus) + flatBonus) * (1 + percentBonus)`
   * — three slots are *added* to the stat and two *multiply* it — and this
   * used to ask `kind !== 'flatBonus'`, which put `baseValue` and `baseBonus`
   * on the multiplying side. A growth stack granting `maxHealth:
   * { baseBonus: 75 }` then advertised **+7500% Máu tối đa** off a single
   * stack. `baseBonus` is the slot `StatAmp`'s own doc comment demonstrates,
   * so the wrong half was the common one.
   *
   * Driven across all five rather than as one case for the slot that broke:
   * the next slot added to `BonusKind` has to be classified by whoever adds
   * it, and a single `baseBonus` case would not ask them to.
   */
  it('tells the slots that add points from the slots that multiply', () => {
    const points: ('baseValue' | 'baseBonus' | 'flatBonus')[] = [
      'baseValue',
      'baseBonus',
      'flatBonus',
    ];
    for (const kind of points) {
      const amp = new StatAmp(1_000, unit, unit);
      amp.bonuses = { maxHealth: { [kind]: 75 } };
      expect(describeOf(amp), `${kind} printed as a share of itself`).toContain(
        '+75 Máu tối đa'
      );
    }

    const shares: ('percentBonus' | 'percentBaseBonus')[] = ['percentBonus', 'percentBaseBonus'];
    for (const kind of shares) {
      const amp = new StatAmp(1_000, unit, unit);
      amp.bonuses = { maxHealth: { [kind]: 0.75 } };
      expect(describeOf(amp), `${kind} printed as points`).toContain('+75% Máu tối đa');
    }
  });

  it('counts a stacking buff’s grant at the stacks it is actually carrying', () => {
    // The shape the Feast-style growth buff uses: one live instance standing
    // in for N, its `bonuses` scaled by `stacks` in both the modifier and the
    // sentence. A tooltip reading one stack's worth on a five-stack buff is
    // the same class of lie as the percentage one, just quieter.
    const amp = new StatAmp(1_000, unit, unit);
    amp.bonuses = { maxHealth: { baseBonus: 75 } };
    amp.stacks = 4;

    expect(describeOf(amp)).toContain('+300 Máu tối đa');
  });

  it('leaves a buff that describes itself alone', () => {
    const slow = new Slow(1_000, unit, unit);
    slow.percent = 0.3;
    slow.description = 'Bùa Đỏ thiêu đốt mục tiêu.';
    expect(describeOf(slow)).toBe('Bùa Đỏ thiêu đốt mục tiêu.');
  });

  it('has something to say about every buff core ships', () => {
    // The population check, and the one that catches the next buff rather than
    // these. A buff answers with a written `description` or with status flags
    // to derive one from; a file with neither ships mute, which is the state
    // all twenty-four of these were in.
    const dir = resolve(__dirname, '../../../src/game/gameObject/buffs');
    const mute: string[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts') || file === 'describeBuff.ts') continue;
      const source = readFileSync(join(dir, file), 'utf8');
      const speaks =
        /\bdescription\s*(\?\?)?=/.test(source) ||
        /statusFlagsTo(Enable|Disable)\s*=/.test(source);
      if (!speaks) mute.push(file);
    }
    expect(mute, `these buffs would hover as a name and a clock:\n  ${mute.join('\n  ')}`).toEqual(
      []
    );
  });
});
