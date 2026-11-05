// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

// The delegation surface is NOT restated here. It is composed from the
// interface that ships beside the implementation in the etherplay delegation
// package, so the router's selector list and the library cannot drift: a
// restatement is a copy, and the failure it produces is a selector that routes
// nowhere, which reads to a player as a broken wallet rather than as a missing
// feature.
import {IDelegation} from "@etherplay/delegation/contracts/IDelegation.sol";

import {ICommitRevealLobby} from "../../commit-reveal/interfaces/ICommitRevealLobby.sol";

import "./UsingGameTypes.sol";
import "./UsingGameEvents.sol";
import "./UsingGameErrors.sol";

/// @dev EVERY `player` HERE IS A `uint256`, and it is the identity rather than
///      an account: what this game means by a player is decided in exactly one
///      place, {UsingCommitReveal-_playerOf}. In this game it is an ARMY
///      (`CONTEXT.md`): an id above `type(uint160).max`, so that army ids and
///      the address-derived ids of accounts can never collide. An army id is
///      `nonce << 160 | owner`, the owner's `nonce`th army, so the client can
///      name the army its next deployment creates before committing it. See
///      `web/src/lib/game/identity.ts` for the client's half of the same rule.
interface IGameCommit is UsingGameTypes {
    /// @notice Credit an ACCOUNT's reserve: stake bought, not yet deployed.
    /// @dev Takes `player` rather than crediting msg.sender, so that the stake
    ///      can be paid from the wallet holding the funds. Anyone may top up
    ///      anyone; only the owner can withdraw.
    ///
    ///      AN ACCOUNT RESERVE NEVER MAKES ITS ACCOUNT A MEMBER: only armies are
    ///      waited for (`docs/adr/0006-stake-erc20-reserve-exit-only.md`).
    ///      Refuses an army id with {InvalidPlayer}, so nobody can pre-fund a
    ///      future army or slip extra stake into an existing one.
    function addToReserve(uint256 player, uint256 amount) external;

    /// @notice Take tokens back out of the CALLER'S ACCOUNT reserve.
    /// @dev Deliberately NOT delegable: a delegate may spend the reserve on
    ///      playing and may never withdraw it. And it only ever reaches an
    ///      account's reserve, because an army id is never an address: an
    ///      army's reserve IS its stake and leaves only through the game.
    ///      Settles the caller's most recent deployment first
    ///      ({settleDeployment}), so a failed one's refund can be withdrawn.
    function withdrawFromReserve(uint256 amount) external;

    /// @notice Write the refund of `army`'s failed deployment: its stake goes
    ///         back to its owner's ACCOUNT reserve, and it is no longer waited
    ///         for. Anyone may call it, once the deployment's cycle is over.
    /// @return refunded What moved; zero (and nothing happens) if the army's
    ///         deployment did not fail, or its refund is already written.
    /// @dev A deployment fails when another reveals the same spawn point in
    ///      its cycle, or its footprint is not clear (a piece on it at the start
    ///      of the cycle, or one arriving on it during it). Nothing runs when a
    ///      cycle ends, so the refund waits for this call; the owner's next
    ///      deployment and withdrawal make it for their most recent army.
    function settleDeployment(uint256 army) external returns (uint256 refunded);

    /// @notice Commit to this cycle's submission for `player`.
    /// @param player The army the commitment is FOR (zero for the caller's own
    ///        account, which only a table seats). Must be one the caller may act
    ///        for: its owner, or a delegate of its owner.
    /// @dev A COMMITMENT FOR AN ARMY THAT DOES NOT EXIST YET IS ITS DEPLOYMENT,
    ///      and it creates it: `player` must be the owner's next army id
    ///      ({IGameGetters-getNextArmy}), the stake moves from the owner's
    ///      account reserve into the new army's reserve, and the army becomes a
    ///      waited-for member, committed in this same cycle. Its reveal names
    ///      the spawn point.
    function makeCommitment(
        uint256 player,
        bytes24 commitmentHash,
        uint256 bond,
        address payable payee
    ) external payable;

    /// @notice Withdraw a commitment before the reveal phase begins.
    /// @dev Cancelling a DEPLOYMENT is free: the army's whole stake goes back
    ///      to its owner's account reserve, and the cycle stops waiting for
    ///      the army, which never exists on the board.
    function cancelCommitment(uint256 player) external;

    // The settlements of a missed reveal and the advance live on the commit
    // route rather than the reveal route only for SIZE: the reveal route holds
    // the whole move rule and has no room left under the 24,576-byte limit.

    /// @notice Settle one chunk of a missed reveal by showing it.
    /// @dev Anyone may call it. A missed DEPLOYMENT forfeits the whole stake,
    ///      which is burned; a missed pass forfeits nothing here
    ///      (`docs/adr/0005-missed-reveal-freezes-the-army.md` is what a missed
    ///      move costs, and it is not this route's).
    function acknowledgeMissedReveal(
        uint256 player,
        Move[] calldata moves,
        bytes32 secret,
        bytes24 furtherActions
    ) external;

    /// @notice Settle a missed reveal WITHOUT its chunks, forfeiting the whole
    ///         bond still earmarked for it (for a missed deployment, the whole
    ///         stake, burned). Only the owner or their delegate.
    function forfeitMissedReveal(uint256 player) external;

    /// @notice Move the cycle on, if the rules already permit it. See the base.
    /// @dev First stops waiting for every dead army (a failed, cancelled or
    ///      unrevealed deployment), under `Manual` and `TimedWithEarlyAdvance`.
    function advanceCycle()
        external
        returns (uint64 cycleNumber, bool commiting);
}

interface IGameReveal is UsingGameTypes {
    /// @notice Reveal one chunk of what an army committed to, and apply it.
    /// @dev Takes `player` rather than using msg.sender so that anyone can
    ///      reveal for them. A CALLER RESUMES FROM THE CHAIN, NOT FROM MEMORY:
    ///      see the base.
    ///
    ///      An army whose deployment was committed this cycle reveals that
    ///      deployment: exactly one move, from and to the spawn point, which
    ///      must have been open at the START of the cycle. Any other submission
    ///      is a pass (no move) or exactly ONE move of one of the army's
    ///      pieces, legal on the board as it stood at the START of the cycle
    ///      ({IGameSimulation-legalMoves}); anything else reverts
    ///      {OneMovePerCycle} or {IllegalMove}.
    function reveal(
        uint256 player,
        Move[] calldata moves,
        bytes32 secret,
        bytes24 furtherActions,
        address payable payee
    ) external payable;
}

interface IGameGetters is UsingGameTypes {
    function getCycleNumber()
        external
        view
        returns (uint64 cycleNumber, bool commiting);

    /// @notice Where the cycle is, and until when. THE ONE A CLIENT SHOULD READ.
    function getCycle() external view returns (Cycle memory cycle);

    /// @notice Who the cycle is waiting for, and how many have acted.
    function getAttendance()
        external
        view
        returns (Attendance memory attendance);

    function getCommitment(
        uint256 player
    ) external view returns (Commitment memory commitment);

    function getReserve(uint256 player) external view returns (uint256 amount);

    function getConfig() external view returns (Config memory config);

    /// @notice Every piece on the squares from (`minX`,`minY`) to
    ///         (`maxX`,`maxY`) inclusive, RESOLVED, plus the cycle the answer
    ///         is for.
    /// @dev The client reads the board through this and nothing else, and only
    ///      the area in view: there is no indexer for state
    ///      (`docs/adr/0007-rules-live-only-in-the-contract.md`). What is stored
    ///      is the cycle's accumulated facts, so the board is worked out here,
    ///      lazily (`docs/adr/0002-order-free-lazy-resolution.md`).
    function getPieces(
        int32 minX,
        int32 minY,
        int32 maxX,
        int32 maxY
    ) external view returns (Piece[] memory pieces, uint64 cycleNumber);

    /// @notice The spawn points a deployment committed now may reveal: the
    ///         free ones nearest the origin, in spiral order, as they stood at
    ///         the start of the current cycle.
    function getOpenSpawnPoints()
        external
        view
        returns (uint64[] memory spawnPoints, uint64 cycleNumber);

    /// @notice One army, resolved.
    function getArmy(uint256 army) external view returns (ArmyView memory);

    /// @notice THE ARMY REGISTRY, a page at a time, resolved: every army ever
    ///         created, in the order they were.
    function getArmies(
        uint256 offset,
        uint256 limit
    ) external view returns (ArmyView[] memory armies, uint256 total);

    /// @notice Every army `owner` has created, resolved.
    function getArmiesOf(
        address owner
    ) external view returns (ArmyView[] memory armies);

    /// @notice The id `owner`'s next deployment creates.
    function getNextArmy(address owner) external view returns (uint256 army);
}

interface IGameSimulation is UsingGameTypes {
    /// @notice The pieces an army deployed at `spawnPoint` stands on, by the
    ///         rule the board is resolved with, and with nothing read or
    ///         written.
    /// @dev A client runs it from the deployed bytecode in its own sandbox
    ///      (`web/src/lib/game/simulation/`) to show where a planned army will
    ///      stand, so the preview is the rule and not a copy of it.
    function previewDeployment(
        uint64 spawnPoint,
        uint256 army
    ) external view returns (Piece[] memory pieces);

    /// @notice Every square the piece on `from` may move to, by the rule the
    ///         reveal applies, judged against `board`: the board as it stood at
    ///         the start of the cycle, as {IGameGetters-getPieces} returns it.
    ///         Empty if `board` has nothing on `from`.
    /// @dev Reads nothing: the client runs it in its sandbox to highlight a
    ///      selected piece's legal destinations, so the highlight is the rule
    ///      and not a copy of it. It only judges what `board` holds, so pass it
    ///      every piece within reach (8 squares around `from` is enough: the
    ///      slider range is 7 and a king looks one square past its
    ///      destination).
    function legalMoves(
        Piece[] calldata board,
        uint64 from
    ) external pure returns (uint64[] memory destinations);
}

interface IGame is
    IGameCommit,
    IGameReveal,
    IGameGetters,
    IGameSimulation,
    IDelegation
{}

/// @notice A game at a table for a fixed set of players: the whole game, plus
///         the lobby's routes. What a clone made by {CommitRevealGameFactory}
///         answers to; the persistent world answers to {IGame} alone.
interface IGameLobby is IGame, ICommitRevealLobby {}
