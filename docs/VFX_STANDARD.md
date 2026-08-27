# The VFX bar

The whole standard, so a briefing can link here instead of making everyone read
a 400-line spell. `packs/reference/spells/Vera_Q.ts` is the worked example that
ships with this checkout — read it once, not once per task.

## The five rules

1. **Unique per champion.** Never reuse another champion's geometry or motif.
   A crag-throwing brawler and an ice mage need visibly different walls. If two
   champions would draw the same shape, one of them needs a new shape — adding
   an `AoePulse` style is cheaper than sharing one.
2. **No instant pop-in.** Every effect animates: a windup, a travel, a growth.
   A spell that appears at full opacity on frame one has no telegraph, and the
   player has nothing to react to.
3. **Impacts spawn something.** `PredefinedParticleSystems` from
   `gameObject/helpers/ParticleSystem` for a legacy `onSpellCast` spell;
   `ImpactEffect` from `game/vfx/` *only* from a `castSpec.vfx` factory. Ground
   shockwaves fire on landing, never at cast.
4. **Damage scales to a ~100 HP pool.** Normal 15–35, ultimate 40–60. Ranges and
   missile speeds scale to the canvas (~1600×1600 map, skillshots 350–500), not
   to raw PC wiki values.
5. **Multi-hit protection.** A dash or continuous pass hits each unit at most
   once, tracked in a `Set` or array.

## The animation is the tooltip

Nobody reads the description mid-fight. Whatever the ability does, the player
has to learn it from the picture — so these five are about **legibility**, and
they outrank looking good. Every one of them was written after shipping the
opposite.

1. **Draw what the ability actually is: its reach and its area.** A spell with
   a cast range draws that range; a spell with an area of effect draws that
   area, at the radius the damage really uses. If the player has to guess where
   the edge is, the effect has failed no matter how it looks.
2. **Every zone that behaves differently must look different.** An axe swing
   that deals full damage in an outer band and a fraction in the inner one —
   with a bleed that only the outer band applies — needs the two drawn as two
   visibly separate regions, not one disc with a faint line in it. One rule,
   one region.
3. **Landing a hit has to show on the victim.** An impact belongs *where the
   hit landed*, on the unit that took it. Grit thrown at seeded random angles
   is decoration; it tells the player nothing about whether they connected.
4. **The motion has to agree with the effect.** If the buff pulls a victim
   toward the caster, the weapon travels inward — outward-sweeping art over an
   inward pull reads as a bug, because it is telling the player the opposite of
   what the game just did. Same for a knock-back, a dash, a channel that grows.
5. **Prefer few, clear layers over many pretty ones.** Effects stacked for
   beauty end up hiding each other: a swing carrying a wide white band, a heat
   trail, the weapon, two rims and fourteen chips has no subject. If two layers
   say the same thing, delete one — the one that survives should be the one
   that also carries information.

The test for all five: at minimum zoom, in a fight, could a player who has never
seen this champion tell where it hits and who it hit? If not, simplify until
they can.

## Color is a language, and the numbers already speak it

Adapted from Riot's public VFX style guide (the 2017 League of Legends one —
its Gameplay/Value/Color/Shapes/Timing sections are the source for this whole
block), filtered down to what a p5 canvas at this scale can honour.

1. **Damage type has exactly one colour channel: the combat text.**
   `DAMAGE_TEXT_COLOR` in `CombatText.ts` — physical amber, magic violet, true
   white, heals green, gold amber-yellow. Every typed number a player sees
   teaches this vocabulary, so nothing else may contradict it: never float a
   custom-coloured number for typed damage, and never reuse one of those hues
   to mean something else in text.
2. **World VFX carry *identity*, not type** — a champion's motif, an item's
   own colour — but they must not *lie across temperature*: a magic proc does
   not dress in the physical amber family, a physical proc does not read as
   arcane violet. Cool hues on magic, warm on physical, is the default; break
   it only when the identity itself demands it, and let the text correct the
   record.
3. **Avoid both ends of value and saturation.** Pure white/black or 0%/100%
   saturation blend into UI or vanish into terrain; the focal element earns
   focus by *contrast against its own secondary elements*, not by maxing any
   slider. One focal point per effect — if two layers compete, desaturate or
   dim the one that carries less information.

## Items and procs: the noise budget

The hierarchy rule ("visual impact represents gameplay impact") gives items a
hard ceiling, because an item proc fires far more often than any ability:

- **A proc flash is one layer, ≤ ~55 units radius, ≤ ~300ms.** It marks that
  the proc happened and on whom; the number beside it says how much and what
  type. If a proc effect feels long, it is too long — nothing about a proc is
  worth covering the fight for.
- **A worn state is a thin stroke, never a fill.** A charge that is loaded, a
  stack count that changes the next swing — these are *anticipation*, the one
  timing stage a reactive proc otherwise has none of, and they belong on the
  body as an outline the champion stays visible through (the spellblade
  orbit, a full-rage arc with its tick marks). Draw a state only while it
  would change a player's decision: an always-on glow says nothing and spends
  the budget saying it.
- **Show a state only when it is true right now.** The shimmer that says "the
  next swing procs" must read the same predicate the proc spends against —
  a ready-glow over an internal cooldown that will eat the proc is the effect
  lying, which is worse than the effect missing.
- **Climax and dissipation still apply.** The flash appears at the impact, on
  the victim, and fades — never pops out at full size on its last frame. The
  three stages (anticipation → climax → dissipation) are the guide's timing
  spine; for a proc item, anticipation is the worn state, climax is the
  flash, dissipation is its fade.

### Anything the player has to *find* has a size floor

The five rules above are judgement calls. This one is not, because it has been
got wrong by simply drawing something too small: **an object the player must
locate — a dropped dagger, a ground trap, a pickup — needs roughly 40 units of
longest dimension and a contrasting rim.**

A champion body is about 40 across, so anything much under that is grit. Colour
alone is not enough: a 26-unit pale-grey blade with no outline, dropped on a
pale-grey floor, fails even when finding it is the entire point of the kit that
dropped it. A dark rim under a light shape (or the reverse) is what makes a
silhouette hold over grass, water and stone alike — draw the rim under *each
piece*, not around the whole thing, or the parts merge into a blob.

Concealed objects are the deliberate exception, and they invert it: a trap
drawn only for its owner and only at ~80 alpha is being hard to see on purpose
— that is what it is for.

### Prove it in the renderer, not in your head

`npm run e2e:vfx` (`tests/e2e/shoot-new-champion-vfx.mjs`) is the rig — a
Playwright script that drives a real cast and screenshots it at a few frames
straddling the moments the effect changes (windup, strike, settle), because a
single frame cannot tell an animated effect from one that pops in. Add an
entry to its `ALL_CASTS` list for your ability the same shape the reference
pack's four already take. See `docs/ADDING_SPELLS.md` §6a for the argument
shape and what to look for once you have the screenshots.

## The shape of a good `draw()`

- One normalized `t = age / lifeTime`, and every value derived from it. No bare
  frame counters deciding sizes.
- Ease, don't lerp linearly: `1 - (1-t)*(1-t)` for a snap-out, `t*t` for a
  wind-in. Linear motion is what makes an effect look like a placeholder.
- Layers, not one shape: a filled body, a hard rim on the *actual* hit radius so
  the hitbox is not a guess, a leading edge that moves, and a flash that is gone
  in the first fifth of the life.
- **Seed randomness once**, in `onAdded()`, into an array field. `random()`
  called inside `draw()` re-rolls every frame and flickers instead of animating.
- Comments say *why the player needs to read this*, not what the code does.

## Two traps that are invisible to `tsc`

**`getDisplayBoundingBox()` is mandatory** on any `SpellObject` that paints past
its own centre. The default derives the box from `visionRadius`, which is `0` —
a zero-area box — and `ObjectManager.draw` picks what to draw by querying the
tree with it. Your 400px cone then vanishes the moment its *centre* leaves the
camera while its damage lands normally.

```ts
getDisplayBoundingBox() {
  const r = this.radius + 40;
  return this.squareDisplayBoundingBox(r * 2);
}
```

The helper takes the full edge length and memoises on `(position, size)`; the
box is read at least three times a frame per object, so a hand-rolled
`new Rectangle` is an allocation on every one of them. Build the `Rectangle`
yourself only when the box is *not* a square around your own centre — a path, a
tether back to the caster, a span over several victims — because those depend on
state the cache key does not watch.

**Never assign `dashBuff.onUpdate`.** `Dash` implements its movement in
`Dash.prototype.onUpdate`, so an instance assignment replaces the frame rather
than hooking it and the champion stands still. Use `onDashUpdate`.

## Your icon on a buff, except on the two that wear it in the world

Giving a buff your ability's icon is the house convention and it is a good one:

```ts
const slowed = new Slow(MS, this.owner, victim);
slowed.image = this.image;          // right — the HUD row now says which ability
```

Three simultaneous slows all drawn as `buff_slow` tell the player nothing about
which one to play around. Over a hundred sites across the content packs do this,
and buffs with no default of their own — `StatAmp`, `Shield`, `DamageReflect`,
`Disarm` — *require* it.

**`Stun` and `Fear` are the exceptions, and they are the only two.** Their
`draw()` paints `this.image` into the world, on the victim, at body size — the
spinning swirl is how the whole screen answers "who is stunned right now". An
ability icon is not legible at that size or recognisable to someone who has not
played your champion, so overriding it trades a global readout for a label
nobody reads. Legibility outranks looking good, and here the two are in direct
conflict.

```ts
const held = new Stun(MS, this.owner, victim);
held.image = this.image;            // wrong — this is the swirl, not a HUD row
held.stackId = 'mypack_myspell_stun';
```

Leave `image` alone on those two; `stackId` and duration are still yours. This
was found as drift rather than as a decision — three of the dota pack's four
stuns had overridden it against 24 of 25 in the lol pack that had not, with
nothing written down either way — so the rule now lives in `buffs/Stun.ts`'s own
header as well as here.

## An effect that rides a body

Use `attachTo(unit, buff)`, open `update()` with
`if (this.dropIfAttachmentLost()) return;`, and sync
`this.position.set(owner.position.x, owner.position.y)` every frame — otherwise
it keeps drawing on the corpse and reappears at the spawn point.

Anything reaching beyond the caster's own body must be a `SpellObject`, not
`castSpec.vfx`: `Champion.draw()` is skipped when the caster is culled or
fogged, so hanging a long effect off it makes the damage land invisibly.
