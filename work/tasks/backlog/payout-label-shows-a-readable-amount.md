---
title: 'The payout button shows an amount a player can read, not "Collect >0 ETH"'
slug: payout-label-shows-a-readable-amount
blockedBy: []
covers: []
---

## What to build

The exit payout and table claim buttons read "Collect >0 ETH". `describeExitPayout` and `describeTableClaim` (`web/src/lib/chess/ui/hud.ts`) label the payout as `formatBalance(value)` plus the chain's symbol. One stake sells for 0.00000001 ETH (10 gwei, `data.sale.default.price` in `contracts/rocketh/config.ts`), and `formatBalance` (upstream, `$lib/core/utils/format/balance.ts`) fits a value into 7 characters, so it rounds that value to `>0`. The player cannot tell what they are collecting.

Show the payout so it can be read at any size:

- **Lead with the stake, in the game's token**, which is what the player actually staked and won: `STAKE.amount(...)` (`$lib/chess/stake.ts`, "TOK"). For an exit, that is the army's stake; for a table claim, the share.
- **Then the chain-currency value in a unit that shows it**: gwei when the value is below 0.001 of the chain's currency, the currency itself otherwise. For example "Collect 10 TOK (10 gwei)". Never print `>0` or `0` for a non-zero payout.
- Put the unit choice in one small plain `.ts` helper in this game's code (beside the HUD), not in `formatBalance`, which is upstream's (AGENTS.md: prefer not to edit `$lib/core`).
- Use the same helper wherever this game shows a payout or a stake's chain-currency price (the HUD's `priceLabel` near the deploy controls is another `formatBalance` of the sale price), so the two cannot disagree.

## Acceptance criteria

- [ ] At the current sale price, the exit payout and table claim buttons read the stake in TOK and the value in gwei (no `>0`).
- [ ] At a price of 0.001 of the chain's currency or more, the value is shown in that currency.
- [ ] The headline and detail of both payouts still read as before apart from the amount; a table claim whose share is not known yet still says "Collect your share" / "Collect every stake".
- [ ] `$lib/core/utils/format/balance.ts` is unchanged.
- [ ] Unit tests cover the helper at both sides of the threshold and the two labels at the current price, next to the existing HUD tests.

## Blocked by

- None: can start immediately.

## Prompt

Goal: build the task above. The "What to build" and "Acceptance criteria" sections are the brief; "done" is every criterion met with the `verify` gate in `dorfl.json` green.

Read first: `AGENTS.md` (Svelte conventions: formatting logic lives in `.ts`, components only render; `$lib/core` is upstream's), `web/src/lib/chess/ui/hud.ts` (`describeExitPayout`, `describeTableClaim`, and the deploy `priceLabel`), `web/src/lib/chess/stake.ts`, and `web/src/lib/core/utils/format/balance.ts` (to reuse, not edit). Find the existing tests of these HUD functions under `web/test/` and extend them.

FIRST, check this task against current reality: do the payout labels still use `formatBalance` of the chain-currency value, and is the sale price still 10 gwei? If it has drifted, route the task to needs-attention with the discrepancy (WORK-CONTRACT.md "Drift is a needs-attention signal").

Work in small steps (one decision, then edit and run a test), and grow files with edits of at most about 300 lines: earlier builds in this repo died on the 16,384-token output limit when a single reply tried to plan everything.

RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT (the runner transcribes it into the done record). Do not write the done record, commit message or PR body yourself, and do not edit this task body.
