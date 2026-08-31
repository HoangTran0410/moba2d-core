/**
 * Colours the world itself is painted in, named so something drawn *on* it can
 * be checked against them.
 *
 * `Game.draw` used to say `background(30)` and nothing else in the codebase
 * knew that number. A procedural creature's legs were then given a default of
 * `[26, 30, 40]` — chosen as "dark enough to read as a silhouette", which was
 * reasoning about a map nobody had looked at — and shipped invisible: a
 * luminance difference of 0.1 out of 255 against the floor they walk on.
 *
 * A constant is what lets a test hold the two apart. See
 * `creatureSpec.test.ts`.
 */

/**
 * The map floor. Greyscale, so p5's one-argument `background()` takes it
 * directly and all three channels are this value.
 */
export const MAP_BACKGROUND_GREY = 30;

/**
 * Perceived brightness, 0..255 — the Rec. 709 luma weights.
 *
 * Not a full WCAG contrast ratio, which is built for text on solid backgrounds
 * and would be false precision here: a leg crosses grass, bush, water and its
 * own body's sprite within one step. Plain luma difference answers the question
 * that actually failed — "can you see it at all".
 */
export const luminance = (rgb: readonly number[]): number =>
  0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
