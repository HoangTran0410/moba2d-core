---
name: moba2d-lol2d-handover
description: "Old LOL2D repo redirects to moba2d (kill-switch SW, standalone guide); core menu has a Cài app install button"
metadata: 
  node_type: memory
  type: project
  originSessionId: ce7d1f5a-7224-4b55-809e-79ba23c29559
  modified: 2026-09-05T19:43:51.422Z
---

Done 2026-09-06. The pre-split repo `HoangTran0410/LOL2D` is frozen and points home:

- Its `.github/workflows/build.yml` no longer builds the old game — it ships only `redirect/` (index.html, 404.html, sw.js) to BOTH old hosts: Cloudflare Pages project `lol2d` (via repo secrets + wrangler) and GitHub Pages (served at hoangtran99.is-a.dev/LOL2D; the github.io URL 301s there). Deep links land on 404.html which also redirects.
- `redirect/sw.js` is a **kill-switch service worker**: the old game was an offline-first PWA whose worker served everything from cache, so returning players would never see the redirect — the kill-switch skipWaits in, clears all caches, unregisters itself, and reloads open tabs.
- The redirect page has two modes: a normal browser tab auto-redirects to moba2d.pages.dev after cleanup; **inside the installed old app** (`display-mode: standalone/fullscreen` or `navigator.standalone`) it does NOT bounce — an installed PWA is pinned to its origin and an out-of-scope redirect opens portrait in a browser-chrome view, which looks broken — instead it shows a hand-over guide: open in real browser → install the new app → uninstall this one. There is no way to transfer an installed PWA to a new origin; don't go looking for one.
- Repo README carries a moved banner (links: moba2d-game/core public engine; moba2d-packs/{lol,dota,naruto} all public); repo description/homepage patched. Repo NOT archived (kept writable so the redirect page can be fixed).

Landing half in core (`9892624`): `src/pwa/install.ts` parks Chromium's one-shot `beforeinstallprompt` behind a Vue ref (same plain-module doctrine as `pwa/updates.ts`, wired in `main.ts` beside `registerServiceWorker`); MenuScene shows a "Cài app" `menu-link` button — real prompt on Chromium, Share→Add-to-Home hint dialog on iOS (`iosManualInstall` catches iPadOS masquerading as Mac via maxTouchPoints), hidden entirely when `runningStandalone()`. A dismissed prompt is spent — Chromium refuses a second `prompt()` on the same event; the button hides until the browser refires.
