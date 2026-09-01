/**
 * Biến hình — a champion swapping part of its kit for another, and back.
 *
 * The engine had no such thing, and the seam that looked like it —
 * `Champion.replaceSpell`, present and until now uncalled — is the wrong one
 * twice over. It routes through `removeSpell`, which calls both
 * `deactivate()` and `onRemoved()`:
 *
 *   - `onRemoved()` deactivates every buff naming that spell as its
 *     `sourceSpell`, so a form that comes back comes back stripped.
 *   - `deactivate()` calls `resetCoolDown()`. Cast Q, transform, transform
 *     back, and Q is up again — a free-cooldown exploit, and the test below
 *     that would have caught it.
 *
 * A stance is a *toggle*, so both kits stay alive and the one out of
 * `spells[]` is merely dormant: `update()` and `drawVfx()` walk that array,
 * so nothing else is needed to freeze it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Spell from '../../../src/game/gameObject/Spell';
import Buff from '../../../src/game/gameObject/Buff';
import { SpellSlot } from '../../../src/game/constants';
import { createGame, stubGameGlobals } from '../fixtures';

class Named extends Spell {
  targetingMode = 'SELF' as const;
  coolDown = 1000;
}
class Attack extends Named {
  name = 'Attack';
}
class BaseQ extends Named {
  name = 'BaseQ';
}
class BaseW extends Named {
  name = 'BaseW';
}
class BaseE extends Named {
  name = 'BaseE';
}
class Ult extends Named {
  name = 'Ult';
}
class FormQ extends Named {
  name = 'FormQ';
}
class FormW extends Named {
  name = 'FormW';
}
class FormE extends Named {
  name = 'FormE';
}
class OtherQ extends Named {
  name = 'OtherQ';
}

let game: ReturnType<typeof createGame>;

/**
 * Laid out the way a real kit is — `[attack, Q, W, E, R]`, see `SpellSlot`.
 * The first version of this suite used a bare four-spell array starting at
 * index 0, which is exactly the shape that hid the bug: a stance filling
 * "the first three" looked correct against a kit with no basic attack in it
 * and replaced attack/Q/W against every real one.
 */
const champion = () => {
  const unit = new Champion({ game, teamId: 'blue' });
  unit.replaceSpells([
    new Attack(unit),
    new BaseQ(unit),
    new BaseW(unit),
    new BaseE(unit),
    new Ult(unit),
  ]);
  return unit;
};

/** The three ability slots a transform swaps, keyed the way a pack writes it. */
const kurama = (unit: Champion) => ({
  [SpellSlot.Q]: new FormQ(unit),
  [SpellSlot.W]: new FormW(unit),
  [SpellSlot.E]: new FormE(unit),
});

beforeEach(() => {
  stubGameGlobals();
  game = createGame(2_000);
});
afterEach(() => vi.unstubAllGlobals());

describe('champion stance', () => {
  it('swaps the slots it is given and leaves the rest alone', () => {
    const unit = champion();
    const ult = unit.spells[SpellSlot.R];

    unit.enterStance('kurama', kurama(unit));

    expect(unit.spells.map(s => s.name)).toEqual(['Attack', 'FormQ', 'FormW', 'FormE', 'Ult']);
    expect(unit.spells[SpellSlot.R]).toBe(ult);
    expect(unit.stance).toBe('kurama');
  });

  it('leaves the basic attack alone', () => {
    // The bug this API shape exists to prevent, reported from a real match:
    // the first `enterStance` took an array and filled from index 0, so a
    // form meaning Q/W/E replaced attack/Q/W and every ability sat one slot
    // to the left. Nothing in the type system had an opinion, because both
    // are just `Spell`.
    const unit = champion();
    const attack = unit.spells[SpellSlot.ATTACK];

    unit.enterStance('kurama', kurama(unit));

    expect(unit.spells[SpellSlot.ATTACK]).toBe(attack);
    expect(unit.spells[SpellSlot.Q].name).toBe('FormQ');
    expect(unit.spells[SpellSlot.E].name).toBe('FormE');
  });

  it('reports which slots it took', () => {
    // The wire reads this to say what changed; if it lied, a client would
    // rebuild the wrong three.
    const unit = champion();
    expect(unit.stanceSlots).toEqual([]);

    unit.enterStance('kurama', kurama(unit));

    expect([...unit.stanceSlots].sort()).toEqual([SpellSlot.Q, SpellSlot.W, SpellSlot.E].sort());
  });

  it('ignores a slot that is not on the kit', () => {
    // A pack naming slot 99 is a pack with a bug; core must not grow the
    // array to fit it and leave holes where a spell should be.
    const unit = champion();
    const before = unit.spells.length;

    unit.enterStance('bad', { 99: new FormQ(unit) });

    expect(unit.spells.length).toBe(before);
  });

  it('gives back the very same instances on exit', () => {
    // Not "an equal kit" — the same objects. Everything a spell remembers
    // between casts lives on the instance and nowhere else.
    const unit = champion();
    const before = [...unit.spells];

    unit.enterStance('kurama', kurama(unit));
    unit.exitStance();

    expect(unit.spells).toEqual(before);
    expect(unit.spells[SpellSlot.Q]).toBe(before[SpellSlot.Q]);
    expect(unit.stance).toBe(null);
  });

  it('freezes a cooldown instead of refunding it', () => {
    // The exploit. `deactivate()` would have zeroed this.
    const unit = champion();
    unit.spells[SpellSlot.Q].currentCooldown = 800;

    unit.enterStance('kurama', kurama(unit));
    unit.exitStance();

    expect(unit.spells[SpellSlot.Q].currentCooldown).toBe(800);
  });

  it('keeps a buff the dormant spell is the source of', () => {
    // `onRemoved()`'s sweep would have taken this with it.
    const unit = champion();
    const source = unit.spells[SpellSlot.Q];
    // `(duration, sourceUnit, targetUnit)`; -1 is the permanent duration a
    // kit passive hangs, which is exactly the kind `onRemoved()` sweeps.
    const buff = new Buff(-1, unit, unit);
    buff.sourceSpell = source;
    unit.addBuff(buff);

    unit.enterStance('kurama', kurama(unit));

    expect(unit.buffs).toContain(buff);
  });

  it('leaves the incoming form on its own cooldowns', () => {
    // Nidalee's two forms each keep their own timers; that is free here,
    // because each form is its own instance holding its own field.
    const unit = champion();
    const form = kurama(unit);
    form[SpellSlot.Q].currentCooldown = 500;

    unit.enterStance('kurama', form);

    expect(unit.spells[SpellSlot.Q].currentCooldown).toBe(500);
  });

  it('exits the standing stance before entering a different one', () => {
    // `exitStance` remembers exactly one base kit. Stacking a stance on a
    // stance would make the middle one unreachable forever.
    const unit = champion();
    const base = [...unit.spells];

    unit.enterStance('kurama', kurama(unit));
    unit.enterStance('sage', {
      [SpellSlot.Q]: new OtherQ(unit),
      [SpellSlot.W]: new FormW(unit),
      [SpellSlot.E]: new FormE(unit),
    });

    expect(unit.stance).toBe('sage');
    expect(unit.spells[SpellSlot.Q].name).toBe('OtherQ');

    unit.exitStance();

    expect(unit.spells).toEqual(base);
  });

  it('treats re-entering the standing stance as a no-op, not a refresh', () => {
    const unit = champion();
    unit.enterStance('kurama', kurama(unit));
    const standing = [...unit.spells];

    unit.enterStance('kurama', kurama(unit));

    expect(unit.spells[SpellSlot.Q]).toBe(standing[SpellSlot.Q]);
  });

  it('exiting with no stance standing does nothing', () => {
    const unit = champion();
    const before = [...unit.spells];

    unit.exitStance();

    expect(unit.spells).toEqual(before);
    expect(unit.stance).toBe(null);
  });

  it('restores a hand-built kit, not the champion this ultimate came from', () => {
    // A player may take this R and leave the other three slots to spells from
    // somewhere else entirely. Exiting has to hand *those* back — which works
    // only because the outgoing set is kept rather than reconstructed.
    const unit = new Champion({ game, teamId: 'blue' });
    unit.replaceSpells([
      new Attack(unit),
      new OtherQ(unit),
      new BaseW(unit),
      new BaseE(unit),
      new Ult(unit),
    ]);
    const borrowed = [...unit.spells];

    unit.enterStance('kurama', kurama(unit));
    unit.exitStance();

    expect(unit.spells).toEqual(borrowed);
    expect(unit.spells[SpellSlot.Q].name).toBe('OtherQ');
  });
});
