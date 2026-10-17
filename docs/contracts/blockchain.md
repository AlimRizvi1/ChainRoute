# Blockchain Settlement Contract

**Contract name:** `ChainRouteSettlement`  
**Interface version:** `1.0.0`  
**Machine-readable ABI:** [`chainroute-settlement.abi.json`](./chainroute-settlement.abi.json)
**JSON boundary schema:** [`blockchain.schema.json`](./blockchain.schema.json)
**Enum and history-action number/name mapping:** [`blockchain-enums.json`](./blockchain-enums.json)

This interface is consumed by the Track 3 backend. `uint256` IDs and monetary amounts are serialized as decimal strings in JSON; timestamps cross HTTP as ISO-8601 UTC and are converted to Unix seconds by the backend. Solidity amounts are integer **paise (INR minor units)**.

## State enum

The numeric ordering is fixed and must not be reordered:

| Value | State |
|---:|---|
| 0 | `Created` |
| 1 | `Booked` |
| 2 | `InTransit` |
| 3 | `Delivered` |
| 4 | `PenaltyCalculated` |
| 5 | `PaymentReleased` |
| 6 | `Closed` |
| 7 | `Disputed` |

Shipment status is a separate enum: `0 Dispatched`, `1 CheckpointReached`, `2 ArrivedAtDestination`.

History action codes returned in `getContractStatus` use the `historyAction` mapping in `blockchain-enums.json`; their order matches the emitted lifecycle events.

The contract appends each history entry to an on-chain array and emits the matching event. Both views are retained: the getter can return the complete chronological history without requiring an indexer, while external clients can independently audit the event log.

## Terms

The `Terms` tuple in the ABI has these fields, in this exact order:

| Field | Solidity type | Meaning |
|---|---|---|
| `freightValuePaise` | `uint256` | Gross freight value, in paise |
| `slaDeadline` | `uint64` | Unix seconds; for a plan containing multiple orders, the earliest stated deadline among the included orders |
| `penaltyBpsPerBlock` | `uint16` | Penalty basis points per started late block |
| `penaltyBlockSeconds` | `uint32` | Duration of one penalty block, in seconds |
| `freeHoldingHours` | `uint16` | Free holding allowance |
| `demurrageRatePaisePerWagonHour` | `uint256` | Integer paise per wagon per hour |
| `wagonCount` | `uint32` | Number of wagons in the agreement |
| `termsHash` | `bytes32` | Keccak-256 hash of the canonical off-chain agreement terms |

Use decimal strings for unsigned integers at the JSON boundary. `termsHash` is `keccak256(UTF-8(JCS(canonical terms JSON)))`, using RFC 8785 JSON Canonicalization Scheme; the hashed object is the full off-chain commercial terms object with the `termsHash` property omitted. The ABI sample in [`../../samples/contract-terms.json`](../../samples/contract-terms.json) contains an illustrative hash only; the backend must calculate the actual hash from canonical terms before submission.

`agreementHash` is `keccak256(abi.encode(planId, shipper, carrier, terms))`. This binds the plan, parties, on-chain terms, and the off-chain terms hash into one deterministic agreement identifier.

## Functions

| Function | Caller / state rule | Inputs and result |
|---|---|---|
| `createAgreement` | Configured operator only | `planId`, shipper address, carrier address, `Terms`; allocates the next ID in `Created`; returns ID and agreement hash. |
| `confirmBooking` | Assigned carrier only; `Created` | Contract ID; transitions to `Booked`. |
| `updateShipmentStatus` | Assigned carrier only; `Booked` or `InTransit` | Contract ID, status enum, Unix timestamp; first status transitions to `InTransit`; all updates are appended to history. |
| `confirmDelivery` | Assigned carrier only; `InTransit` | Contract ID, Unix delivery timestamp, non-empty proof-of-delivery reference; records delivery, SLA result, penalty and demurrage, then transitions to `PenaltyCalculated`; returns both deductions. |
| `evaluateSLA` | Public read | Contract ID and delivery timestamp; returns whether delivery met the deadline and seconds late. |
| `calculatePenalty` | Public read | Contract ID and seconds late; returns penalty in paise using started blocks and the stored terms. |
| `calculateDemurrage` | Public read | Contract ID, arrival timestamp, delivery timestamp; returns demurrage in paise. Held time starts at the `ArrivedAtDestination` status and partial hours are rounded up after free time. |
| `releasePayment` | Configured operator only; `PenaltyCalculated` | Contract ID; records accounting-only net payment (no token transfer) and transitions to `PaymentReleased`; returns net paise. A dispute blocks release. |
| `raiseDispute` | Shipper or assigned carrier; `PenaltyCalculated` and before release | Contract ID, reason code, claimed party address; the address must equal `msg.sender`; transitions to `Disputed`. |
| `resolveDispute` | Configured arbitrator/admin only; `Disputed` | Contract ID and outcome (`0 UpholdDeductions`, `1 WaivePenalty`, `2 WaiveAll`); returns to `PenaltyCalculated` and returns the final deductions. |
| `getContractStatus` | Public read | Contract ID; returns the complete agreement state and its append-only history in chronological order. |
| `closeContract` | Configured operator only; `PaymentReleased` | Contract ID; transitions to terminal state `Closed`. |

The interface follows the plan's accounting-only payment decision: `releasePayment` records a payout amount; the backend stores the resulting transaction hash as the payment reference. The contract does not transfer real money or tokens.

## Phase 10 implementation decisions

The deploying account is the immutable operator. Agreement creation rejects an empty plan ID, zero party address, zero freight value, an SLA deadline that is not in the future, a zero penalty block length, zero wagons, or a zero terms hash. A zero wagon count is invalid because an agreement without wagons cannot be booked. Shipper and carrier may be the same address. `InvalidTerms.reasonCode` values are `0` empty plan ID, `1` invalid party address, `2` zero freight value, `3` invalid SLA deadline, `4` zero penalty block length, `5` zero wagons, and `6` zero terms hash. Creation and booking each append a history entry and emit their corresponding event.

## Events

Every state-changing operation emits its corresponding event. `confirmDelivery` additionally emits `PenaltyCalculated` and `DemurrageCalculated`, in that order, after `DeliveryConfirmed`. Event history is append-only; dispute resolution never edits earlier entries.

| Event | Emitted by | Key data |
|---|---|---|
| `AgreementCreated` | `createAgreement` | contract ID, plan ID, shipper, carrier, agreement hash |
| `BookingConfirmed` | `confirmBooking` | contract ID, carrier, timestamp |
| `ShipmentStatusUpdated` | `updateShipmentStatus` | contract ID, status, actor, timestamp |
| `DeliveryConfirmed` | `confirmDelivery` | contract ID, actor, delivery timestamp, POD reference |
| `PenaltyCalculated` | `confirmDelivery` | contract ID, penalty paise, seconds late |
| `DemurrageCalculated` | `confirmDelivery` | contract ID, demurrage paise, held seconds |
| `PaymentReleased` | `releasePayment` | contract ID, gross, deductions, and net paise |
| `DisputeRaised` | `raiseDispute` | contract ID, party, reason code, timestamp |
| `DisputeResolved` | `resolveDispute` | contract ID, arbitrator, outcome, final deductions |
| `ContractClosed` | `closeContract` | contract ID, timestamp |

## Error behavior

The ABI exposes distinct custom errors for authorization, unknown IDs, invalid state, invalid terms, invalid shipment status/timestamp, empty POD, and invalid dispute arguments. `InvalidState` includes current and required state values. Track 3 maps these to the shared HTTP error shape; an invalid state maps to `409`, unauthorized role to `403`, and an unknown or unauthorized-owned resource to `404` as specified in the platform contract.

## Phase 1 agreement scope

This ABI freezes wire shapes, enum values, units, caller roles, and on-chain history storage. Term validation edge cases, the zero-wagon policy, and additional penalty/demurrage boundary choices remain assigned to their implementation phases in [`../decisions.md`](../decisions.md).
