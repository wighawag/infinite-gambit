// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "../internal/UsingGameInternal.sol";
import "../interfaces/IGame.sol";

contract GameCommit is IGameCommit, UsingGameInternal {
    constructor(Config memory config) UsingGameInternal(config) {}

    /// @inheritdoc IGameCommit
    function addToReserve(uint256 player, uint256 amount) external {
        // An army's reserve is its stake: funded once, by its deployment, from
        // its owner's reserve, and by nothing else.
        if (_isArmyId(player)) {
            revert InvalidPlayer(player);
        }
        if (amount > 0) {
            // Paid by msg.sender, CREDITED to `player`: the stake is paid from
            // the wallet holding the funds, the game is played by a local key
            // that holds none. A gift to someone else's reserve is safe, since
            // only its owner can withdraw it.
            //
            // CREDITED WITHOUT TAKING A SEAT. Only armies are waited for: an
            // account that became a member by buying stake would stall every
            // policy that waits for everyone, since an account never commits.
            // AT A TABLE the template's rule still holds until this game seats
            // its armies there (`work/tasks/backlog/chess-tables.md`): the
            // credited account takes the seat, and can only pass.
            if (_roster().seats != 0) {
                _addToReserve(player, amount);
            } else {
                CommitReveal.deposit(player, amount);
            }
            TOKENS.transferFrom(msg.sender, address(this), amount);
        }
    }

    /// @inheritdoc IGameCommit
    function withdrawFromReserve(uint256 amount) external {
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
        // A commitment for an army that does not exist yet is its deployment:
        // `_playerOf` only lets that through for the owner's next army.
        if (_isArmyId(resolved) && _armies[resolved].owner == address(0)) {
            _createArmy(resolved);
        }
        _makeCommitment(resolved, commitmentHash, bond);

        // extra steps for which we do not intend to track via events
        if (payee != address(0) && msg.value != 0) {
            payee.transfer(msg.value);
        }
    }

    /// @inheritdoc IGameCommit
    function cancelCommitment(uint256 player) external {
        _cancelCommitment(_playerOf(msg.sender, player));
    }
}
