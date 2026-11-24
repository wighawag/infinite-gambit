---
title: 'A missed deployment is explained only after the player stakes again'
---

Observed 2026-11-24 while porting the template's missed-reveal e2e case to chess (`web/e2e/tests/chess-game.e2e.ts`, "A missed reveal").

When a deployment's reveal is missed, the army is `Unrevealed` and never played again, so the client moves on to the account's next army (`chooseArmy`, `web/src/lib/chess/armies.ts`) and the framework's missed-reveal notice, keyed by the army played, says nothing. What tells the player is the HUD's `lastDeployment` ("Last deployment never revealed. Pick a spawn point to deploy again." and "N lost: burned when settled."), which is drawn only outside the setup gate. The stake went into the lost deployment, so the reserve is usually empty and the setup gate ("Buy a stake to play") is all the player sees: they learn what happened to their stake only after buying another. Possibly intended (the gate is the next action either way), but the player is asked to pay again before being told why. The e2e case asserts the message after a new stake, which is what the app does today.

The commitment itself stays open on chain until someone settles it (`forfeitMissedReveal`); nothing in the client offers to, since the army is no longer played. The stake is lost either way, so this costs nothing but a stale commitment.
