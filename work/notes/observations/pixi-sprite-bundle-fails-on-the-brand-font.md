---
title: 'Under PUBLIC_RENDERER=pixi the sprite bundle fails to load on the brand font, in headless Chromium at least'
---

Observed 2026-11-06 running the preset e2e suite with `PUBLIC_RENDERER=pixi`, online and offline alike: the console says `could not load the sprite bundle Error: [Loader.load] Failed to load http://localhost:4173/assets/brand/fonts/Cinzel-VariableFont_wght-Kctsxw.ttf.` The default bundle in `web/src/lib/manifest.json` sweeps up all of `static/assets`, `brand/` included (its README.md, build.sh, concept PNGs and the Cinzel font), so one asset pixi cannot load fails the whole bundle and the board draws with the vector fallback (`assets.ts` sets progress to 1 on failure). Unverified in a headed, real browser. If it holds there, the wooden board's sprites never load; keeping `brand/` out of the pixi bundle would fix it.

The same runs show the "Loading the board art" bar of `$lib/game/render/pixi/LoadingGate.svelte` still drawn across the middle of the board 1.2 s and 4 s after it first showed, although `assets.ts` sets the progress to 1 when the bundle fails. Screenshots were in `web/test-results/` of the `E2E_PRESET_SHOTS=1` run of `web/e2e/tests/offline-presets.e2e.ts`.
