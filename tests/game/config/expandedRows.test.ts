import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/seams/importScan';
import { expandedRosterRows, resetExpandedRosterRows } from '@/game/hud/config/expandedRows';

/**
 * Which roster drawers are open, held **outside** the component.
 *
 * `<script setup>` *is* the setup function, so `const expanded = ref(new Set())`
 * at its top level looks like module scope and is not — it is rebuilt on every
 * mount, and both HUD views mount the panel with `v-if`. So every drawer
 * closed itself every time the panel did, and the roster is a list a player
 * opens *in order to* do something: open Bot 2, read its stats, go and change
 * something, come back to a collapsed list and find Bot 2 again.
 *
 * The shop is what made it acute rather than merely annoying. Pressing Cửa
 * hàng closes the panel by design — it holds the match paused, and a purchase
 * is a mutation with nothing ticking to settle it — so shopping for three bots
 * meant re-expanding three rows three times.
 *
 * `panelTab.ts` is the existing precedent, one file over, for exactly this and
 * for exactly this reason.
 *
 * Comments are stripped before matching, or this test flags the paragraph you
 * are reading.
 */

const roster = () =>
  stripComments(readFileSync(join(process.cwd(), 'src/game/hud/config/RosterTab.vue'), 'utf8'));

describe('the roster’s open drawers', () => {
  it('live in a module, so they outlive the component', () => {
    resetExpandedRosterRows();
    expect(expandedRosterRows.value.size).toBe(0);

    expandedRosterRows.value = new Set(['bot-2']);

    // A second read is the same module state — which is the whole point, and
    // is what a `<script setup>` ref cannot do.
    expect(expandedRosterRows.value.has('bot-2')).toBe(true);
    resetExpandedRosterRows();
  });

  it('are not re-declared inside the component', () => {
    // The failure this file exists for, and the one a behaviour test cannot
    // see: a component that keeps its own copy compiles, renders, and forgets.
    const source = roster();
    expect(source, 'RosterTab declares its own expansion state').not.toMatch(
      /const\s+expanded\s*=\s*ref\(/
    );
    expect(source).toMatch(/from ['"].*expandedRows['"]/);
  });

  it('are keyed by row id, not by position', () => {
    // Removing Bot 1 shifts every row below it, and an index-keyed drawer
    // would jump to a different participant instead of closing.
    expect(roster()).toMatch(/expandedRosterRows\.value\.has\(row\.id\)/);
  });
});
