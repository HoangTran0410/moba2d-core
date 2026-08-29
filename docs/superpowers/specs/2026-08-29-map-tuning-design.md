# Map tuning — a map states its own numbers

Status: implemented across four milestones on 2026-08-29 — see §14 for
what landed and the two things deliberately left open.

A map today is geometry and slots. Every number that makes a match *feel*
like something — how hard a turret hits, how far a camp will chase, what a
wave is made of, how fast the fountain heals — is a constant in a core
TypeScript file. So a new map can only ever be a new *shape* of the same
game.

This spec makes those numbers part of the map, authored in the editor,
exported in the map's own JSON, with the engine's current values as the
default for every field nobody set. It also adds the mechanisms a map needs
before those numbers mean anything new: terrain that changes movement
speed, camps that run away instead of fighting, and bodies that die once
and stay dead.

The second half of the spec is the content that proves it out: four new
camps for the `lol` pack — Krug, Dragon, Scuttle Crab, Vilemaw.

## 1. The compatibility rule

**Every field is optional and absent means today's number.** Summoner's
Rift, Twisted Treeline, Proving Grounds and the reference map play
bit-identically after this lands, and every map already sitting in a
player's `localStorage` keeps working without a migration.

This is not politeness, it is the test strategy: the whole subsystem has a
provable no-op state, so `tuning: undefined` is one assertion per system
rather than a re-balanced test suite.

## 2. Where tuning lives

New optional field on **`MapSummary`** in `src/content/ContentPack.ts`:

```ts
export interface MapSummary {
  id: string;
  name: string;
  size: number;
  factions: Faction[];
  /** This map's own numbers. Absent, or any field absent, means core's own. */
  tuning?: MapTuning;
}
```

`MapSummary`, not `MapGeometry`, for three reasons:

- `ActiveMap = MapSummary & MapGeometry`, so `Game` and `preset.ts` receive
  it with no change to that type at all.
- `PackRegistry.maps()` returns `MapSummary`, so the map picker can show
  "trụ ×2 máu, không có lính" *before* downloading 395 polygons. A map with
  unusual rules that the player only discovers after loading in is a worse
  map.
- Tuning is a few hundred bytes against a geometry payload measured in
  hundreds of kilobytes. It has no business being behind the lazy loader,
  and keeping it out means editing a number does not invalidate a cached
  geometry chunk.

**Per-slot overrides live on the slots**, inside `MapGeometry`, because
that is where the slot is. See §4.

## 3. The schema

All of this is new in `src/content/ContentPack.ts`, beside the slot types.

```ts
export interface MapTuning {
  champions?: ChampionTuning;
  turrets?: TurretTuning;
  fountain?: FountainTuning;
  minions?: MinionTuning;
  monsters?: MonsterTuning;
  terrain?: TerrainTuning;
}
```

### 3.1 Turrets

Absolute overrides of `TurretPresetData` (`Turret.ts:17`), every field
optional:

```ts
export interface TurretStats {
  health?: number;
  size?: number;
  attackRange?: number;
  attackInterval?: number;
  damage?: number;
  rebuildTime?: number;
  repairDelay?: number;
  repairRate?: number;
}
export type TurretTuning = TurretStats;
```

Absolute rather than multiplied because the base — `DEFAULT_TURRET_PRESET`
— is core's own and a map author can read it. There is nothing to be
relative *to* that the author does not already know.

### 3.2 Fountain

```ts
export interface FountainStats {
  name?: string;
  tickInterval?: number;
  healPercent?: number;
  manaPercent?: number;
}
export type FountainTuning = FountainStats;
```

`Fountain` already accepts all three (`Fountain.ts:7`); the reason a map
cannot set them today is that `fountainsFromSlots` (`preset.ts:820`)
hardcodes the name and omits the rest. This is the smallest change in the
spec.

### 3.3 Minions

The one place the map may define new *things* rather than new numbers, per
the decision in chat.

```ts
/** How a minion fights and draws. Core's three built-in bodies. */
export type MinionStyle = 'melee' | 'ranged' | 'cannon';

export interface MinionTypeDef {
  name: string;
  speed: number;
  size: number;
  health: number;
  damage: number;
  attackInterval: number;
  attackRange: number;
  aggroRange: number;
  /** Defaults to 'melee'. See §5 for why this is separate from the id. */
  style?: MinionStyle;
  /** Defaults to core's MINION_BOUNTY. */
  goldBounty?: number;
}

export interface WaveStage {
  /** Match time from which this stage applies, ms. */
  atMs: number;
  /** Type ids, in release order. */
  composition?: string[];
  intervalMs?: number;
}

export interface MinionTuning {
  /** Present replaces core's three entirely. Keyed by a free type id. */
  types?: Record<string, MinionTypeDef>;
  waves?: {
    composition?: string[];
    intervalMs?: number;
    firstDelayMs?: number;
    releaseIntervalMs?: number;
    liveCap?: number;
    /** Applied in `atMs` order; each stage overrides the fields it names. */
    stages?: WaveStage[];
  };
}
```

`types` is all-or-nothing on purpose. A partial merge into core's three
raises "what does `{ melee: { damage: 9 } }` mean when the map also
declares `siege`?" and the honest answer is that a map declaring its own
roster is declaring its own roster. A map that only wants stronger melee
minions copies the three defaults and edits one number — the editor offers
a "chép 3 loại mặc định" button so this is one click, not transcription.

### 3.4 Monsters

Multipliers, not absolutes, at the map level:

```ts
export interface MonsterScale {
  healthMult?: number;
  damageMult?: number;
  speedMult?: number;
  attackIntervalMult?: number;
  aggroRangeMult?: number;
  reviveTimeMult?: number;
}
export interface MonsterTuning extends MonsterScale {
  /** Replaces MONSTER_CHASE_MARGIN (Monster.ts:105). */
  chaseMargin?: number;
  /** Replaces MONSTER_GIVE_UP_DELAY_MS (Monster.ts:108). */
  giveUpDelayMs?: number;
}
```

A map does not know what monsters a pack will fill its slots with — the
same map runs with `lol`'s jungle or `dota`'s. "×1.5 damage" is the only
sentence it can say that stays true across packs, which is exactly the
argument `NeutralSlot.role` already rests on.

Per-slot (§4) additionally allows absolutes, because there the author is
aiming at one named camp on one map and can see what fills it.

### 3.5 Terrain

```ts
export interface TerrainLayerTuning {
  /** Movement speed multiplier for a unit inside this layer. Default 1. */
  speedMultiplier?: number;
}
export interface TerrainTuning {
  bush?: TerrainLayerTuning;
  water?: TerrainLayerTuning;
}
```

See §6 — this is a new mechanic, not an exposed constant.

### 3.6 Champion respawn

```ts
export interface ChampionTuning {
  /** Flat respawn, ms. Default 5000 — today's number. */
  reviveTime?: number;
  /**
   * Optional growth. Present, it replaces the flat value:
   *   min(base + perMinute * matchMinutes, max)
   */
  reviveCurve?: { base: number; perMinute: number; max: number };
}
```

Champion respawn today is **a flat 5000 ms and nothing else** —
`AttackableUnit.reviveTime = 5000` (`AttackableUnit.ts:155`), inherited by
`Champion` with no override, no scaling by level or match time anywhere in
the engine. There is no curve to expose; the curve is new.

So `reviveTime` alone keeps the map honest, and `reviveCurve` is what a map
reaches for when it wants dying to get costlier as the match runs long. A
map wanting that flavour without copying League writes
`{ base: 8000, perMinute: 2500, max: 60000 }` — the 60s ceiling the user set
for this game's pace, reached around minute 21.

Default stays 5000 flat, so nothing moves for any existing map.

Only respawn. Champion *stats* stay out of map tuning (§15) — a map that
rewrites champions is a different feature with a much larger blast radius.

**Adjacent finding, not fixed here:** `DummyChampion.respawnTime = 1000`
(`DummyChampion.ts:8`) is dead. Nothing in `src/` reads `respawnTime` — the
field the engine actually uses is `reviveTime`, one letter of intent away.
It is a one-line deletion; it belongs to whoever next touches that file, not
to this spec.

## 4. Per-slot overrides and the merge

Three layers, innermost wins:

```
core default  →  map.tuning.<system>  →  slot.stats
```

New optional fields on the existing slot types in `ContentPack.ts`:

| Slot | New field | Type |
|---|---|---|
| `StructureSlot` | `stats?` | `TurretStats` |
| `SpawnSlot` | `stats?` | `FountainStats` |
| `NeutralSlot` | `stats?` | `MonsterSlotStats` |

```ts
export interface MonsterSlotStats extends MonsterScale {
  /** Absolute, applied after the multipliers. */
  health?: number;
  damage?: number;
  attackRange?: number;
  aggroRange?: number;
  reviveTime?: number;
  chaseMargin?: number;
  /** See §7. Lets one map make its crabs fight back. */
  temperament?: MonsterTemperament;
}
```

`MinionSlot` gets no `stats`: a muster point is where a wave forms up, not
what it is made of, and per-lane rosters are not something anyone asked
for. Deferred, not forgotten.

### 4.1 The merge module

New file **`src/game/config/mapTuning.ts`** — pure functions, no p5
globals, no `Game`, unit-testable on plain objects:

```ts
resolveChampionRevive(tuning, matchTimeMs): number
resolveTurretPreset(tuning, slot): TurretPresetData
resolveFountainPreset(tuning, slot, factions): FountainPresetData
resolveMonsterPreset(tuning, slot, base: MonsterPresetData): MonsterPresetData
resolveMinionTypes(tuning): Record<string, MinionPresetData>
resolveWavePlan(tuning): WavePlan
resolveTerrainTuning(tuning): ResolvedTerrainTuning
```

This is the single place the three layers meet. `preset.ts` calls into it;
nothing else composes tuning by hand. `preset.ts` is already 908 lines and
its job is *slots to presets*; the merge arithmetic is a different job with
a different test shape, which is why it is its own module rather than six
more exports there.

### 4.2 Call sites that change

- `Game.spawnTurrets` (`Game.ts:567`) — currently `new Turret({ game,
  position, teamId })` with **no preset at all**, so every turret in the
  engine is `DEFAULT_TURRET_PRESET`. Starts passing a resolved preset.
- `preset.ts` `fountainsFromSlots` / `turretsFromSlots` /
  `monsterBodyPreset` — take the active map's tuning as a parameter.
- `Monster.chaseLeashRange()` (`Monster.ts:299`) — reads `this.chaseMargin`
  (new, from the preset) instead of the module constant. The constant stays
  as the default.
- `MinionSpawner` — takes a `WavePlan` from its context instead of reading
  the module constants directly; the constants become the default plan.

## 5. Free-form minion types

`MinionKind` (`Minion.ts:17`) widens from `'melee' | 'ranged' | 'cannon'`
to `string`. It is referenced in exactly three files outside its own —
`MinionSpawner.ts`, `net/ClientSession.ts`, and nothing else — so this is
cheaper than it sounds.

The catch is that `kind` currently carries **two** meanings:

- identity — which preset this minion is
- behaviour and art — `Minion.ts:411` branches on `!== 'melee'` for ranged
  attacks, `:548`/`:556` branch on `'cannon'`/`'ranged'` for drawing

A map that declares a type called `siege` would silently get melee
behaviour and melee art. So `MinionPresetData` gains `style: MinionStyle`,
those three sites read `this.style`, and `kind` goes back to being only an
id. Core's three built-ins set `style` equal to their own kind, so nothing
moves.

**On the wire:** `protocol.ts:81` already declares `kind: string`, so no
protocol change. `ClientSession.ts:444` currently does `event.kind in
MinionPresets ? event.kind : 'melee'` — it must resolve against the active
map's resolved type table instead, falling back to core's melee only when
the map declares no such type. A client and host that disagree about the
type table is a map-sync problem (§8), not something the fallback should
paper over silently; it logs once per unknown id.

## 6. Terrain speed — a new mechanic

There is no terrain speed effect in the engine today. `TerrainMap.update()`
(`TerrainMap.ts:88`) queries Champions only, sets `isInsideBush` for
vision, and draws ripples for water. Nothing reads terrain when moving.

Design:

- `AttackableUnit.terrainSpeedFactor = 1` (new field). `move()`
  (`AttackableUnit.ts:917`) multiplies `this.stats.speed.value` by it.
- **A second pass in `TerrainMap.update()`, gated on the map declaring a
  multiplier that is not 1.** When both layers are 1 — every map that
  exists today — the pass does not run and the cost is one boolean.
- The pass covers champions, minions and monsters; it skips `isImmovable`
  units (turrets, fountains).
- It does **not** touch `isInsideBush`. The existing champion pass keeps
  sole ownership of that flag, so vision semantics are untouched and 160
  minions do not start hiding in brush.

`terrainSpeedFactor` rather than a `StatModifier` on `stats.speed`:
modifiers are added and removed by buffs with lifetimes, and a per-frame
add/remove churn on a stat that `ClientSession.setComposedValue` has to
invert over the wire is the wrong shape. A plain factor applied at the
point of movement is honest — the HUD keeps showing the champion's real
movement speed, and what the terrain does is visible in the movement
itself.

## 7. Monster temperament, roam region and ephemeral bodies

The Scuttle Crab needs a camp that runs away and never fights back, and
that can roam the river rather than a circle. Krug needs split children
that die once and stay dead. None of the three exists.

### 7.1 Temperament

New field on `MonsterBody` (pack data) and `MonsterPresetData`:

```ts
export type MonsterTemperament = 'aggressive' | 'passive' | 'skittish';
```

- **`aggressive`** (default, absent) — today's behaviour, byte for byte.
- **`passive`** — `aggroOn` is a no-op and `takeDamage` does not
  `alertCamp`. It never enters `ATTACK`. It can be killed; it does nothing
  about it.
- **`skittish`** — never enters `ATTACK`. A champion inside `aggroRange`,
  or any damage taken, puts it in a new `FLEE` phase. After
  `giveUpDelayMs` with no threat inside `aggroRange`, it returns to
  `BACK_TO_CAMP`.

`Monster.PHASES` gains `FLEE` as a fourth entry, and `update()`
(`Monster.ts:247`) a fourth branch. `FLEE` picks a destination away from
the nearest threat, clamped to the roam region and to
`NavGrid.isWalkable`, and re-picks when it arrives or the threat moves.

### 7.2 Roam region

```ts
export type MonsterRoam =
  | { kind: 'camp' }
  | { kind: 'terrain'; layer: 'water' | 'bush' };
```

Default `{ kind: 'camp' }` — the `camp.r` circle every camp uses now.

`{ kind: 'terrain', layer: 'water' }` makes the region "anywhere inside the
water layer". `TerrainMap` gains a small public query for this —
`containsPoint(x, y, terrainType)` — built from the quadtree lookup and
`CollideUtils.pointPolygon` that `TerrainMap.ts:107` already does inline.
The flee destination sampler keeps only candidates the region contains; if
none qualifies it falls back to the camp circle, so a crab whose river was
edited out from under it still behaves.

The leash check (`isOutsideCamp`, `Monster.ts:286`) asks the region rather
than the radius.

### 7.3 Ephemeral bodies

```ts
/** A body that is removed on death instead of respawning. Default false. */
ephemeral?: boolean;
```

`Monster.die` sets `this.toRemove = true` for one of these instead of
letting the revive timer run.

This exists because Krug's split children have no honest value for
`reviveTime`. `AttackableUnit.die` schedules `{ reviveAfter: reviveTime }`
and `update` (`AttackableUnit.ts:268`) respawns the moment that counter
reaches zero — so `reviveTime: 0` is not "never comes back", it is "comes
back next frame". `Infinity` never elapses but leaves a corpse in the
object list for the rest of the match. A spawned-then-gone body is a
concept the engine is missing, not a number to pick, and it will serve any
future summon-shaped monster too.

### 7.4 Where these are declared

`temperament`, `roam` and `ephemeral` are declared by the **pack** on
`MonsterBody`, because they are
what a monster *is*. `temperament` is additionally overridable per-slot
(§4) so a map can make its crabs bite; `roam` is not, because a roam region
that disagrees with where the map put the water is not a playstyle, it is a
bug.

### 7.5 Attack style — added 2026-08-29, after the milestones below

Not in the original design, and found by playing it: a camp's basic attack
resolved damage on the frame `updateAttack` allowed a swing and drew a
180ms line from the body to its target as the only evidence. Legible for
nothing, and invisible for a boss whose reach runs to hundreds of pixels —
"hit like Bluetooth", in the report that prompted it. `Minion.launchAttack`
had had the answer since long before this spec (`MinionBolt`,
`MinionSwing`: damage on arrival), and camps had simply never been given
it.

`MonsterAttackStyle` — `melee` | `ranged` | `breath` — declared on
`MonsterBody` beside `temperament`, with `attackColor` beside it, and
overridable per slot exactly as `temperament` is (§4) so a map may decide a
pit breathes where the pack said it claws. Three objects in
`gameObject/attackableUnits/monsterAttacks.ts` — `MonsterClaw`,
`MonsterSpit`, `MonsterBreath` — each resolving damage exactly once at its
own strike instant and re-checking the target first, so a dodge during a
wind-up is a real dodge.

**Absent means core derives one from `attackRange`** (`MONSTER_MELEE_REACH`,
100). That default is what carries every camp in every pack written before
the field: farm camps sit at tens of pixels of reach and bosses in the
hundreds, so the split lands cleanly and no pack had to be edited. The one
declaration the `lol` pack makes is the dragon's `breath`, whose reach
would otherwise have derived a spat projectile.

The `breath` cone is **single-target on purpose**: it is aimed art over a
basic attack, and damaging everything it covers would multiply a boss
camp's output by however many people are contesting it — a balance change
wearing a graphics change's clothes.

### 7.6 `MonsterAbility.onSpawn` — added 2026-08-29

`onKilled`'s counterpart, and the seam a camp needs to say something
*before* anyone fights it: `cast` runs only once a fight is underway, and
`onKilled` runs a life too late. Called once per life on the body's first
`update()` — not in the constructor, so the world the callback reaches for
(`monster.game.objectManager`) is one an object can actually be added to —
and reset by `respawn()`.

It exists because a pit whose contents rotate has to be readable from
across the map, or the rotation is not a decision but a surprise. See
§11.2's element ring, which is its only caller today.

### 7.7 Regen delay, and a rooted camp that does not forget — 2026-08-30

Two bugs that read as one, both found by playing the dragon.

**Regen is applied per frame with no `deltaTime`** — `Stats.update()` adds
`healthRegen.value` straight onto `health.baseValue` — and a camp's
walking-home rate is `health / 60`. That is a full bar in sixty frames: one
second. Every camp in the game reset almost instantly whenever a fight
paused.

**A rooted camp dropped its target the frame it left reach.** `updateAttack`
called `goBackToCamp()` in the `isImmovable` branch, bypassing the give-up
leash entirely — so on any `speed: 0` boss, stepping over an invisible line
was a complete heal. The dragon made it obvious because its own wingbeat
threw the target past its reach: a signature ability whose whole effect was
to end its own fight and hand the boss a reset.

Fixes, both in `Monster`:

- `MONSTER_REGEN_DELAY_MS` (4000), refreshed by every `takeDamage`, checked
  *before* the phase and outranking it — the phase is not a reliable answer
  to "is this fight over", since a rooted boss reaches BACK_TO_CAMP the
  moment a target steps back and a winning camp reaches IDLE on the frame
  the last blow lands. Overridable per body (`MonsterPresetData`) and per
  map (`MonsterTuning.regenDelayMs`, editor field *Trễ hồi máu*). Zero
  restores the old behaviour exactly.
- The `isImmovable` branch holds the lock and stops moving instead of going
  home. The leash ends the fight, the same as for a camp with legs; being
  rooted only means it waits where it stands. This reverses a documented
  decision — `tests/game/monsters/Monster.test.ts`'s "holds a target it can
  see but could never walk to" carries the old rule and why it lost.

A third thing fell out of the same session: **`MonsterBody` gained
`chaseMargin`, `giveUpDelayMs` and `regenDelayMs`**, and
`resolveMonsterPreset` was reading none of them. All three fell straight
from the map layer to the module constant, so a body that declared a
tighter leash than the jungle around it had that statement dropped on the
floor — invisible to every test, because the map layer worked. The merge
now runs the full stack for them: slot, map, **pack**, core. A body
declares one when its leash is part of what it *is* rather than part of the
jungle's feel, which is what §11.2's dragon does now that it has legs.

## 8. Validation

New `checkMapTuning()` in `src/content/validate.ts`, called from
`checkMap()` (`validate.ts:700`), and per-slot `stats` checked inside
`checkMapGeometry()`.

Rules:

- Every value must be a finite number (or string, for `fountain.name`).
- **Unknown keys are rejected, not ignored.** A map author who writes
  `attackRnage` and gets silence has the worst possible afternoon. This is
  the same stance `checkMapGeometry` already takes on unknown terrain
  layers (`validate.ts:619`).
- Non-negative: every duration, range, size, health, interval, multiplier.
- `waves.composition` and every `stages[].composition` entry must name a
  declared type id (or one of core's three when `types` is absent).
- `minions.types` values must carry every required `MinionTypeDef` field —
  a type is all-or-nothing, unlike a tuning override.
- `style` must be one of the three; `temperament` one of the three;
  `roam.layer` one of the two.

`checkMonsterBody` (`validate.ts:533`) grows the `temperament` and `roam`
checks for the pack side.

## 9. Map editor

`public/map-editor/` — vanilla JS, ~8.5k lines. Documented in
`docs/MAP_EDITOR.md`, which gets a new section.

**New right-panel section "Cấu hình map"**, collapsible, five groups: Trụ /
Bệ đá / Lính / Quái / Địa hình. Every numeric input is empty by default,
with the engine's own default as the `placeholder`, so an empty field
reads as "dùng mặc định" and the author can see what they are departing
from without opening the source.

- **Lính** is a small list editor: add/remove a type, per-type fields, a
  `style` select, and a "chép 3 loại mặc định" button that seeds the list
  from core's table. Wave composition is a chip row of type ids; stages are
  a short list of `{ atMs, composition, intervalMs }`.
- **Per-slot** extends the existing per-kind `PROPS` schema
  (`js/ui.js:494`) with a "Ghi đè chỉ số" subsection for `structure`,
  `spawn` and `neutral`.

`js/state.js` holds `E.tuning`; `js/commands.js` gets the undoable edit
commands, since every other mutation in that editor is undoable and a
config panel that is not would be the odd one out.

### 9.1 Every path tuning has to survive

The editor↔game contract is **two `localStorage` keys**, and tuning has to
ride both plus the pack pipeline. Miss one and the failure is silent data
loss, not an error.

| Path | File | What changes |
|---|---|---|
| editor's own save | `js/storage.js` map record | store `E.tuning` |
| editor → game, local maps | `js/storage.js` `publishToGame` → `moba2d-local-maps-v1` | write `tuning` beside `factions` |
| game → editor, pack maps | `src/content/editorCatalog.ts:83` → `moba2d-pack-maps-v1`, read at `js/storage.js:951` | carry `tuning` in and back out |
| editor → JSON export | `exportMapGeometry` | write `tuning` at the document's top level |
| editor → TS export | `exportMapTS` | emit `tuning` in the summary module |
| export → pack | `scripts/generate-maps.mjs` | **`mapMeta.ts`, not the geometry JSON** |

The last row is the one that would have bitten. `generate-maps.mjs` builds
the geometry file from **exactly** `terrain`, `slots` and `lanes`
(`generate-maps.mjs:142`) and the meta file from `name`, `size`, `factions`
(`:147`) — anything else in the export is dropped on the floor by
construction, and that is deliberate: the header records that a
`{ ...summary, ...geometry }` spread once shipped a map whose picker size
disagreed with its terrain, and made a map unjoinable over LAN by carrying
`id`. So `tuning` is added to the **meta** half, which is where §2 already
put it. Per-slot `stats` needs no change there at all — it rides inside
`slots`.

The `moba2d-pack-maps-v1` row is the data-loss trap: without it, opening a
shipped pack map in the editor and re-exporting silently strips the tuning
it arrived with, and the map looks fine.

**Writes happen only when tuning is non-empty**, so a map with none exports
byte-identically to today — which is what keeps `generate-maps.mjs`'s
staleness check quiet for every pack that has not opted in.

### 9.2 Editor tests

`tests/content/localMaps.test.ts` and `editorCatalog.test.ts` already run
the **real editor** inside a `vm`, which is what makes the two keys a
tested contract rather than a convention. The new round-trip cases go
there: publish a map with tuning, read it back through `localMaps.ts`;
seed `moba2d-pack-maps-v1` with a tuned map, open it, re-export, assert the
tuning survived. No browser needed.

## 10. Networking

Tuning travels with the map, and both sides of a LAN match already resolve
the same map by id, so a pack map needs nothing. The open question is a
**local** map — one drawn in the editor, living only in the host's
`localStorage`. Whether those sync today is not something this spec
changes; if they do not, a client joining a host's local map is already
broken and this makes it no more so.

What this spec does require: `ClientSession` resolves minion types from the
active map (§5) rather than from `MinionPresets`, and the host/client
handshake's existing map-id check is what guarantees they agree.

## 11. Content: four camps for the `lol` pack

Each is a `MonsterDef` in `lol/data.ts` plus a behaviour module under
`lol/monsters/`, wired through `code.ts` by local id — the shape
`monsters/Baron.ts` and `monsters/JungleBuffs.ts` already establish.

### 11.1 Krug — bãi quái đá

Three tiers. Killing the Ancient Krug spawns two Krugs; killing a Krug
spawns two Krug nhỏ. Implemented with `MonsterAbility.onKilled` plus
`api.units.Monster` (already on the `ContentApi` surface,
`ContentApi.ts:167`) and `monster.game.objectManager.addObject` — the same
door `Game.spawnJungle` uses.

Children spawn at a small offset from the parent's death position, inherit
the parent's `camp` object **by reference** so `alertCamp` still finds
packmates (`Monster.ts:57` is explicit that identity is the shared
reference), and are marked `ephemeral` (§7.3) — a split child is not a camp
member that respawns, it is a body that exists until killed. The camp's
real respawn puts the Ancient back.

`reviveTime: 3000`, matching the wolves/gromp/raptors around it rather than
inventing a number — it is an ordinary farm camp and its neighbours already
settled this game's pace.

Two new `role: "krugs"` slots on Summoner's Rift.

### 11.2 Dragon — rồng nguyên tố

One camp, four elements, rotating on each respawn: Infernal (damage),
Ocean (health regen), Cloud (movement speed), Mountain (defence). Killing
it grants every champion on the killer's team a **long but finite** buff —
the user's explicit call: not permanent.

**The buff replaces, it never stacks.** One dragon buff on a champion at a
time; the next dragon overwrites whatever was there. This is `buffAddType =
BuffAddType.REPLACE_EXISTING`, which `AttackableUnit.addBuff` already
implements (`:466`) by deactivating every live buff sharing the `stackId`
before pushing the new one. Nothing new is needed in core.

The one thing that must be written by hand: **all four element classes share
`stackId = 'dragon'`**. `Buff.stackId` defaults to `new.target`
(`Buff.ts:148`), so four separate classes would otherwise land in four
separate slots and quietly stack after all — exactly what `stackId` exists
to control, used here in reverse (distinct classes deliberately sharing one
slot rather than one generic class being split).

The consequence, stated plainly because it is a design choice and not a
side effect: taking a Cloud dragon **removes** your Infernal buff. Element
rotation stops being accumulation and becomes a decision — the drake
currently up is the buff currently on offer, and it costs you the one you
have. If that turns out to play badly, the fix is one string
(`stackId = 'dragon:' + element`) and it becomes four independent slots.

```
reviveTime:  60_000   (the user's ceiling for this game's pace)
durationMs: 180_000
```

**Retuned 2026-08-29, after §7.5 made the swing visible.** As shipped the
dragon was `damage: 10` at `1_800`ms — 5.6 dps, and the *weakest fighting
camp in the jungle*: a raptor pit does 14.0, a buff camp 8.0. It survived
review because Baron (6.0) and Vilemaw (5.5) read as similarly modest, and
they can afford to — their kits carry roughly 8.6 and 4.7 dps more. This
camp has no kit at all. `makeDragonAbilities` returns one entry and that
entry is the blessing paid on death, never cast, so its basic attack is the
whole fight.

Now `damage: 24` at `1_600`ms — 15.0 dps, just past the raptors and a shade
over Baron's swing-plus-kit total. A large single hit on a ~100 health
champion on purpose: the swing is a `breath` cone whose wind-up re-checks
reach before it lands, so it is dodgeable by walking, and a number worth
walking away from is what makes that telegraph mean anything.

`lol/tests/monsters/campPower.test.ts` builds every camp in the pack as a
real `Monster` and measures it, rather than reading a table core does not
use — six of the nine bodies leave `damage` out and let core derive it,
which is how this went unnoticed.

**And a kit, same day.** The retune above fixed the number and left the
shape: the dragon was still the only boss with nothing to *do*. It has two
abilities now.

`WINGBEAT`, shared by every drake: a half-second rear-up, then everything
hostile within 330px of the pit is thrown out to 560px and takes 10. It
fires on the first frame of the fight for free — `_abilityCooldowns` starts
at zero and `castAbility` runs before the reach check — so "hit it and it
takes off" needs no trigger of its own, and unlike a once-per-life trigger
it recurs. It **pushes** rather than knocking up on purpose: Baron's `SLAM`
already owns airborne (§11 has both), and two bosses with the same verb are
one fight in two skins. The price is the walk back, not being pinned.

`RITE`, one ability that branches on `elementFor(monster.camp)`, so the
rotation decides the fight as well as the reward:

| drake | rite | why not another pool |
|---|---|---|
| Rồng Lửa | a burn on its target | Baron and Vilemaw already own ground pools |
| Rồng Nước | heals **itself** 7% per cast | nothing else in the pack heals; makes the pit a damage check |
| Rồng Gió | slows everything in the pit | wind is displacement, which the wingbeat sets up |
| Rồng Đất | shields itself for 140 | nothing else in the pack shields; makes the pit a burst check |

Two of the four deal no damage at all, which is the point of four fights
rather than four damage numbers.

**The pit wears a ring in its element's colour**, spawned through
`MonsterAbility.onSpawn` (§7.6) and guarded by a `WeakSet` keyed on the
camp so a pit gains one ring, not one per respawn. It is ground art
(`api.layers.GROUND_Z_INDEX` — `Z_INDEX_MAP` is keyed by exact constructor,
so a subclass naming no layer draws over champions) and it **outlives the
body on purpose**: the rotation advances on death, so the sixty seconds the
pit stands empty are exactly when a team decides whether to contest the
next drake.

Both are exported constants in the pack file, per this repo's rule that
tuning values are importable by tests rather than edited into them.

Same `onKilled` shape as `BARON_BUFF` (`monsters/JungleBuffs.ts:108`), same
"killer must be a champion, a pet's kill pays its owner" rule.

One new `role: "dragon"` slot at Summoner's Rift's point-symmetric mirror
of the Baron pit — the map is 6400² symmetric about (3200, 3200) and Baron
sits at (2147, 1876), giving ≈ (4253, 4524). **The exact point is verified
against the map's own wall polygons and `NavGrid` before it is committed,
by a throwaway script — not eyeballed.**

### 11.3 Scuttle Crab — cua

`temperament: 'skittish'`, `roam: { kind: 'terrain', layer: 'water' }`,
`damage: 0`. It never fights back and flees along the river.

`reviveTime: 45_000` — slower than the 3s ordinary camps around it, because
its value is the shrine and not the gold, and well under the 60s ceiling.

On death: a speed shrine at its corpse — an area that grants a movement
buff to champions of the killer's team — and vision of that area, both for
a fixed duration. Both are `SpellObject`s built from `api`, the way every
Baron effect is (`monsters/Baron.ts` header: an effect drawn from the
caster vanishes when the caster leaves the camera; it must be its own
object).

Two new `role: "scuttle"` slots in the river.

### 11.4 Vilemaw — for Twisted Treeline

Requested so the user can swap it in for Baron on their own TT edit. This
spec adds the **monster**; it does not touch `twistedTreeline_map.json`.
The user places the slot themselves.

`fills: ['vilemaw']` and **not** `'baron'`. Adding `'baron'` to its `fills`
looked convenient and is a trap: `monsterFillingSlot` (`preset.ts:684`)
takes `monstersFilling(role)[0]` and install order decides the winner, so a
Vilemaw that also fills `baron` could take over Summoner's Rift's own Baron
pit. One role, unambiguous; the user sets `role: "vilemaw"` on the slot
they add to Twisted Treeline.

`reviveTime: 60_000` and a team buff on the `BARON_BUFF` shape with
`durationMs: 180_000`, also `REPLACE_EXISTING`, under its own
`stackId = 'vilemaw'` — its own slot, independent of the dragon's, which
costs nothing since the two never share a map.

Kit, deliberately not Baron's: a web pull that yanks the nearest champion
toward the pit (the `Dash` buff `Turret.ts:97` names as what a hook
constructs), a venom spray, and a leg sweep ring. `onKilled` grants the
team buff described above.

### 11.5 Twisted Treeline is not otherwise touched

The 100-unit seam down the centre of its wall bands is **deliberate** —
confirmed by the user on 2026-08-29. Nothing here closes it.

## 12. Contract and versioning

`MapTuning` and friends are exported from `content/types.ts`, and
`MonsterTemperament` / `MonsterRoam` change the `MonsterBody` surface.
`npm run contract:bump` records the surface and raises core's minor:
**1.9.0 → 1.10.0**. Approved in chat.

**Corrected during milestone 1, from what actually happened:**
`apiContract.test.ts` did **not** go red for the monster seams. It snapshots
the `ContentApi` *runtime object*, and milestone 1 added no value to it —
type-only exports are erased before that test can see them. What did go red
was `tests/content/publicSurface.test.ts`, which pins the export list of
`./content/ContentPack` and caught the two new runtime vocabularies
(`MONSTER_TEMPERAMENTS`, `MONSTER_ROAM_LAYERS`); it was updated in place.

So the bump is **not** forced by milestone 1's gate. It is still wanted
before milestone 4: a pack declaring `temperament` needs a core that has
the field, and `coreRange: '>=1.10.0'` is the only way `lol` can say so.
Run it with the milestone that first needs the floor, not earlier.

`lol`'s `coreRange` moves to `>=1.10.0` — in `data.ts`, in
`write-manifest.mjs`, and in the pin inside `tests/items.test.ts`. All
three move together; that trap is recorded in the pack's own `AGENTS.md`.

`dota` is untouched and stays at `>=1.5.0`.

## 13. Testing

| Area | Test |
|---|---|
| Merge | `tests/game/config/mapTuning.test.ts` — pure functions, three-layer precedence, `undefined` tuning reproduces every current default exactly |
| Validation | tuning rejection cases in the existing `validate` suite, incl. unknown-key rejection and a composition naming an undeclared type |
| Turrets | a map whose tuning doubles turret damage produces a `Turret` that deals it; a slot override beats the map value |
| Minions | a map declaring four types spawns four types; `style` drives ranged behaviour and art; wave stages switch on match time |
| Terrain speed | a unit inside water at `speedMultiplier: 0.5` covers half the ground; with no tuning the second pass does not run |
| Monster | `skittish` never enters ATTACK and increases distance from a threat; `passive` never retaliates; a terrain roam keeps a body in the layer; `chaseMargin` override changes the leash; an `ephemeral` body is removed on death and never respawns |
| Champion respawn | a map's flat `reviveTime` is honoured; `reviveCurve` grows with match time and clamps at `max`; no tuning reproduces 5000 exactly |
| lol pack | one test file per camp — Krug split counts and camp identity, Dragon element rotation plus **a second dragon buff replacing the first rather than adding to it**, crab flee and death effects, Vilemaw kit |

Two pack traps from the repo's own notes apply: `tests/noCoreReach.test.ts`
pins the **count** of pack test files and must be bumped by four; and
`tests/setup.ts` installs an ambient lane set, so any new test calls
`resetLanesForTests()` before `setActiveLanes`.

## 14. Milestones

Four, in dependency order. Each is its own implementation plan.

1. **Core seams** — `MonsterTemperament`, `MonsterRoam`, `ephemeral`, the
   `FLEE` phase, `TerrainMap.containsPoint`. Unblocks the crab and Krug;
   no map format change. **Done 2026-08-29** — 23 tests across
   `MonsterBehaviour.test.ts`, `TerrainMap.test.ts` and `validate.test.ts`;
   3057 pass, both typechecks and `check-seams` clean.
2. **`MapTuning` for champions, turrets, fountain, monsters, terrain** —
   schema, `mapTuning.ts`, validator, `preset.ts` and `Game.spawnTurrets`
   wiring, champion respawn resolution, terrain speed pass. **Done
   2026-08-29.**
3. **Free-form minion types** — `MinionKind` widening, `style` split, wave
   plan, `ClientSession` resolution. **Done 2026-08-29.**
4. **Editor + content** — the "Cấu hình map" panel and per-slot fields;
   the four `lol` camps and the Summoner's Rift slots. **Done 2026-08-29.**

**What is deliberately left for the user:**

- **`lol`'s `coreRange` is still `>=1.6.0`.** It needs `>=1.10.0` before
  `temperament` and `roam` mean anything, but `bump-api-contract` is
  explicit that a pack published with a floor its live core cannot meet is
  refused on every player's machine — and the pack is the half already out
  there. Raise it (in `data.ts`, `write-manifest.mjs` and the pin in
  `tests/items.test.ts`, all three together) **after** a core carrying
  contract 10 is deployed to pages.dev. Until then the fields are simply
  ignored by an older core, so a crab plays as an ordinary camp rather
  than breaking.
- **Dragon and Vilemaw art is placeholder** — flat silhouettes generated
  to fill the two asset keys, not traced from anything. Replacing the two
  PNGs in `assets/images/monsters/` and re-running `assets:generate` is
  the whole job.
- **Twisted Treeline gets no new slots.** Vilemaw ships with no home on
  purpose; the user places `role: "vilemaw"` on their own edit.

Milestone 4 is the only one that touches two repos, and it is last on
purpose: `lol` cannot declare `temperament` until core ships milestone 1
and the contract bump.

**Operational note:** `lol` is currently symlinked to core
(`node_modules/@moba2d/core -> ../moba2d-core`). Core's own `npm run
verify` refuses while linked, and beyond `links:check` the link makes nine
tests and `chunks:check` fail for reasons unrelated to any change. While
linked, judge a core change by typecheck plus the tests it touches — not by
a clean gate. Unlink for the final verify.

## 15. Deliberately not in scope

- **Per-lane minion rosters.** `MinionSlot` gets no `stats`.
- **Champion stats in map tuning.** Respawn timing is in (§3.6); health,
  damage, speed and the rest are not. A map that rewrites champions is a
  different feature and a much larger blast radius.
- **Rebalancing the `lol` pack's existing timers.** Baron sits at 180s and
  the buff camps at 90s, both above the 60s ceiling the new camps observe.
  Bringing them down is a balance change, not a config feature, and §1
  promises existing maps do not move. It is one line each whenever the user
  wants it.
- **Item or gold tuning.** Same reason.
- **Syncing local maps over LAN.** Pre-existing, unchanged.
- **A tuning UI inside the game.** The editor is where maps are authored;
  a second surface would be a second source of truth.
- **Closing the Twisted Treeline seam.** Intentional.
