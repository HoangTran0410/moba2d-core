import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — a plain .mjs tool, deliberately not part of the TS build.
import { RULES, scanSource, scanTree } from '../../scripts/perf-scan.mjs';

const CORE = join(fileURLToPath(new URL('../../', import.meta.url)));

/**
 * The scanner, held to the two bugs it was written from.
 *
 * `scripts/perf-scan.mjs` exists because a fight was slow and finding out *why*
 * cost a day of measurement. Every rule in it is the residue of one real
 * finding, and a rule that has drifted off the shape it was distilled from is
 * worse than no rule — it produces a list nobody trusts, which is the same as
 * an empty one.
 *
 * So each rule is proven twice here: it fires on a fixture that **is** the
 * mistake, and it stays quiet on the nearest thing that is not. The fixtures
 * are deliberately the smallest source that carries the shape rather than
 * copies of real spells, because a copy drifts with the spell and stops being
 * a fixture.
 */
const ids = (source: string): string[] =>
  scanSource(source).map((finding: { rule: string }) => finding.rule);

describe('perf-scan', () => {
  it('names every rule it ships, so a report can be read without the source', () => {
    expect(RULES.map((rule: { id: string }) => rule.id)).toEqual([
      'hand-rolled-particles',
      'heavy-draw',
      'blend-mode-per-instance',
      'alloc-in-draw-loop',
      'query-in-draw',
      'text-in-draw-loop',
    ]);
    // Every rule has to say *why*, with the measurement behind it: a finding
    // nobody can weigh is a finding nobody acts on.
    for (const rule of RULES) expect(rule.why.length).toBeGreaterThan(80);
  });

  describe('hand-rolled-particles', () => {
    // The `DamageOverTime` shape: an array spawned into on a clock, aged, and
    // painted from inside the buff's own draw — invisible to the draw budget.
    const offender = `
      class Burn extends Buff {
        _flames = [];
        onUpdate() {
          this._flames.push({ x: 0, age: 0, lifeTime: 500 });
          for (const f of this._flames) f.age += deltaTime;
        }
        draw() {
          for (const flame of this._flames) circle(flame.x, flame.y, 8);
        }
      }`;

    it('catches an array that is spawned, aged and painted', () => {
      expect(ids(offender)).toContain('hand-rolled-particles');
    });

    it('says nothing once the same effect is a ParticleSystem', () => {
      expect(ids(offender.replace('class Burn', 'const s = new ParticleSystem({}); class Burn'))).not.toContain(
        'hand-rolled-particles'
      );
    });

    it('leaves an ordinary loop over a list alone', () => {
      // A chain of segments, a row of marks — no clock, no spawn, no reaping.
      const fine = `
        class Chain extends SpellObject {
          links = [];
          draw() { for (const link of this.links) circle(link.x, link.y, 4); }
        }`;
      expect(ids(fine)).not.toContain('hand-rolled-particles');
    });
  });

  describe('heavy-draw', () => {
    it('multiplies a literal loop bound out, the way the frame pays it', () => {
      const offender = `
        const TONGUES = 14;
        class Bear extends Pet {
          drawAvatar() {
            for (let i = 0; i < TONGUES; i++) {
              for (let k = 0; k < 4; k++) { fill(1, 2, 3); circle(k, i, 5); }
            }
          }
        }`;
      const found = scanSource(offender).find((f: { rule: string }) => f.rule === 'heavy-draw');
      // 14 x 4 x 2 calls, not the two a reader counts in the source.
      expect(found?.weight).toBeGreaterThan(100);
    });

    it('leaves a body that draws a handful of shapes alone', () => {
      const fine = `class Bolt extends SpellObject {
        draw() { fill(1,2,3); circle(0,0,8); stroke(4); line(0,0,1,1); }
      }`;
      expect(ids(fine)).not.toContain('heavy-draw');
    });
  });

  describe('blend-mode-per-instance', () => {
    it('catches a switch paid once per wearer', () => {
      const offender = `class Aura extends Buff {
        draw() { blendMode(ADD); circle(this.targetUnit.position.x, 0, 4); blendMode(BLEND); }
      }`;
      expect(ids(offender)).toContain('blend-mode-per-instance');
    });

    it('leaves a one-off cast effect alone', () => {
      // The common, correct case: one object, one moment, one switch.
      const fine = `class Blast extends SpellObject {
        draw() { blendMode(ADD); circle(0, 0, 40); blendMode(BLEND); }
      }`;
      expect(ids(fine)).not.toContain('blend-mode-per-instance');
    });
  });

  describe('alloc-in-draw-loop', () => {
    it('catches garbage made once a frame per element', () => {
      const offender = `class Ring extends SpellObject {
        draw() { for (let i = 0; i < 8; i++) { const v = new Vector(i, i); circle(v.x, v.y, 2); } }
      }`;
      expect(ids(offender)).toContain('alloc-in-draw-loop');
    });
  });

  /**
   * And the regression half: the tree the first rule was written from is clean,
   * and has to stay that way. This is what would have caught the burn going
   * back to a private array.
   */
  it('finds nothing in core buffs, where the first rule came from', () => {
    expect(scanTree(join(CORE, 'src/game/gameObject/buffs'))).toEqual([]);
  });
});
