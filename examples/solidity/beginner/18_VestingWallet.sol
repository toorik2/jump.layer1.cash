// Source: OpenZeppelin Contracts v5.5.0
// Holds and releases assets according to a vesting schedule
// https://github.com/OpenZeppelin/openzeppelin-contracts

// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.5.0) (finance/VestingWallet.sol)

pragma solidity ^0.8.20;

/**
 * @dev A vesting wallet is an ownable contract that can receive native currency and ERC-20 tokens, and release these
 * assets to the wallet owner according to a vesting schedule.
 *
 * Note: This is a simplified standalone version. The original imports IERC20, SafeERC20, Address, Context, and Ownable.
 */
contract VestingWallet {
    event EtherReleased(uint256 amount);

    uint256 private _released;
    uint64 private immutable _start;
    uint64 private immutable _duration;
    address private immutable _beneficiary;

    constructor(address beneficiary, uint64 startTimestamp, uint64 durationSeconds) payable {
        _beneficiary = beneficiary;
        _start = startTimestamp;
        _duration = durationSeconds;
    }

    receive() external payable virtual {}

    function beneficiary() public view virtual returns (address) {
        return _beneficiary;
    }

    function start() public view virtual returns (uint256) {
        return _start;
    }

    function duration() public view virtual returns (uint256) {
        return _duration;
    }

    function end() public view virtual returns (uint256) {
        return start() + duration();
    }

    function released() public view virtual returns (uint256) {
        return _released;
    }

    function releasable() public view virtual returns (uint256) {
        return vestedAmount(uint64(block.timestamp)) - released();
    }

    function release() public virtual {
        uint256 amount = releasable();
        _released += amount;
        emit EtherReleased(amount);
        payable(beneficiary()).transfer(amount);
    }

    function vestedAmount(uint64 timestamp) public view virtual returns (uint256) {
        return _vestingSchedule(address(this).balance + released(), timestamp);
    }

    function _vestingSchedule(uint256 totalAllocation, uint64 timestamp) internal view virtual returns (uint256) {
        if (timestamp < start()) {
            return 0;
        } else if (timestamp >= end()) {
            return totalAllocation;
        } else {
            return (totalAllocation * (timestamp - start())) / duration();
        }
    }
}
