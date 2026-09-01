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
import { createGame, stubGameGlobals } from '../fixtures';

class Named extends Spell {
  targetingMode = 'SELF' as const;
  coolDown = 1000;
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

const champion = () => {
  const unit = new Champion({ game, teamId: 'blue' });
  unit.replaceSpells([new BaseQ(unit), new BaseW(unit), new BaseE(unit), new Ult(unit)]);
  return unit;
};

const formSpells = (unit: Champion) => [new FormQ(unit), new FormW(unit), new FormE(unit)];

beforeEach(() => {
  stubGameGlobals();
  game = createGame(2_000);
});
afterEach(() => vi.unstubAllGlobals());

describe('champion stance', () => {
  it('swaps the slots it is given and leaves the rest alone', () => {
    const unit = champion();
    const ult = unit.spells[3];

    unit.enterStance('kurama', formSpells(unit));

    expect(unit.spells.map(s => s.name)).toEqual(['FormQ', 'FormW', 'FormE', 'Ult']);
    expect(unit.spells[3]).toBe(ult);
    expect(unit.stance).toBe('kurama');
  });

  it('gives back the very same instances on exit', () => {
    // Not "an equal kit" — the same objects. Everything a spell remembers
    // between casts lives on the instance and nowhere else.
    const unit = champion();
    const before = [...unit.spells];

    unit.enterStance('kurama', formSpells(unit));
    unit.exitStance();

    expect(unit.spells).toEqual(before);
    expect(unit.spells[0]).toBe(before[0]);
    expect(unit.stance).toBe(null);
  });

  it('freezes a cooldown instead of refunding it', () => {
    // The exploit. `deactivate()` would have zeroed this.
    const unit = champion();
    unit.spells[0].currentCooldown = 800;

    unit.enterStance('kurama', formSpells(unit));
    unit.exitStance();

    expect(unit.spells[0].currentCooldown).toBe(800);
  });

  it('keeps a buff the dormant spell is the source of', () => {
    // `onRemoved()`'s sweep would have taken this with it.
    const unit = champion();
    const source = unit.spells[0];
    // `(duration, sourceUnit, targetUnit)`; -1 is the permanent duration a
    // kit passive hangs, which is exactly the kind `onRemoved()` sweeps.
    const buff = new Buff(-1, unit, unit);
    buff.sourceSpell = source;
    unit.addBuff(buff);

    unit.enterStance('kurama', formSpells(unit));

    expect(unit.buffs).toContain(buff);
  });

  it('leaves the incoming form on its own cooldowns', () => {
    // Nidalee's two forms each keep their own timers; that is free here,
    // because each form is its own instance holding its own field.
    const unit = champion();
    const form = formSpells(unit);
    form[0].currentCooldown = 500;

    unit.enterStance('kurama', form);

    expect(unit.spells[0].currentCooldown).toBe(500);
  });

  it('exits the standing stance before entering a different one', () => {
    // `exitStance` remembers exactly one base kit. Stacking a stance on a
    // stance would make the middle one unreachable forever.
    const unit = champion();
    const base = [...unit.spells];

    unit.enterStance('kurama', formSpells(unit));
    unit.enterStance('sage', [new OtherQ(unit), new FormW(unit), new FormE(unit)]);

    expect(unit.stance).toBe('sage');
    expect(unit.spells[0].name).toBe('OtherQ');

    unit.exitStance();

    expect(unit.spells).toEqual(base);
  });

  it('treats re-entering the standing stance as a no-op, not a refresh', () => {
    const unit = champion();
    unit.enterStance('kurama', formSpells(unit));
    const standing = [...unit.spells];

    unit.enterStance('kurama', formSpells(unit));

    expect(unit.spells[0]).toBe(standing[0]);
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
    unit.replaceSpells([new OtherQ(unit), new BaseW(unit), new BaseE(unit), new Ult(unit)]);
    const borrowed = [...unit.spells];

    unit.enterStance('kurama', formSpells(unit));
    unit.exitStance();

    expect(unit.spells).toEqual(borrowed);
    expect(unit.spells[0].name).toBe('OtherQ');
  });
});
