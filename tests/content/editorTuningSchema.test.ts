import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validatePack } from '@/content/validate';

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

  it('and would fail loudly if it offered one core does not know', () => {
    // The falsification. Without it, a schema reader that silently returned
    // nothing would make the case above pass for ever.
    const result = validatePack(mapWithTuning({ turrets: { attackRnage: 1 } }));
    expect(result.ok).toBe(false);
  });
});
