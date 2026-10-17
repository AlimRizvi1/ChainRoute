// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

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
        uint8 state;
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
    error NotContractParty();
    error NotArbitrator();
    error UnknownContract(uint256 contractId);
    error InvalidState(uint8 currentState, uint8 requiredState);
    error InvalidTerms(uint8 reasonCode);
    error InvalidShipmentStatus(uint8 status);
    error InvalidTimestamp(uint64 supplied, uint64 previous);
    error EmptyProofOfDelivery();
    error InvalidDisputeOutcome(uint8 outcome);

    event AgreementCreated(
        uint256 indexed contractId,
        string planId,
        address indexed shipper,
        address indexed carrier,
        bytes32 agreementHash
    );
    event BookingConfirmed(uint256 indexed contractId, address indexed carrier, uint64 timestamp);
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
    event PenaltyCalculated(uint256 indexed contractId, uint256 penaltyPaise, uint64 secondsLate);
    event DemurrageCalculated(uint256 indexed contractId, uint256 demurragePaise, uint64 heldSeconds);
    event PaymentReleased(
        uint256 indexed contractId,
        uint256 grossPaise,
        uint256 penaltyPaise,
        uint256 demurragePaise,
        uint256 netPaymentPaise
    );
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
    event ContractClosed(uint256 indexed contractId, uint64 timestamp);

    address private immutable operator;
    address private immutable arbitrator;
    uint256 private nextContractId = 1;
    mapping(uint256 => Agreement) private agreements;
    mapping(uint256 => HistoryEntry[]) private histories;
    mapping(uint256 => uint64) private lastShipmentTimestamp;
    mapping(uint256 => uint64) private arrivalTimestamp;

    constructor() {
        operator = msg.sender;
        arbitrator = msg.sender;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotAuthorized();
        _;
    }

    modifier onlyArbitrator() {
        if (msg.sender != arbitrator) revert NotArbitrator();
        _;
    }

    function createAgreement(
        string calldata planId,
        address shipper,
        address carrier,
        Terms calldata terms
    ) external onlyOperator returns (uint256 contractId, bytes32 agreementHash) {
        if (
            bytes(planId).length == 0 ||
            shipper == address(0) ||
            carrier == address(0) ||
            terms.freightValuePaise == 0 ||
            terms.slaDeadline <= block.timestamp ||
            terms.penaltyBlockSeconds == 0 ||
            terms.wagonCount == 0
        ) revert InvalidTerms(1);

        contractId = nextContractId++;
        agreementHash = keccak256(abi.encode(planId, shipper, carrier, terms));

        Agreement storage agreement = agreements[contractId];
        agreement.contractId = contractId;
        agreement.planId = planId;
        agreement.shipper = shipper;
        agreement.carrier = carrier;
        agreement.terms = terms;
        agreement.state = uint8(ContractState.Created);

        emit AgreementCreated(contractId, planId, shipper, carrier, agreementHash);
        _appendHistory(contractId, 0, keccak256(abi.encode(planId, shipper, carrier, terms)));
    }

    function confirmBooking(uint256 contractId) external {
        Agreement storage agreement = _getAgreement(contractId);
        if (msg.sender != agreement.carrier) revert NotCarrier();
        _requireState(agreement, ContractState.Created);

        agreement.state = uint8(ContractState.Booked);
        uint64 timestamp = uint64(block.timestamp);
        emit BookingConfirmed(contractId, msg.sender, timestamp);
        _appendHistory(contractId, 1, keccak256(abi.encode(msg.sender, timestamp)));
    }

    function updateShipmentStatus(uint256 contractId, uint8 status, uint64 timestamp) external {
        Agreement storage agreement = _getAgreement(contractId);
        if (msg.sender != agreement.carrier) revert NotCarrier();
        if (agreement.state != uint8(ContractState.Booked) && agreement.state != uint8(ContractState.InTransit)) {
            revert InvalidState(agreement.state, uint8(ContractState.Booked));
        }
        if (status > uint8(ShipmentStatus.ArrivedAtDestination)) revert InvalidShipmentStatus(status);

        uint64 previousTimestamp = lastShipmentTimestamp[contractId];
        if (timestamp < previousTimestamp) revert InvalidTimestamp(timestamp, previousTimestamp);

        agreement.state = uint8(ContractState.InTransit);
        lastShipmentTimestamp[contractId] = timestamp;
        if (status == uint8(ShipmentStatus.ArrivedAtDestination)) arrivalTimestamp[contractId] = timestamp;

        emit ShipmentStatusUpdated(contractId, status, msg.sender, timestamp);
        _appendHistoryAt(contractId, 2, keccak256(abi.encode(status, msg.sender, timestamp)), timestamp);
    }

    function confirmDelivery(
        uint256 contractId,
        uint64 timestamp,
        string calldata podReference
    ) external returns (uint256 penaltyPaise, uint256 demurragePaise) {
        Agreement storage agreement = _getAgreement(contractId);
        if (msg.sender != agreement.carrier) revert NotCarrier();
        _requireState(agreement, ContractState.InTransit);
        if (bytes(podReference).length == 0) revert EmptyProofOfDelivery();

        uint64 previousTimestamp = lastShipmentTimestamp[contractId];
        if (timestamp < previousTimestamp) revert InvalidTimestamp(timestamp, previousTimestamp);

        agreement.deliveryTimestamp = timestamp;
        agreement.podReference = podReference;
        (agreement.onTime, agreement.secondsLate) = _evaluateSLA(agreement, timestamp);

        uint64 arrivedAt = arrivalTimestamp[contractId];
        uint64 heldSeconds = arrivedAt == 0 ? 0 : timestamp - arrivedAt;
        penaltyPaise = _calculatePenalty(agreement, agreement.secondsLate);
        demurragePaise = _calculateDemurrage(agreement, heldSeconds);
        (agreement.penaltyPaise, agreement.demurragePaise) = _capDeductions(
            agreement.terms.freightValuePaise,
            penaltyPaise,
            demurragePaise
        );
        agreement.state = uint8(ContractState.PenaltyCalculated);

        emit DeliveryConfirmed(contractId, msg.sender, timestamp, podReference);
        _appendHistoryAt(contractId, 3, keccak256(abi.encode(msg.sender, timestamp, podReference)), timestamp);
        emit PenaltyCalculated(contractId, agreement.penaltyPaise, agreement.secondsLate);
        _appendHistory(contractId, 4, keccak256(abi.encode(agreement.penaltyPaise, agreement.secondsLate)));
        emit DemurrageCalculated(contractId, agreement.demurragePaise, heldSeconds);
        _appendHistory(contractId, 5, keccak256(abi.encode(agreement.demurragePaise, heldSeconds)));
    }

    function evaluateSLA(
        uint256 contractId,
        uint64 deliveryTimestamp
    ) external view returns (bool onTime, uint64 secondsLate) {
        Agreement storage agreement = _getAgreement(contractId);
        return _evaluateSLA(agreement, deliveryTimestamp);
    }

    function calculatePenalty(uint256 contractId, uint64 secondsLate) external view returns (uint256) {
        Agreement storage agreement = _getAgreement(contractId);
        return _calculatePenalty(agreement, secondsLate);
    }

    function calculateDemurrage(
        uint256 contractId,
        uint64 arrivedAtTimestamp,
        uint64 deliveryTimestamp
    ) external view returns (uint256) {
        Agreement storage agreement = _getAgreement(contractId);
        if (deliveryTimestamp < arrivedAtTimestamp) {
            revert InvalidTimestamp(deliveryTimestamp, arrivedAtTimestamp);
        }
        return _calculateDemurrage(agreement, deliveryTimestamp - arrivedAtTimestamp);
    }

    function releasePayment(uint256 contractId) external onlyOperator returns (uint256 netPaymentPaise) {
        Agreement storage agreement = _getAgreement(contractId);
        _requireState(agreement, ContractState.PenaltyCalculated);

        uint256 deductions = agreement.penaltyPaise + agreement.demurragePaise;
        if (deductions > agreement.terms.freightValuePaise) deductions = agreement.terms.freightValuePaise;
        netPaymentPaise = agreement.terms.freightValuePaise - deductions;
        agreement.netPaymentPaise = netPaymentPaise;
        agreement.state = uint8(ContractState.PaymentReleased);

        emit PaymentReleased(
            contractId,
            agreement.terms.freightValuePaise,
            agreement.penaltyPaise,
            agreement.demurragePaise,
            netPaymentPaise
        );
        _appendHistory(
            contractId,
            6,
            keccak256(
                abi.encode(
                    agreement.terms.freightValuePaise,
                    agreement.penaltyPaise,
                    agreement.demurragePaise,
                    netPaymentPaise
                )
            )
        );
    }

    function raiseDispute(uint256 contractId, string calldata reasonCode, address raisedBy) external {
        Agreement storage agreement = _getAgreement(contractId);
        _requireState(agreement, ContractState.PenaltyCalculated);
        if (msg.sender != raisedBy || (raisedBy != agreement.shipper && raisedBy != agreement.carrier)) {
            revert NotContractParty();
        }
        if (bytes(reasonCode).length == 0) revert InvalidTerms(2);

        agreement.state = uint8(ContractState.Disputed);
        uint64 timestamp = uint64(block.timestamp);
        emit DisputeRaised(contractId, raisedBy, reasonCode, timestamp);
        _appendHistory(contractId, 7, keccak256(abi.encode(raisedBy, reasonCode, timestamp)));
    }

    function resolveDispute(
        uint256 contractId,
        uint8 outcome
    ) external onlyArbitrator returns (uint256 penaltyPaise, uint256 demurragePaise) {
        Agreement storage agreement = _getAgreement(contractId);
        _requireState(agreement, ContractState.Disputed);
        if (outcome > uint8(DisputeOutcome.WaiveAll)) revert InvalidDisputeOutcome(outcome);

        if (outcome == uint8(DisputeOutcome.WaivePenalty)) agreement.penaltyPaise = 0;
        if (outcome == uint8(DisputeOutcome.WaiveAll)) {
            agreement.penaltyPaise = 0;
            agreement.demurragePaise = 0;
        }
        (agreement.penaltyPaise, agreement.demurragePaise) = _capDeductions(
            agreement.terms.freightValuePaise,
            agreement.penaltyPaise,
            agreement.demurragePaise
        );
        agreement.state = uint8(ContractState.PenaltyCalculated);
        penaltyPaise = agreement.penaltyPaise;
        demurragePaise = agreement.demurragePaise;

        emit DisputeResolved(contractId, msg.sender, outcome, penaltyPaise, demurragePaise);
        _appendHistory(contractId, 8, keccak256(abi.encode(msg.sender, outcome, penaltyPaise, demurragePaise)));
    }

    function getContractStatus(
        uint256 contractId
    ) external view returns (Agreement memory agreement, HistoryEntry[] memory history) {
        agreement = _getAgreement(contractId);
        history = histories[contractId];
    }

    function closeContract(uint256 contractId) external onlyOperator {
        Agreement storage agreement = _getAgreement(contractId);
        _requireState(agreement, ContractState.PaymentReleased);
        agreement.state = uint8(ContractState.Closed);

        uint64 timestamp = uint64(block.timestamp);
        emit ContractClosed(contractId, timestamp);
        _appendHistory(contractId, 9, keccak256(abi.encode(timestamp)));
    }

    function _getAgreement(uint256 contractId) private view returns (Agreement storage agreement) {
        agreement = agreements[contractId];
        if (agreement.contractId == 0) revert UnknownContract(contractId);
    }

    function _requireState(Agreement storage agreement, ContractState requiredState) private view {
        if (agreement.state != uint8(requiredState)) revert InvalidState(agreement.state, uint8(requiredState));
    }

    function _appendHistory(uint256 contractId, uint8 action, bytes32 dataHash) private {
        _appendHistoryAt(contractId, action, dataHash, uint64(block.timestamp));
    }

    function _appendHistoryAt(uint256 contractId, uint8 action, bytes32 dataHash, uint64 timestamp) private {
        histories[contractId].push(
            HistoryEntry(action, msg.sender, timestamp, dataHash)
        );
    }

    function _evaluateSLA(
        Agreement storage agreement,
        uint64 deliveryTimestamp
    ) private view returns (bool onTime, uint64 secondsLate) {
        onTime = deliveryTimestamp <= agreement.terms.slaDeadline;
        if (!onTime) secondsLate = deliveryTimestamp - agreement.terms.slaDeadline;
    }

    function _calculatePenalty(
        Agreement storage agreement,
        uint64 secondsLate
    ) private view returns (uint256) {
        if (secondsLate == 0 || agreement.terms.penaltyBpsPerBlock == 0) return 0;

        uint256 blocksLate = (uint256(secondsLate) - 1) / agreement.terms.penaltyBlockSeconds + 1;
        uint256 freight = agreement.terms.freightValuePaise;
        uint256 basisPoints = agreement.terms.penaltyBpsPerBlock;
        uint256 perBlock = (freight / 10_000) * basisPoints + ((freight % 10_000) * basisPoints) / 10_000;
        if (perBlock == 0 || blocksLate > freight / perBlock) return freight;
        return perBlock * blocksLate;
    }

    function _calculateDemurrage(
        Agreement storage agreement,
        uint64 heldSeconds
    ) private view returns (uint256) {
        uint256 freeSeconds = uint256(agreement.terms.freeHoldingHours) * 3600;
        if (heldSeconds <= freeSeconds || agreement.terms.demurrageRatePaisePerWagonHour == 0) return 0;

        uint256 billableHours = (uint256(heldSeconds) - freeSeconds - 1) / 3600 + 1;
        uint256 ratePerWagonHour = agreement.terms.demurrageRatePaisePerWagonHour;
        uint256 wagons = agreement.terms.wagonCount;
        uint256 freight = agreement.terms.freightValuePaise;
        if (ratePerWagonHour > freight / wagons) return freight;
        uint256 perHour = ratePerWagonHour * wagons;
        if (billableHours > freight / perHour) return freight;
        return perHour * billableHours;
    }

    function _capDeductions(
        uint256 freight,
        uint256 penalty,
        uint256 demurrage
    ) private pure returns (uint256 cappedPenalty, uint256 cappedDemurrage) {
        if (penalty >= freight) return (freight, 0);
        if (demurrage > freight - penalty) return (penalty, freight - penalty);
        return (penalty, demurrage);
    }
}