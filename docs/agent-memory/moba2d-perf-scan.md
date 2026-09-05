---
name: moba2d-perf-scan
description: "scripts/perf-scan.mjs (2026-09-05) — ranked CPU-pattern scan over core + all packs; six rules, each distilled from a measured finding"
metadata: 
  node_type: memory
  type: project
  originSessionId: 39240f27-05a9-4656-82f9-d50bb98cf249
  modified: 2026-09-05T09:10:26.986Z
---

`npm run perf:scan` (core, `scripts/perf-scan.mjs`) walks core's game tree and
every linked pack's `spells/` at once and reports ranked findings. Committed
2026-09-05 on branch `fight-perf-and-hud-stability`.

**It is not a seam, on purpose.** A seam (`src/seams/`) bans a shape and fails
the build because the shape is always wrong; none of these is — a
200-primitive body is a decision. So it reports, ranks worst-first, exits 0, and
takes `--max N` to hold a line. Standalone `.mjs` with its own walker rather
than reusing `src/seams/shared.ts`, because the seam CLI loads TS through Vite
and cannot be pointed at a sibling pack repo.

Six rules, each the residue of a real finding: `hand-rolled-particles`,
`heavy-draw`, `blend-mode-per-instance`, `alloc-in-draw-loop`, `query-in-draw`,
`text-in-draw-loop`. Exports `RULES`, `scanSource(text)`, `scanTree(root)` behind
a `realpathSync` direct-invoke guard, so `tests/scripts/perfScan.test.ts` can
drive it on fixtures.

**Baseline at the time: 92 findings** — 28 hand-rolled-particles, 33 heavy-draw,
14 blend-mode, 17 alloc, 0 query-in-draw, 0 text-in-draw-loop. Worst bodies:
`Blitzcrank_W` ~231, `Cassiopeia_R` ~187, `Annie_R.drawAvatar` ~175 (the pet
measured at 388us/call, 2.1% of CPU by itself), `JarvanIV_W` ~172, `Temari_R`
~141. None of these is acted on yet; they are art decisions for the user.

**Tuning it is the hard part, and two rules had to be narrowed:**
`hand-rolled-particles` first matched *any* draw looping over an instance array
— 168 hits, because that is a normal correct pattern. The real signature is
**spawned-into on a clock AND aged out**; both halves required. `blend-mode` first
flagged every use (69); additive blending is legitimate for a one-off cast, and
only costs when paid *per wearer* (a Buff / `this.targetUnit`) or inside a loop.

**Writing the fixtures found two bugs in the scanner itself** — keep this in
mind for any similar tool: braceless loops were invisible (and
`for (const p of this.particles) circle(...)` unbraced *is* rule one's whole
shape), and nested loops were added rather than multiplied, reading a 112-call
ring as 34.

## The dynamic half, and the push hook

`npm run perf:spell -- <Champion_Slot | path>` (`tests/e2e/measure-spell-cost.mjs`)
casts the real ability in a real match until the board is full of it and
measures the frame. Reports **us per live instance per frame** — the only figure
comparable between abilities, because the pattern is always "one is fine and
forty are not". Takes a file path too, since pack spells are `<Champion>_<Slot>.ts`
everywhere. Mechanics worth knowing: `game.director.applyLoadout(player, {mode:
'champion', championName, ...})` swaps the player onto any champion,
`game.director.addBot(...)` stands up dummies, and a cast is
`game.worldMouse = createVector(...); spell.currentCooldown = 0; spell.cast()`.
Six dummies in a ring, because an effect that needs a body to attach to draws
nothing unattached and measures *free*. Default budget 150us at 4x throttle.

Measured while writing it: **Cassiopeia_W 176us/instance with 48 live — over
budget** (same object the profiler flagged at 473us/call); Malphite_E 16,
Temari_R 31, Garen_E 60, Blitzcrank_W 51, Sniper_E ~0, Annie_R 107 with only 6
live.

**The two passes disagree usefully — keep both.** Annie_R is the 3rd-heaviest
body statically (~175 primitives) and measures fine, because there is only ever
one Tibbers. Something ordinary-looking measures over budget because a wave-clear
puts fifty up.

`scripts/perf-guard.mjs` runs both over the spell files a push adds, called
from each repo's **versioned** `scripts/git-hooks/pre-push` (not pre-commit — a
minute of browser per commit is how a guard gets uninstalled). It is wired into
the versioned hook because all four repos set `core.hooksPath`, so an installer
writing `.git/hooks/pre-push` produced a hook git never read and a guard that
reported itself installed without ever running. Bypass with
`MOBA2D_PERF_GUARD_SKIP=1`. Bins `moba2d-perf-scan` / `moba2d-perf-guard` ship
in `files` so a pack reaches them through node_modules; the dynamic half lives
in `tests/`, is not shipped, and the guard degrades to static rather than
failing. In core's hook the call must sit **before** the linked-pack branch, or
it never runs in a development checkout.

## Rewritten on the TypeScript compiler API (2026-09-05)

The regex engine was replaced wholesale. **`typescript` is already a dependency
of core and of every pack** (they all run `tsc`), so the compiler API costs zero
new deps. It resolves what no regex can — `victim.stopMovement()` to
`AttackableUnit.ts`, `PredefinedFilters.x` across the package boundary into
core, `super.`, aliases — and resolves loop bounds through the checker at any
scope. Braceless loops, `;` in strings, `.forEach(cb)`-as-loop all come free.
A program over a pack builds in **~0.9s**; the whole four-tree scan is 3.4s.
The 13 tests passed unchanged, which is what made the rewrite safe.

Findings 124 → 160 (heavy-draw 69→78, alloc 17→50, hand-rolled-particles
26→**20** — seeing more *and* guessing less). New worst body in the game:
core's own `AoePulse` at ~623 calls/frame, invisible to every earlier version.

**CodeGraph was evaluated and rejected for this** — packs are indexed, core is
not, `.codegraph/` is gitignored (so a fresh clone/CI has nothing), and `sync`
found 255 stale files, i.e. staleness is real. Its advantage is an instant
prebuilt index, which is worth nothing at the 1s scale. Good for agent Q&A,
wrong for a build step.

## The same lesson applied to `src/seams/`

**Five converted (2026-09-05), each only after proving the weakness** — do the
same before touching any of the rest:
- `dashOnUpdate` **1 of 4**: missed `dash['onUpdate'] =`,
  `Object.assign(dash, {onUpdate})`, and a line break before the property.
- `buffDeactivate` **2 of 6**: missed a line break, `b['deactivate']()`, a
  parenthesized cast, and a receiver that is itself a call.
- `castSpecFrozen`: missed `this['field']`, optional chaining, a line break,
  destructuring — none puts the substring `this.field` in the file. **Plus two
  outright bugs from hand-rolling a parser**: it found getter bodies with
  `.exec` (first match only, so a *second* `castSpec` in a file was invisible)
  and its brace counter did not know a `}` can sit in a string. Latent, not
  live — no pack file has two `castSpec` getters today.
- `statResourceModifier` **1 of 6**: missed a quoted key, a computed key, a
  value behind parens/`as`, and a name split from its colon by a newline.
- `cooldowns`: saw 251 of 386, blind to 135 named constants.

**Fixtures in `exported-seams.test.ts` were testing uncompilable source** — bare
`get castSpec() {…}` outside a class, `stats: {…}` at top level (which parses as
labeled statements). A text scanner matched them happily. Repaired when
converting; expect this whenever a text scan becomes a parse.

`src/seams/ast.ts` is the shared half: `parse`, `walkAst`, `propertyWrites`,
`propertyValues`, `numericValueOf`, `constantsOf`. **No checker, no tsconfig** —
a syntactic ban needs neither and runs in ~1ms; only a seam that must resolve a
name across files wants `ts.createProgram`.

Do **not** convert the seams that are about *text* — a champion's name in a core
comment, prose in a description. An AST discards comments, so a parser is
strictly worse there.

**Resolved:** the user set the pace rule — every cooldown under 20s, because it
is a practice room (see [[moba2d-sandbox-not-win-condition]]). Core's ceiling is
now 20_000 and 24 spells were rescaled (lol 7 item actives 40-90s → 10-18s;
dota 17 at 20-60s → 11-19s; naruto's 11-12s already fine). All three packs read
zero — **but the sweep missed the bundled `packs/reference/` pack**: Vera_R sat
at 60s all day and only CI's `verify:all` (which runs the reference pack's own
check-seams; local `verify` does not) caught it, breaking main's CI. Fixed to
18s in `04fe859`. Any future pace change must sweep FOUR trees, reference
included. `seam-debt.mjs` inside a scanned tree is still the per-pack override if
one ever wants a different pace.

**The follow-up, made 2026-09-05:** capping cooldowns without touching
*durations* inflates uptime mechanically. Four dota abilities were restored to
the duty cycle they were drawn with — see [[moba2d-duty-scan]], which is the
instrument that found half of them. lol's item actives turned out never to have
had the problem (Ghostblade tops out at 42%).

**Why:** the rules only mean something with the measurements behind them, and
those cost a day; see [[moba2d-teamfight-profile]] for where each number came
from.

**How to apply:** `tests/content/publicSurface.test.ts` pins the **bin count**
(now fourteen) and `lol/tests/noCoreReach.test.ts` pins the pack test-file count
— both are tripwires that must be bumped with a note. Validate any new rule
against a known offender before trusting it — `git show <pre-fix-commit>:path` into a temp dir and scan that. A rule that
does not catch the bug it was written from is worse than no rule.

## The budget was recalibrated against a population (2026-09-05)

The 150us/instance and 3ms/frame numbers were guessed. Checking them changed
the gate's *shape*, not its height, and then changed what it gates on at all.

**The population.** Thirty-three abilities sampled by walking each pack's spell
list at a fixed stride — a population, not a list of suspects. Twenty-five
measured: **median delta 0.70ms, p75 ~1.5ms, p90 ~2.2ms, worst 4.11ms**; median
41 us/inst. So 3ms was a *good* line and my earlier claim that it was too low
was wrong — the abilities it flagged really are the tail. Re-run this with
`measure-spell-cost.mjs` and a huge `--budget`/`--delta-budget` to get a table.

**The noise.** Ten of those re-measured under identical conditions moved by
**-77% to +68%**, median 24%. So a failure is now re-measured and the better run
counts; a gate decided by one run refuses good work, and had.

**The thing that mattered most: `reach` = `lifetime / cooldown`.** Under
saturation the population settles at `lifetime / FIRE_INTERVAL_MS` (90ms), so
the saturated aggregate is `perInstance x lifetime / 90ms` — it grows with **how
long an effect lasts** as much as with what it costs. Proven, not assumed: the
ability the aggregate gate was *built* for (Shaco_W, "95us/inst but 5.4ms") has
a reach of **1.1** — sixty on the board in the harness, one in play, real cost
0.14ms. The gate had been refusing on an unreachable number since it was
written. It now fails on `perInstance x reach x TEAM` (TEAM=5, a named
assumption) and the saturated figure only warns.

Under this: Cassiopeia_W, Diana_R, Irelia_R, Shaco_W, Juggernaut_W and Gaara_E
all read 3-8ms saturated and all cost **0.14-0.77ms** across a full side. None
refuses. **Per-instance is what actually gates**, which is what the driver's own
header always said was the only comparable figure.

**Two art fixes landed with it**, both measured against the *restored original*
rather than an earlier session's number, because populations differ per run:
`Juggernaut_W` 265 p5 calls -> a native dashed arc, 252 -> 147 us/inst (-42%);
`Veigar_E` 379 -> 92 p5 calls by drawing rings in passes instead of per item,
117 -> 70 us/inst (-40%). **Nobody has looked at either in game yet.**

**Trap paid for:** both scans' arg parsers treated a flag's *value* as a path,
so `--max 20` died reading a directory called 20. Fixed in both.
