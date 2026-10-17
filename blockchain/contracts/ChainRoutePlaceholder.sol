// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract ChainRoutePlaceholder {
    uint256 public value;

    function version() external pure returns (string memory) {
        return "chainroute-phase-2-placeholder";
    }

    function setValue(uint256 newValue) external {
        value = newValue;
    }
}
