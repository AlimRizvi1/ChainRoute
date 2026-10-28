// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./ChainRouteSettlement.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Gas-only freight initiation. Receipts are not currency or freight escrow.
/// The original shipper/carrier remain the contract parties after a receipt transfer.
contract ChainRouteFreightDApp is ChainRouteSettlement, ERC721, ReentrancyGuard {
    error PlanAlreadyInitiated();
    mapping(bytes32 => uint256) public freightForPlan;
    mapping(uint256 => bytes32) public receiptTermsHash;
    mapping(uint256 => uint64) public receiptCreatedAt;
    uint256 public totalFreightReceipts;

    event FreightInitiated(uint256 indexed contractId, address indexed shipper,
        uint256 indexed tokenId, bytes32 termsHash, uint64 timestamp);

    constructor() ERC721("ChainRoute Freight Receipt", "CRFR") {}

    function initiateFreight(string calldata planId, address carrier, Terms calldata terms)
        external nonReentrant returns (uint256 contractId)
    {
        bytes32 key = keccak256(abi.encode(msg.sender, planId));
        if (freightForPlan[key] != 0) revert PlanAlreadyInitiated();
        (contractId,) = _createAgreement(planId, msg.sender, carrier, terms);
        freightForPlan[key] = contractId;
        receiptTermsHash[contractId] = terms.termsHash;
        receiptCreatedAt[contractId] = uint64(block.timestamp);
        totalFreightReceipts++;
        _safeMint(msg.sender, contractId);
        emit FreightInitiated(contractId, msg.sender, contractId, terms.termsHash, uint64(block.timestamp));
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat("data:application/json;base64,", Base64.encode(bytes(string.concat(
            '{"name":"ChainRoute Freight Receipt #', Strings.toString(tokenId),
            '","description":"Freight agreement receipt. Not currency, payment, or legal cargo title.",',
            '"attributes":[{"trait_type":"Agreement ID","value":"', Strings.toString(tokenId),
            '"},{"trait_type":"Chain ID","value":"', Strings.toString(block.chainid),
            '"},{"trait_type":"Created at Unix","value":"', Strings.toString(receiptCreatedAt[tokenId]),
            '"},{"trait_type":"Terms hash","value":"', Strings.toHexString(uint256(receiptTermsHash[tokenId]), 32),
            '"}]}'
        ))));
    }
}
