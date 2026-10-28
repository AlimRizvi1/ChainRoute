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

    enum DisputeOutcome {
        UpholdDeductions,
        WaivePenalty,
        WaiveAll
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
    error EmptyProofOfDelivery();
    error NotContractParty();
    error NotArbitrator();
    error InvalidDisputeOutcome(uint8 outcome);

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
    event DeliveryConfirmed(
        uint256 indexed contractId,
        address indexed actor,
        uint64 timestamp,
        string podReference
    );
    event PenaltyCalculated(
        uint256 indexed contractId,
        uint256 penaltyPaise,
        uint64 secondsLate
    );
    event DemurrageCalculated(
        uint256 indexed contractId,
        uint256 demurragePaise,
        uint64 heldSeconds
    );
    event PaymentReleased(
        uint256 indexed contractId,
        uint256 grossPaise,
        uint256 penaltyPaise,
        uint256 demurragePaise,
        uint256 netPaymentPaise
    );
    event ContractClosed(uint256 indexed contractId, uint64 timestamp);
    event DisputeRaised(
        uint256 indexed contractId,
        address indexed raisedBy,
        string reasonCode,
        uint64 timestamp
    );
    event DisputeResolved(
        uint256 indexed contractId,
        address indexed arbitrator,
        uint8 outcome,
        uint256 penaltyPaise,
        uint256 demurragePaise
    );

    address public immutable operator;
    uint256 private nextContractId = 1;
    mapping(uint256 contractId => Agreement agreement) private agreements;
    mapping(uint256 contractId => HistoryEntry[] entries) private histories;
    mapping(uint256 contractId => uint64 timestamp) private lastShipmentTimestamp;
    mapping(uint256 contractId => uint64 timestamp) private arrivalTimestamps;

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
        return _createAgreement(planId, shipper, carrier, terms);
    }

    function _createAgreement(
        string calldata planId,
        address shipper,
        address carrier,
        Terms calldata terms
    ) internal returns (uint256 contractId, bytes32 agreementHash) {
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
        if (
            status == uint8(ShipmentStatus.ArrivedAtDestination) &&
            arrivalTimestamps[contractId] == 0
        ) {
            arrivalTimestamps[contractId] = timestamp;
        }
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

    function confirmDelivery(
        uint256 contractId,
        uint64 timestamp,
        string calldata podReference
    ) external returns (uint256 penaltyPaise, uint256 demurragePaise) {
        Agreement storage agreement = _getAgreement(contractId);
        if (msg.sender != agreement.carrier) revert NotCarrier();
        if (agreement.state != ContractState.InTransit) {
            revert InvalidState(uint8(agreement.state), uint8(ContractState.InTransit));
        }
        if (bytes(podReference).length == 0) revert EmptyProofOfDelivery();

        uint64 previousTimestamp = lastShipmentTimestamp[contractId];
        if (timestamp < previousTimestamp) {
            revert InvalidTimestamp(timestamp, previousTimestamp);
        }
        if (timestamp > block.timestamp) {
            revert InvalidTimestamp(timestamp, uint64(block.timestamp));
        }

        (bool onTime, uint64 secondsLate) = _evaluateSLA(
            agreement.terms.slaDeadline,
            timestamp
        );
        penaltyPaise = _calculatePenalty(agreement.terms, secondsLate);
        uint64 arrivedAt = arrivalTimestamps[contractId];
        if (arrivedAt != 0) {
            demurragePaise = _calculateDemurrage(
                agreement.terms,
                arrivedAt,
                timestamp,
                penaltyPaise
            );
        }

        agreement.state = ContractState.Delivered;
        agreement.onTime = onTime;
        agreement.secondsLate = secondsLate;
        agreement.deliveryTimestamp = timestamp;
        agreement.podReference = podReference;
        agreement.penaltyPaise = penaltyPaise;
        agreement.demurragePaise = demurragePaise;

        uint64 heldSeconds = arrivedAt == 0 ? 0 : timestamp - arrivedAt;
        _recordDelivery(contractId, timestamp, podReference);
        _recordPenalty(contractId, timestamp, penaltyPaise, secondsLate);
        _recordDemurrage(contractId, timestamp, demurragePaise, heldSeconds);

        agreement.state = ContractState.PenaltyCalculated;
    }

    function evaluateSLA(
        uint256 contractId,
        uint64 deliveryTimestamp
    ) external view returns (bool onTime, uint64 secondsLate) {
        Agreement storage agreement = _getAgreement(contractId);
        return _evaluateSLA(agreement.terms.slaDeadline, deliveryTimestamp);
    }

    function calculatePenalty(
        uint256 contractId,
        uint64 secondsLate
    ) external view returns (uint256 penaltyPaise) {
        Agreement storage agreement = _getAgreement(contractId);
        return _calculatePenalty(agreement.terms, secondsLate);
    }

    function calculateDemurrage(
        uint256 contractId,
        uint64 arrivedAtTimestamp,
        uint64 deliveryTimestamp
    ) external view returns (uint256 demurragePaise) {
        Agreement storage agreement = _getAgreement(contractId);
        (, uint64 secondsLate) = _evaluateSLA(
            agreement.terms.slaDeadline,
            deliveryTimestamp
        );
        uint256 penaltyPaise = _calculatePenalty(agreement.terms, secondsLate);
        return _calculateDemurrage(
            agreement.terms,
            arrivedAtTimestamp,
            deliveryTimestamp,
            penaltyPaise
        );
    }

    function releasePayment(uint256 contractId) external returns (uint256 netPaymentPaise) {
        Agreement storage agreement = _getAgreement(contractId);
        if (msg.sender != operator) revert NotAuthorized();
        if (agreement.state != ContractState.PenaltyCalculated) {
            revert InvalidState(uint8(agreement.state), uint8(ContractState.PenaltyCalculated));
        }

        uint256 grossPaise = agreement.terms.freightValuePaise;
        uint256 penaltyPaise = agreement.penaltyPaise;
        uint256 demurragePaise = agreement.demurragePaise;
        netPaymentPaise = grossPaise - penaltyPaise - demurragePaise;
        agreement.netPaymentPaise = netPaymentPaise;
        agreement.state = ContractState.PaymentReleased;

        uint64 timestamp = uint64(block.timestamp);
        _appendHistory(
            contractId,
            6,
            msg.sender,
            timestamp,
            keccak256(
                abi.encode(contractId, grossPaise, penaltyPaise, demurragePaise, netPaymentPaise)
            )
        );
        emit PaymentReleased(
            contractId,
            grossPaise,
            penaltyPaise,
            demurragePaise,
            netPaymentPaise
        );
    }

    function closeContract(uint256 contractId) external {
        Agreement storage agreement = _getAgreement(contractId);
        if (msg.sender != operator) revert NotAuthorized();
        if (agreement.state != ContractState.PaymentReleased) {
            revert InvalidState(uint8(agreement.state), uint8(ContractState.PaymentReleased));
        }

        agreement.state = ContractState.Closed;
        uint64 timestamp = uint64(block.timestamp);
        _appendHistory(
            contractId,
            9,
            msg.sender,
            timestamp,
            keccak256(abi.encode(contractId, timestamp))
        );
        emit ContractClosed(contractId, timestamp);
    }

    function raiseDispute(
        uint256 contractId,
        string calldata reasonCode,
        address raisedBy
    ) external {
        Agreement storage agreement = _getAgreement(contractId);
        if (
            raisedBy != msg.sender ||
            (msg.sender != agreement.shipper && msg.sender != agreement.carrier)
        ) {
            revert NotContractParty();
        }
        if (agreement.state != ContractState.PenaltyCalculated) {
            revert InvalidState(uint8(agreement.state), uint8(ContractState.PenaltyCalculated));
        }

        agreement.state = ContractState.Disputed;
        uint64 timestamp = uint64(block.timestamp);
        _recordDisputeRaised(contractId, raisedBy, reasonCode, timestamp);
    }

    function resolveDispute(
        uint256 contractId,
        uint8 outcome
    ) external returns (uint256 penaltyPaise, uint256 demurragePaise) {
        Agreement storage agreement = _getAgreement(contractId);
        if (msg.sender != operator) revert NotArbitrator();
        if (agreement.state != ContractState.Disputed) {
            revert InvalidState(uint8(agreement.state), uint8(ContractState.Disputed));
        }
        if (outcome > uint8(DisputeOutcome.WaiveAll)) {
            revert InvalidDisputeOutcome(outcome);
        }

        if (outcome == uint8(DisputeOutcome.WaivePenalty)) {
            agreement.penaltyPaise = 0;
        } else if (outcome == uint8(DisputeOutcome.WaiveAll)) {
            agreement.penaltyPaise = 0;
            agreement.demurragePaise = 0;
        }
        agreement.state = ContractState.PenaltyCalculated;
        penaltyPaise = agreement.penaltyPaise;
        demurragePaise = agreement.demurragePaise;

        uint64 timestamp = uint64(block.timestamp);
        _recordDisputeResolved(contractId, outcome, penaltyPaise, demurragePaise, timestamp);
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

    function _evaluateSLA(
        uint64 slaDeadline,
        uint64 deliveryTimestamp
    ) private pure returns (bool onTime, uint64 secondsLate) {
        if (deliveryTimestamp <= slaDeadline) return (true, 0);
        return (false, deliveryTimestamp - slaDeadline);
    }

    function _calculatePenalty(
        Terms memory terms,
        uint64 secondsLate
    ) private pure returns (uint256) {
        if (secondsLate == 0 || terms.penaltyBpsPerBlock == 0) return 0;

        uint256 lateBlocks = (uint256(secondsLate) - 1) / terms.penaltyBlockSeconds + 1;
        uint256 freightValue = terms.freightValuePaise;
        uint256 basisPoints = terms.penaltyBpsPerBlock;
        if (basisPoints >= 10000) return freightValue;

        uint256 penaltyPerBlock =
            (freightValue / 10000) * basisPoints +
            ((freightValue % 10000) * basisPoints) / 10000;
        if (penaltyPerBlock == 0) return 0;
        if (lateBlocks > (freightValue - 1) / penaltyPerBlock) return freightValue;
        return penaltyPerBlock * lateBlocks;
    }

    function _calculateDemurrage(
        Terms memory terms,
        uint64 arrivedAtTimestamp,
        uint64 deliveryTimestamp,
        uint256 penaltyPaise
    ) private pure returns (uint256) {
        if (deliveryTimestamp < arrivedAtTimestamp) {
            revert InvalidTimestamp(deliveryTimestamp, arrivedAtTimestamp);
        }

        uint256 heldSeconds = deliveryTimestamp - arrivedAtTimestamp;
        uint256 freeSeconds = uint256(terms.freeHoldingHours) * 3600;
        if (heldSeconds <= freeSeconds || terms.demurrageRatePaisePerWagonHour == 0) {
            return 0;
        }

        uint256 billableHours = (heldSeconds - freeSeconds + 3599) / 3600;
        uint256 wagonHours = uint256(terms.wagonCount) * billableHours;
        uint256 remainingDeduction = terms.freightValuePaise - penaltyPaise;
        if (terms.demurrageRatePaisePerWagonHour > remainingDeduction / wagonHours) {
            return remainingDeduction;
        }
        return terms.demurrageRatePaisePerWagonHour * wagonHours;
    }

    function _recordDelivery(
        uint256 contractId,
        uint64 timestamp,
        string calldata podReference
    ) private {
        _appendHistory(
            contractId,
            3,
            msg.sender,
            timestamp,
            keccak256(abi.encode(contractId, msg.sender, timestamp, podReference))
        );
        emit DeliveryConfirmed(contractId, msg.sender, timestamp, podReference);
    }

    function _recordPenalty(
        uint256 contractId,
        uint64 timestamp,
        uint256 penaltyPaise,
        uint64 secondsLate
    ) private {
        _appendHistory(
            contractId,
            4,
            msg.sender,
            timestamp,
            keccak256(abi.encode(contractId, penaltyPaise, secondsLate))
        );
        emit PenaltyCalculated(contractId, penaltyPaise, secondsLate);
    }

    function _recordDemurrage(
        uint256 contractId,
        uint64 timestamp,
        uint256 demurragePaise,
        uint64 heldSeconds
    ) private {
        _appendHistory(
            contractId,
            5,
            msg.sender,
            timestamp,
            keccak256(abi.encode(contractId, demurragePaise, heldSeconds))
        );
        emit DemurrageCalculated(contractId, demurragePaise, heldSeconds);
    }

    function _appendHistory(
        uint256 contractId,
        uint8 action,
        address actor,
        uint64 timestamp,
        bytes32 dataHash
    ) private {
        histories[contractId].push(
            HistoryEntry({
                action: action,
                actor: actor,
                timestamp: timestamp,
                dataHash: dataHash
            })
        );
    }

    function _recordDisputeRaised(
        uint256 contractId,
        address raisedBy,
        string calldata reasonCode,
        uint64 timestamp
    ) private {
        _appendHistory(
            contractId,
            7,
            raisedBy,
            timestamp,
            keccak256(abi.encode(contractId, raisedBy, reasonCode, timestamp))
        );
        emit DisputeRaised(contractId, raisedBy, reasonCode, timestamp);
    }

    function _recordDisputeResolved(
        uint256 contractId,
        uint8 outcome,
        uint256 penaltyPaise,
        uint256 demurragePaise,
        uint64 timestamp
    ) private {
        _appendHistory(
            contractId,
            8,
            msg.sender,
            timestamp,
            keccak256(
                abi.encode(contractId, msg.sender, outcome, penaltyPaise, demurragePaise, timestamp)
            )
        );
        emit DisputeResolved(
            contractId,
            msg.sender,
            outcome,
            penaltyPaise,
            demurragePaise
        );
    }
}
