import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validatePack } from '@/content/validate';
import { MONSTER_ATTACK_STYLES, MONSTER_TEMPERAMENTS } from '@/content/ContentPack';

/**
 * Every field the editor's config panel offers is a field core actually reads.
 *
 * The editor is plain browser JavaScript with no build and no types, so
 * nothing compares its schema to `MapTuning` — and the failure if they drift
 * is the worst kind available here: an author types a number into a box, the
 * map saves, core's validator sees a key it does not know, and the map is
 * **refused at install** with a console line nobody reads. Or worse, for a
 * local map: it silently never appears in the picker.
 *
 * So this reads the panel's own `TUNING_SCHEMA` out of `ui.js`, builds a map
 * that sets every single field it offers, and puts that through the real
 * validator. A field the editor invented fails here, named, in milliseconds.
 *
 * The reverse direction is deliberately *not* asserted. Core may hold a knob
 * the panel does not expose yet — that is a panel with a smaller surface, not
 * a broken one.
 */

const UI = readFileSync(
  resolve(__dirname, '../../public/map-editor/js/ui.js'),
  'utf8'
);

/** `{ group: [field paths] }`, read out of the editor's own schema literal. */
function editorSchema(): Record<string, string[]> {
  const start = UI.indexOf('const TUNING_SCHEMA = [');
  expect(start, 'TUNING_SCHEMA is gone from ui.js — this test proves nothing').toBeGreaterThan(-1);
  const end = UI.indexOf('\n  ];', start);
  const block = UI.slice(start, end);

  const groups: Record<string, string[]> = {};
  // Group headers are the entries that carry a `label`; a field entry never
  // does. Splitting on that is what keeps a field id from being read as a
  // group id when both are written `key: "..."`.
  const chunks = block.split(/\n    \{\n      key: "/).slice(1);
  for (const chunk of chunks) {
    const name = chunk.slice(0, chunk.indexOf('"'));
    const fields = [...chunk.matchAll(/\{ key: "([a-zA-Z.]+)"/g)].map(match => match[1]);
    groups[name] = fields;
  }
  return groups;
}

/**
 * `{ slotType: { statKey: a plausible value } }`, read out of `PROP_FIELDS`.
 *
 * Only the `stats.` half: `faction`, `lane` and `r` are slot fields core reads
 * by name and are already exercised by every fixture in this file. The value
 * comes from the field's own `kind`, because a `list` field written as `1` and
 * a number field written as `[]` would both fail for the wrong reason.
 */
function slotSchema(): Record<string, Record<string, unknown>> {
  const start = UI.indexOf('const PROP_FIELDS = {');
  expect(start, 'PROP_FIELDS is gone from ui.js — this test proves nothing').toBeGreaterThan(-1);
  const block = UI.slice(start, UI.indexOf('\n  };', start));

  const out: Record<string, Record<string, unknown>> = {};
  const types = block.split(/\n    ([a-z]+): \[/).slice(1);
  for (let i = 0; i < types.length; i += 2) {
    const stats: Record<string, unknown> = {};
    for (const match of types[i + 1].matchAll(/\{[^{}]*key: "stats\.([A-Za-z]+)"[^{}]*\}/g)) {
      // `melee` is a type id core's own roster always holds, so a composition
      // naming it passes on a map that declares no roster of its own.
      stats[match[1]] = /kind: "list"/.test(match[0])
        ? ['melee']
        : /kind: "choice"/.test(match[0])
          ? optionOf(match[0])
          : 1;
    }
    out[types[i]] = stats;
  }
  return out;
}

/** The first non-empty option of a `choice` field — any of them must validate. */
function optionOf(field: string): string {
  const options = [...field.matchAll(/"([a-z]+)"/g)].map(match => match[1]);
  return options[options.length - 1];
}

/** Writes `obj.a.b.c = value`, building the objects on the way down. */
function setDeep(root: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop() as string;
  let node = root;
  for (const key of keys) {
    if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[last] = value;
}

const mapWithTuning = (tuning: unknown) => ({
  manifest: { id: 'p', version: '1.0.0', coreRange: '*' },
  maps: [
    {
      id: 'm',
      name: 'M',
      size: 1_000,
      factions: [{ id: 'blue' }, { id: 'red' }],
      tuning,
      geometry: {
        terrain: { wall: [], bush: [], water: [] },
        slots: { spawn: [], minion: [], structure: [], neutral: [] },
      },
    },
  ],
});

describe('the map editor\'s config panel', () => {
  it('offers groups, and enough of them to be worth checking', () => {
    const schema = editorSchema();
    const names = Object.keys(schema);
    expect(names.length).toBeGreaterThanOrEqual(7);
    expect(names).toContain('economy');
    expect(names).toContain('terrain');
    for (const [group, fields] of Object.entries(schema)) {
      expect(fields.length, `${group} offers no fields`).toBeGreaterThan(0);
    }
  });

  it('offers only fields core will accept', () => {
    const schema = editorSchema();
    const tuning: Record<string, unknown> = {};
    for (const [group, fields] of Object.entries(schema)) {
      for (const field of fields) setDeep(tuning, `${group}.${field}`, 1);
    }

    const result = validatePack(mapWithTuning(tuning));

    // Named rather than a bare boolean: the validator's own message says which
    // key it did not recognise, which is the whole value of failing here.
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it('offers a neutral slot only the vocabularies core can read back', () => {
    /*
     * The slot inspector's two `choice` fields are the same drift risk as the
     * global schema above, one layer down: they write a *string* straight into
     * `slot.stats`, and a value core does not know is a map refused at install
     * (`checkMonsterSlotStats`). Read out of `ui.js` so adding a fourth
     * temperament in core without adding it to the panel — or the reverse —
     * shows up here rather than in somebody's console.
     */
    const options = (key: string): string[] => {
      const at = UI.indexOf(`key: "${key}", label:`);
      expect(at, `${key} is gone from the slot inspector`).toBeGreaterThan(-1);
      const list = UI.indexOf('options:', at);
      const line = UI.slice(list, UI.indexOf(']', list));
      return [...line.matchAll(/"([a-z]*)"/g)]
        .map(match => match[1])
        .filter(value => value !== '');
    };

    expect(options('stats.attackStyle')).toEqual([...MONSTER_ATTACK_STYLES]);
    expect(options('stats.temperament')).toEqual([...MONSTER_TEMPERAMENTS]);
  });

  /**
   * The same check, one panel over.
   *
   * `PROP_FIELDS` is the **slot** inspector — "ghi đè chỉ số cho trụ này" — and
   * it had no guard at all: every `stats.*` key it offers is written straight
   * into a slot, and a name core does not read is the identical silent refusal
   * the global schema's test exists for. The neutral case above checks two
   * *values*; this checks every key on every slot type.
   */
  it('offers only per-slot overrides core will accept', () => {
    const slots = slotSchema();
    expect(Object.keys(slots).length, 'no slot types found in PROP_FIELDS').toBeGreaterThanOrEqual(
      4
    );

    const geometry = {
      terrain: { wall: [], bush: [], water: [] },
      slots: {
        spawn: [{ faction: 'blue', x: 1, y: 1, r: 150, stats: slots.spawn }],
        minion: [{ faction: 'blue', lane: 'MID', x: 1, y: 1, stats: slots.minion }],
        structure: [{ faction: 'blue', kind: 'turret', x: 1, y: 1, stats: slots.structure }],
        neutral: [{ role: 'warden', x: 1, y: 1, r: 150, stats: slots.neutral }],
      },
    };

    const result = validatePack({
      manifest: { id: 'p', version: '1.0.0', coreRange: '*' },
      maps: [
        {
          id: 'm',
          name: 'M',
          size: 1_000,
          factions: [{ id: 'blue' }, { id: 'red' }],
          geometry,
        },
      ],
    });

    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it('and would fail loudly if it offered one core does not know', () => {
    // The falsification. Without it, a schema reader that silently returned
    // nothing would make the case above pass for ever.
    const result = validatePack(mapWithTuning({ turrets: { attackRnage: 1 } }));
    expect(result.ok).toBe(false);
  });
});
