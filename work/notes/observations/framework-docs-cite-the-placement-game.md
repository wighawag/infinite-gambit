---
title: 'Inherited framework docs still cite $lib/placement as the worked example'
---

Observed 2026-11-05 while building `chess-army-deployment`.

Upstream (template) files still name the deleted reference game as their worked example: `web/src/lib/game/simulation/README.md` ("the client is `$lib/placement/preview.ts`"), `web/src/lib/game/render/README.md` (`placement/context.ts`), `web/src/lib/indexer/README.md` (`$lib/placement/indexer/`), `web/src/lib/game/core/diagnostics.ts` and the `placement` comments in `contracts/src/commit-reveal/interfaces/UsingCommitRevealTypes.sol`. They were left untouched on purpose (editing inherited files turns every upstream merge into a conflict, `AGENTS.md`); this game's equivalents are `web/src/lib/chess/preview.ts`, `web/src/lib/chess/context.ts`, and no indexer at all (`docs/adr/0007-rules-live-only-in-the-contract.md`). Worth a decision on whether to annotate them here or upstream.
