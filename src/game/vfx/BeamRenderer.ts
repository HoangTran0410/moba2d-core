import type { BeamGeometry } from '@/game/gameObject/spellObjects/BeamSpellObject';
import { Chain } from '@/game/render/creature/chain';
import { drawChain } from '@/game/render/creature/drawCreature';
import type { VfxHandle } from './SpellVfx';

/**
 * Core's default painter for a beam, and the fallback every beam gets when the
 * spell that fired it supplies none of its own.
 *
 * It was one `line()` between the two ends, which is the correct picture for a
 * laser and the wrong one for everything else a beam is used as — a tether, a
 * chain, a leash, a grip. Those read as *attached* only if the middle is
 * allowed to fall behind the ends and catch up, and a straight segment between
 * two moving points never does: it is rigid at every frame rate, which is what
 * makes it look like a UI line drawn over the world rather than a thing in it.
 *
 * So the default is a `Chain` now, spanned between the same two points and
 * carrying a little slack. Nothing about the beam's *damage* changed and
 * nothing may: `BeamSpellObject`'s hit test is the straight capsule it always
 * was, and bending the volume the picture covers would be a balance change
 * wearing a graphics change's clothes. The rope is allowed to bow outside what
 * the beam hits, and that is the honest arrangement — the same one the cone
 * beside it takes.
 */
export default class BeamRenderer implements VfxHandle {
  private disposed = false;

  /**
   * The rope, when this is the default painter. `null` when the caller brought
   * its own `render`, which is then the only thing that decides the picture.
   *
   * Public because its joints are the geometry of what is actually on screen,
   * and the straight `geometry` is no longer that.
   */
  readonly rope: Chain | null;

  constructor(
    readonly geometry: BeamGeometry,
    private readonly render?: (geometry: BeamGeometry) => void
  ) {
    this.rope = render ? null : new Chain(BEAM_LINKS, 0);
    if (this.rope) this.reseat();
  }

  /**
   * `deltaMs` was ignored here, and now it is the whole point.
   *
   * How far the rope trails is how many solver passes it got, so a fixed count
   * per frame would make the slack a function of the frame rate — the trap
   * `Camera.smoothingFor` exists for, one layer down. Scaled by the delta, a
   * phone at 30fps and a desktop at 144 draw the same rope.
   */
  update(deltaMs: number): void {
    const rope = this.rope;
    if (this.disposed || !rope) return;

    const { start, end } = this.geometry;
    // Exactly taut, re-derived every frame from wherever the ends are now.
    //
    // Slack is the obvious thing to want here and it is wrong: the camera looks
    // straight down, so a rope has no direction to hang in, and spare length
    // between two pinned ends comes out *along the line* — the far end of the
    // beam poking a few percent past the point it is aimed at, permanently,
    // while it is standing still. Taut, the only arrangement that satisfies
    // both pins is the straight one, so a resting beam is straight and every
    // bow you see is a real end that really moved.
    const away = Math.hypot(end.x - start.x, end.y - start.y);
    rope.spacing = away / (rope.joints.length - 1);

    const passes = Math.max(
      1,
      Math.min(MAX_SETTLE_PASSES, Math.round((SETTLE_PASSES * deltaMs) / FRAME_MS))
    );
    // The caster's end is the anchor; the far end is the one reaching.
    rope.span(end.x, end.y, start.x, start.y, passes);
  }

  draw(): void {
    if (this.disposed) return;
    if (this.render) {
      this.render(this.geometry);
      return;
    }
    if (!this.rope) return;
    drawChain(
      this.rope,
      // `tip: 1` is an even weight end to end. A beam is not a limb: the taper
      // that makes a leg read as a leg would make this read as a tail.
      { thickness: this.geometry.width, color: [...BEAM_COLOR], tip: 1, glow: 0.6 },
      BEAM_ALPHA
    );
  }

  dispose(): void {
    this.disposed = true;
  }

  /** Lay the rope straight down the beam, so its first frame is not a knot. */
  private reseat(): void {
    const { start, end } = this.geometry;
    this.rope?.straighten(end.x, end.y, start.x, start.y);
  }
}

/** Enough joints to bow, few enough to stroke every frame of a channelled beam. */
const BEAM_LINKS = 10;

/** One frame at 60fps, the rate `SETTLE_PASSES` is written for. */
const FRAME_MS = 1000 / 60;

/**
 * Solver passes per 60fps frame — how fast the rope chases a moved end.
 *
 * The chase is deliberately unhurried. FABRIK closes most of the gap in the
 * first frames and the last few percent slowly, so a beam whose caster just
 * strafed keeps a few percent of curve for about a second. That residue is the
 * memory in the rope, and raising this until it is gone gets a straight line
 * back with extra steps.
 */
const SETTLE_PASSES = 2;

/** A hitch must not be paid off in one frame's worth of solving. */
const MAX_SETTLE_PASSES = 24;

/** The stroke the flat `line()` used, kept so no beam changes colour. */
const BEAM_COLOR: readonly number[] = Object.freeze([180, 220, 255]);
const BEAM_ALPHA = 180;
