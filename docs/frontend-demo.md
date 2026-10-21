# Use the running frontend

Open <http://localhost:5173/login> and sign in as **demo.shipper** using the existing **DEMO_USER_PASSWORD** from the root `.env`. The demo data belongs to this Shipper. This is the real backend, PostgreSQL database, AI service and local blockchain, populated with synthetic demonstration records.

| Screen / role | What to try |
|---|---|
| Overview · Shipper | Pending orders, active contracts, allocations, utilization, tracking schematic and signal board |
| Allocations · Shipper | Select weights and **Run allocation** to process the six queued synthetic orders. Review assignments, metrics and alternative plans; export CSV or change weights for a what-if run |
| Contracts · Shipper | Open the in-transit agreement for tracking, or the closed late agreement for the penalty/demurrage breakdown |
| Contracts · Carrier | Sign in as **demo.carrier** with the same local demo password. Open the Created agreement, confirm booking, then dispatch and post milestones |
| Settlement · Administrator | Sign in as **demo.administrator**. The payment-ready agreement can be released and closed; private financial details are shown to its parties |
| Audit view · Auditor | Sign in as **demo.auditor**. Open a contract to read its immutable state history; commercial fields stay private |
| ML demonstration | <http://localhost:8000/demo/> shows live predictions and the synthetic held-out evaluation |

All four local role accounts use the root `.env` demo password. The default seed does not create real user orders or move bank money. Signup creates a separate Shipper account with its own data and chosen password.

To start the current services without redeploying the blockchain:

```powershell
docker compose start
```

To populate these demonstration records once the services are healthy:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/seed-frontend-demo.ps1
```

The helper uses authenticated API calls and real AI allocation/contract operations. It creates a closed late settlement, a payment-ready on-time shipment, an in-transit shipment, a Created agreement ready for booking, and six pending orders. It preserves existing records, refuses production, and reuses previously created demo agreements. The seed report with exact IDs is in ignored `artifacts/demo/frontend-demo.json`; temporary login sessions stay in ignored `artifacts/demo/.sessions.json` and must not be shared.

The late example advances the local Hardhat clock by about thirteen hours so delivery confirmation obeys the on-chain timestamp rules. Active-contract and pending-order deadlines are created afterwards. For manual delivery, choose a time between the previous milestone and current chain time. Plan departure/arrival estimates currently follow Track 1's fixed January 2026 synthetic clock. A container restart of the Hardhat process loses its in-memory ledger; use the running stack for this demonstration.
