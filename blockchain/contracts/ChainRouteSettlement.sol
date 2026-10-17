// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract ChainRouteSettlement {
    enum ContractState {
        Created,
        Booked,
        InTransit,
        Delivered,
        PenaltyCalculated,
        PaymentReleased,
        Closed,
        Disputed
    }

    enum ShipmentStatus {
        Dispatched,
        CheckpointReached,
        ArrivedAtDestination
    }

    struct Terms {
        uint256 freightValuePaise;
        uint64 slaDeadline;
        uint16 penaltyBpsPerBlock;
        uint32 penaltyBlockSeconds;
        uint16 freeHoldingHours;
        uint256 demurrageRatePaisePerWagonHour;
        uint32 wagonCount;
        bytes32 termsHash;
    }

    struct Agreement {
        uint256 contractId;
        string planId;
        address shipper;
        address carrier;
        Terms terms;
        ContractState state;
        bool onTime;
        uint64 secondsLate;
        uint64 deliveryTimestamp;
        string podReference;
        uint256 penaltyPaise;
        uint256 demurragePaise;
        uint256 netPaymentPaise;
    }

    struct HistoryEntry {
        uint8 action;
        address actor;
        uint64 timestamp;
        bytes32 dataHash;
    }

    error NotAuthorized();
    error NotCarrier();
    error UnknownContract(uint256 contractId);
    error InvalidState(uint8 currentState, uint8 requiredState);
    error InvalidTerms(uint8 reasonCode);
    error InvalidShipmentStatus(uint8 status);
    error InvalidTimestamp(uint64 supplied, uint64 previous);

    event AgreementCreated(
        uint256 indexed contractId,
        string planId,
        address indexed shipper,
        address indexed carrier,
        bytes32 agreementHash
    );
    event BookingConfirmed(
        uint256 indexed contractId,
        address indexed carrier,
        uint64 timestamp
    );
    event ShipmentStatusUpdated(
        uint256 indexed contractId,
        uint8 status,
        address indexed actor,
        uint64 timestamp
    );

    address public immutable operator;
    uint256 private nextContractId = 1;
    mapping(uint256 contractId => Agreement agreement) private agreements;
    mapping(uint256 contractId => HistoryEntry[] entries) private histories;
    mapping(uint256 contractId => uint64 timestamp) private lastShipmentTimestamp;

    constructor() {
        operator = msg.sender;
    }

    function createAgreement(
        string calldata planId,
        address shipper,
        address carrier,
        Terms calldata terms
    ) external returns (uint256 contractId, bytes32 agreementHash) {
        if (msg.sender != operator) revert NotAuthorized();
        _validateTerms(planId, shipper, carrier, terms);

        contractId = nextContractId++;
        agreementHash = keccak256(abi.encode(planId, shipper, carrier, terms));
        agreements[contractId] = Agreement({
            contractId: contractId,
            planId: planId,
            shipper: shipper,
            carrier: carrier,
            terms: terms,
            state: ContractState.Created,
            onTime: false,
            secondsLate: 0,
            deliveryTimestamp: 0,
            podReference: "",
            penaltyPaise: 0,
            demurragePaise: 0,
            netPaymentPaise: 0
        });

        uint64 timestamp = uint64(block.timestamp);
        histories[contractId].push(
            HistoryEntry({
                action: 0,
                actor: msg.sender,
                timestamp: timestamp,
                dataHash: agreementHash
            })
        );
        emit AgreementCreated(contractId, planId, shipper, carrier, agreementHash);
    }

    function confirmBooking(uint256 contractId) external {
        Agreement storage agreement = _getAgreement(contractId);
        if (msg.sender != agreement.carrier) revert NotCarrier();
        if (agreement.state != ContractState.Created) {
            revert InvalidState(uint8(agreement.state), uint8(ContractState.Created));
        }

        agreement.state = ContractState.Booked;
        uint64 timestamp = uint64(block.timestamp);
        lastShipmentTimestamp[contractId] = timestamp;
        bytes32 dataHash = keccak256(
            abi.encode(contractId, msg.sender, timestamp, uint8(ContractState.Booked))
        );
        histories[contractId].push(
            HistoryEntry({
                action: 1,
                actor: msg.sender,
                timestamp: timestamp,
                dataHash: dataHash
            })
        );
        emit BookingConfirmed(contractId, msg.sender, timestamp);
    }

    function updateShipmentStatus(
        uint256 contractId,
        uint8 status,
        uint64 timestamp
    ) external {
        Agreement storage agreement = _getAgreement(contractId);
        if (msg.sender != agreement.carrier) revert NotCarrier();
        if (
            agreement.state != ContractState.Booked &&
            agreement.state != ContractState.InTransit
        ) {
            revert InvalidState(uint8(agreement.state), uint8(ContractState.Booked));
        }
        if (status > uint8(ShipmentStatus.ArrivedAtDestination)) {
            revert InvalidShipmentStatus(status);
        }

        uint64 previousTimestamp = lastShipmentTimestamp[contractId];
        if (timestamp < previousTimestamp) {
            revert InvalidTimestamp(timestamp, previousTimestamp);
        }

        if (agreement.state == ContractState.Booked) {
            agreement.state = ContractState.InTransit;
        }
        lastShipmentTimestamp[contractId] = timestamp;
        bytes32 dataHash = keccak256(abi.encode(contractId, status, msg.sender, timestamp));
        histories[contractId].push(
            HistoryEntry({
                action: 2,
                actor: msg.sender,
                timestamp: timestamp,
                dataHash: dataHash
            })
        );
        emit ShipmentStatusUpdated(contractId, status, msg.sender, timestamp);
    }

    function getContractStatus(
        uint256 contractId
    ) external view returns (Agreement memory agreement, HistoryEntry[] memory history) {
        agreement = _getAgreement(contractId);
        history = histories[contractId];
    }

    function _getAgreement(
        uint256 contractId
    ) private view returns (Agreement storage agreement) {
        agreement = agreements[contractId];
        if (agreement.contractId == 0) revert UnknownContract(contractId);
    }

    function _validateTerms(
        string calldata planId,
        address shipper,
        address carrier,
        Terms calldata terms
    ) private view {
        if (bytes(planId).length == 0) revert InvalidTerms(0);
        if (shipper == address(0) || carrier == address(0)) revert InvalidTerms(1);
        if (terms.freightValuePaise == 0) revert InvalidTerms(2);
        if (terms.slaDeadline <= block.timestamp) revert InvalidTerms(3);
        if (terms.penaltyBlockSeconds == 0) revert InvalidTerms(4);
        if (terms.wagonCount == 0) revert InvalidTerms(5);
        if (terms.termsHash == bytes32(0)) revert InvalidTerms(6);
    }
}