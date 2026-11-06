---
title: 'The Reveal route is 58 bytes under the 24,576-byte code size limit'
---

Observed 2026-11-07 while building `three-piece-moves-in-the-contract`: `RouteSizes.test.ts` reports `Reveal 24518` (it was 23,814 before the task), so the unoptimised `GameReveal` route has 58 bytes left. The next tasks add code to that same route (`three-piece-moves-table-toggle` reads `gameOptions` to cap a move at one), so it will likely have to move code out first: another route, a library, or the deployment-forwarding branch in `GameReveal.reveal`.
