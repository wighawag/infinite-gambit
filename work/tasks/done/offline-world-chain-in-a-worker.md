---
title: 'Run the offline world chain in a Worker, so the board stays smooth'
slug: offline-world-chain-in-a-worker
blockedBy: []
covers: []
---

## What to build

The offline world (the hotseat mode, `$lib/offline.ts` on top of the embedded-chain mechanism in `$lib/embedded`) runs its webevm node on the page's MAIN THREAD: `$lib/embedded/node.ts` defaults to webevm's main-thread `createNode` and `$lib/offline.ts` never passes another factory. Every transaction (commits, reveals of up to about 1.3M gas, the deploy) and every view the client polls (the board viewport, the army registry, the cycle outcomes, attendance) is interpreted in the thread that draws the board, so the game drops frames while it plays. Only the rule sandbox (`$lib/game/simulation/sandbox.ts`, used by the bot and the client's legal-move highlights) already runs in a Worker.

Move the world's node into a Worker, through the seam that exists for exactly this: the `createNode` option of the embedded node ("injected ONLY so a caller can supply a Worker-hosted node (`createWorkerNode`) or a faster engine"). webevm 0.9 ships the pieces: `createWorkerNode` (`webevm/worker-client`) on the page side and `webevm/worker-entry` (or a module of your own calling `exposeNode()` from `webevm/worker-host`) on the Worker side. The sandbox's `./worker.ts` is the in-repo example of the bundling pattern (`new Worker(new URL(..., import.meta.url), {type: 'module'})`).

Keep everything the world does today working through the Worker:
- **Persistence is built INSIDE the Worker.** The world persists its chain in IndexedDB (`createIndexedDBPersistence`) and restores it on reload, checking coherence against the deployment records (`restoreIsCoherent`). `createWorkerNode` structured-clones its options into the Worker, and a persistence adapter is an object with methods, so it cannot be passed from the page (a `DataCloneError`); `exposeNode`'s host options only take `createEngine`. So write a Worker module of our own that wraps webevm's worker API (`createNodeWorkerApi()` / `exposeNode`, `webevm/worker-host`) and builds `createIndexedDBPersistence` itself from cloneable options (the database name). `comlink` is only a transitive dependency of `web` today: make it a direct one if the module needs it. A reload must restore the same world, and a fresh boot must deploy one, exactly as now.
- **The restore probe.** `openWorld` opens a second persisted node (the `probe`) to run `restoreIsCoherent` before the real node opens. Say where it runs (Worker or main thread), and make sure it is fully disposed before the real node opens the same database.
- **Everything reached off the provider.** Code downstream reaches `dumpState`/`mine` and the rest off the provider (see the comment in `$lib/embedded/node.ts`); make sure every such call still has an answer across the Worker boundary.
- **One tab per world, and a dispose that does not cut a save.** On a take-over, `letGoOfWorld` (`$lib/embedded/claim.ts`) calls `world.dispose()` and THEN sends one more request (`eth_blockNumber`) as the "everything is saved" barrier. webevm's worker client terminates the Worker inside `dispose()`, right after `remote.dispose()`, so that barrier would never settle (the take-over hangs) and a `persistence.save()` still running could be cut. Terminate the Worker only after a barrier request has resolved (wrap `dispose` so it drains before it terminates, or order the barrier first). The Worker must always be terminated once the world is disposed or taken over, never left running.
- **Tests and SSR run without `Worker`.** Outside a browser keep the main-thread node, as the sandbox does (`typeof Worker === 'undefined'`), so the unit and world tests keep running unchanged. Make the Worker constructor (or the node factory) INJECTABLE into the offline world's node choice, so a unit test can pass a fake Worker and assert the node choice and that `terminate()` is called after the barrier.

Optional, only if it is small and measured: webevm's `revm` engine is faster, but `createWorkerNode` refuses a non-default `engine`; the supported way is a Worker module of your own that builds the engine and calls `exposeNode()`. If you do it, keep the default engine as a fallback and say what it bought in the Decisions block. If not, leave a note for a follow-up.

Also cheap and in scope: the HUD's attacked-squares overlay (`$lib/chess/attacked.ts`) makes one sandbox call per enemy piece in view on every board change. Leave it alone unless measurement shows it matters; if it does, a single batch call on the Simulation route is the documented fix (it is a contract change, so mind `RouteSizes.test.ts`).

## Acceptance criteria

- [ ] Whenever `Worker` exists, the offline world's node is a Worker-hosted node (`createWorkerNode` or our own `exposeNode` module), with its IndexedDB persistence built inside the Worker.
- [ ] A fresh world boots and deploys, and a reload restores the same world (same chain, same armies); the restore probe is disposed before the real node opens the database.
- [ ] The one-tab claim and take-over still finish: the save barrier resolves before the Worker is terminated, and the Worker is always terminated on dispose.
- [ ] Outside a browser (unit tests, SSR) the world still runs on the main-thread node, and the existing world tests pass unchanged.
- [ ] `web/e2e/tests/offline.e2e.ts`, `offline-hotseat.e2e.ts`, `offline-one-tab.e2e.ts` and `offline-ai.e2e.ts` still pass (run them if the environment allows; say so in the report if it does not).
- [ ] Tests cover the new behaviour: with an injected fake Worker, the node choice, and `terminate()` called only after the barrier request has settled.

## Blocked by

- None: can start immediately.

## Prompt

Goal: build the task above. The "What to build" and "Acceptance criteria" sections are the brief; "done" is every criterion met with the `verify` gate in `dorfl.json` green.

Read first: `AGENTS.md` (the Svelte conventions, the framework boundary: only `web/src/lib/kit` may import `$app/*`), `web/src/lib/embedded/README.md` (what the embedded world is, what building on it found, and which files are upstream's and should not be edited for this game's convenience), `web/src/lib/embedded/node.ts`, `web/src/lib/embedded/world.ts`, `web/src/lib/offline.ts`, and `web/src/lib/game/simulation/sandbox.ts` + `worker.ts` (the Worker pattern already in use). `$lib/embedded` is upstream's mechanism: prefer passing a Worker-backed `createNode` from `$lib/offline.ts` over editing `$lib/embedded`; if `$lib/embedded` genuinely needs a change, keep it minimal and generic, and say so.

FIRST, check this task against current reality: is the world's node still on the main thread, and does webevm still expose `createWorkerNode`/`worker-entry`? If not, route the task to needs-attention with the discrepancy (WORK-CONTRACT.md "Drift is a needs-attention signal").

Work in small steps (one decision, then edit and run a test), and grow files with edits of at most about 300 lines: earlier builds in this repo died on the 16,384-token output limit when a single reply tried to plan everything.

RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT (the runner transcribes it into the done record). Do not write the done record, commit message or PR body yourself, and do not edit this task body.

## Decisions

- **Termination is deferred inside our own Worker wrapper; `letGoOfWorld` is not reordered.** `dispose()` resolves straight away, and the Worker is terminated only after the internal barrier and every in-flight request have settled, one task later. Requests after that reject with "the offline world's node has been disposed" instead of hanging. Why: this keeps `$lib/embedded/claim.ts` (upstream's file) untouched and also covers callers other than `letGoOfWorld`. Alternatives considered: reorder the barrier before dispose in `claim.ts` (an upstream edit), or write my own comlink client (webevm's RPC-error rebuilding is not exported, so revert data would be lost). Touches: `letGoOfWorld`, the restore probe.
- **The restore probe runs in a Worker too, and `openWorld` waits on `released()`.** Why: loading the dump is the heaviest read at boot, and waiting turns "it never writes" into a fact. Alternative: keep the probe on the main thread, which would block the page while it loads the dump. Cost: two short-lived Workers at boot.
- **New module names `$lib/offline-node`, `-host` and `-worker`,** following the existing `offline-*` sibling naming (`offline-players`, `offline-lobby`). The new option `indexedDB` (a database name) is the Worker-side stand-in for webevm's `persistence` option and lives only on our own host.
- **A Worker-hosted node refuses `persistence` and `engine` with a clear error** instead of comlink's opaque `DataCloneError`. This is a new refusal, but it can only trigger when the factory is misused.
- **A failed `createWorkerNode` terminates its Worker.** Not covered: if the deploy or provisioning throws later in `createEmbeddedWorld`, the world's Worker stays alive until reload. That was already true of the main-thread node, and fixing it would need a change in `$lib/embedded`.
