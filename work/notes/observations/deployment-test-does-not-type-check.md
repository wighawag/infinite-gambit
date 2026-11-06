# `Deployment.test.ts` does not type-check either

2026-11-06. Besides the `DeploymentCollisions.test.ts` errors already noted (`deployment-collisions-test-does-not-type-check.md`), `npx tsc -p contracts/test/js` reports two TS2352 casts in `contracts/test/js/Deployment.test.ts` (lines 124 and 686, a registry tuple converted to a narrower type). They are there without `chess-capture-loops`'s changes; nothing in `verify` type-checks the suites, so nothing catches them.
