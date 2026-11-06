// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "../internal/UsingGameInternal.sol";

/// @dev TEST ONLY, never deployed by a deploy script: writes the registry's
///      merge pointers and reserves directly, so a suite can build a tree of
///      captures deeper than `MAX_CHAIN`, which would take hundreds of cycles
///      on a board, and check that a walk past the bound is a rock and that an
///      exit's collection takes the whole tree
///      (`docs/adr/0011-an-exit-removes-its-own-army-and-leaves-rocks.md`).
contract GameTreeHarness is UsingGameInternal {
    constructor(Config memory config) UsingGameInternal(config) {}

    function setArmy(uint256 id, uint256 reserve) external {
        _armies[id].owner = address(uint160(id));
        CommitReveal.deposit(id, reserve);
    }

    function setCapture(uint256 victim, uint256 captor) external {
        _armies[victim].capturedInto = captor;
        _capturesBy[captor].push(victim);
    }

    function setExited(uint256 id) external {
        _armies[id].exited = true;
    }

    function armyOf(uint256 id) external view returns (uint256) {
        (uint64 cycleNumber, ) = _cycleNumber();
        return _armyOf(id, cycleNumber);
    }

    function collect(uint256 army, uint256 budget) external returns (bool) {
        (uint64 cycleNumber, ) = _cycleNumber();
        return _collect(army, cycleNumber, budget);
    }

    function collected(uint256 army) external view returns (uint256) {
        return _collected[army];
    }

    function reserveOf(uint256 id) external view returns (uint256) {
        return _reserveOf(id);
    }
}
