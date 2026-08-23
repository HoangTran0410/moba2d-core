/**
 * Everything a content pack may import as a type.
 *
 * Types and values leave core by different doors, and the reason is what a
 * pack becomes: its own package, compiled against core's `.d.ts` and handed
 * core's runtime objects. A type-only import survives that intact — it is
 * erased before anything runs, so it creates no second copy of a class and no
 * `instanceof` that answers wrong. A *value* import would create exactly
 * those, which is why `ContentApi` exists and why nothing here is a value.
 *
 * So: `import type { CastContext } from '@/content/types'` is correct and
 * always will be; `import { Slow } from '@/game/gameObject/buffs/Slow'` is
 * not, and the `pack-core-boundary` seam fails the pack's own build over it.
 */
export type {
  ActivationPattern,
  ActiveSpec,
  AttackOrderPolicy,
  CancelReason,
  CastContext,
  CastSpec,
  ChannelSpec,
  ChargeActivation,
  ChargeCastSpec,
  ChargeSpec,
  CooldownPolicy,
  CooldownStartPoint,
  InterruptPolicy,
  ResourceCommitPoint,
  ResourcePolicy,
  SpellRuntimeState,
  TargetingMode,
  Vec2,
} from '@/game/spell/runtime/types';

/**
 * More type-only gaps, found the same way the rest of this barrel was:
 * measured against what the spell tree actually imports, not guessed —
 * first by reading the import surface directly, then by the compiler itself
 * once packs/riot/spells/ was real (each remaining `Cannot find name` under
 * `tsc -p tsconfig.strict-core.json` named one more). `ContentApi`-surface
 * checks (now `coreSpellsApiSurface.test.ts`) only ever asserted VALUE
 * coverage — its own doc comment says type-only imports are skipped, on
 * purpose, because a type is erased and has no runtime object to be
 * "reachable" through — so none of these ever had to justify themselves
 * against that scan. They still needed a home once packs/riot/spells/ could
 * no longer reach into core directly at all: `BasicAttackHit` is the
 * `ON_ATTACK_HIT` payload shape (15 files, all read-only);
 * `BasicAttackController` names the field a bot reads off
 * `this.owner.basicAttack` (one skillshot, purely as a cast target, never
 * constructed); `GameObjectRuntimeContext` is a lantern-throw ability's helper's `game`
 * parameter type; `KillCredit` is a clone spell's clone declaring how a kill on it
 * should be scored; `TargetingRequest` is the shape every `UNIT`-targeting
 * spell's `targetingRequest` field returns (20 files); the rest
 * (`ExecuteFallback`/`ExecuteSpell`, `DynamicWall`, `BeamGeometry`,
 * `WallContact`, `AssetHandle`) are one or two spells each, named in the
 * commit that added them rather than repeated here.
 */
export type { BasicAttackHit } from '@/game/combat/BasicAttack';
export type { default as BasicAttackController } from '@/game/combat/BasicAttackController';
export type { GameObjectRuntimeContext } from '@/game/gameObject/GameObject';
export type { KillCredit } from '@/game/combat/MatchTally';
export type { TargetingRequest } from '@/game/spell/targeting/TargetResolver';
export type { ExecuteFallback, ExecuteSpell } from '@/game/combat/ExecuteTargeting';
export type { DynamicWall } from '@/game/gameObject/map/DynamicTerrain';
export type { BeamGeometry } from '@/game/gameObject/spellObjects/BeamSpellObject';
export type { WallContact } from '@/game/gameObject/map/TerrainField';
export type { AssetHandle } from '@/managers/AssetManager';

/**
 * Two more type-only gaps, added for Task 4 of the pack/SDK split —
 * contract vocabulary rather than spell vocabulary, which is why they land
 * here and not in `src/testing`. `MatchRules` is what a synthetic
 * match-rules object (built to exercise a rules variant without starting a
 * real match) gets typed as; `GameObject` is the base class type this
 * module has, until now, only re-exported the runtime-context shape of
 * (`GameObjectRuntimeContext`, above) — code holding a plain array of game
 * objects has had no published element type to name it with.
 */
export type { MatchRules } from '@/game/config/PregameConfig';
export type { default as GameObject } from '@/game/gameObject/GameObject';

export type { ContentApi } from './ContentApi';
export type {
  ChampionAttack,
  ChampionEntry,
  ContentPack,
  ContentPackCode,
  ContentPackData,
  ContentPackFactory,
  Faction,
  LaneDefinition,
  MapDefinition,
  MapGeometry,
  MapGeometryLoader,
  MapGeometrySource,
  MapSummary,
  MinionSlot,
  MonsterAbility,
  MonsterDef,
  NeutralSlot,
  PackManifest,
  SpawnSlot,
  SpellClass,
  SpellDisplayData,
  SpellLoader,
  SpellSource,
  StructureKind,
  StructureSlot,
} from './ContentPack';
