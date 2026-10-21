# Use the running frontend

Open <http://localhost:5173/login> and sign in as **demo.shipper** using the existing **DEMO_USER_PASSWORD** from the root `.env`. The demo data belongs to this Shipper. This is the real backend, PostgreSQL database, AI service and local blockchain, populated with synthetic demonstration records.

| Screen / role | What to try |
|---|---|
| Overview · Shipper | Pending orders, active contracts, allocations, utilization, tracking schematic and signal board |
| Freight orders · Shipper / Administrator | <http://localhost:5173/orders> lists persisted orders, including those already Planned. Filter by status, page through records, refresh, or queue a new order. Shippers see their own records; Administrators see all records |
| Allocations · Shipper | Select weights and **Run allocation** to process the six queued synthetic orders. Review assignments, metrics and alternative plans; export CSV or change weights for a what-if run |
| Contracts · Shipper | Open the in-transit agreement for tracking, or the closed late agreement for the penalty/demurrage breakdown |
| Contracts · Carrier | Sign in as **demo.carrier** with the same local demo password. Open the Created agreement, confirm booking, then dispatch and post milestones |
| Settlement · Administrator | Sign in as **demo.administrator**. The payment-ready agreement can be released and closed; private financial details are shown to its parties |
| Audit view · Auditor | Sign in as **demo.auditor**. Open a contract to read its immutable state history; commercial fields stay private |
| CP-SAT & ML lab · All four roles | <http://localhost:5173/ai-lab> runs the live greedy/CP-SAT comparison and ML prediction controls, and displays synthetic holdout accuracy, baseline and confusion matrix. The standalone ML view remains at <http://localhost:8000/demo/> |

All four local role accounts use the root `.env` demo password. The default seed does not create real user orders or move bank money. Signup creates a separate Shipper account with its own data and chosen password.

For a teacher walkthrough, open **CP-SAT & ML lab** from the sidebar:

1. Read the input → feasible allocations → prediction → ranking pipeline. In **Run CP-SAT comparison**, the flexible load can take either wagon, but the other load can only take WAG-B. The live shortest-route baseline serves one load. CP-SAT can serve both by reserving WAG-B for ORD-ONLY. The demonstration uses a three-second bounded search; the screen always displays the actual returned result, including a fallback if the budget is exhausted.
2. In **ML: how much time is enough?**, leave Grain selected and predict at slack 0, 0.25 and 0.50. Expected probabilities with the committed model are 51.81%, 88.30% and 98.15%. These are live inference results, not newly measured accuracies. Expand the request/response to inspect inputs, assignments, run ID and model identity.
3. In **How accurate is the model?**, show 97.35% classification accuracy versus the 90.92% always-on-time baseline, 81.65% late recall, the 24,000 / 6,000 train/test split and confusion matrix. This is a synthetic holdout from the same simulator, not real-world railway validation. A mismatched live model or heuristic fallback is explicitly labeled.
4. Return to **Freight orders**, add a load if all existing orders are already Planned, then open **Allocations**. The returned plan now explains how the actual engine and prediction method were applied, along with the model version. Lab examples never consume this order queue or create contracts.

Counts change when allocations run: zero Pending does not mean orders disappeared. Choose **All orders** or **Planned** to see saved orders. The order deadline field uses local time and sends UTC to the API.

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
