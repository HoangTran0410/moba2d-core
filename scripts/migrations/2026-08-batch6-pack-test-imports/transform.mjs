// Task 5 of content-pack-extraction batch 6: rewrite tests/packs/riot/**/*.ts
// so its only non-relative imports are vitest, node:*,
// @moba2d/core/content/types, @moba2d/core/testing, @moba2d/core/testing/spell,
// and every relative import resolves inside packs/riot/ or tests/packs/riot/.
//
// Run with:
//   node scripts/migrations/2026-08-batch6-pack-test-imports/transform.mjs         (dry run, prints a summary)
//   node scripts/migrations/2026-08-batch6-pack-test-imports/transform.mjs --write (rewrites files in place)
//
// What this script does NOT do, on purpose, left for hand-editing afterward
// (each is small and singular, and the report says so):
//   - tests/game/spell/registry (1 file, Janna_R.test.ts) — needs the pack's
//     own spell barrel passed in, which this script has no reliable way to
//     name generically.
//   - the Janna_R.test.ts CastTelegraph mock (1 file) — becomes
//     `buildTestApi({ vfx: { CastTelegraph: SpyTelegraph } })`, a structural
//     rewrite of how the spy is wired, not an import substitution.
//   - src/managers/AssetManager static-import call sites (3 files) — the
//     import is deleted and `AssetManager.get(` calls are rewritten to
//     `<apiVar>.asset(` automatically, but is worth a manual eyeball since it
//     is a textual, not scope-aware, substitution.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { SPEC_MAP } from './spec-map.mjs';

const ROOT = resolve(import.meta.dirname, '../../../');
const TEST_DIR = join(ROOT, 'tests/packs/riot');
const WRITE = process.argv.includes('--write');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Index just past the balanced-paren end of a call whose `(` is at `openIdx`. */
function findBalancedCallEnd(source, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i + 1;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i++;
        i++;
      }
    }
  }
  throw new Error('unbalanced vi.mock( call');
}

/** Deletes every `vi.mock('...token...', ...)` call, whole statement plus its trailing newline. */
function removeMockCalls(source, token) {
  let out = source;
  let searchFrom = 0;
  for (;;) {
    const callIdx = out.indexOf('vi.mock(', searchFrom);
    if (callIdx === -1) return out;
    const openParen = callIdx + 'vi.mock'.length;
    const endParen = findBalancedCallEnd(out, openParen);
    const callText = out.slice(callIdx, endParen);
    let stmtEnd = endParen;
    if (out[stmtEnd] === ';') stmtEnd++;
    if (callText.includes(token)) {
      while (out[stmtEnd] === '\n') stmtEnd++;
      out = out.slice(0, callIdx) + out.slice(stmtEnd);
      searchFrom = callIdx;
    } else {
      searchFrom = endParen;
    }
  }
}

function resolveSpecifier(fileDir, specifier) {
  const abs = resolve(fileDir, specifier);
  return relative(ROOT, abs).split('\\').join('/');
}

/** `{ A, type B }, C` (either order) -> { defaultName, named: [{name, isType}] } */
function parseClause(clause) {
  const braceMatch = /\{([\s\S]*)\}/.exec(clause);
  let defaultName = null;
  let named = [];
  if (braceMatch) {
    const before = clause.slice(0, clause.indexOf('{')).replace(/,\s*$/, '').trim();
    if (before) defaultName = before;
    named = braceMatch[1]
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => {
        const isType = /^type\s+/.test(s);
        return { name: s.replace(/^type\s+/, ''), isType };
      });
  } else if (clause.trim()) {
    defaultName = clause.trim();
  }
  return { defaultName, named };
}

/**
 * Whether `name` appears in TYPE position anywhere in `source` (outside the
 * import statement itself) — `: Name`, `Name[]`, `<Name>`/`<Name,`/`, Name>`,
 * a union member (`Name |` / `| Name`), or `as Name`. Heuristic, not a parser
 * (no `: Name` false-positives expected from object-literal keys, since a
 * key is followed by a value expression, not a bare identifier at a type
 * boundary) — good enough to decide whether a REACHABLE class import needs
 * the `InstanceType<typeof ...>` alias alongside its value destructure; a
 * false positive costs one unused type alias (harmless, this tree carries no
 * `noUnusedLocals` program today), a false negative costs a real
 * `Cannot find name` the moment this tree is ever strict-typechecked — so
 * this leans toward over-detecting.
 */
function usedAsType(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`:\\s*${escaped}\\b(?!\\s*[.(])`), // `: Name`, not `: Name.x` or `: Name(`
    new RegExp(`\\b${escaped}\\[\\]`),
    new RegExp(`<${escaped}[,>]`),
    new RegExp(`,\\s*${escaped}>`),
    new RegExp(`\\b${escaped}\\s*\\|`),
    new RegExp(`\\|\\s*${escaped}\\b`),
    new RegExp(`\\bas\\s+${escaped}\\b`),
  ];
  return patterns.some(re => re.test(source));
}

const GENERIC = () =>
  /\b(?:import|export)\b\s+(type\s+)?((?:(?!\b(?:import|export)\b)[\s\S])*?)\bfrom\s+(['"])([^'"]+)\3;?\n?/g;

function transformFile(source, fileDir, relPath) {
  const notes = [];
  let manual = false;
  const originalSource = source;

  source = removeMockCalls(source, 'AssetManager');
  source = removeMockCalls(source, 'CastTelegraph');

  const need = {
    units: new Set(),
    buffs: new Set(),
    enums: new Set(),
    vfx: new Set(),
    terrain: new Set(),
    combat: new Set(),
    executeTargeting: new Set(),
    quadtreeRectangle: false,
    top: new Set(),
    testingDirect: new Set(), // name[] straight off @moba2d/core/testing (Stats family)
    typeAliases: new Set(),
  };
  let usesContentApi = false;
  let apiVarName = null;
  let usesAssetManagerDefault = false;
  let insertionSpot = -1;

  for (;;) {
    const re = GENERIC();
    let m;
    let matched = null;
    while ((m = re.exec(source))) {
      const specifier = m[4];
      if (!specifier.startsWith('.')) continue;
      const resolved = resolveSpecifier(fileDir, specifier);
      if (Object.prototype.hasOwnProperty.call(SPEC_MAP, resolved)) {
        matched = { m, resolved, specifier };
        break;
      }
    }
    if (!matched) break;
    const { m: mm, resolved, specifier } = matched;
    const wholeStatementType = Boolean(mm[1]);
    const clause = mm[2];
    const start = mm.index;
    const end = start + mm[0].length;
    const descriptor = SPEC_MAP[resolved];

    const dropStatement = () => {
      if (insertionSpot === -1) insertionSpot = start;
      source = source.slice(0, start) + source.slice(end);
    };
    const retarget = target => {
      const quote = mm[3];
      const newStatement = mm[0].replace(`${quote}${specifier}${quote}`, `'${target}'`);
      source = source.slice(0, start) + newStatement + source.slice(end);
    };

    if (resolved === 'src/content/ContentApi') {
      usesContentApi = true;
      const { defaultName, named } = parseClause(clause);
      // Every file in this tree does `import { buildContentApi } from ...`.
      if (named.length !== 1 || named[0].name !== 'buildContentApi' || defaultName) {
        notes.push(`unexpected ContentApi import shape: ${mm[0].slice(0, 80)}`);
      }
      dropStatement();
      continue;
    }

    if (resolved === 'src/managers/AssetManager') {
      usesAssetManagerDefault = true;
      dropStatement();
      continue;
    }

    if (descriptor.kind === 'registry') {
      notes.push('MANUAL: tests/game/spell/registry — left in place for hand rewrite');
      manual = true;
      break;
    }

    if (
      descriptor.kind === 'fixture-spell' ||
      descriptor.kind === 'fixture-general' ||
      descriptor.kind === 'types-passthrough'
    ) {
      retarget(
        descriptor.kind === 'fixture-spell'
          ? '@moba2d/core/testing/spell'
          : descriptor.kind === 'fixture-general'
            ? '@moba2d/core/testing'
            : '@moba2d/core/content/types'
      );
      continue;
    }

    if (descriptor.kind === 'testing-passthrough') {
      // The testing barrel has no default export — every one of these is a
      // named re-export (`export { default as EventManager } from ...`), so
      // a bare `import X from '<old path>'` has to become `import { X }`,
      // not keep its default form. A named clause (`{ HotKeys, ... }`) is
      // already the right shape and is left untouched by retarget().
      const { defaultName, named } = parseClause(clause);
      if (defaultName && named.length === 0) {
        const quote = mm[3];
        const newStatement = mm[0]
          .replace(`${quote}${specifier}${quote}`, `'@moba2d/core/testing'`)
          .replace(defaultName, `{ ${defaultName} }`);
        source = source.slice(0, start) + newStatement + source.slice(end);
      } else {
        retarget('@moba2d/core/testing');
      }
      continue;
    }

    if (descriptor.kind === 'mixed') {
      const { defaultName, named } = parseClause(clause);
      const bindingNames = defaultName ? [defaultName] : named.map(n => n.name);
      for (const raw of bindingNames) {
        const key = defaultName === raw ? 'default' : raw;
        const sub = descriptor.bindings[key];
        if (!sub) {
          notes.push(`unhandled Stats binding "${raw}"`);
          continue;
        }
        if (sub.kind === 'api-namespaced') need[sub.ns].add(raw);
        else if (sub.kind === 'testing-passthrough') need.testingDirect.add(sub.renameTo ?? raw);
      }
      dropStatement();
      continue;
    }

    // api-namespaced / api-top / api-nested
    const { defaultName, named } = parseClause(clause);
    const names = [];
    if (defaultName) names.push({ name: defaultName, isType: wholeStatementType });
    for (const n of named) names.push(n);

    for (const { name, isType } of names) {
      // A pure type-only reference (`import type X from '...'`, or `{ type X }`)
      // is erased at runtime and must NOT also get a value destructure — the
      // whole reason it was `import type` is that the file never constructs
      // one. Only the InstanceType alias is added for those.
      if (isType && descriptor.typeCapable) {
        need.typeAliases.add(
          descriptor.kind === 'api-nested' && descriptor.path[1] === 'Quadtree' ? 'Rectangle' : name
        );
        continue;
      }
      if (isType && !descriptor.typeCapable) {
        notes.push(`type-only import of non-type-capable "${name}" — check by hand`);
        continue;
      }
      if (descriptor.kind === 'api-namespaced') {
        need[descriptor.ns].add(name);
      } else if (descriptor.kind === 'api-top') {
        need.top.add(name);
      } else if (descriptor.kind === 'api-nested') {
        if (descriptor.path[0] === 'combat' && descriptor.path[1] === 'ExecuteTargeting') {
          need.executeTargeting.add(name);
        } else if (descriptor.path[0] === 'utils' && descriptor.path[1] === 'Quadtree') {
          need.quadtreeRectangle = true;
        }
      }
    }
    dropStatement();
  }

  // A value-imported AttackableUnit/Spell/Rectangle may ALSO be used in type
  // position elsewhere in the file body (idiomatic TS: a class import serves
  // both roles automatically, which a destructured const does not) — see
  // usedAsType's own doc comment. Checked against the untouched original text
  // so the import statement's own now-deleted text can never itself trip a
  // pattern.
  if (need.units.has('AttackableUnit') && usedAsType(originalSource, 'AttackableUnit')) {
    need.typeAliases.add('AttackableUnit');
  }
  if (need.top.has('Spell') && usedAsType(originalSource, 'Spell')) {
    need.typeAliases.add('Spell');
  }
  if (need.quadtreeRectangle && usedAsType(originalSource, 'Rectangle')) {
    need.typeAliases.add('Rectangle');
  }

  return {
    source,
    notes,
    manual,
    need,
    usesContentApi,
    usesAssetManagerDefault,
    insertionSpot,
  };
}

/** Builds the destructure/type-alias block that replaces the removed imports. */
function buildInsertion(need, apiVar) {
  const lines = [];
  const destructure = (set, path) => {
    if (set.size === 0) return;
    lines.push(`const { ${[...set].join(', ')} } = ${apiVar}${path};`);
  };
  destructure(need.units, '.units');
  destructure(need.buffs, '.buffs');
  destructure(need.enums, '.enums');
  destructure(need.vfx, '.vfx');
  destructure(need.terrain, '.terrain');
  destructure(need.combat, '.combat');
  destructure(need.executeTargeting, '.combat.ExecuteTargeting');
  if (need.quadtreeRectangle) lines.push(`const { Rectangle } = ${apiVar}.utils.Quadtree;`);
  destructure(need.top, '');
  for (const name of need.typeAliases) {
    if (name === 'AttackableUnit') {
      lines.push(`type AttackableUnit = InstanceType<typeof ${apiVar}.units.AttackableUnit>;`);
    } else if (name === 'Spell') {
      lines.push(`type Spell = InstanceType<typeof ${apiVar}.Spell>;`);
    } else if (name === 'Rectangle') {
      lines.push(`type Rectangle = InstanceType<typeof ${apiVar}.utils.Quadtree.Rectangle>;`);
    }
  }
  return lines;
}

function main() {
  const files = walk(TEST_DIR).sort();
  let changed = 0;
  const manualFiles = [];
  const allNotes = [];

  for (const file of files) {
    const rel = relative(ROOT, file);
    const original = readFileSync(file, 'utf8');
    const fileDir = dirname(file);

    const result = transformFile(original, fileDir, rel);
    if (result.manual) {
      manualFiles.push(rel);
      continue;
    }
    if (result.notes.length) {
      for (const n of result.notes) allNotes.push(`${rel}: ${n}`);
    }

    let { source } = result;
    const apiVarExisting = /\bconst\s+(__api|api)\s*=\s*buildContentApi\(\)/.exec(original);
    const apiVar = apiVarExisting ? apiVarExisting[1] : '__api';

    if (result.usesContentApi) {
      source = source.replace(/\bbuildContentApi\(\)/g, 'buildTestApi()');
    }

    // AssetManager.get( -> <apiVar>.asset(
    if (result.usesAssetManagerDefault) {
      const before = source;
      source = source.replace(/\bAssetManager\.get\(/g, `${apiVar}.asset(`);
      if (source === before) {
        allNotes.push(
          `${rel}: AssetManager imported but AssetManager.get( never called — import dropped with no replacement`
        );
      }
    }

    const need = result.need;
    const apiGroupsNeeded =
      need.units.size ||
      need.buffs.size ||
      need.enums.size ||
      need.vfx.size ||
      need.terrain.size ||
      need.combat.size ||
      need.executeTargeting.size ||
      need.quadtreeRectangle ||
      need.top.size;
    // A file with no `buildContentApi()` in scope that still needs api-group
    // vocabulary (only attackProfiles.test.ts, of the 69) gets its own fresh
    // `const __api = buildTestApi();` — brief Step 4's explicit instruction
    // for "the 5 files with no __api in scope".
    const needsFreshApiConst = apiGroupsNeeded && !result.usesContentApi;

    // One '@moba2d/core/testing' import line carries buildTestApi (if this
    // file's own buildContentApi import was removed) and the Stats-family
    // direct re-exports together, rather than two separate import
    // statements for the same specifier.
    const testingBarrelNames = [];
    if (result.usesContentApi || needsFreshApiConst) testingBarrelNames.push('buildTestApi');
    testingBarrelNames.push(...need.testingDirect);

    const importLines = [];
    if (testingBarrelNames.length > 0) {
      importLines.push(`import { ${testingBarrelNames.join(', ')} } from '@moba2d/core/testing';`);
    }
    const constLines = [];
    if (needsFreshApiConst) constLines.push(`const ${apiVar} = buildTestApi();`);
    constLines.push(...buildInsertion(need, apiVar));

    if (needsFreshApiConst) {
      // Nothing pre-existing to anchor after — write the import and every
      // const/type line together, in one splice, at the earliest removed
      // import's old position (or the top of the file, if nothing was
      // removed there at all).
      const block = [...importLines, ...constLines].join('\n');
      if (block.length > 0) {
        const spot = result.insertionSpot === -1 ? 0 : result.insertionSpot;
        source = source.slice(0, spot) + block + '\n' + source.slice(spot);
      }
    } else {
      // The file already has its own `const <apiVar> = buildTestApi();`
      // (renamed from buildContentApi above). The import line can float
      // anywhere, but a destructure reading `<apiVar>.units`/etc. must come
      // AFTER that declaration, never at the position of the earliest
      // *removed* import — which usually sits well before it in the file.
      if (importLines.length > 0) {
        const spot = result.insertionSpot === -1 ? 0 : result.insertionSpot;
        source = source.slice(0, spot) + importLines.join('\n') + '\n' + source.slice(spot);
      }
      if (constLines.length > 0) {
        const declRe = new RegExp(`const\\s+${apiVar}\\s*=\\s*buildTestApi\\(\\);?\\n?`);
        const declMatch = declRe.exec(source);
        if (!declMatch) {
          allNotes.push(
            `${rel}: needed api bindings but no "const ${apiVar} = buildTestApi();" found to anchor after`
          );
        } else {
          const at = declMatch.index + declMatch[0].length;
          source = source.slice(0, at) + constLines.join('\n') + '\n' + source.slice(at);
        }
      }
    }

    if (source !== original) {
      changed++;
      if (WRITE) writeFileSync(file, source);
    }
  }

  console.log(`files scanned: ${files.length}`);
  console.log(`files changed: ${changed}`);
  console.log(`manual (skipped): ${manualFiles.length}`);
  for (const f of manualFiles) console.log('  ' + f);
  console.log(`notes: ${allNotes.length}`);
  for (const n of allNotes) console.log('  ' + n);
  console.log(WRITE ? '\n--write applied' : '\ndry run only — pass --write to apply');
}

main();
