# Track 2: Blockchain Settlement

`ChainRouteSettlement` implements the frozen ABI in `../docs/contracts/chainroute-settlement.abi.json`. Its constructor assigns the deployer as both the operator and arbitrator; this is the local prototype role configuration. Contract state and all lifecycle history are stored on-chain. Settlement records accounting values only and does not transfer tokens.

## Test locally

From the repository root:

```powershell
Push-Location blockchain
npm ci
npx hardhat compile
npx hardhat test
Pop-Location
```

The tests run on Hardhat's isolated in-memory chain and compare the compiled ABI against the frozen contract ABI.

## Run in the full stack

The main Compose stack now deploys `ChainRouteSettlement` by default. Start it from the repository root:

```powershell
docker compose up --build --detach
```

The contract deployer writes `/shared/contract.json`, which is consumed by the backend. The existing `blockchain/Dockerfile` builds the local Hardhat development chain and the one-shot deployer; it is not a separate Track 2-only image.

## Integrate a Track 1 plan

With the stack running, run the optional bridge service to optimize the sample request and create a corresponding on-chain agreement:

```powershell
docker compose --profile track2-bridge run --rm track2-bridge
```

The bridge uses the optimizer's returned `planId` and `runId`, derives the earliest SLA deadline among assigned orders, calculates the terms hash, and records an agreement. If all sample deadlines are in the past, it shifts the request schedule forward and reruns optimization before creating the agreement. To pass another request file, set `OPTIMIZE_REQUEST_PATH` in the Compose service.

The bridge uses local Hardhat accounts 0, 1, and 2 for operator, shipper, and carrier. This is for the local demo only; production identity custody and authorization belong in the Track 3 backend.

## Contract decisions

- Money is integer paise (INR minor units); the contract never uses floating-point values.
- Zero-wagon agreements are rejected because they cannot represent a physical shipment.
- Penalty blocks and demurrage hours round up when any portion of the block/hour is late/billable.
- Combined penalty and demurrage are capped at freight value, with penalty deducted first.
- Shipment timestamps may be historical for deterministic demos but must never regress; delivery cannot predate the last posted shipment status.
- The operator account creates agreements, releases accounting payments, and closes contracts. The carrier account books and posts transit/delivery actions. The shipper or carrier may dispute; the deployer/arbitrator resolves.