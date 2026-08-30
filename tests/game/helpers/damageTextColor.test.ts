import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createGame, createUnit, installSpellObjectGlobals } from '../spell/fixtures';
import CombatText, { DAMAGE_TEXT_COLOR } from '../../../src/game/gameObject/helpers/CombatText';
import type { DamageType } from '../../../src/game/combat/Mitigation';

const combatTexts = (game: ReturnType<typeof createGame>): CombatText[] =>
  [...game.objectManager.objects, ...game.objectManager._objectToBeAdd].filter(
    (object): object is CombatText => object instanceof CombatText
  );

/**
 * Damage got a type and every number on screen stayed the same red, so a
 * player who bought armour had no way to tell whether the hit that went
 * through it was one armour was ever going to stop.
 *
 * Colour is the whole signal, and the merge key is what makes it hold: the
 * key is `(victim, kind, colour)`, so giving the three types three colours
 * *also* stops a physical hit and a magic hit on one victim blending into a
 * single number that hides which of them was which.
 */
describe('a damage number carries its type', () => {
  beforeEach(() => installSpellObjectGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('gives the three types three different colours', () => {
    const seen = new Set(
      (['PHYSICAL', 'MAGIC', 'TRUE'] as DamageType[]).map(type => DAMAGE_TEXT_COLOR[type].join(','))
    );
    expect(seen.size, 'two damage types share a colour').toBe(3);
  });

  it('keeps the three far enough apart to tell apart at a glance', () => {
    // Written out as a distance rather than three inequalities on purpose: the
    // failure this guards is a retune that nudges two of them together, and
    // "they are different values" would still pass that.
    const types = ['PHYSICAL', 'MAGIC', 'TRUE'] as DamageType[];
    for (const a of types) {
      for (const b of types) {
        if (a === b) continue;
        const distance = Math.hypot(
          ...DAMAGE_TEXT_COLOR[a].map((channel, i) => channel - DAMAGE_TEXT_COLOR[b][i])
        );
        expect(distance, `${a} and ${b} are near-identical on screen`).toBeGreaterThan(90);
      }
    }
  });

  /**
   * The colour has two backgrounds, and only one of them was ever checked.
   *
   * In the world a number floats over grass, stone and bodies, and white is
   * the right answer there — nothing absorbed it, so it arrives uncoloured.
   * In a spell description the same claim is a word inside `#eee` body text on
   * a dark panel, and `#f8f8f8` against `#eee` is not a colour, it is the
   * absence of one: "40 sát thương chuẩn" read exactly like the sentence
   * around it, so the one type no resistance touches was the one type a player
   * could not see was being called out.
   *
   * Read out of the stylesheet rather than written as a literal, for the same
   * reason the binding case below reads `main.css`: the body colour is a
   * decision made in a different file and this has to fail when *it* moves,
   * not only when the palette does.
   */
  it('keeps every one of them clear of the body text it is printed on', () => {
    const surfaces = [
      ['styles/hud.css', /\.spell-info \.body \{[^}]*color:\s*(#[0-9a-f]{3,6})/i],
      ['styles/pregame-scene.css', /\.spell-detail-body \{[^}]*color:\s*(#[0-9a-f]{3,6})/i],
    ] as const;

    const widen = (hex: string): number[] => {
      const full = hex.length === 4 ? hex.replace(/([0-9a-f])/gi, '$1$1').slice(1) : hex.slice(1);
      return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
    };

    for (const [file, pattern] of surfaces) {
      const css = readFileSync(resolve(__dirname, '../../../', file), 'utf8');
      const body = css.match(pattern)?.[1];
      expect(body, `${file} no longer states its description body colour`).toBeDefined();
      const text = widen(body!);

      for (const type of ['PHYSICAL', 'MAGIC', 'TRUE'] as DamageType[]) {
        const distance = Math.hypot(...DAMAGE_TEXT_COLOR[type].map((c, i) => c - text[i]));
        expect(
          distance,
          `${type} is invisible against ${file}'s own body text`
        ).toBeGreaterThan(100);
      }
    }
  });

  it('keeps every one of them clear of the heal green', () => {
    // Green is already on screen and already means the opposite thing. A
    // damage colour that lands near it is a number a player reads as a heal.
    for (const type of ['PHYSICAL', 'MAGIC', 'TRUE'] as DamageType[]) {
      const distance = Math.hypot(...DAMAGE_TEXT_COLOR[type].map((c, i) => c - [0, 255, 0][i]));
      expect(distance, `${type} sits on top of the heal green`).toBeGreaterThan(120);
    }
  });

  it('does not merge a physical hit into a magic one on the same victim', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');

    unit.takeDamage(15, undefined, 'PHYSICAL');
    unit.takeDamage(10, undefined, 'MAGIC');

    const texts = combatTexts(game);
    expect(texts, 'two damage types blended into one number').toHaveLength(2);
    expect(texts.map(t => t.text).sort()).toEqual(['-10', '-15']);
  });

  it('still merges repeated hits of the same type', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');

    unit.takeDamage(15, undefined, 'PHYSICAL');
    unit.takeDamage(10, undefined, 'PHYSICAL');

    const texts = combatTexts(game);
    expect(texts).toHaveLength(1);
    expect(texts[0].text).toBe('-25');
  });

  /**
   * A spell tooltip promising "40 sát thương phép" is painted from CSS custom
   * properties and the number it predicts is painted from this table, and the
   * two are in different languages in different files. Writing the same colour
   * twice is the cheap part; keeping it written twice is not, and the failure
   * is invisible in every test that renders either one alone — the tooltip
   * would still be violet, just a *different* violet from the figure that
   * comes off the health bar.
   */
  it('paints a tooltip the same colour as the number it predicts', () => {
    const css = readFileSync(resolve(__dirname, '../../../styles/main.css'), 'utf8');
    const hex = ([r, g, b]: readonly number[]) =>
      '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');

    for (const [type, token] of [
      ['PHYSICAL', '--spell-damage-physical'],
      ['MAGIC', '--spell-damage-magic'],
      ['TRUE', '--spell-damage-true'],
    ] as const) {
      const declared = css.match(new RegExp(`\\${token}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1];
      expect(declared, `${token} is not declared in styles/main.css`).toBeDefined();
      expect(declared!.toLowerCase(), `${token} has drifted from DAMAGE_TEXT_COLOR.${type}`).toBe(
        hex(DAMAGE_TEXT_COLOR[type])
      );
    }
  });

  it('paints a hit in its own type’s colour, not a single red for all of them', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');

    unit.takeDamage(15, undefined, 'MAGIC');

    expect(combatTexts(game)[0].textColor).toEqual(DAMAGE_TEXT_COLOR.MAGIC);
  });
});
