# Commit-reveal games

The vocabulary of a template for simultaneous-turn games: everyone acts at the
same time, hidden, and the results are applied together. A game built from this
template inherits these words and adds its own; nothing here describes a
particular game, and nothing here is implementation.

Where a word belongs to the FRAMEWORK it is used nowhere else. Where a word is
reserved for GAMES the framework never uses it, so that a game can mean by it
whatever its players would mean.

## Language

### The clock

**Cycle**:
One numbered interval of play: a commit phase, then a reveal phase, and nothing
else. Every player may act at most once in it.
_Avoid_: epoch, round, turn, tick, period, era

**Commit phase**:
The half of a cycle in which a player may hide what they intend to do. There is
no other way into a cycle.
_Avoid_: planning phase, submission window

**Reveal phase**:
The half of a cycle in which a hidden intention is opened and applied. It always
follows the commit phase of the same cycle, which is why an intention committed
in the current cycle can always still be opened.
_Avoid_: resolution phase, settlement window

**Cycle policy**:
How cycles advance: on the clock, only when someone pushes them, or on the clock
with unanimity able to bring the next phase forward.
_Avoid_: epoch mode, turn mode

**Advance**:
Moving the cycle on by a transaction rather than by the clock. It may only ever
do what the rules already permit, so anyone may do it and it is nobody's move.
_Avoid_: skip, force, tick

**Waited-for member**:
Someone the cycle blocks on: unanimity is measured against this count and not
against who is alive. A game decides separately what it costs to stop being one.
_Avoid_: roster, active player, participant

### The player

**Submission**:
One player's pass through one cycle: planning actions, hiding them, committing,
and then opening them or losing what was at stake.
_Avoid_: round, turn, commitment, action set

**Actions**:
What a player submits into a cycle. ORDERED, because two orderings of the same
actions are two different commitments, and each game defines what one is.
_Avoid_: moves, orders, action set

**Chunk**:
As many actions as one TRANSACTION may carry. A submission longer than a chunk
is opened in several reveals, in order. It bounds the transaction and never the
submission: how many actions a submission may contain at all is a game's own
rule, which the framework does not have and does not take a word for.
_Avoid_: batch, page, part, step

**Commitment**:
The hidden form of a submission: the head of a hash chain, each link holding one
chunk and the hash of the next. What the chain holds between committing and
revealing, and until every chunk has arrived.
_Avoid_: hash, sealed move, bid

**Stake**:
Whatever a player loses by never revealing. Every game must have one, and no two
games need agree on what it is.
_Avoid_: bond, deposit, collateral

**Forfeit**:
Ceasing to be a waited-for member, and nothing else. It settles nothing, returns
nothing and burns nothing: a forfeit that paid out would be a costless way to
not reveal.
_Avoid_: quit, withdraw, resign, settle

### Before the first cycle

**Lobby**:
Where it is settled who will be in a game, BEFORE it exists. It is not a
waiting room: what makes somebody a waited-for member is being given whatever
this game puts at stake, and that happens once, while the game is being set up.
So a lobby is the last moment membership can be decided at all, and changing it
afterwards means a different game rather than a different setting.
_Avoid_: menu, room, matchmaking, setup

**Seat**:
One place in a lobby, which becomes one waited-for member. A seat is not a
player count: it has an OCCUPANT, and the question a lobby answers is who is in
each one rather than how many there are.
_Avoid_: slot, player slot, spot

**Occupant**:
Who is in a seat. It is the axis along which lobbies differ - a person at this
browser, a person at the same keyboard, something the machine plays - and
nothing else about a seat changes when it changes.
_Avoid_: participant, agent, bot, NPC

**Played seat**:
A seat the machine ACTS FOR, because its occupant is the machine. It is not a
kind of player and the word deliberately describes the seat rather than
inventing one: what makes it necessary is the clock, not the game. A cycle waits
for every member, so a member that never acts does not make a quiet game, it
makes a frozen one - which means whoever sets a game up either plays these seats
or does not enrol them. The smallest thing that gives a cycle somebody to wait
for: no intelligence, no difficulty, no interface.
_Avoid_: bot, NPC, AI, opponent, computer player, played player

**Table**:
One game for a fixed set of members, at an address of its own: created by anyone (its CREATOR) with a number of seats, its seats taken by staking at it, and started by the creator once two are seated, which closes its roster. A table is a clone of its game's lobby implementation made by the game's factory, so what the client knows of it is only its address (`?game=<address>`). The persistent world is not a table: it has open entry and no creator.
_Avoid_: room, match, instance, lobby (a table is IN its lobby until its creator starts it)

**Hotseat**:
Several people at ONE device, each in a seat of their own and each their own account in the world's wallet, passing the device between them. Real commit-reveal, the same code path as online: one person commits, hands the device over, the next commits, and nobody reveals by hand (the world's local REVEALER, given each turn at its commit, sends every reveal from a key of its own). What it hides is the shared screen, not anything in the browser's storage.
_Avoid_: local multiplayer, pass-and-play, shared account

**Handover**:
The moment the device changes hands in a hotseat, and the screen that covers the game while it does: nothing of the previous person's turn is mounted, the next person presses to begin, and only then is the world's connection switched to their account and the game shown. Whose turn it is comes from the chain, so a reload lands on the handover for the right person.
_Avoid_: turn change (`turn` is the game's word), switch screen

### Who is who

**Identity**:
Who plays, as the game counts players. It may be an account, or a token the
account owns, and everything a player holds is keyed by it.
_Avoid_: player address, user, avatar

**Account**:
The address that OWNS: the stake, the identity, and anything won. It authorises
others to act for it and can always take that back.
_Avoid_: wallet, owner, user

**Signer**:
A key held in one browser that acts FOR an account, so that a cycle costs no
prompts. It owns nothing and can never withdraw anything.
_Avoid_: burner, delegate key, session key

### Reserved for games, never used by the framework

**Round**:
Whatever a game builds out of several cycles, if it builds anything: the rounds
of a duel, a match, a day. The framework has no such concept and takes no
position on it.

**Turn**:
Whatever a game calls one player's contribution, if it wants the word. Games
here are simultaneous, so a turn is not an interval; and in a game whose actions
are directions, turning is also a move. This template's own reference game takes
the word: what the framework calls a submission, its HUD calls a turn.

## This game: infinite chess

chess-battleground is an onchain infinite-board chess game. Players stake to deploy an army at a hidden spawn point, every army makes one simultaneous move per cycle (commit then reveal), capturing a king takes its stake and absorbs its army, and the stake only leaves through an exit square. It also runs online as closed tables with a winner, and offline as a hotseat world where each seat is a human at the same device or a machine-played seat (single player is the latter).

Everything above this heading is the framework's and stays game-neutral. The words below are this game's own. The full rule set is in `work/specs/`, and the decisions behind it are in `docs/adr/`.

**Army**:
One king, the stake it holds, and every piece under it. An army is this game's **identity**: one army is one player as the cycle counts players, owned by an account and acted for by its signer. An account may stake several armies, each one its own identity. Its stake is its OWN reserve, funded from the account's reserve at deployment: the army's reserve leaves only through an exit (a capture does not move it: the captor's stake counts the reserves of every army merged into it), while the account's reserve (stake not yet deployed, refunds) stays redeemable (`docs/adr/0006-stake-erc20-reserve-exit-only.md`).
_Avoid_: player, faction, team, side

**Move**:
This game's action: one chess move by one piece. An army submits at most one move per cycle, however many pieces it has, and may submit none (a pass).
_Avoid_: turn, action (in game-facing text), order

**Spawn point**:
A point on a fixed grid where an army may be deployed. Only the few free spawn points nearest the origin are open, so the world stays dense as it grows.
_Avoid_: slot, start position, base

**Deployment**:
Placing a new army, committed and revealed like a move so nobody knows which spawn point was chosen until it is on the board. It FAILS, and its stake is refunded to the account's reserve, if another deployment reveals the same spawn point in the same cycle or its footprint is not clear; the refund is written by `settleDeployment` (anyone may call it, and the account's next deployment or withdrawal does). Cancelling one in its commit phase is free. One never revealed has its stake burned.
_Avoid_: spawn (as a noun for the act), join, enter

**Footprint**:
The twenty squares a deployment's layout puts a piece on (the 6 by 4 rectangle without its empty corners). It is clear when none is occupied at the start of the deployment's cycle and no piece arrives on one during it.
_Avoid_: base, area, zone (a zone is the board read's 16 by 16 index)

**Dead army**:
An army that can never act again, so no cycle waits for it: today a deployment that failed, was cancelled or was never revealed, or an army whose king was taken (later an exited or frozen army). One predicate in the contract (`_isDead`); an advance stops waiting for every dead army first.
_Avoid_: eliminated, gone, inactive

**Exit**:
A square where a king may leave the world with its stake. It is the only way a stake leaves.
_Avoid_: withdraw, cash out, escape

**Capture**:
Taking a piece that stayed put: by being the only piece to arrive on its square, or by being a moving king that survives a crowd of arrivals there (`docs/adr/0003-collision-table-king-survives-a-crowd.md`). Capturing a king takes its stake and merges its army.
_Avoid_: kill, take (in code)

**Merge**:
What happens to an army whose king is captured, or dies in a collision with a single enemy piece: its pieces join the captor's army, which still makes one move per cycle. Resolved lazily: each army keeps who took its king, and a piece's army is followed through those to the end of the chain (A takes B while C takes A: C owns both), so it never matters which squares were read first.
_Avoid_: absorb, conquer, annex

**Collision**:
Two or more pieces arriving on the same square in the same cycle. Who survives depends only on how many arrived and whether a king is among them, never on the order of reveals.
_Avoid_: clash, conflict, bounce

**Capture loop**:
Kings capturing each other in a ring within one cycle (A takes B while B takes A, or longer). The king-capturing pieces die, every king survives, and each owner takes over the army they captured.
_Avoid_: mutual capture, swap, draw

**Freeze**:
What a missed reveal does to an army: it never moves again and its king cannot exit, but it can still be captured. An army is frozen as soon as its reveal window closes unrevealed, before anyone settles it (frozen flag OR an unrevealed commitment from a past cycle). In the framework's terms it is a forfeit, and the cycle stops waiting for it.
_Avoid_: ban, lock, penalty

## The work/ contract

Planning lives in `work/` on `main` (this is a final game, not a template, so there is no orphan `work` branch). The reference docs are in `work/protocol/`, copied by dorfl's `setup` and re-synced by `dorfl sync`: never edit them here. Status is the folder an item is in. `work/specs/` holds product intent, `work/tasks/` the build board, `work/notes/{ideas,observations,findings}` captured signals (findings are external ground truth, each with a `source:`), and `work/questions/` what needs a human. `docs/adr/` records what we decided and why.

**promptGuidance**:
The NUDGE namespace in `dorfl.json`. Its one member, `testFirst`, is on here: autonomous builds are told to write the failing test first. It is not a gate; `verify` alone decides pass/fail.

## Conventions

- **dorfl is pinned.** `dorfl` is a root `devDependency` at an exact version and `dorfl.json` sets `"dorflCmd": "node_modules/.bin/dorfl"`, so bare `dorfl` forwards to the pinned copy. To upgrade: bump the version in `package.json`, `pnpm install`, then `dorfl sync`.
- No changeset or changelog entry is required per change.
