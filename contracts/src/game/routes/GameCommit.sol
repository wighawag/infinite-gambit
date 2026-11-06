// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "../internal/UsingGameInternal.sol";
import "../interfaces/IGame.sol";

contract GameCommit is IGameCommit, UsingGameInternal {
    constructor(Config memory config) UsingGameInternal(config) {}

    /// @inheritdoc IGameCommit
    function withdrawFromReserve(uint256 amount) external {
        // A failed deployment's refund is the account's to withdraw: written
        // first, so the player never has to know it was still pending.
        (uint64 cycleNumber, ) = _cycleNumber();
        _settleLatestOf(msg.sender, cycleNumber);
        if (amount > 0) {
            // `msg.sender` and NOT `_playerOf`, which is the whole point of
            // this function: a delegate may spend the reserve on playing and
            // may never take it out. And it is only ever an ACCOUNT's reserve,
            // because no army id is an address: an army's stake does not leave
            // through here.
            _withdrawFromReserve(uint256(uint160(msg.sender)), amount);
            TOKENS.transfer(msg.sender, amount);
        }
    }

    /// @inheritdoc IGameCommit
    function makeCommitment(
        uint256 player,
        bytes24 commitmentHash,
        uint256 bond,
        address payable payee
    ) external payable {
        uint256 resolved = _playerOf(msg.sender, player);
        if (_isArmyId(resolved)) {
            (uint64 cycleNumber, ) = _cycleNumber();
            if (_armies[resolved].owner == address(0)) {
                // A commitment for an army that does not exist yet is its
                // deployment: `_playerOf` only lets that through for the
                // owner's next army. The owner's previous deployment is
                // settled first, so a failed one's refund pays for this one.
                _settleLatestOf(address(uint160(resolved)), cycleNumber);
                _createArmy(resolved);
            } else if (_isDead(resolved, cycleNumber)) {
                // A dead army is still waited for until an advance sweeps it,
                // and a commitment from it would count towards a unanimity
                // its own sweep then shrinks.
                revert NotInGame(resolved);
            }
        }
        _makeCommitment(resolved, commitmentHash, bond);

        // extra steps for which we do not intend to track via events
        if (payee != address(0) && msg.value != 0) {
            payee.transfer(msg.value);
        }
    }

    /// @inheritdoc IGameCommit
    function cancelCommitment(uint256 player) external {
        uint256 resolved = _playerOf(msg.sender, player);
        _cancelCommitment(resolved);
        // A deployment cancelled in its commit phase is refunded in full.
        (uint64 cycleNumber, ) = _cycleNumber();
        _cancelDeployment(resolved, cycleNumber);
    }

    /// @inheritdoc IGameCommit
    function acknowledgeMissedReveal(
        uint256 player,
        Move[] calldata moves,
        bytes32 secret,
        bytes24 furtherActions
    ) external {
        _acknowledgeMissedReveal(player, moves, secret, furtherActions);
    }

    /// @inheritdoc IGameCommit
    function forfeitMissedReveal(uint256 player) external {
        _forfeitMissedReveal(msg.sender, player);
    }

    /// @inheritdoc IGameCommit
    /// @dev Its own entry point, deliberately: a reveal never advances
    ///      anything, whoever sends it and whenever it lands.
    function advanceCycle()
        external
        returns (uint64 cycleNumber, bool commiting)
    {
        // DEAD ARMIES STOP BEING WAITED FOR first: a failed or cancelled
        // deployment never commits again, and a cycle that waited for it would
        // never advance.
        _sweepDeadArmies();
        return _advanceCycle();
    }

    /// @inheritdoc IGameCommit
    function settleDeployment(
        uint256 army
    ) external returns (uint256 refunded) {
        (uint64 cycleNumber, ) = _cycleNumber();
        return _settleDeployment(army, cycleNumber);
    }
}
