// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "./UsingGameBoard.sol";
import "../interfaces/UsingGameEvents.sol";
import "../interfaces/UsingGameErrors.sol";
import "../../utils/PositionUtils.sol";
import {ChessRules} from "./ChessRules.sol";
import {CommitReveal} from "../../commit-reveal/CommitReveal.sol";
import {Delegation} from "@etherplay/delegation/contracts/Delegation.sol";

/// @dev THIS GAME, ON THE COMMIT-REVEAL BASE. Everything that is mechanism -
///      the reserve, the bonded commitment, the chain of chunks, the cycle
///      policies, advance, attendance, delegation and both settlements - is
///      {UsingCommitReveal}'s (`src/commit-reveal/`), which this game keeps
///      rather than writes. What is here is what an ARMY is (the identity, at
///      the {_playerOf} seam), what deploying one does, and how the board is
///      resolved from what reveals recorded.
///
///      The rules themselves are {ChessRules}: pure, and shared by the reveal,
///      the resolving views and the simulation route.
/// @dev The one thing this game asks of its token beyond IERC20: that a holder
///      can burn its own balance (`GameToken.burn`).
interface IBurnableToken {
    function burn(uint256 amount) external;
}

/// @dev Where an exit's payout goes: the token's one minter, `StakeSale`,
///      which keeps the ETH every token was bought with.
interface IMintedToken {
    function minter() external view returns (address);
}

interface IStakeRedeemer {
    function redeem(uint256 amount, address payable to) external;
}

abstract contract UsingGameInternal is UsingGameBoard, UsingGameEvents {
    constructor(Config memory config) UsingGameBoard(config) {}

    // ------------------------------------------------------------------------
    // WHO PLAYS: ARMIES
    // ------------------------------------------------------------------------

    /// @notice Whether `id` is an army's id rather than an account's.
    /// @dev Army ids are `nonce << 160 | owner` with a nonce of at least one,
    ///      so every one of them is above `type(uint160).max`, where no
    ///      address-derived id can be: the two kinds of reserve can never be
    ///      the same reserve.
    function _isArmyId(uint256 id) internal pure returns (bool) {
        return id > type(uint160).max;
    }

    /// @notice The id of `owner`'s `nonce`th army.
    function _armyIdOf(
        address owner,
        uint256 nonce
    ) internal pure returns (uint256) {
        return (nonce << 160) | uint256(uint160(owner));
    }

    /// @notice WHO THE CALLER IS ACTING FOR: an army, through its owner.
    /// @dev THE BASE'S SEAM, overridden for one kind of id. An army is acted
    ///      for by its OWNER, or by a delegate of its owner, through the
    ///      template's delegation. An army that does not exist yet may be named
    ///      only as its owner's NEXT army, which is what a deployment commits
    ///      for (see {_createArmy}). An address-derived id is the base's: an
    ///      account, which is never a member (at a table too, the seat is an
    ///      army: `UsingGameTable-_joinTable`).
    function _playerOf(
        address sender,
        uint256 id
    ) internal view override returns (uint256 player) {
        if (!_isArmyId(id)) {
            return super._playerOf(sender, id);
        }
        address owner = _armies[id].owner;
        if (owner == address(0)) {
            owner = address(uint160(id));
            if (owner == address(0) || id >> 160 != _armyCountOf[owner] + 1) {
                revert InvalidPlayer(id);
            }
        }
        Delegation.requireAccountFor(sender, owner);
        return id;
    }

    /// @notice Create the army a deployment is committed for, and fund it.
    /// @param army An id {_playerOf} has resolved to an army not created yet.
    /// @dev THE STAKE MOVES BETWEEN TWO RESERVES and never leaves the
    ///      contract: out of the owner's account reserve (which must hold it,
    ///      or this reverts {ReserveTooLow}) and into the army's, which IS the
    ///      army's stake (`docs/adr/0006-stake-erc20-reserve-exit-only.md`).
    ///      Funding the army's reserve is also what makes it a waited-for
    ///      member, through the base's own rule, in the same cycle as the
    ///      commitment that follows: the denominator and the numerator grow
    ///      together.
    function _createArmy(uint256 army) internal {
        address owner = address(uint160(army));
        (uint64 cycleNumber, ) = _cycleNumber();
        _armyCountOf[owner] = army >> 160;
        // The first slot only: the rest of the record starts at zero, and
        // writing zero over zero would still pay for each slot.
        ArmyRecord storage record = _armies[army];
        record.owner = owner;
        record.deployCycle = _cycle32(cycleNumber);
        record.index = _registerArmy(army);
        // Only a cycle that advances reads who it waits for, so only there is
        // the army remembered for the sweep ({_sweepDeadArmies}).
        if (CYCLE_POLICY != CyclePolicy.Timed) {
            _awaitedArmies.push(army);
        }
        CommitReveal.withdraw(uint256(uint160(owner)), STAKE);
        _addToReserve(army, STAKE);
        emit ArmyCreated(army, owner, cycleNumber, STAKE);
    }

    // ------------------------------------------------------------------------
    // WHAT BECAME OF A DEPLOYMENT
    // ------------------------------------------------------------------------

    /// @notice Where `army`'s deployment stands at `cycleNumber`, resolved.
    /// @dev From closed-cycle facts only once its cycle is over, so neither the
    ///      order of that cycle's reveals nor the order of later reads can
    ///      change the answer.
    function _deploymentStatus(
        uint256 army,
        uint64 cycleNumber
    ) internal view returns (ArmyStatus) {
        ArmyRecord storage record = _armies[army];
        if (record.owner == address(0)) return ArmyStatus.None;
        if (record.cancelled) return ArmyStatus.Cancelled;
        // A TABLE'S ARMY IS DEPLOYED BY ITS PURCHASE, on a spawn point of its
        // own, and stands inert and hidden until the table starts
        // (`UsingGameTable-_joinTable`): nothing can fail it.
        if (record.atTable) {
            return
                _isBeforeTableStart()
                    ? ArmyStatus.Deploying
                    : ArmyStatus.Deployed;
        }
        uint64 deployCycle = record.deployCycle;
        if (deployCycle >= cycleNumber) return ArmyStatus.Deploying;
        uint32 indexPlusOne = record.spawnIndexPlusOne;
        if (indexPlusOne == 0) return ArmyStatus.Unrevealed;
        // Landed only if the spawn point's record is still the one of the
        // army's cycle and says it landed: a record started again since means
        // the spawn point was free, so this deployment failed.
        SpawnRecord storage spawn = _spawns[indexPlusOne - 1];
        if (
            spawn.cycle == deployCycle &&
            spawn.count == 1 &&
            !spawn.blocked &&
            spawn.armyIndex == record.index
        ) {
            return ArmyStatus.Deployed;
        }
        return ArmyStatus.Failed;
    }

    /// @notice Whether this is a table that has not started yet: its armies
    ///         stand inert and hidden on their spawn points until it does.
    /// @dev The lobby's `start()` calls no game code, so this is what every
    ///      read asks instead: nothing is written when a table starts.
    function _isBeforeTableStart() internal view returns (bool) {
        Roster memory roster = _roster();
        return roster.seats != 0 && !roster.started;
    }

    /// @notice THE ONE "DEAD" PREDICATE: whether `id` is an army that can never
    ///         act again, so that no cycle should wait for it.
    /// @dev A deployment that failed, was cancelled, or was never revealed,
    ///      an army whose king was taken or has exited, whose pieces have left
    ///      the board ({_fellIn}, one predicate for both), and a FROZEN army
    ///      ({_isFrozen}), which never commits again. An account is never dead by it: only armies can be.
    function _isDead(
        uint256 id,
        uint64 cycleNumber
    ) internal view returns (bool) {
        if (!_isArmyId(id)) return false;
        ArmyStatus status = _deploymentStatus(id, cycleNumber);
        if (status == ArmyStatus.Deployed) {
            return _isFrozen(id, cycleNumber) || _fellIn(id, cycleNumber) != 0;
        }
        return
            status == ArmyStatus.Failed ||
            status == ArmyStatus.Cancelled ||
            status == ArmyStatus.Unrevealed;
    }

    /// @notice THE ONE "FROZEN" DEFINITION: whether `army` is an army on the
    ///         board that a missed reveal has frozen for good at the start of
    ///         `cycleNumber` (`docs/adr/0005-missed-reveal-freezes-the-army.md`).
    /// @dev A FLAG OR A FACT. The base only runs {_forfeit} when somebody
    ///      settles the missed reveal, which sets the flag; until then the
    ///      unrevealed commitment of a cycle that is over says the same, so the
    ///      army is frozen from the moment its reveal window closes, whoever
    ///      settles it and whenever. A commitment of the current cycle can
    ///      still be revealed, so it freezes nothing yet. Only an army whose
    ///      deployment was revealed can be frozen: one never revealed has no
    ///      army to freeze, and its stake is burned instead.
    ///
    ///      Every check that cares reads this: a commitment ({_isDead}, so it
    ///      reverts `NotInGame`), the waited-for set (the advance's sweep and
    ///      {_effectiveAttendance}, through {_isDead}), and the registry
    ///      ({_armyView}, `isFrozen`).
    ///
    ///      A FROZEN KING NEVER EXITS, and nothing has to check it on the hot
    ///      path: a king moves only by its army's reveals, and an army that
    ///      missed the reveal of cycle C revealed nothing in C or after. An
    ///      exit by a move of an earlier cycle would have made it dead before
    ///      C, and a dead army's commitment in C reverts, so no army is ever
    ///      both frozen and exited (`test/js/Freeze.test.ts`).
    function _isFrozen(
        uint256 army,
        uint64 cycleNumber
    ) internal view returns (bool) {
        ArmyRecord storage record = _armies[army];
        if (record.spawnIndexPlusOne == 0) return false;
        if (record.frozen) return true;
        uint64 committedIn = _commitmentOf(army).cycleNumber;
        return committedIn != 0 && committedIn < cycleNumber;
    }

    /// @notice Write the refund of `army`'s failed deployment, if it is due:
    ///         its whole reserve back to its owner's ACCOUNT reserve.
    /// @return refunded What moved, zero if nothing was due.
    /// @dev Nothing runs when a cycle ends, so a failure is only known when
    ///      somebody next looks; this is where the looking is written down.
    ///      Credited WITHOUT A SEAT (`CommitReveal.deposit`): an account never
    ///      becomes a member. The army is no longer waited for, whatever the
    ///      policy.
    function _settleDeployment(
        uint256 army,
        uint64 cycleNumber
    ) internal returns (uint256 refunded) {
        if (!_isArmyId(army) || _reserveOf(army) == 0) return 0;
        if (_deploymentStatus(army, cycleNumber) != ArmyStatus.Failed) {
            return 0;
        }
        refunded = _refundArmy(army);
    }

    /// @notice Settle the deployment of `owner`'s most recent army, if it
    ///         failed: what the owner's next deployment and withdrawal do first.
    /// @dev Only the most recent: an account plays one army at a time, so that
    ///      is the one whose refund it is waiting for, and one bounds the gas
    ///      of every commit. Anything older is {IGameCommit-settleDeployment}'s.
    function _settleLatestOf(address owner, uint64 cycleNumber) internal {
        uint256 count = _armyCountOf[owner];
        if (count != 0) {
            _settleDeployment(_armyIdOf(owner, count), cycleNumber);
        }
    }

    /// @notice Cancel `army`'s deployment, if the commitment just cancelled
    ///         was its deployment: its whole stake goes back to its owner.
    /// @dev FREE, because nobody has revealed anything yet in a commit phase:
    ///      there is no option to buy by cancelling. The base only clears the
    ///      commitment (its bond is a lock on the reserve), so the refund is the
    ///      game's.
    function _cancelDeployment(uint256 army, uint64 cycleNumber) internal {
        if (!_isDeploying(army, cycleNumber)) return;
        _armies[army].cancelled = true;
        _refundArmy(army);
    }

    /// @dev Move an army's whole reserve to its owner's account reserve, and
    ///      stop waiting for it.
    function _refundArmy(uint256 army) private returns (uint256 amount) {
        amount = CommitReveal.debit(army, type(uint256).max);
        address owner = _armies[army].owner;
        if (amount != 0) {
            CommitReveal.deposit(uint256(uint160(owner)), amount);
        }
        _stopWaitingFor(army);
        emit DeploymentRefunded(army, owner, amount);
    }

    /// @notice WHAT NOT REVEALING COSTS, for an army.
    /// @dev THE BASE'S SEAM (`docs/adr/0005-missed-reveal-freezes-the-army.md`).
    ///      A missed DEPLOYMENT costs its whole stake, whatever the settlement
    ///      path and whatever was bonded, and the stake is BURNED: a real burn
    ///      that reduces the supply, not tokens left in the contract. There is
    ///      no army to freeze, so nothing returns and the army is no longer
    ///      waited for.
    ///
    ///      ANY OTHER MISSED REVEAL OF AN ARMY FREEZES IT, and takes NOTHING:
    ///      whatever was bonded stays in its reserve, which is its stake, on
    ///      the board as prey for whoever captures it. It was frozen already
    ///      ({_isFrozen}); settling writes it down for good and stops waiting
    ///      for it. An account's (a table's member) is the base's default.
    function _forfeit(
        uint256 player,
        uint256 amount
    ) internal override returns (uint256 forfeited) {
        if (_isArmyId(player)) {
            ArmyRecord storage army = _armies[player];
            if (army.spawnIndexPlusOne == 0 && !army.cancelled) {
                forfeited = CommitReveal.debit(player, type(uint256).max);
                if (forfeited != 0) {
                    IBurnableToken(address(TOKENS)).burn(forfeited);
                }
                _stopWaitingFor(player);
                emit StakeBurned(player, forfeited);
                return forfeited;
            }
            army.frozen = true;
            _stopWaitingFor(player);
            emit ArmyFrozen(player);
            return 0;
        }
        return super._forfeit(player, amount);
    }

    /// @notice Stop waiting for every army the advance would otherwise wait
    ///         for in vain. Called before the base's advance.
    /// @dev Under `Timed` nothing advances and nothing reads the count, and
    ///      the list is empty. Elsewhere the list is bounded by the seats, and
    ///      an army found dead leaves it for good, so each is swept once.
    function _sweepDeadArmies() internal {
        if (CYCLE_POLICY == CyclePolicy.Timed) return;
        (uint64 cycleNumber, ) = _cycleNumber();
        uint256 n = _awaitedArmies.length;
        for (uint256 k = n; k > 0; k--) {
            uint256 army = _awaitedArmies[k - 1];
            if (!_isDead(army, cycleNumber)) continue;
            _stopWaitingFor(army);
            uint256 last = _awaitedArmies.length - 1;
            if (k - 1 != last) _awaitedArmies[k - 1] = _awaitedArmies[last];
            _awaitedArmies.pop();
        }
    }

    /// @notice The attendance as the next advance judges it: an army the sweep
    ///         would stop waiting for is not counted as waited for.
    /// @dev What lets a client that mirrors the advance's guard
    ///      (`web/src/lib/game/core/advance.ts`) see that a dead army no longer
    ///      holds the cycle up, before anybody has swept it.
    function _effectiveAttendance(
        uint64 cycleNumber
    ) internal view returns (Attendance memory attendance) {
        attendance = _attendance(cycleNumber);
        if (CYCLE_POLICY == CyclePolicy.Timed) return attendance;
        for (uint256 k = 0; k < _awaitedArmies.length; k++) {
            uint256 army = _awaitedArmies[k];
            if (_isWaitedFor(army) && _isDead(army, cycleNumber)) {
                attendance.waitedFor -= 1;
            }
        }
    }

    // ------------------------------------------------------------------------
    // EXITS (`docs/adr/0006-stake-erc20-reserve-exit-only.md`)
    // ------------------------------------------------------------------------

    /// @notice Collect up to `budget` armies of the tree of stakes `army`
    ///         took into its payout, and say whether the whole tree is
    ///         collected.
    /// @dev NEVER A TRUNCATED PAYOUT, AND NEVER TWICE. A depth-first walk of
    ///      the tree of who took whose stake, kept in storage ({_toCollect})
    ///      so it can run over several transactions, unbounded in depth: a
    ///      victim counts when its stake really went to the army it is listed
    ///      under ({_captureOf}), which is a closed-cycle fact, and an exited
    ///      tree never changes. A STONE's stake went to nobody, so it is
    ///      skipped: it stays on the board as prey (`docs/adr/0014`). Each
    ///      army's whole reserve is DEBITED as it is collected, so nothing is
    ///      paid twice, and before that every victim of it has its taker
    ///      written (`capturedByIndex`), so no later fold can move a reserve into
    ///      an army already collected (`UsingGameBoard-_take` skips a written
    ///      one).
    function _collect(
        uint256 army,
        uint64 cycleNumber,
        uint256 budget
    ) internal returns (bool done) {
        ArmyRecord storage record = _armies[army];
        if (!_exited(army, cycleNumber)) revert NotExited(army);
        if (record.paid) revert AlreadyPaid(army);
        uint256[] storage stack = _toCollect[army];
        if (!record.collecting) {
            record.collecting = true;
            stack.push(army);
        }
        uint256 pot = _collected[army];
        while (stack.length != 0 && budget != 0) {
            budget--;
            uint256 node = stack[stack.length - 1];
            stack.pop();
            uint256[] storage victims = _capturesBy[node];
            for (uint256 k = 0; k < victims.length; k++) {
                uint256 victim = victims[k];
                if (_captureOf(victim, cycleNumber) != node) continue;
                bool seen = false;
                for (uint256 j = 0; j < k && !seen; j++) {
                    seen = victims[j] == victim;
                }
                if (seen) continue;
                ArmyRecord storage taken = _armies[victim];
                if (taken.capturedByIndex == 0) {
                    taken.capturedByIndex = _indexOf(node);
                }
                stack.push(victim);
            }
            pot += CommitReveal.debit(node, type(uint256).max);
        }
        _collected[army] = pot;
        return stack.length == 0;
    }

    /// @notice Pay `army`'s whole collected stake to its current owner, in
    ///         ETH, through the token's minter (`StakeSale.redeem`).
    /// @dev Marked paid before the external call.
    function _payExit(
        uint256 army,
        uint64 cycleNumber
    ) internal returns (uint256 paid) {
        // Unbounded: it finishes, or the transaction runs out of gas and the
        // tree is first {_collect}ed in parts.
        _collect(army, cycleNumber, type(uint256).max);
        _armies[army].paid = true;
        paid = _collected[army];
        delete _collected[army];
        address payable owner = payable(_armies[army].owner);
        if (paid != 0) {
            IStakeRedeemer(IMintedToken(address(TOKENS)).minter()).redeem(
                paid,
                owner
            );
        }
        emit ExitPaid(army, owner, paid);
    }

    // ------------------------------------------------------------------------
    // REVEAL
    // ------------------------------------------------------------------------

    /// @notice Apply one chunk of an army's revealed submission.
    /// @dev THE BASE CHECKS AND CHARGES, THE GAME RESOLVES: {_openChunk}
    ///      refuses a chunk that is not the head of the chain, {_closeChunk}
    ///      moves the chain on and counts the submission. Nothing a submission
    ///      does costs reserve here, so the cost is zero.
    ///
    ///      ORDER INDEPENDENCE. A reveal only ACCUMULATES facts (see
    ///      {_revealDeployment}); every comparison between two players' reveals
    ///      happens when the board is read, once the cycle is over
    ///      (`docs/adr/0002-order-free-lazy-resolution.md`).
    function _reveal(
        uint256 player,
        Move[] calldata moves,
        bytes32 secret,
        bytes24 furtherActions
    ) internal {
        CommitReveal.Chunk memory chunk = _openChunk(
            player,
            _digest(moves, secret, furtherActions),
            moves.length,
            furtherActions
        );

        // A deployment is revealed through {_revealDeploymentChunk}, on a
        // route of its own (`GameDeploymentReveal`), for size alone; `reveal`
        // forwards it there, so this only meets one that is not this cycle's.
        if (_isDeploying(player, chunk.cycleNumber)) revert InvalidDeployment();
        if (moves.length != 0 || furtherActions != bytes24(0)) {
            // ONE MOVE PER ARMY PER CYCLE (story 9): a submission is a pass
            // (nothing) or exactly one move, in one chunk. A move is validated
            // against the start-of-cycle board, so an account seated at a
            // table, which has no pieces, can only ever pass.
            if (moves.length != 1 || furtherActions != bytes24(0)) {
                revert OneMovePerCycle();
            }
            _revealMove(player, moves[0], chunk.cycleNumber);
        }

        _closeChunk(chunk, 0);
    }

    /// @notice {_reveal}, for the submission that is an army's deployment.
    function _revealDeploymentChunk(
        uint256 player,
        Move[] calldata moves,
        bytes32 secret,
        bytes24 furtherActions
    ) internal {
        CommitReveal.Chunk memory chunk = _openChunk(
            player,
            _digest(moves, secret, furtherActions),
            moves.length,
            furtherActions
        );
        if (!_isDeploying(player, chunk.cycleNumber)) {
            revert InvalidDeployment();
        }
        _revealDeployment(player, moves, furtherActions, chunk.cycleNumber);
        _closeChunk(chunk, 0);
    }

    /// @notice Whether `player`'s submission in `cycleNumber` is its
    ///         deployment: an army whose deployment was committed in that cycle
    ///         and has not been revealed.
    function _isDeploying(
        uint256 player,
        uint64 cycleNumber
    ) internal view returns (bool) {
        if (!_isArmyId(player)) return false;
        ArmyRecord storage army = _armies[player];
        return army.spawnIndexPlusOne == 0 && army.deployCycle == cycleNumber;
    }

    /// @notice Record a deployment's spawn point.
    /// @dev VALIDATED AGAINST THE START OF THE CYCLE: the spawn point must be in
    ///      the open set as it stood when the cycle began, which depends only on
    ///      deployments of earlier cycles and so is the same whichever reveal of
    ///      this cycle lands first.
    ///
    ///      THEN ONLY ACCUMULATED. The spawn point's record counts this cycle's
    ///      deployments onto it, and keeps the army only for the case where the
    ///      count is one. Whether the deployment LANDS is decided when the
    ///      cycle is over and the record is read: one deployment lands, two or
    ///      more all fail, by the count and never by who revealed first or
    ///      last.
    ///
    ///      THE ONE BRANCH ON SHARED STATE, AND WHY IT IS ORDER-FREE. The first
    ///      reveal of a cycle onto a spawn point starts a fresh record (it may
    ///      hold a failed deployment of an earlier cycle, which is free and is
    ///      simply overwritten), and the rest add one. After any set of reveals,
    ///      in any order, the record holds this cycle, the number of reveals,
    ///      and an army that is the only one whenever the number is one. What
    ///      differs with order is which army sits in a record whose count says
    ///      to ignore it, and which reveal pays to start the record. Neither is
    ///      part of the game. `test/js/Deployment.test.ts` replays the reveals
    ///      in both orders.
    function _revealDeployment(
        uint256 player,
        Move[] calldata moves,
        bytes24 furtherActions,
        uint64 cycleNumber
    ) internal {
        if (
            furtherActions != bytes24(0) ||
            moves.length != 1 ||
            moves[0].from != moves[0].to
        ) {
            revert InvalidDeployment();
        }
        uint64 spawnPoint = moves[0].to;
        (bool onGrid, uint256 index) = ChessRules.spawnIndexOf(
            spawnPoint,
            SPAWN_SPACING
        );
        if (!onGrid) revert NotASpawnPoint(spawnPoint);

        (uint64[] memory open, uint64 next, bool changed) = _openSet(
            cycleNumber
        );
        bool isOpen = false;
        for (uint256 i = 0; i < open.length; i++) {
            if (open[i] == index) {
                isOpen = true;
                break;
            }
        }
        if (!isOpen) revert SpawnPointNotOpen(spawnPoint);

        // KEEPING THE OPEN SET CURRENT IS A CACHE OF PAST CYCLES: the set it
        // writes is the start-of-cycle set, which every reveal of this cycle
        // computes identically, so whichever writes it changes nothing anyone
        // gets. It has to be written before a deployment lands on a fresh
        // index, which is why it is a deployment's reveal that writes it.
        if (changed) {
            _openSpawnIndices = open;
            _nextSpawnIndex = next;
        }

        // THE FOOTPRINT, judged once per cycle by its first reveal, from facts
        // that are the same for every reveal of the cycle: the start-of-cycle
        // board, and whether a move of this cycle has already arrived on it
        // (one that arrives later blocks the record itself: `_markArrival`).
        SpawnRecord storage spawn = _spawns[index];
        if (spawn.cycle != cycleNumber) {
            bool blocked =
                spawn.arrivedIn == cycleNumber ||
                    !_footprintClear(spawnPoint, cycleNumber);
            spawn.cycle = cycleNumber;
            spawn.count = 1;
            spawn.blocked = blocked;
            spawn.armyIndex = _indexOf(player);
        } else {
            spawn.count += 1;
        }
        _armies[player].spawnIndexPlusOne = uint32(index + 1);

        emit DeploymentRevealed(player, spawnPoint, cycleNumber);
    }

    /// @notice Settle one chunk of a missed reveal, shown its moves.
    /// @dev A MISSED DEPLOYMENT FORFEITS THE STAKE, which is everything the
    ///      army holds, and {_forfeit} burns it: a deployment that could be
    ///      watched and then dropped for free would make committing one an
    ///      option rather than a choice
    ///      (`docs/adr/0005-missed-reveal-freezes-the-army.md`). A missed pass
    ///      forfeits nothing here; what a missed move costs is the freeze.
    function _acknowledgeMissedReveal(
        uint256 player,
        Move[] calldata moves,
        bytes32 secret,
        bytes24 furtherActions
    ) internal {
        uint64 committedIn = _commitmentOf(player).cycleNumber;
        CommitReveal.Chunk memory chunk = _openMissedChunk(
            player,
            _digest(moves, secret, furtherActions),
            moves.length,
            furtherActions
        );
        _closeChunk(chunk, _isDeploying(player, committedIn) ? STAKE : 0);
    }

    /// @notice The hash a chunk of moves is committed under.
    /// @dev ONE ENCODING, ALWAYS, the base's, including for the last chunk,
    ///      where `furtherActions` is zero and is hashed in anyway. The client
    ///      builds the same bytes (`web/src/lib/chess/commit-reveal.ts`).
    function _digest(
        Move[] calldata moves,
        bytes32 secret,
        bytes24 furtherActions
    ) internal pure returns (bytes24) {
        return bytes24(keccak256(abi.encode(secret, moves, furtherActions)));
    }

    // ------------------------------------------------------------------------
    // RESOLVING
    // ------------------------------------------------------------------------

    /// @notice THE OPEN SET at the start of `cycleNumber`: the spiral indices
    ///         of the free spawn points nearest the origin, and the next fresh
    ///         index after them, and whether that differs from what is
    ///         stored (which a deployment's reveal then writes).
    /// @dev See {_openSpawnIndices} for the invariant that makes this K reads.
    function _openSet(
        uint64 cycleNumber
    ) internal view returns (uint64[] memory open, uint64 next, bool changed) {
        next = _nextSpawnIndex;
        if (next == 0) {
            open = new uint64[](OPEN_SPAWN_POINTS);
            for (uint64 i = 0; i < OPEN_SPAWN_POINTS; i++) open[i] = i;
            next = OPEN_SPAWN_POINTS;
            changed = true;
        } else {
            open = _openSpawnIndices;
        }
        for (uint256 i = 0; i < open.length; i++) {
            (bool landed, ) = _landedBefore(open[i], cycleNumber);
            if (landed) {
                open[i] = next;
                next++;
                changed = true;
            }
        }
    }

    /// @notice One army as the registry shows it, resolved for `cycleNumber`.
    function _armyView(
        uint256 id,
        uint64 cycleNumber
    ) internal view returns (ArmyView memory view_) {
        ArmyRecord memory army = _armies[id];
        view_.id = id;
        if (army.owner == address(0)) return view_;
        view_.owner = army.owner;
        view_.deployedIn = army.deployCycle;
        view_.stake = _reserveOf(id);
        view_.status = _deploymentStatus(id, cycleNumber);
        if (army.spawnIndexPlusOne == 0) return view_;
        view_.spawnPoint = ChessRules.spawnPointAt(
            army.spawnIndexPlusOne - 1,
            SPAWN_SPACING
        );
        if (view_.status != ArmyStatus.Deployed) return view_;
        // RESOLVED FROM THE FACTS, like its pieces: what it holds, whichever
        // squares have been read or folded yet. The stake is the bounded
        // view's ({_treeStake}).
        if (_exited(id, cycleNumber)) {
            view_.status = ArmyStatus.Exited;
            view_.stake =
                army.paid
                    ? 0
                    : _collected[id] +
                        _treeStake(id, cycleNumber, STAKE_VIEW_DEPTH);
            return view_;
        }
        view_.king = _kingAt(id, view_.spawnPoint, cycleNumber);
        view_.stake = _stakeOf(id, cycleNumber);
        if (_fellIn(id, cycleNumber) != 0) {
            // Taken: its stake is its taker's, or, a stone's, its own.
            view_.status = ArmyStatus.Captured;
            view_.capturedBy = _captureOf(id, cycleNumber);
            return view_;
        }
        // Frozen, it stays on the board with its stake (story 37).
        if (_isFrozen(id, cycleNumber)) view_.status = ArmyStatus.Frozen;
    }

    /// @notice Every piece on the squares from (`minX`,`minY`) to
    ///         (`maxX`,`maxY`), resolved for `cycleNumber`.
    /// @dev TWO SOURCES, NEVER BOTH FOR ONE SQUARE. A square some reveal has
    ///      touched has a record and is resolved from it ({_squareAt}), found
    ///      through the zone index; every other square holds what the
    ///      deployment over it laid there, if one has landed. A square is
    ///      covered by at most one spawn point's footprint (the spacing is at
    ///      least the footprint's width), and a footprint reaches at most 3
    ///      squares left of / below its spawn point and 2 right of / above it,
    ///      so the spawn points to lay out are those within that margin of the
    ///      rectangle. The order of the answer depends only on what is on the
    ///      board, never on the order of the reveals that put it there.
    function _piecesIn(
        int32 minX,
        int32 minY,
        int32 maxX,
        int32 maxY,
        uint64 cycleNumber
    ) internal view returns (Piece[] memory pieces) {
        if (maxX < minX || maxY < minY) return new Piece[](0);
        // A table's armies are hidden until it starts.
        if (_isBeforeTableStart()) return new Piece[](0);
        Rect memory rect = Rect(minX, minY, maxX, maxY);
        uint64[] memory spawnPoints;
        uint256[] memory armies;
        (spawnPoints, armies) = _landedAround(rect, cycleNumber);
        uint64[] memory touched = _touchedIn(rect);

        pieces = new Piece[](
            spawnPoints.length * ChessRules.ARMY_SIZE + touched.length
        );
        uint256 n = 0;
        for (uint256 k = 0; k < spawnPoints.length; k++) {
            // A fallen army's pieces have left the board.
            if (_fellIn(armies[k], cycleNumber) != 0) continue;
            n = _appendArmy(
                pieces,
                n,
                rect,
                ChessRules.layout(spawnPoints[k], armies[k])
            );
        }
        for (uint256 k = 0; k < touched.length; k++) {
            Piece memory piece = _squareAt(touched[k], cycleNumber);
            if (piece.kind == PieceKind.None) continue;
            pieces[n] = piece;
            n++;
        }
        assembly {
            mstore(pieces, n)
        }
    }

    /// @notice The captures and collisions of `cycleNumber` on the squares of
    ///         the rectangle whose record still holds that cycle's facts.
    /// @dev See {IGameGetters-getOutcomes}. Only a record OF `cycleNumber` is
    ///      read, so an older one (an idle square) and a newer one (a reveal of
    ///      the open cycle) are both skipped, and the resolution is
    ///      {ChessRules-settle} and {ChessRules-outcome} on the facts the board
    ///      read folds in, so the two cannot disagree.
    function _outcomesIn(
        int32 minX,
        int32 minY,
        int32 maxX,
        int32 maxY,
        uint64 cycleNumber
    ) internal view returns (SquareOutcome[] memory outcomes) {
        if (maxX < minX || maxY < minY) return outcomes;
        uint64[] memory touched = _touchedIn(Rect(minX, minY, maxX, maxY));
        outcomes = new SquareOutcome[](touched.length);
        uint256 n = 0;
        for (uint256 k = 0; k < touched.length; k++) {
            SquareRecord storage record = _squares[touched[k]];
            if (record.cycle != cycleNumber || record.arrivals == 0) continue;
            (Piece memory captured, uint256 died) = ChessRules.outcome(
                _standingOf(record, touched[k]),
                record.departed,
                record.arrivals,
                record.kingArrived
            );
            if (died == 0 && captured.kind == PieceKind.None) continue;
            outcomes[n++] = SquareOutcome({
                position: touched[k],
                died: uint32(died),
                captured: captured,
                piece: _squareAt(touched[k], cycleNumber + 1)
            });
        }
        assembly {
            mstore(outcomes, n)
        }
    }

    /// @dev The spawn points whose deployment has landed and whose footprint
    ///      can reach `rect`, and their armies.
    function _landedAround(
        Rect memory rect,
        uint64 cycleNumber
    )
        private
        view
        returns (uint64[] memory spawnPoints, uint256[] memory armies)
    {
        int256 s = int256(uint256(SPAWN_SPACING));
        int256 i0 = _ceilDiv(int256(rect.minX) - 2, s);
        int256 i1 = _floorDiv(int256(rect.maxX) + 2, s);
        int256 j0 = _ceilDiv(int256(rect.minY) - 2, s);
        int256 j1 = _floorDiv(int256(rect.maxY) + 2, s);
        if (i1 < i0 || j1 < j0) return (spawnPoints, armies);
        uint256 points = uint256((i1 - i0 + 1) * (j1 - j0 + 1));
        spawnPoints = new uint64[](points);
        armies = new uint256[](points);
        uint256 landed = 0;
        for (int256 j = j0; j <= j1; j++) {
            for (int256 i = i0; i <= i1; i++) {
                (bool isLanded, uint256 army) = _landedBefore(
                    ChessRules.spiralIndex(i, j),
                    cycleNumber
                );
                if (!isLanded) continue;
                spawnPoints[landed] = PositionUtils.fromXY(
                    int32(i * s),
                    int32(j * s)
                );
                armies[landed] = army;
                landed++;
            }
        }
        assembly {
            mstore(spawnPoints, landed)
            mstore(armies, landed)
        }
    }

    /// @dev Every square in `rect` that has a record, zone by zone and in the
    ///      zone index's bit order.
    function _touchedIn(
        Rect memory rect
    ) private view returns (uint64[] memory squares) {
        int32 zx0 = PositionUtils.zoneCoord(rect.minX);
        int32 zx1 = PositionUtils.zoneCoord(rect.maxX);
        int32 zy0 = PositionUtils.zoneCoord(rect.minY);
        int32 zy1 = PositionUtils.zoneCoord(rect.maxY);
        uint256 total = 0;
        uint256 zones = uint256(int256(zx1 - zx0 + 1) * int256(zy1 - zy0 + 1));
        uint256[] memory bits = new uint256[](zones);
        uint256 z = 0;
        for (int32 zy = zy0; zy <= zy1; zy++) {
            for (int32 zx = zx0; zx <= zx1; zx++) {
                uint256 b = _touchedSquares[
                    (uint64(uint32(zy)) << 32) + uint64(uint32(zx))
                ];
                bits[z++] = b;
                for (; b != 0; b &= b - 1) total++;
            }
        }
        squares = new uint64[](total);
        uint256 n = 0;
        z = 0;
        for (int32 zy = zy0; zy <= zy1; zy++) {
            for (int32 zx = zx0; zx <= zx1; zx++) {
                n = _appendZone(squares, n, rect, zx, zy, bits[z++]);
            }
        }
        assembly {
            mstore(squares, n)
        }
    }

    /// @dev Append the squares of zone (`zx`,`zy`) whose bit is set in `b`
    ///      and that lie in `rect`.
    function _appendZone(
        uint64[] memory squares,
        uint256 n,
        Rect memory rect,
        int32 zx,
        int32 zy,
        uint256 b
    ) private pure returns (uint256) {
        int32 x0 = zx * 16 - 8;
        int32 y0 = zy * 16 - 8;
        for (uint256 k = 0; b != 0; k++) {
            if (b & (uint256(1) << k) == 0) continue;
            b &= ~(uint256(1) << k);
            int32 x = x0 + int32(int256(k % 16));
            int32 y = y0 + int32(int256(k / 16));
            if (x < rect.minX || x > rect.maxX) continue;
            if (y < rect.minY || y > rect.maxY) continue;
            squares[n++] = PositionUtils.fromXY(x, y);
        }
        return n;
    }

    /// @dev A viewport, inclusive on every side.
    struct Rect {
        int32 minX;
        int32 minY;
        int32 maxX;
        int32 maxY;
    }

    /// @dev Copy the pieces of `army` that stand inside `rect`, on squares no
    ///      reveal has touched, to `pieces` from index `n`, and return the
    ///      index after the last.
    function _appendArmy(
        Piece[] memory pieces,
        uint256 n,
        Rect memory rect,
        Piece[] memory army
    ) private view returns (uint256) {
        for (uint256 p = 0; p < army.length; p++) {
            uint64 position = army[p].position;
            (int32 x, int32 y) = PositionUtils.toXY(position);
            if (x < rect.minX || x > rect.maxX) continue;
            if (y < rect.minY || y > rect.maxY) continue;
            if (_squares[position].cycle != 0) continue;
            pieces[n] = army[p];
            n++;
        }
        return n;
    }
}
