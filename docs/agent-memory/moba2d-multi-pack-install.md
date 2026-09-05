---
name: moba2d-multi-pack-install
description: Linking three content packs at once broke install and bare spell ids — the index-0 core-spell fold and BUNDLED_PACK_ID
metadata:
  type: project
---

Fixed 2026-09-02 in core `4a46165` (unpushed). Two symptoms, one cause:
`src/generated/installedPacks.ts` **sorts by package name**, so with `dota`,
`lol` and `naruto` linked together `dota` is index 0 — and the header of that
generated file had already warned the ordering "stops being theoretical the
moment a third pack exists".

1. **Install rejected.** `install.ts` folded core's `BasicAttack`/`Recall`
   onto `index === 0` only, while `PackRegistry.writeData` qualifies a bare id
   against *the pack that declared it*. So `lol:BasicAttack` resolved to
   nothing and the 67-champion pack failed to install. `installRuntimePack`
   already folded unconditionally — the same pack over the network worked,
   bundled at index 1 did not. Fix: fold onto every pack.
2. **Bare ids went to the wrong pack, silently.** `qualifySpellId` used
   `BUNDLED_PACK_ID`. `PregameConfig`'s summoner defaults are bare *today*
   (`summonerD: 'Flash'`), and only lol ships Flash/Ghost/Heal/Ignite/
   StealthWard — so every `'Flash'` became `dota:Flash`. Nothing threw; the
   slot came back empty. Now: the first installed pack **that declares it**,
   with `BUNDLED_PACK_ID` kept as the fallback.

Traps this exposed:
- Core's own suite **only passes unlinked** (`npm run verify` refuses while
  linked). With 3 packs linked ~11 tests go red on pack counts and install
  order — expected, not bugs. Always `npm run pack:unlink -- --all` before a
  core commit, relink after.
- `tests/content/install.test.ts` imports `packs/riot`, so it is pack-dependent
  and never runs in core's own CI. That is why this shipped.
  `tests/content/installMultiPack.test.ts` imports no pack and is the durable
  check.
- Core forbids naming a pack's champions **in comments**
  (`vocabularyBoundary.test.ts`) — writing "Garen's W" in `src/testing/`
  failed verify.

- **Running `npx`/`npm` from inside a linked pack's own directory silently
  unlinks every pack.** Hit on 2026-09-02: a couple of `npx vitest` /
  `npx tsc` runs with the cwd at `../lol` pruned
  `moba2d-core/node_modules/@moba2d/` back to the workspace's own
  `content-reference`, and the first sign of it was `links:check` suddenly
  passing and `chunks:check` going green. Nothing warns. Relink with
  `npm run pack:link -- ../dota ../lol ../naruto` from the core checkout, and
  check `ls node_modules/@moba2d/` rather than trusting the test result.

See [[moba2d-bot-scoring-and-tempo]], [[moba2d-workspace-layout]].
