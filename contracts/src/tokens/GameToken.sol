// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "solidity-kit/solc_0_8/ERC20/implementations/ERC20Base.sol";

/// @notice The token players stake in order to deploy an army.
/// @dev ONLY ITS MINTER MAY MINT, and the minter is `StakeSale`, which keeps
///      the ETH every token was bought with, so every token in circulation is
///      backed at the sale's fixed price and `StakeSale.redeem` is always
///      solvent (`docs/adr/0006-stake-erc20-reserve-exit-only.md`). The minter
///      is set ONCE, by the owner, after the sale is deployed: the sale's
///      constructor takes this token, so this token cannot take the sale. The
///      owner is a constructor argument because under CREATE2 `msg.sender` is
///      the factory.
contract GameToken is ERC20Base {
    error NotOwner(address sender);
    error NotMinter(address sender);
    error MinterAlreadySet(address minter);

    string public constant name = "Game Token";
    string public constant symbol = "GAME";

    /// @notice who may set the minter, once
    address public immutable OWNER;
    /// @notice the only address that may mint, and burn on a redemption
    address public minter;

    constructor(address owner) {
        OWNER = owner;
    }

    /// @notice Name the minter. Once: replacing it would leave the ETH backing
    ///         the tokens already sold in a sale that could no longer redeem.
    function setMinter(address newMinter) external {
        if (msg.sender != OWNER) revert NotOwner(msg.sender);
        if (minter != address(0)) revert MinterAlreadySet(minter);
        minter = newMinter;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != minter) revert NotMinter(msg.sender);
        _mint(to, amount);
    }

    /// @notice Burn `amount` of `from`'s balance: the minter's half of a
    ///         redemption, which only ever burns from its own caller.
    function burnFrom(address from, uint256 amount) external {
        if (msg.sender != minter) revert NotMinter(msg.sender);
        _burnFrom(from, amount);
    }

    /// @notice Burn `amount` of the caller's own balance, reducing the supply.
    /// @dev What the game calls with the stake of a deployment that was never
    ///      revealed (`docs/adr/0005-missed-reveal-freezes-the-army.md`).
    function burn(uint256 amount) external {
        _burnFrom(msg.sender, amount);
    }
}
