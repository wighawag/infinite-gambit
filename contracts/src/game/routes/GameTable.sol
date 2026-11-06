// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "../internal/UsingGameTable.sol";
import "../interfaces/IGame.sol";

/// @dev BUYING IN, and A TABLE'S SEATS AND PAYOUT. `addToReserve` is here
///      rather than on {GameCommit} because at a table it creates an army,
///      which no longer fits beside the commitments under the deployed-size
///      limit. Behind the world's router too: there, buying in credits an
///      account and nothing else here can be called usefully.
contract GameTable is IGameStake, IGameTable, UsingGameTable {
    constructor(Config memory config) UsingGameInternal(config) {}

    /// @inheritdoc IGameStake
    function addToReserve(uint256 player, uint256 amount) external {
        // An army's reserve is its stake: funded once, at its creation, and by
        // nothing else.
        if (_isArmyId(player)) {
            revert InvalidPlayer(player);
        }
        if (amount > 0) {
            // Paid by msg.sender, CREDITED to `player`: the stake is paid from
            // the wallet holding the funds, the game is played by a local key
            // that holds none. A gift to someone else's reserve is safe, since
            // only its owner can withdraw it.
            if (_roster().seats != 0) {
                // AT A TABLE THE SEAT IS THE ARMY: one stake, one new army.
                if (amount != STAKE) revert WrongStake(amount, STAKE);
                _joinTable(address(uint160(player)));
            } else {
                // CREDITED WITHOUT TAKING A SEAT. Only armies are waited for:
                // an account that became a member by buying stake would stall
                // every policy that waits for everyone.
                CommitReveal.deposit(player, amount);
            }
            TOKENS.transferFrom(msg.sender, address(this), amount);
        }
    }

    /// @inheritdoc IGameTable
    function leaveTable(uint256 army) external returns (uint256 amount) {
        return _leaveTable(msg.sender, army);
    }

    /// @inheritdoc IGameTable
    function tally(uint256 maxSteps) external returns (bool done) {
        return _tally(maxSteps);
    }

    /// @inheritdoc IGameTable
    function claim(uint256 army) external returns (uint256 paid) {
        return _claim(army);
    }

    /// @inheritdoc IGameTable
    function getTableOutcome() external view returns (TableOutcome memory) {
        return _tableOutcome();
    }

    /// @inheritdoc IGameTable
    function getTableShare(
        uint256 army
    ) external view returns (uint256 share, bool paid) {
        return (_shareOf(army), _armies[army].paid);
    }
}
