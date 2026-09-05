---
name: moba2d-flat-ui
description: "2026-09-05: the user set flat design as the UI rule — no glows/neon/blur anywhere; what the allowed vocabulary is and the hextech-css CDN find"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: ce7d1f5a-7224-4b55-809e-79ba23c29559
  modified: 2026-09-05T13:27:24.817Z
---

The user asked (twice, same day) for flat design across the whole UI: "bỏ bớt
shadow/neon effect đồ đi, để flat design thôi, để máy yếu ko overhead". First
pass hit the kill feed/banners (`c983b62`), second pass everything else
(`ca9a536`): all of `styles/*.css` + `NetLinkOverlay.vue`.

**Why:** weak machines (the user plays on a phone PWA) pay for blurred
rasters; and the user simply prefers the flat look now.

**How to apply — the vocabulary that survived, use it for any new UI:**
- State changes: border-color + background wash, never a glow.
- Text legibility over canvas/art: crisp `0 1px 0 #000`-style offsets, never a
  blurred halo.
- Zero-blur box-shadow rings (`0 0 0 1px …`, inset or not) are ALLOWED — a
  spread ring is a rect fill, not a blur, and still reads flat.
- No `backdrop-filter` — darken the scrim instead.
- Infinite animations may touch transform/opacity only (never box-shadow,
  filter, or top/left — `hextechConfirmPulse` and the menu `.shiny` sweep were
  the two offenders).
- `grayscale(100%)` on dead/disabled things stays — it is information.

**Finds worth not re-finding:** `.hextech-btn:hover` fetched `btn.jpg` from
jsdelivr (pxlucasf/hextech-css remnant) — a network request on first hover and
an offline-PWA hole; the `--hextech-*` theme itself (styles/main.css) is just
colour vars and was always flat. If the user says a solid-colour state now
reads too faint, darken/brighten the border a step — do not reach back for a
glow. See [[moba2d-teamfight-profile]] for the canvas half of the same
per-frame budget.
