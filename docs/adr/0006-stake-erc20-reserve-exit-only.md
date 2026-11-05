# The stake is the template's ERC20 reserve, held by the army, redeemable for ETH only through an exit

A fixed stake is paid in the template's ERC20 game token, which `StakeSale` sells for native ETH in one transaction, and `StakeSale` gains a `redeem` at the same fixed price, so to a player it is ETH in and ETH out. We kept the reserve rather than holding native ETH in the game because the template's commit, forfeit and settlement code already works on it and other ERC20 stakes become possible later at no cost.

## Two reserves: the account's and the army's

The commit-reveal base only waits for an identity that has a funded reserve, and an army is its own identity (`docs/adr/0001-one-move-per-army-merge-on-capture.md`), distinct from the account that owns it. So at deployment the ACCOUNT's reserve funds a new ARMY id, and that army's reserve IS its stake. Army ids are kept disjoint from the address-derived ids `StakeSale` credits.

- **The army's reserve can never be withdrawn directly.** It leaves only when its king reaches an exit square (the payout goes to the army's owner), by moving to a captor, or, at a table, as the winner's payout. Otherwise a losing army could simply cash out.
- **Only armies are members.** A credit to an account's reserve (a purchase, a refund) does not make the account a waited-for member: it skips the seat. Otherwise every policy that waits for everyone (the offline world's manual advance, a table's early advance) would stall on an identity that never commits. For the same reason the public `addToReserve` refuses army ids.
- **At a table the seat is the army.** A roster seats identities before the table starts and refuses new ones after, so at a table buying a seat credits a new army id directly and that purchase is the deployment; accounts are not seated. The one exception to "never withdrawn directly": before a table starts, the owner may withdraw their army's whole reserve, which frees the seat. Once it starts, the normal rule applies.
- **The account's reserve stays freely withdrawable and redeemable.** It holds stake bought but not yet deployed, and refunds of failed deployments. That money is not on the board, so nothing is gained by locking it.
- **An exit is claimed by a call anyone may make** (`exit(army)`) once the cycle in which the king landed on the exit has closed, because nothing runs on chain at the end of a cycle. The payout always goes to the army's owner.

## What backs `redeem`

Only `StakeSale` may mint the game token, and the sale keeps the ETH it receives (it no longer forwards payments to a recipient), so every token in circulation was paid for at the fixed price and `redeem` is always solvent. Tokens burned by an unrevealed deployment (`docs/adr/0005-missed-reveal-freezes-the-army.md`) leave their ETH in the sale as surplus, which can only make it more solvent. We rejected keeping the template's free faucet mint because a fixed-price `redeem` would then pay ETH for tokens anyone can mint. Fresh deployments stay playable by buying through `StakeSale`.
