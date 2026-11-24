---
title: 'A lost deployment cannot be recovered: the HUD says "pick the same spawn point" and offers none'
---

Observed 2026-11-24 while porting the template's placement-game e2e suites to chess (`web/e2e/tests/chess-game.e2e.ts`).

A deployment is committed, then the browser loses the submission (site data cleared, another device) while the cycle is still running. The recovery notice appears, as it should: "This browser no longer has the turn for cycle N. It can still be revealed this cycle: pick the same spawn point and recover." (`describeRecovery`, `web/src/lib/chess/ui/hud.ts`). But the army that deployment committed already shows as `Deploying` in the registry (`_deploymentStatus`: `deployCycle >= cycleNumber`), so `needsDeployment` is false, the HUD shows "Your army can move from next cycle" and no spawn point list, and the planning store accepts no deployment. Nothing can be planned, so `canRecover` (a planned count above zero) never becomes true and "Recover turn" stays disabled until the cycle ends and the deployment is lost (`Unrevealed`, its stake burned when settled).

Recovering a MOVE works (the same suite recovers one), so this is specific to deployments. A fix would let the HUD offer the open spawn points (which one was picked is what the hash checks, so all of them) while a recovery of this army's deployment is pending, and let the planning store plan a deployment for an army that is `Deploying` with a recovery pending. The suite's deployment case is left out until then.
