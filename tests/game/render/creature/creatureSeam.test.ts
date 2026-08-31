import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The rule that makes one implementation serve three callers.
 *
 * `legRig.ts` and `legIk.ts` run in the game (p5), in the map editor's
 * inspector preview (Canvas2D, a different document with no p5 on the page at
 * all) and in this suite (node, no canvas anywhere). A p5 global reached from
 * either file is a `ReferenceError` in two of those three, and a reach into a
 * unit or a `Game` is a module the editor cannot even load.
 *
 * A source scan rather than a behavioural test because the failure is an
 * `import` line, and the two places it breaks are the two places no vitest run
 * ever executes.
 */
const PURE = [
  'src/game/render/creature/legRig.ts',
  'src/game/render/creature/legIk.ts',
  'src/game/render/creature/spine.ts',
  'src/game/render/creature/creature.ts',
];

/**
 * p5 globals that would type-check fine and throw in the editor.
 *
 * The lookbehind is load-bearing: `this.legs.push(...)` is an array, not p5's
 * matrix stack, and a scan without it fails on the constructor.
 */
const P5_GLOBALS =
  /(?<![.\w])(push|pop|fill|stroke|line|circle|ellipse|vertex|beginShape|image|noStroke|noFill|strokeWeight|strokeCap|drawingContext|deltaTime|createVector)\s*\(/;

describe('the creature rig stays drawable from anywhere', () => {
  it.each(PURE)('%s draws nothing and reaches no p5 global', file => {
    const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

    expect(source).not.toMatch(P5_GLOBALS);
  });

  it.each(PURE)('%s imports no unit, no game and no p5', file => {
    const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map(match => match[1]);

    for (const specifier of imports) {
      expect(specifier).not.toMatch(/p5|gameObject|managers\/|hud\//);
    }
  });
});
