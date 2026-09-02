import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `@moba2d/core/testing/vfx` — the VFX rules a scan can hold, for any pack.
 *
 * ## Why core states these and not each pack
 *
 * Every one of them is a fact about **this engine**, not about anyone's
 * champions: what `MissileSpellObject` carries, which globals p5 supplies,
 * which globals the test harness supplies. A pack cannot get any of them
 * right by reading its own source.
 *
 * They are here for the reason `testing/boundary` gives for itself: what was
 * in a pack was a caller in *one* pack, so every other pack's `npm test` said
 * nothing about the rule at all.
 *
 * ## Why a scan at all, when `docs/VFX_STANDARD.md` already says this
 *
 * Because saying it did not work. Every visual failure the content packs have
 * shipped was a rule its author had read that week — the standard was open in
 * another tab. `CLAUDE.md` states the pattern plainly: *a rule enforced by a
 * test has never been broken; a rule that was only prose has been broken at
 * least once.* These four move.
 *
 * ## What is deliberately not here
 *
 * **"Does this effect hand off to an aftermath?"** looks scannable and is
 * not. The hand-off is routinely one method away — `onHit` calls
 * `this.burst()`, and `burst()` spawns the vortex — so a scan that reads
 * inside `onHit` flags three of five *correct* files. A check with a 60%
 * false-positive rate is not a check, it is a debt list people learn to
 * ignore. The rule below is the weaker, honest version: a missile that hits,
 * does not survive its hit, and constructs nothing *anywhere in the file*.
 *
 * **"Is this shape this champion's own?"** and **"does it read as a wave or
 * as a mace?"** are eyes-only. `moba2d-shoot-vfx` is the answer to those.
 */

/** p5 constants that exist in a live sketch and **not** in the test harness. */
export const UNSTUBBED_P5_GLOBALS = ['HALF_PI', 'QUARTER_PI', 'PI'] as const;

export interface VfxIssue {
  file: string;
  rule: string;
  detail: string;
}

/** Comments discuss these rules by name; a scan must not flag its own docs. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const isMissile = (source: string): boolean =>
  /extends (api\.)?(Missile|HomingMissile)SpellObject/.test(source);

/**
 * The body of every `name(` method in a file, brace-matched.
 *
 * A regex cannot answer "is this call inside `draw`" — the method runs to a
 * closing brace that may be forty lines and six nested blocks away. Counting
 * braces over comment-stripped source is exact for the shape packs actually
 * write, and the alternative is a real parser for one rule.
 */
const bodiesOf = (source: string, name: string): string[] => {
  const bodies: string[] = [];
  const opener = new RegExp(`(?<![.\\w])${name}\\s*\\(`, 'g');
  for (const match of source.matchAll(opener)) {
    const open = source.indexOf('{', match.index + match[0].length);
    if (open < 0) continue;
    let depth = 0;
    let end = open;
    for (; end < source.length; end++) {
      if (source[end] === '{') depth++;
      else if (source[end] === '}' && --depth === 0) break;
    }
    bodies.push(source.slice(open, end));
  }
  return bodies;
};

/**
 * Every VFX rule broken under `spellsDir`, as a flat list.
 *
 * Exported separately from `describeVfxRules` so a pack can assert on the
 * issues themselves — the same split `mapIssues`/`describeMapRules` uses.
 */
export function vfxIssues(spellsDir: string): VfxIssue[] {
  const issues: VfxIssue[] = [];
  const files = readdirSync(spellsDir).filter(
    name => name.endsWith('.ts') && name !== 'index.ts'
  );

  for (const file of files) {
    const source = stripComments(readFileSync(join(spellsDir, file), 'utf8'));

    // `MissileSpellObject` carries `position` and `destination` and derives
    // its angle from the two. `this.direction` is `undefined`, falls through
    // whatever `??` sits beside it, and draws every projectile at one fixed
    // angle however it was aimed. It typechecks, it never throws, and the
    // fallback makes the result look deliberate — an ultimate shipped
    // pointing due east and nobody could tell from the file.
    if (/\bthis\.direction\b/.test(source)) {
      issues.push({
        file,
        rule: 'missile-heading',
        detail: 'reads `this.direction`; derive it from `destination - position`',
      });
    }

    // The dissipation rule, in the one form a scan can state honestly. A
    // missile may be removed on landing — but then *something* has to carry
    // the moment on. Hitting, dying, and constructing nothing is the
    // "đột nhiên biến mất" failure with no room for anything else to be true.
    if (isMissile(source) && /\bonHit\s*\(/.test(source)) {
      const survivesItsHit = /removeOnMaxHit\s*=\s*false/.test(source);
      const handsOff = /objectManager\.addObject\(/.test(source);
      if (!survivesItsHit && !handsOff) {
        issues.push({
          file,
          rule: 'vanishes-on-hit',
          detail: 'set `removeOnMaxHit = false` and fade, or spawn what owns the aftermath',
        });
      }
    }

    // A spell reaching for a global the harness lacks is a spell that cannot
    // be driven by a test: it dies with "HALF_PI is not defined", only in the
    // tests, never in the game. `Math.PI` is not in doubt.
    for (const global of UNSTUBBED_P5_GLOBALS) {
      if (new RegExp(`(?<![.\\w])${global}\\b`).test(source)) {
        issues.push({
          file,
          rule: 'unstubbed-p5-global',
          detail: `uses \`${global}\`; write \`Math.PI\` — p5 globals only exist in a live sketch`,
        });
      }
    }

    // **A render pass may not move the world.** `ObjectManager` brackets
    // `update`, `onAdded` and `onRemoved` in the object's own attribution and
    // deliberately brackets `draw` in nothing — so damage dealt from there is
    // not ability damage to `abilityPowerScales()`, and the caster's whole
    // `Stats.abilityPower` silently vanishes from the number. The tooltip goes
    // on promising it, because the tooltip reads the stat and the hit does not.
    //
    // That is only the half a scan can see. `draw` also runs once per rendered
    // frame rather than once per simulation step: it is skipped for anything
    // off-screen or culled by `RenderQuality`, and a hit that lands only when
    // somebody is looking at it is not a hit. The two arguments point the same
    // way, which is why this is a rule and not a lint.
    for (const body of bodiesOf(source, 'draw')) {
      const call = /\.(takeDamage|takeHeal)\s*\(/.exec(body);
      if (call) {
        issues.push({
          file,
          rule: 'damage-in-draw',
          detail: `calls \`${call[1]}\` from \`draw\`; move it to \`update\`, which core attributes`,
        });
      }
    }

    // On a phone the cursor is wherever the finger is *pressing*, which while
    // a spell is charging is that spell's own button. `Spell.aimPoint` is the
    // only thing that knows a thumb drag from a press; an effect must be
    // *told* the aim rather than going to look for it.
    if (source.includes('worldMouse')) {
      issues.push({
        file,
        rule: 'raw-cursor',
        detail: 'reads `worldMouse`; use `Spell.aimPoint` and push the answer into the effect',
      });
    }
  }

  return issues;
}

export interface VfxRulesFixture {
  /** Absolute path to the pack's `spells/` directory. */
  spellsDir: string;
  /** Label for the suite, so two packs' output is tellable apart. */
  label?: string;
  /**
   * `file:rule` pairs this pack has not fixed yet.
   *
   * Every entry is a thing a player will eventually report. Kept as an
   * explicit list rather than a severity knob so that adding to it is a
   * visible decision in a diff.
   */
  knownDebt?: string[];
}

export function describeVfxRules(fixture: VfxRulesFixture): void {
  const { spellsDir, label = 'VFX rules', knownDebt = [] } = fixture;

  describe(label, () => {
    const issues = vfxIssues(spellsDir);
    const key = (issue: VfxIssue): string => `${issue.file}:${issue.rule}`;

    it('has spell files to scan', () => {
      const files = readdirSync(spellsDir).filter(
        name => name.endsWith('.ts') && name !== 'index.ts'
      );
      expect(files.length, `nothing to scan in ${spellsDir}`).toBeGreaterThan(0);
    });

    it('breaks no VFX rule a scan can hold', () => {
      const unexpected = issues
        .filter(issue => !knownDebt.includes(key(issue)))
        .map(issue => `${key(issue)} — ${issue.detail}`);
      expect(unexpected).toEqual([]);
    });

    it('lists no debt it has already paid off', () => {
      // A stale debt entry is worse than none: it says a rule is broken
      // where it is not, so the next author leaves the real one alone too.
      const live = new Set(issues.map(key));
      const settled = knownDebt.filter(entry => !live.has(entry));
      expect(settled, 'fixed — delete these from knownDebt').toEqual([]);
    });
  });
}
