---
title: "The greedy bot heads for an exit once its army holds a captured stake"
type: idea
status: incubating
created: 2026-11-06
---

Raised by the maintainer, 2026-11-06.

Today the greedy level (`CONTEXT.md` "Greedy level", `chess-greedy-bot`) captures the most valuable piece it can reach and otherwise moves at random. It never leaves, so a played seat that has taken a king sits on a stake it can only lose.

The idea: where exits exist (the online and offline worlds, not tables), a greedy seat whose army holds MORE than its own stake (it has captured at least one king, or a stone) starts heading for the nearest exit with its king, and leaves through it when its king can land alone. Captures still come first when one is on offer.

What to settle before building:
- The trigger: any captured stake, or a threshold (for example twice its own stake).
- How it walks: the next king step that brings it closer to the nearest exit, from the contract's `legalMoves` (rules live only in the contract, ADR-0007), avoiding attacked squares (`$lib/chess/attacked.ts`) when it can.
- The priority between running for the exit and a capture that is on offer.
- It is a bot change only; no contract change. Build it after the `lean-rules` spec has landed (`work/specs/proposed/lean-rules.md`), which changes the exits (2 by 2 blocks), the army and the stakes the bot reads.
