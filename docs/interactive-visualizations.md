# Interactive blockchain and AI demonstrations

Implemented 28 October 2026, within Track 3 Phase 25.

## Blockchain

Open `/blockchain`. The default request is `/blockchain/blocks?from=0&limit=12`, so Genesis is visible on entry even when the ledger contains more than twelve blocks. The Genesis origin strip remains available in every window. Use **Newer blocks**, **Earlier blocks**, **From Genesis** or **Latest blocks** to navigate. Windows remain bounded; the server returns `genesis`, `nextFrom` and `nextBefore` metadata and rejects simultaneous `from` and `before` parameters.

Every displayed block date comes from `eth_getBlockByNumber`, never the browser's current time or animation step. **Block time zone** switches between UTC and IST presentation while preserving the exact UTC ISO timestamp in the inspector. Synthetic late-delivery fixtures intentionally advance the node's clock, which explains future-dated blocks. The last successful API observation is labelled separately. Replay does not mine or change timestamps. An Administrator's **Add demonstration block** mines an empty local block; it does not create a freight agreement.

Block entry, parent-link drawing and the seal use bounded GSAP animation. Replay can be paused; the motion checkbox and OS reduced-motion preference suppress spatial effects. Hidden/offscreen replay is suspended. Full hashes, roots and transaction hashes remain inspectable.

## CP-SAT

Open `/ai-lab` and choose **Run CP-SAT comparison**. The live request uses the existing two-order, two-wagon bottleneck. The seven-frame diagram explains the shortest-route greedy choice, wagon-reuse conflict, unavailable route, alternative resource reservation and final returned assignment edges. The final frame reads assignments/counts from the real response.

This is an **illustrative candidate walkthrough**, not an instrumented trace of CP-SAT's internal branching. Capacity, compatibility and route facts come from the fixed synthetic teaching case. Learned prediction/ranking follows candidate generation; the diagram does not imply Logistic Regression is embedded inside the CP-SAT objective.

## Logistic Regression

Select cargo and deadline slack, then choose **Predict on-time probability**. The visualization reads the saved model's coefficients and cargo variability, computes each weighted contribution and logit, draws the sigmoid, and places the live response probability on the graph. The calculation is only attributed to the live result when its method/version matches the evaluation artifact. A different model or heuristic fallback suppresses the saved-model animation and explains why. Changing inputs clears the previous result.

The preview uses the saved coefficients and is labelled accordingly. The runtime sequence illustrates inference, not retraining. Accuracy remains a separate synthetic-holdout measure. Grain with slack `0.25` gives logit approximately `2.0215` and live probability `88.30%` with the current saved model.

## Playback and verification

Both algorithm views provide **Play/Pause**, **Previous**, **Next step**, **Replay**, speed selection and a Motion checkbox. Steps are keyboard-operable, their current position is announced, and diagrams have text descriptions. Timers pause when the document is hidden or the visualization leaves the viewport; animation contexts are reverted on update/unmount. Mobile allocation diagrams scroll inside their own labelled region rather than overflowing the page.

Targeted checks cover Genesis pagination, original UTC dates/time-zone presentation, model-version/fallback handling, live-result counts, manual playback and reduced motion. Frontend production compilation and backend TypeScript compilation are also checked. Actual animation/rendering is reviewed in the browser because Happy DOM does not implement GSAP's SVG matrix APIs.

Relevant files: `backend/src/platform/blockchain.ts`, `dashboard/src/api/blockchain.ts`, `dashboard/src/app/BlockchainPage.tsx`, `dashboard/src/app/AiLabPage.tsx`, `dashboard/src/components/AlgorithmVisualizations.tsx`, `dashboard/src/components/TeachingPlayback.tsx` and their tests/styles.

### Recorded verification for this update

- Frontend production build passed. Full frontend suite: **77 passed, 2 live-platform integration tests skipped** because their optional harness was not enabled. The new targeted selection contains **9 passing tests**.
- Backend TypeScript build and the explorer's pagination/validation test passed; three operational-clock tests passed in the AI image.
- Live API checks confirmed Genesis #0, byte-for-byte matching node timestamp, the #1 parent link and healthy database/AI/blockchain dependencies.
- Browser review covered 1280-pixel desktop and 375-pixel mobile layouts, UTC/IST conversion, forward history paging, real CP-SAT and matched LR results, manual playback and adding a single local empty block (#23 → #24). Both mobile pages had document scroll width equal to client width.
- Local screenshots are in the ignored `artifacts/visualizations-20261028/` directory. A clean full backend/blockchain acceptance rerun and independent-machine walkthrough are not implied by these checks.
