#!/usr/bin/env node
/**
 * Every shape this codebase has been *measured* paying for, looked for
 * everywhere at once.
 *
 *   node scripts/perf-scan.mjs                 # core's game tree + linked packs
 *   node scripts/perf-scan.mjs ../lol/spells   # anything you point it at
 *   node scripts/perf-scan.mjs --max 0         # exit 1 on any finding (a gate)
 *
 * ## What this is, and what it is not
 *
 * It is **not** a seam (`src/seams/`). A seam bans a shape outright and fails
 * the build, because the shape is always wrong. Nothing here is always wrong:
 * a two-hundred-primitive body is a *decision*, and the right answer is
 * sometimes "yes, that ability is worth it". So this reports and ranks, exits
 * 0 by default, and takes `--max` when a caller wants it to hold a line.
 *
 * ## Every rule below cost a real measurement to learn
 *
 * The numbers in each rule's `why` came off `tests/e2e/measure-frame-cost.mjs`
 * and the deterministic harnesses beside it, on a ten-champion teamfight. They
 * are quoted so nobody has to re-derive them to decide whether a finding is
 * worth acting on — and so a rule that stops being true can be deleted rather
 * than obeyed forever.
 *
 * The scan is deliberately textual, the same choice every seam in this repo
 * makes: the mistakes are *shapes*, a real parse buys accuracy this does not
 * need, and a pack is a separate repository that must be scannable without
 * building core first.
 */
import { readFileSync, readdirSync, statSync, existsSync, realpathSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = resolve(HERE, '..');

/** Comments go first, or every rule matches its own documentation. */
const stripComments = source =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'generated') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.ts$/.test(name) && !/\.d\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(full);
  }
  return out;
};

/** The body of `{ ... }` starting at the first brace at or after `from`. */
const braceBody = (text, from) => {
  const open = text.indexOf('{', from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return { start: open + 1, end: i, body: text.slice(open + 1, i) };
  }
  return null;
};

/** Methods a frame or a tick calls, which is the only place any of this matters. */
const HOT_METHODS = /(^|\n)\s*(?:public\s+|private\s+|protected\s+|override\s+)*(draw|drawAvatar|drawBody|drawBuffs|drawHealthBar|drawFn|update|onUpdate|onDashUpdate)\s*\(/g;

const methodsOf = text => {
  const found = [];
  for (const match of text.matchAll(HOT_METHODS)) {
    const at = match.index + match[0].length;
    const block = braceBody(text, at - 1);
    if (block) found.push({ name: match[2], body: block.body, at: match.index });
  }
  return found;
};

/** The index just past the `)` that closes the `(` at or after `from`. */
const afterParens = (text, from) => {
  const open = text.indexOf('(', from);
  if (open === -1) return -1;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i + 1;
  }
  return -1;
};

/**
 * Loop bodies inside one method, with the trip count when it is knowable.
 *
 * Braces are optional in the language and a one-line loop is exactly where a
 * `circle()` hides — `for (const p of this.particles) circle(p.x, p.y, 4)` is
 * the whole of the mistake the first rule looks for, and a scanner that only
 * matched `{` walked straight past it. So: a braced body when there is one,
 * else the single statement up to the next top-level `;`.
 */
const loopsOf = (body, consts) => {
  const loops = [];
  const head = /\b(for|while)\s*\(|\.forEach\s*\(/g;
  for (const match of body.matchAll(head)) {
    const close = afterParens(body, match.index);
    if (close === -1) continue;
    const rest = body.slice(close);
    const lead = rest.match(/^\s*/)[0].length;
    let block;
    if (rest[lead] === '{') {
      block = braceBody(body, close);
    } else {
      // Braceless: one statement. Depth-aware, so a `;` inside a nested call
      // or a string does not end it early.
      let depth = 0;
      let end = -1;
      for (let i = close + lead; i < body.length; i++) {
        const ch = body[i];
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth--;
        else if (ch === ';' && depth === 0) {
          end = i;
          break;
        }
      }
      if (end === -1) continue;
      block = { start: close + lead, end, body: body.slice(close + lead, end) };
    }
    if (!block) continue;
    const decl = body.slice(match.index, close);
    // `i < 22`, `i < AURA_TONGUES`, `k < 4` — a literal or a module const.
    const bound = /[<>]=?\s*([A-Za-z_$][\w$]*|\d+)/.exec(decl);
    let trips = null;
    if (bound) {
      const raw = bound[1];
      trips = /^\d+$/.test(raw) ? Number(raw) : (consts.get(raw) ?? null);
    }
    loops.push({ ...block, trips, decl });
  }
  return loops;
};

/** Loops in `body` that no other loop in `body` contains. */
const outermostLoops = (body, consts) => {
  const all = loopsOf(body, consts);
  return all.filter(
    loop => !all.some(other => other !== loop && other.start < loop.start && other.end > loop.end)
  );
};

/** Module-level `const NAME = 14`, so a loop bound written as a name still counts. */
const constsOf = text => {
  const map = new Map();
  for (const m of text.matchAll(/(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*(\d+)\s*[;,\n]/g)) {
    map.set(m[1], Number(m[2]));
  }
  return map;
};

/** p5 calls that put pixels on the canvas, as opposed to setting state. */
const PAINTS = /\b(circle|ellipse|rect|arc|line|triangle|quad|point|image|text|vertex|curveVertex|bezierVertex|square)\s*\(/g;
/** p5 calls that only change state — cheap alone, not in a loop of two hundred. */
const STATE = /\b(fill|stroke|noFill|noStroke|strokeWeight|textSize|textAlign|textStyle|tint|push|pop|translate|rotate|scale)\s*\(/g;

const countCalls = (text, pattern) => (text.match(pattern) ?? []).length;

/**
 * Primitives one call of this method puts on the canvas, loops multiplied out.
 * Unknown trip counts count once — an underestimate on purpose, so a finding
 * is never an artefact of a guess.
 */
const primitiveCost = (body, consts) => {
  let direct = countCalls(body, PAINTS) + countCalls(body, STATE);
  let looped = 0;
  for (const loop of outermostLoops(body, consts)) {
    // Everything inside this loop was counted in `direct` once; take it back
    // and charge the loop's own cost instead, recursively — a loop inside a
    // loop *multiplies*, and adding the two was the bug that made a 112-call
    // ring read as 34.
    direct -= countCalls(loop.body, PAINTS) + countCalls(loop.body, STATE);
    looped += (loop.trips ?? 1) * primitiveCost(loop.body, consts);
  }
  return direct + looped;
};

export const RULES = [
  {
    id: 'hand-rolled-particles',
    why:
      "a per-instance array painted from inside draw() is a particle system that " +
      "ObjectManager's draw budget cannot ration. DamageOverTime was one: 30 of " +
      "them on a wave took the frame from 4.66ms to 14.29ms, and the ration that " +
      'exists for exactly that was blind to it. Use ParticleSystem (see Speedup).',
    find: ({ text, methods, consts }) => {
      // Already one, or already using one — nothing to say.
      if (/extends\s+ParticleSystem|new\s+(?:api\.helpers\.)?ParticleSystem|PredefinedParticleSystems/.test(text)) return [];
      // Painting a loop over an array is ordinary and usually right — a row of
      // marks, a chain of segments, a list of positions. What makes it a
      // *particle system* is that the array is **spawned into and aged out
      // of**: entries carrying their own clock, born on an interval and reaped
      // when it runs out. Both halves are required, because either alone is a
      // shape half the spells in a pack use correctly.
      const spawnsWithClock = /\.push\(\s*\{[^}]*\b(age|life|lifeTime|ttl|maxAge)\b/s.test(text);
      const agesThem = /\b(age|life|ttl)\w*\s*(\+=|--|\+\+)/.test(text);
      if (!spawnsWithClock || !agesThem) return [];
      const out = [];
      for (const method of methods) {
        if (!/^draw/.test(method.name)) continue;
        for (const loop of loopsOf(method.body, consts)) {
          const overField = /\bof\s+this\.\w+|this\.\w+\.length|this\.\w+\[/.test(loop.decl);
          if (overField && countCalls(loop.body, PAINTS) > 0) {
            out.push(`${method.name}() paints a spawned-and-aged array of its own`);
            break;
          }
        }
      }
      return out;
    },
  },
  {
    id: 'heavy-draw',
    threshold: 60,
    why:
      'p5 costs 6-10x the raw canvas call underneath it, so primitive count is ' +
      'the cost. One pet at ~200 primitives a frame measured 388us a call and ' +
      '2.1% of CPU on its own. Cut the count, or bake the static half the way ' +
      'Fountain.bakeArt does.',
    find: ({ methods, consts }) => {
      const out = [];
      for (const method of methods) {
        if (!/^draw/.test(method.name)) continue;
        const cost = primitiveCost(method.body, consts);
        if (cost >= 60) out.push({ note: `${method.name}() is ~${cost} p5 calls per frame`, weight: cost });
      }
      return out;
    },
  },
  {
    id: 'blend-mode-per-instance',
    why:
      'blendMode() sets globalCompositeOperation, which additive-blends every ' +
      'primitive after it and cannot batch. Two switches per instance per frame ' +
      'is two per *body* once an AoE puts the effect on a whole wave.',
    find: ({ text, methods, consts }) => {
      // Additive blending is a legitimate technique and most casts use it once,
      // on one object, for a moment — flagging those is noise. It becomes a
      // cost when the switch is paid **per body**: an effect that rides a unit
      // (a buff, an aura, a mark) is drawn once per wearer, so an AoE that puts
      // it on a wave pays for it forty times a frame. Inside a loop is the same
      // mistake one level down.
      const perTarget = /extends\s+(?:api\.buffs\.)?\w*Buff\b|\bthis\.targetUnit\b/.test(text);
      const out = [];
      for (const method of methods) {
        if (!/^draw/.test(method.name) || !/\bblendMode\s*\(/.test(method.body)) continue;
        const inLoop = loopsOf(method.body, consts).some(l => /\bblendMode\s*\(/.test(l.body));
        if (!perTarget && !inLoop) continue;
        const n = countCalls(method.body, /\bblendMode\s*\(/g);
        out.push(
          `${method.name}() switches blendMode ${n}x ${inLoop ? 'inside a loop' : 'per wearer'}`
        );
      }
      return out;
    },
  },
  {
    id: 'alloc-in-draw-loop',
    why:
      'an allocation inside a per-frame loop is garbage at 60fps, and GC pauses ' +
      'are what a fight feels as a stutter rather than as a lower average.',
    find: ({ methods, consts }) => {
      const out = [];
      for (const method of methods) {
        for (const loop of loopsOf(method.body, consts)) {
          const allocs = [];
          if (/\bnew\s+[A-Z]/.test(loop.body)) allocs.push('new');
          if (/`[^`]*\$\{/.test(loop.body)) allocs.push('template string');
          if (/=\s*\[[^\]]/.test(loop.body)) allocs.push('array literal');
          if (allocs.length) out.push(`${method.name}() allocates in a loop (${allocs.join(', ')})`);
        }
      }
      return [...new Set(out)];
    },
  },
  {
    id: 'query-in-draw',
    why:
      'queryObjects is the single biggest simulation cost in a teamfight (~7% of ' +
      'CPU, ~37 calls a tick). Issuing one from draw() runs it at frame rate on ' +
      'top of that, and a draw has no business asking the world a question.',
    find: ({ methods }) =>
      methods
        .filter(m => /^draw/.test(m.name) && /queryObjects\s*\(/.test(m.body))
        .map(m => `${m.name}() calls queryObjects`),
  },
  {
    id: 'text-in-draw-loop',
    why:
      'text() is the most expensive p5 primitive there is - 2.275us against 0.30 ' +
      'for the raw fillText, the worst ratio of any call measured. In a loop it ' +
      'is the first thing to move off p5 or out of the frame.',
    find: ({ methods, consts }) => {
      const out = [];
      for (const method of methods) {
        if (!/^draw/.test(method.name)) continue;
        for (const loop of loopsOf(method.body, consts)) {
          if (/\btext\s*\(/.test(loop.body)) out.push(`${method.name}() draws text in a loop`);
        }
      }
      return [...new Set(out)];
    },
  },
];

/**
 * Every finding in one source file, without touching the disk.
 *
 * The unit a test drives. `scanTree` below is this plus a walk, and the CLI is
 * that plus a report — kept apart so the rules can be proven against a fixture
 * whose whole point is to be the mistake, which is the only way a scanner
 * stays honest about what it catches.
 */
export function scanSource(source) {
  const text = stripComments(source);
  const consts = constsOf(text);
  const methods = methodsOf(text);
  if (methods.length === 0) return [];
  const context = { text, methods, consts };
  const out = [];
  for (const rule of RULES) {
    for (const found of rule.find(context)) {
      const { note, weight = 0 } = typeof found === 'string' ? { note: found } : found;
      out.push({ rule: rule.id, note, weight });
    }
  }
  return out;
}

/** Every finding under `root`, each tagged with the file it came from. */
export function scanTree(root, labelFrom = resolve(CORE, '..')) {
  const out = [];
  if (!existsSync(root)) return out;
  for (const file of walk(root)) {
    for (const finding of scanSource(readFileSync(file, 'utf8'))) {
      out.push({ ...finding, file: relative(labelFrom, file) });
    }
  }
  return out;
}

const invokedDirectly =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (!invokedDirectly) {
  // Imported for its rules; the report below is the CLI's job.
} else {

const targets = process.argv.slice(2).filter(a => !a.startsWith('--'));
const maxArg = process.argv.indexOf('--max');
const max = maxArg === -1 ? null : Number(process.argv[maxArg + 1]);

const roots = targets.length
  ? targets.map(t => resolve(t))
  : [
      join(CORE, 'src/game/gameObject'),
      ...['lol', 'naruto', 'dota']
        .map(pack => resolve(CORE, '..', pack, 'spells'))
        .filter(existsSync),
    ];

const findings = roots.flatMap(root => scanTree(root));

const byRule = new Map();
for (const f of findings) byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), f]);

console.log(`\nperf-scan: ${findings.length} finding(s) across ${roots.length} tree(s)\n`);
for (const rule of RULES) {
  const n = (byRule.get(rule.id) ?? []).length;
  console.log(`   ${String(n).padStart(4)}  ${rule.id}`);
}
console.log('');
for (const rule of RULES) {
  const rows = byRule.get(rule.id) ?? [];
  if (rows.length === 0) continue;
  console.log(`── ${rule.id} (${rows.length})`);
  console.log(`   ${rule.why.replace(/(.{78}\s)/g, '$1\n   ')}\n`);
  // Worst first where a rule can say what worst means, then alphabetical, so
  // the top of a section is the place to start and two runs read the same.
  rows.sort((a, b) => b.weight - a.weight || a.file.localeCompare(b.file));
  for (const row of rows) console.log(`   ${row.file}\n     ${row.note}`);
  console.log('');
}
if (findings.length === 0) console.log('  nothing to report.\n');

if (max !== null && findings.length > max) {
  console.error(`perf-scan: ${findings.length} findings, over the --max of ${max}`);
  process.exit(1);
}

}
