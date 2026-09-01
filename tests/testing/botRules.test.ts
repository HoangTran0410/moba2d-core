/**
 * The rules `@moba2d/core/testing/bots` publishes to packs.
 *
 * Each one is checked twice: once against a spell with the shape it exists to
 * find, and once against a spell that does the same job correctly, because a
 * rule that fires on everything is not a rule. The stubs are deliberately the
 * real shapes from the sweep that produced this file — a costed `SELF` cast,
 * a `Summon`-only tag, and a self-cast ultimate — rather than invented ones.
 */
import { describe, expect, it } from 'vitest';
import { botRoleIssues, type BotRuleName } from '../../src/testing/botRules';
import { SpellRole, roles } from '../../src/game/ai/SpellRole';

/**
 * One spell class per stub, never a shared one: `rolesOf` caches the mask by
 * *constructor*, so two stubs sharing a class would share a verdict.
 */
const spellClass = (
  over: Partial<{ targeting: string; manaCost: number; range: number | undefined; aiRoles: number }>
) => {
  const cls = class {
    static aiRoles: number | undefined = over.aiRoles;
    manaCost = over.manaCost ?? 50;
    declaredRange: number | undefined = 'range' in over ? over.range : 450;
    castSpec = { targeting: over.targeting ?? 'DIRECTION' };
  };
  return cls;
};

const sweep = (spells: Record<string, unknown>, kit: string[]): BotRuleName[] =>
  botRoleIssues({ spells, champions: [{ id: 'stub', spells: kit }] }).map(issue => issue.rule);

/** A plain skillshot: what a healthy kit's Q looks like to the scorer. */
const OK_Q = spellClass({ targeting: 'DIRECTION', manaCost: 30, range: 450 });

describe('bot role rules', () => {
  it('flags a costed SELF cast that says nothing about itself', () => {
    const spells = { Q: OK_Q, W: spellClass({ targeting: 'SELF', manaCost: 60, range: undefined }) };
    expect(sweep(spells, ['Q', 'W', 'Q', 'Q'])).toContain('self-cast-untagged');
  });

  it('says nothing once that spell declares what it is', () => {
    const spells = {
      Q: OK_Q,
      W: spellClass({ targeting: 'SELF', manaCost: 60, range: undefined, aiRoles: SpellRole.Buff }),
    };
    expect(sweep(spells, ['Q', 'W', 'Q', 'Q'])).toEqual([]);
  });

  it('flags the panic-button shape by its score, not by its targeting', () => {
    // `Buff | Shield` is what `inferRoles` hands every costed SELF cast, and
    // it comes to exactly 0 in a fight against 20 while hurt. Declared here
    // by hand so the rule is shown catching the *mask*, not the tag's absence.
    const spells = {
      Q: OK_Q,
      W: spellClass({
        targeting: 'DIRECTION',
        manaCost: 60,
        aiRoles: roles(SpellRole.Buff, SpellRole.Shield),
      }),
    };
    const found = sweep(spells, ['Q', 'W', 'Q', 'Q']);
    expect(found).toContain('dead-in-combat');
    expect(found).not.toContain('self-cast-untagged');
  });

  it('flags a tag the scorer pays nothing for', () => {
    // The regression that produced this rule: hand-tagging an ability
    // `Summon` scored it *lower* than the inference it replaced, because
    // `scoreSpell` has no term for that flag at all.
    const spells = { Q: OK_Q, W: spellClass({ aiRoles: SpellRole.Summon }) };
    expect(sweep(spells, ['Q', 'W', 'Q', 'Q'])).toContain('unpaid-tag');
  });

  it('accepts the same tag once a paid role is beside it', () => {
    const spells = {
      Q: OK_Q,
      W: spellClass({ aiRoles: roles(SpellRole.Summon, SpellRole.Damage) }),
    };
    expect(sweep(spells, ['Q', 'W', 'Q', 'Q'])).toEqual([]);
  });

  it('flags an ultimate whose best moment is nearly dying', () => {
    const spells = {
      Q: OK_Q,
      R: spellClass({ targeting: 'SELF', manaCost: 100, range: undefined, aiRoles: roles(SpellRole.Buff, SpellRole.Shield) }),
    };
    const found = sweep(spells, ['Q', 'Q', 'Q', 'R']);
    expect(found).toContain('panic-ultimate');
  });

  it('leaves an ultimate that wants a fight alone', () => {
    const spells = {
      Q: OK_Q,
      R: spellClass({ targeting: 'SELF', manaCost: 100, range: undefined, aiRoles: roles(SpellRole.Buff, SpellRole.Burst) }),
    };
    expect(sweep(spells, ['Q', 'Q', 'Q', 'R'])).toEqual([]);
  });

  it('scores form abilities at the slots they occupy', () => {
    // A transform's own Q/W/E never appear in `champions[].spells` — they are
    // not choosable — so nothing else in a pack's build ever looks at them.
    const spells = { Q: OK_Q, F: spellClass({ targeting: 'SELF', manaCost: 40, range: undefined }) };
    const issues = botRoleIssues({
      spells,
      champions: [{ id: 'stub', spells: ['Q', 'Q', 'Q', 'Q'], formSpells: ['F', 'Q', 'Q'] }],
    });
    expect(issues.map(issue => issue.spellId)).toContain('F');
  });

  it('reports a key a pack can paste straight into `knownDebt`', () => {
    const spells = { Q: OK_Q, W: spellClass({ targeting: 'SELF', manaCost: 60, range: undefined }) };
    const issues = botRoleIssues({ spells, champions: [{ id: 'stub', spells: ['Q', 'W', 'Q', 'Q'] }] });
    expect(issues.map(issue => issue.key)).toContain('self-cast-untagged:W');
  });
});
