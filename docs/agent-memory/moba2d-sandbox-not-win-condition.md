---
name: moba2d-sandbox-not-win-condition
description: "The user wants moba2d to stay a \"phòng tập\" sandbox skirmish; no nexus, no win/lose condition, no end-of-match screen (stated 2026-09-02)"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 40c76eac-3d37-4bf8-b1f2-81a38c8ab810
  modified: 2026-09-02T05:36:12.690Z
---

On 2026-09-02, given a ranked list of improvement ideas, the user accepted all of them except "điều kiện thắng" (Nexus + inhibitors + victory/defeat screen + surrender): "t vẫn thích dạng phòng tập hơn là đánh phá nhà để thắng trận". The endless match with self-rebuilding turrets is a deliberate design, not a gap.

**Why:** The game is played as a practice-room / free-fight sandbox on the user's phone; a match arc with a hard ending is not what they want out of it, at least for now ("chưa cần làm đâu" — not never, but not now).

**The pace follows from this, and it is a stated rule now.** On 2026-09-05 the
user set a hard ceiling: *"thời gian hồi chiêu thì cap về < 20 hết, này là phòng
tập, ko nên cho quá lâu"* — **every cooldown under 20 seconds**, because nobody
comes to a practice room to stand still for most of a minute waiting for the
ability they came to practise. Core's `checkCooldowns` seam default moved
10_000 → **20_000** to match, and 24 spells were rescaled down to fit (lol 7,
dota 17; naruto's 11-12s were already inside). Fidelity to the game an ability
was modelled on **loses** to rehearsal pace — dota's canonical 40-60s ultimates
are exactly the case that has to give. Apply the same reasoning to any other
"wait" the sandbox imposes: respawn timers, item actives, recall.

**How to apply:** Do not propose Nexus, inhibitors, win/lose, surrender, or a post-match results screen unless the user raises it. Frame "retention" ideas around per-fight feel and self-set progress instead: killfeed/streak announcements, local match history + champion mastery, saved 15s clips, sandbox-flavoured mode presets (ARAM/URF/1v1 as tuning bundles without a win rule), an on-demand scoreboard (the roster tab already has live K/D/A). The accepted idea list lives in the 2026-09-02 session; the other 18 items stand. See [[moba2d-workspace-layout]].
