// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "./UsingGameInternal.sol";

/// @dev A TABLE: the same rules as the world, for a closed roster, with a
///      winner (`work/specs/tasked/infinite-chess.md`, stories 38 to 42).
///
///      THE SEAT IS THE ARMY. A table's roster is the base's (`_openRoster`,
///      seated by funding a reserve, started by its creator), and what funds a
///      reserve here is a purchase that creates an army ({_joinTable}): so the
///      members are armies, which is what the cycle counts as players. There is
///      no deployment commit at a table: before the start nobody is waited for,
///      so a commitment would revert `NotInGame`, and after it nobody is seated.
///
///      NO START HOOK. The lobby's `start()` calls no game code, so an army is
///      written whole at its purchase, on a spawn point of its own, and is
///      INERT (nobody can commit before the start) and HIDDEN (every read asks
///      {UsingGameInternal-_isBeforeTableStart}) until the table starts.
///
///      NO EXITS ({UsingGameBoard-_exited}): a table ends with the last king
///      standing, who takes every stake, or at its last cycle, where the stakes
///      are split by the material each standing army has left ({_claim}).
abstract contract UsingGameTable is UsingGameInternal {
    /// @dev The squares of a footprint's 5 by 5 square, corners included: what
    ///      the count of material walks per army ({_tallyStep}).
    uint256 private constant FOOTPRINT_CELLS = 25;

    // ------------------------------------------------------------------------
    // BUYING IN
    // ------------------------------------------------------------------------

    /// @notice Buy a seat for `owner`: a new army, funded with one stake, on
    ///         the table's next spawn point.
    /// @dev THE PURCHASE IS THE DEPLOYMENT. The army's spawn record is written
    ///      as a deployment of this cycle that landed alone on a clear
    ///      footprint, which is what every read of the board already resolves
    ///      ({UsingGameBoard-_landedBefore}); a table starts in a later cycle
    ///      than any purchase, so it is on the board from the first cycle
    ///      played. Its spawn point comes from a counter that ONLY INCREASES
    ///      ({TableState-spawned}), never from the seat order, which the base
    ///      reorders whenever somebody leaves: a leaver leaves a gap. No two
    ///      seats share a spawn point, so nothing can collide, and the
    ///      footprints are clear because nothing has moved yet.
    ///
    ///      Seating is the base's: funding the army's reserve takes the seat,
    ///      reverting `GameAlreadyStarted` or `GameFull`.
    function _joinTable(address owner) internal returns (uint256 army) {
        if (owner == address(0)) revert InvalidPlayer(0);
        (uint64 cycleNumber, ) = _cycleNumber();
        uint256 nonce = _armyCountOf[owner] + 1;
        army = _armyIdOf(owner, nonce);
        _armyCountOf[owner] = nonce;
        uint32 index = _table.spawned;
        _table.spawned = index + 1;
        uint32 armyIndex = _registerArmy(army);
        ArmyRecord storage record = _armies[army];
        record.owner = owner;
        record.deployCycle = _cycle32(cycleNumber);
        record.spawnIndexPlusOne = index + 1;
        record.index = armyIndex;
        record.atTable = true;
        if (CYCLE_POLICY != CyclePolicy.Timed) {
            _awaitedArmies.push(army);
        }
        _spawns[index] = SpawnRecord({
            cycle: cycleNumber,
            count: 1,
            blocked: false,
            arrivedIn: 0,
            armyIndex: armyIndex
        });
        _addToReserve(army, STAKE);
        emit ArmyCreated(army, owner, cycleNumber, STAKE);
        emit TableSeatTaken(
            army,
            ChessRules.spawnPointAt(index, SPAWN_SPACING)
        );
    }

    /// @notice `sender` leaves the table before it starts with `army`.
    /// @dev THE ONE EXCEPTION to "an army's reserve is never withdrawn"
    ///      (`docs/adr/0006-stake-erc20-reserve-exit-only.md`): nothing has
    ///      been played before the start, so there is no fight to leave. The
    ///      army is removed (cancelled, its spawn record cleared so nothing of
    ///      it is laid on the board) and its seat freed; its spawn point stays
    ///      used, so nobody else's moves.
    function _leaveTable(
        address sender,
        uint256 army
    ) internal returns (uint256 amount) {
        Roster memory roster = _roster();
        if (roster.seats == 0) revert NoRoster();
        if (roster.started) revert GameAlreadyStarted();
        ArmyRecord storage record = _armies[army];
        if (!record.atTable || record.cancelled) revert InvalidPlayer(army);
        address owner = record.owner;
        if (sender != owner) revert NotArmyOwner(army);
        record.cancelled = true;
        delete _spawns[record.spawnIndexPlusOne - 1];
        amount = CommitReveal.debit(army, type(uint256).max);
        _leaveSeat(army);
        if (amount != 0) TOKENS.transfer(owner, amount);
        emit TableLeft(army, owner, amount);
    }

    // ------------------------------------------------------------------------
    // THE END
    // ------------------------------------------------------------------------

    /// @notice How many of the table's armies stand at the start of
    ///         `cycleNumber` (deployed and not captured: a frozen king stands),
    ///         and the last of them.
    /// @dev Bounded by the seats. ORDER-FREE: from closed-cycle facts only,
    ///      and once one army alone stands it stays alone, since a capture is
    ///      never undone and nobody else can join.
    function _standing(
        uint64 cycleNumber
    ) internal view returns (uint256 count, uint256 last) {
        uint256 n = _armyIds.length;
        for (uint256 k = 0; k < n; k++) {
            uint256 army = _armyIds[k];
            if (_isStanding(army, cycleNumber)) {
                count++;
                last = army;
            }
        }
    }

    function _isStanding(
        uint256 army,
        uint64 cycleNumber
    ) internal view returns (bool) {
        return
            _deploymentStatus(army, cycleNumber) == ArmyStatus.Deployed &&
            _fellIn(army, cycleNumber) == 0;
    }

    /// @notice The cycle the cap's board is read at: the one after the last.
    /// @dev Every fact is then of a cycle that is over, so the board read
    ///      there is final, whenever the count runs.
    function _capCycle() internal view returns (uint64) {
        return _lastCycleNumber() + 1;
    }

    /// @notice Count up to `budget` steps of the material each standing army
    ///         has on the board at the cap.
    /// @dev ONE PASS OVER EVERY SQUARE THAT CAN HOLD A PIECE, each once: the
    ///      footprints of the table's armies where no reveal ever touched them
    ///      (one step per square), then every zone a reveal touched
    ///      ({_tableZones}, one step per zone). A piece counts for the army it
    ///      is labelled with ({_squareAt}): a fallen army's pieces read as
    ///      empty, a promoted queen counts 9 and a stone nothing
    ///      ({ChessRules-materialOf}).
    ///      Kept in storage, so it can run over several transactions; nothing
    ///      changes the board after the cap, so the order of the steps and of
    ///      the transactions cannot change the count.
    function _tally(uint256 budget) internal returns (bool done) {
        if (!_hasEnded()) revert TableNotOver();
        TableState storage table = _table;
        if (table.tallied) return true;
        uint64 capCycle = _capCycle();
        uint256 footprints = _armyIds.length * FOOTPRINT_CELLS;
        uint256 total = footprints + _tableZones.length;
        uint256 k = table.tallyCursor;
        uint256 material = table.totalMaterial;
        for (; k < total && budget != 0; k++) {
            budget--;
            if (k < footprints) {
                material += _tallyFootprintCell(k, capCycle);
            } else {
                material += _tallyZone(_tableZones[k - footprints], capCycle);
            }
        }
        table.tallyCursor = uint64(k);
        table.totalMaterial = material;
        done = k == total;
        if (done) table.tallied = true;
    }

    /// @dev Cell `k % 25` of the 5 by 5 square of army `k / 25`, if no reveal
    ///      touched it (a touched square is its zone's).
    function _tallyFootprintCell(
        uint256 k,
        uint64 capCycle
    ) private returns (uint256) {
        uint256 cell = k % FOOTPRINT_CELLS;
        uint256 r = cell / 5;
        uint256 c = cell % 5;
        if (!ChessRules.onFootprint(r, c)) return 0;
        uint32 indexPlusOne = _armies[_armyIds[k / FOOTPRINT_CELLS]]
            .spawnIndexPlusOne;
        uint64 position = ChessRules.layoutSquare(
            ChessRules.spawnPointAt(indexPlusOne - 1, SPAWN_SPACING),
            r,
            c
        );
        if (_squares[position].cycle != 0) return 0;
        return _tallySquare(position, capCycle);
    }

    /// @dev Every touched square of `zone`.
    function _tallyZone(
        uint64 zone,
        uint64 capCycle
    ) private returns (uint256 material) {
        (int32 zx, int32 zy) = PositionUtils.toXY(zone);
        int32 x0 = zx * 16 - 8;
        int32 y0 = zy * 16 - 8;
        uint256 b = _touchedSquares[zone];
        for (uint256 i = 0; b != 0; i++) {
            if (b & (uint256(1) << i) == 0) continue;
            b &= ~(uint256(1) << i);
            material += _tallySquare(
                PositionUtils.fromXY(
                    x0 + int32(int256(i % 16)),
                    y0 + int32(int256(i / 16))
                ),
                capCycle
            );
        }
    }

    function _tallySquare(
        uint64 position,
        uint64 capCycle
    ) private returns (uint256 value) {
        Piece memory piece = _squareAt(position, capCycle);
        if (piece.army == 0) return 0;
        value = ChessRules.materialOf(piece.kind);
        if (value != 0) _materialOf[piece.army] += value;
    }

    /// @notice The table's outcome now, without writing anything.
    function _tableOutcome()
        internal
        view
        returns (TableOutcome memory outcome)
    {
        TableState storage table = _table;
        outcome.settled = table.settled;
        outcome.tallied = table.tallied;
        outcome.pot = table.pot;
        outcome.totalMaterial = table.totalMaterial;
        if (table.settled) {
            outcome.over = true;
            outcome.winner = table.winner;
            return outcome;
        }
        Roster memory roster = _roster();
        if (roster.seats == 0 || !roster.started) return outcome;
        (uint64 cycleNumber, ) = _cycleNumber();
        (uint256 count, uint256 last) = _standing(cycleNumber);
        if (count == 1) {
            outcome.over = true;
            outcome.winner = last;
        } else {
            outcome.over = _hasEnded();
        }
    }

    /// @notice Write the table's outcome and gather every stake on it into
    ///         the pot, once: by the first {_claim}.
    /// @dev THE LAST KING STANDING TAKES EVERYTHING, before the cap or at it.
    ///      Otherwise, at the cap, the material is counted first (the rest of
    ///      {_tally}, unbounded: a count too big for one transaction is
    ///      {IGameTable-tally}'d in parts beforehand). The pot is every army's
    ///      reserve, debited, whether a fold has moved it up to its taker yet
    ///      or not, a stone's included: every stake is in it, each once, and a
    ///      stone's that nobody took is split with the rest.
    function _settleTable() internal {
        TableOutcome memory outcome = _tableOutcome();
        if (!outcome.over) revert TableNotOver();
        TableState storage table = _table;
        if (outcome.winner != 0) {
            table.winner = outcome.winner;
        } else {
            _tally(type(uint256).max);
            (uint256 count, ) = _standing(_capCycle());
            table.standing = uint32(count);
        }
        uint256 pot = 0;
        uint256 n = _armyIds.length;
        for (uint256 k = 0; k < n; k++) {
            pot += CommitReveal.debit(_armyIds[k], type(uint256).max);
        }
        table.pot = pot;
        table.settled = true;
        emit TableSettled(table.winner, pot, table.totalMaterial);
    }

    /// @notice What `army` is owed by the table's written outcome.
    /// @dev Rounded down, so the shares never add up to more than the pot.
    function _shareOf(uint256 army) internal view returns (uint256) {
        TableState storage table = _table;
        if (!table.settled || !_armies[army].atTable) return 0;
        if (table.winner != 0) return army == table.winner ? table.pot : 0;
        if (table.totalMaterial != 0) {
            return (table.pot * _materialOf[army]) / table.totalMaterial;
        }
        // Nobody has any material left: the standing kings split it evenly.
        if (table.standing == 0 || !_isStanding(army, _capCycle())) return 0;
        return table.pot / table.standing;
    }

    /// @notice Pay `army`'s share, in ETH, to its current owner, through the
    ///         token's minter (`StakeSale.redeem`), as an exit pays.
    /// @dev Marked paid before the external call.
    function _claim(uint256 army) internal returns (uint256 paid) {
        Roster memory roster = _roster();
        if (roster.seats == 0) revert NoRoster();
        if (!roster.started) revert GameNotStarted();
        ArmyRecord storage record = _armies[army];
        if (!record.atTable) revert InvalidPlayer(army);
        if (record.paid) revert AlreadyPaid(army);
        if (!_table.settled) _settleTable();
        paid = _shareOf(army);
        if (paid == 0) revert NothingToClaim(army);
        record.paid = true;
        address payable owner = payable(record.owner);
        IStakeRedeemer(IMintedToken(address(TOKENS)).minter()).redeem(
            paid,
            owner
        );
        emit TablePaid(army, owner, paid);
    }
}
