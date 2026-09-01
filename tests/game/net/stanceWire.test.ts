/**
 * A form change crossing the wire.
 *
 * The host end is a *diff*, not a hook: entering, leaving and swapping one
 * form straight for another all end as a different (stance, slot ids) pair,
 * and `discover` notices. The trap the hello half exists for is the one
 * `BagEvent` already documents — a diff only speaks on change, so a champion
 * that transformed before a client joined would never announce it again.
 *
 * The client end is asynchronous, because a form's abilities are their own
 * lazy chunks, and that await is what makes the generation guard necessary.
 */
import { describe, expect, it } from 'vitest';
import { stanceSignatureOf } from '@/game/net/HostSession';

describe('the host-side stance signature', () => {
  const base = { stance: null, spells: [] as string[] };

  it('is stable while nothing changes', () => {
    expect(stanceSignatureOf(base)).toBe(stanceSignatureOf({ ...base }));
  });

  it('changes when a form is entered', () => {
    const form = { stance: 'kurama', spells: ['naruto:Naruto_Q2', 'naruto:Naruto_W2'] };
    expect(stanceSignatureOf(form)).not.toBe(stanceSignatureOf(base));
  });

  it('changes when one form is swapped straight for another', () => {
    const kurama = { stance: 'kurama', spells: ['naruto:Naruto_Q2'] };
    const sage = { stance: 'sage', spells: ['naruto:Naruto_Q2'] };
    expect(stanceSignatureOf(kurama)).not.toBe(stanceSignatureOf(sage));
  });

  it('changes when a form keeps its name but not its contents', () => {
    // The spell ids are in the signature, not just the stance id. A pack that
    // rebuilt a form's slots without renaming the form still has to cross,
    // or the client casts the abilities it had before.
    const before = { stance: 'kurama', spells: ['naruto:Naruto_Q2'] };
    const after = { stance: 'kurama', spells: ['naruto:Naruto_Q3'] };
    expect(stanceSignatureOf(before)).not.toBe(stanceSignatureOf(after));
  });

  it('tells an empty form apart from no form', () => {
    // `''` and `null` must not collide into the same string, or leaving a
    // form named by the empty string would be a silent no-op.
    expect(stanceSignatureOf({ stance: '', spells: [] })).not.toBe(stanceSignatureOf(base));
  });
});
