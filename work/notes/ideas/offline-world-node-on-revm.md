---
title: "Run the offline world node on the revm engine"
---

Left as a follow-up by `offline-world-chain-in-a-worker` (2026-11-06), which moved the offline world's node into a Worker on webevm's default engine and did not measure revm.

webevm's `revm` engine is faster, and the Worker module is now ours (`web/src/lib/offline-node-host.ts` wraps `createNodeWorkerApi()` from `webevm/worker-host`), so the engine can be built there: pass `createNodeWorkerApi({createEngine: () => createRevmEngine({wasm})})` with the wasm from `revm-wasm`, keep the default engine as a fallback when it fails to build, and measure a reveal (about 1.3M gas) and the deploy before and after. Mind that the restore probe takes the same path, and that a persisted dump must load under either engine.
