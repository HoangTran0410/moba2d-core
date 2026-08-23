// The 55-specifier mapping table this migration's transform script drives
// off, built from `docs/superpowers/surveys/2026-08-23-pack-test-api-mapping.md`
// (measured against the pre-batch-6 tree) and cross-checked against
// `src/content/ContentApi.ts` and `src/testing/{world,api,engine,spellRegistry,index}.ts`
// as they stand after Tasks 1-4.
//
// `kind`:
//   'content-api'    — `buildContentApi` from `src/content/ContentApi` itself;
//                       becomes `buildTestApi` from `@moba2d/core/testing`.
//   'api-namespaced' — reachable off `__api.<ns>.<Name>`; `ns` names the namespace.
//   'api-top'        — reachable directly off `__api.<Name>`.
//   'api-nested'     — reachable off `__api.<path.join('.')>.<Name>`.
//   'testing-passthrough' — retarget the specifier straight to
//                       `@moba2d/core/testing`, keep the import clause byte-for-byte.
//   'types-passthrough'   — same, but to `@moba2d/core/content/types`.
//   'fixture-spell'  — retarget to `@moba2d/core/testing/spell`, keep clause.
//   'fixture-general'— retarget to `@moba2d/core/testing`, keep clause.
//   'registry'       — `tests/game/spell/registry`; handled by hand (one file).
//   'asset-manager-mock-only' — the 48 `vi.mock()`-only population; no static import left once mocks are gone.
//
// `typeCapable: true` marks the three specifiers (`AttackableUnit`, `Spell`,
// `Rectangle`) the survey found used in type position from a *value* import
// in some files — the only names that may need a local
// `type X = InstanceType<typeof __api...X>` alias alongside the destructure.
export const SPEC_MAP = {
  'src/content/ContentApi': { kind: 'content-api' },

  'src/game/gameObject/attackableUnits/AttackableUnit': {
    kind: 'api-namespaced',
    ns: 'units',
    typeCapable: true,
  },
  'src/game/gameObject/attackableUnits/Champion': { kind: 'api-namespaced', ns: 'units' },
  'src/game/gameObject/attackableUnits/Monster': { kind: 'api-namespaced', ns: 'units' },

  'src/game/gameObject/buffs/Dash': { kind: 'api-namespaced', ns: 'buffs' },
  'src/game/gameObject/buffs/Slow': { kind: 'api-namespaced', ns: 'buffs' },
  'src/game/gameObject/buffs/Stun': { kind: 'api-namespaced', ns: 'buffs' },
  'src/game/gameObject/buffs/Shield': { kind: 'api-namespaced', ns: 'buffs' },
  'src/game/gameObject/buffs/StatAmp': { kind: 'api-namespaced', ns: 'buffs' },
  'src/game/gameObject/buffs/Speedup': { kind: 'api-namespaced', ns: 'buffs' },
  'src/game/gameObject/buffs/Airborne': { kind: 'api-namespaced', ns: 'buffs' },
  'src/game/gameObject/buffs/Root': { kind: 'api-namespaced', ns: 'buffs' },
  'src/game/gameObject/buffs/Silence': { kind: 'api-namespaced', ns: 'buffs' },
  'src/game/gameObject/buffs/Untargetable': { kind: 'api-namespaced', ns: 'buffs' },
  'src/game/gameObject/buffs/Chilled': { kind: 'api-namespaced', ns: 'buffs' },
  'src/game/gameObject/buffs/TrueSight': { kind: 'api-namespaced', ns: 'buffs' },
  'src/game/gameObject/buffs/Taunt': { kind: 'api-namespaced', ns: 'buffs' },
  'src/game/gameObject/buffs/DamageOverTime': { kind: 'api-namespaced', ns: 'buffs' },
  'src/game/gameObject/Buff': { kind: 'api-namespaced', ns: 'buffs' },

  'src/game/enums/EventType': { kind: 'api-namespaced', ns: 'enums' },
  'src/game/enums/StatusFlags': { kind: 'api-namespaced', ns: 'enums' },
  'src/game/enums/ActionState': { kind: 'api-namespaced', ns: 'enums' },

  'src/game/gameObject/spellObjects/HomingMissileSpellObject': { kind: 'api-top' },
  'src/game/gameObject/spellObjects/BeamSpellObject': { kind: 'api-top' },
  'src/game/gameObject/spellObjects/AreaSpellObject': { kind: 'api-top' },
  'src/game/gameObject/spellObjects/AoePulse': { kind: 'api-top' },
  'src/game/gameObject/SpellObject': { kind: 'api-top' },
  'src/game/gameObject/Spell': { kind: 'api-top', typeCapable: true },

  'src/game/spell/targeting/TargetResolver': { kind: 'api-namespaced', ns: 'combat' },
  'src/game/combat/ExecuteTargeting': { kind: 'api-nested', path: ['combat', 'ExecuteTargeting'] },

  'src/game/vfx/CastBar': { kind: 'api-namespaced', ns: 'vfx' },

  'src/game/gameObject/map/DynamicTerrain': { kind: 'api-namespaced', ns: 'terrain' },

  'src/libs/quadtree': { kind: 'api-nested', path: ['utils', 'Quadtree'], typeCapable: true },

  // Mixed: split by binding name, not by specifier — see transform.mjs.
  'src/game/gameObject/Stats': {
    kind: 'mixed',
    bindings: {
      MAX_UNIT_SIZE: { kind: 'api-namespaced', ns: 'units' },
      default: { kind: 'testing-passthrough', renameTo: 'Stats' },
      MAX_ATTACK_SPEED: { kind: 'testing-passthrough' },
    },
  },

  // AssetManager: the one REACHABLE static-import row (3 files, api.asset()).
  // The 48 vi.mock() calls are a *different* population, deleted in step 1
  // before this table is ever consulted for the remaining static imports.
  'src/managers/AssetManager': { kind: 'asset-call' },

  // Thirteen gaps Task 4 admitted, plus their siblings from the same modules.
  'src/game/combat/BasicAttack': { kind: 'testing-passthrough' },
  'src/game/enums/TeamId': { kind: 'testing-passthrough' },
  'src/game/lanes': { kind: 'testing-passthrough' },
  'src/content/PackRegistry': { kind: 'testing-passthrough' },
  'src/game/gameObject/attackableUnits/Minion': { kind: 'testing-passthrough' },
  'src/managers/EventManager': { kind: 'testing-passthrough' },
  'src/content/validate': { kind: 'testing-passthrough' },
  'src/game/gameObject/map/FogOfWar': { kind: 'testing-passthrough' },
  'src/game/preset': { kind: 'testing-passthrough' },
  'src/game/gameObject/coreSpells/BasicAttack': { kind: 'testing-passthrough' },
  'src/game/spell/input/SpellInputController': { kind: 'testing-passthrough' },
  'src/game/constants': { kind: 'testing-passthrough' },

  // Type-only, published at @moba2d/core/content/types.
  'src/game/spell/runtime/types': { kind: 'types-passthrough' },
  'src/content/ContentPack': { kind: 'types-passthrough' },
  'src/game/config/PregameConfig': { kind: 'types-passthrough' },
  'src/game/gameObject/GameObject': { kind: 'types-passthrough' },

  // Fixtures.
  'tests/game/fixtures': { kind: 'fixture-general' },
  'tests/game/spell/fixtures': { kind: 'fixture-spell' },
  'tests/game/spell/registry': { kind: 'registry' },
};
