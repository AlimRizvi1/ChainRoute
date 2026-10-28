# ChainRoute: six-slide content draft for approval

**Draft only — 27 October 2026. No PPTX has been created.**

This uses the exact six headings and sequence in the supplied `ChainRoute.pdf`. That file carries SIH **2026** branding and unrelated SatQuery identity fields, while the request specifies **2025**. Consequently, this is a **provisional mapping to the supplied template, not a certified official SIH 2025 submission**. Confirm the year/template and replace the identity placeholders before production. Never reuse the PDF's problem/team IDs for ChainRoute.

Only text inside each **Copy-ready content** block belongs on the slide. Other sections are production instructions or speaker notes. Preserve approved template branding, headings, footer and page-number regions. Asterisks below are metric qualifiers, not optional decoration.

## Slide 1 — TITLE PAGE

**Proposed title/subtitle:** ChainRoute / Freight allocation with auditable settlement.

**Copy-ready content**

> **ChainRoute**\
> AI-optimized freight allocation with blockchain-backed agreements
>
> **SIH year:** [confirm 2025 / 2026]\
> **Problem statement ID:** [official ID to confirm]\
> **Problem statement:** AI/ML-based Decision Support System for optimizing rake formation strategies for SAIL\
> **Context:** Bokaro Steel Plant → CMO stockyards and customer locations
>
> **Team name / ID:** [registered name] / [registered ID]\
> **Members:** [names]\
> **College:** [official college name]\
> **Theme / category:** [official theme] / [confirmed category]
>
> Local prototype • Blockchain settlement is our extension

**Recommended visual:** One small product mark and a simple wagon → agreement motif inside the template's content area. The brand is ChainRoute; avoid unrelated industrial or partner logos. Retain official SIH branding only after the matching-year template is confirmed.

**Metric:** None. Identity and problem alignment are the focus.

**Layout:** Use the supplied cover's identity field structure. Keep project name and positioning above the identity block; allow the problem context to wrap cleanly. The title is a short working description corroborated by CUTM, not a claim that the complete official card has been retrieved.

**Speaker explanation — approximately 45–55 seconds**

ChainRoute connects two decisions that freight teams often handle separately: how to allocate available wagons, and how to record what happens financially after delivery. Our inspiration is the SAIL rake-planning problem, with movements from Bokaro to stockyards and customers. Our implemented scope is narrower: compatible wagon allocation, direct route selection and delivery-reliability scoring on synthetic data. We extend that workflow with blockchain-recorded agreements, delay penalties, demurrage and dispute handling. The result is a local integrated prototype that makes a planning decision traceable through settlement accounting. We are not claiming industrial deployment, complete railway scheduling or real-money transfers. The official submission identity and year still need confirmation before this draft becomes a deck.

**Evidence:** [PRODUCT](../PRODUCT.md), [Plan](Plan.md), [source/scope mapping](SIH_PROJECT_RESEARCH.md#3-original-sih-inspiration-and-scope-mapping), [CUTM report](https://cutm.ac.in/wp-content/uploads/event/2025/Internal%20Hackathon%20SIH%202025%20Report.pdf). Supplied PDF cover is template evidence only.

## Slide 2 — PROPOSED SOLUTION

**Proposed title/subtitle:** One freight workflow, from available capacity to agreed deductions.

**Copy-ready content**

> **Orders → Feasible allocations → Reliability scoring → Accepted agreement → Delivery & settlement record**
>
> - Match cargo, wagon capacity, origin, route, priority and deadline.
> - Compare plans using cost, capacity fill and predicted on-time probability.
> - Record booking, delivery, deductions and disputes against agreed terms.
> - Give Shippers, Carriers, Administrators and Auditors their permitted workflow.
>
> Planning data off-chain • Contract state and deductions on-chain

**Recommended visual:** A five-stage horizontal workflow, with a bracket labelled **Planning** under the first three stages and **Contract operations** under the last two. Beneath the final stage, use a genuine, tightly cropped settlement/history screenshot from `artifacts/integration/browser/shipper-settlement-1280.png`. Add “Synthetic local demonstration.”

**Metric:** None required; keep the end-to-end proposition clear. Do not add commercial savings estimates.

**Layout:** Workflow occupies the upper half of the available body. Use at most four short labels beside the screenshot below. Do not shrink a full-page application screenshot to illegible size. Keep the architecture for slide 3.

**Speaker explanation — approximately 40–50 seconds**

A Shipper enters freight orders and compares allocation plans. The engine checks hard constraints first, including wagon compatibility, capacity and deadline feasibility. It then estimates on-time probabilities and ranks the candidate plans using the chosen trade-offs. When the Shipper accepts a saved plan, the backend creates a linked agreement with normalized commercial terms. The Carrier records booking and shipment milestones, then confirms delivery. The smart contract calculates the agreed deductions; an Administrator resolves a dispute if needed and records release and closure. Each role sees the actions it is allowed to perform. This joins planning and contractual operations in one application, while keeping complete planning records in the database and the settlement lifecycle on the local chain.

**Evidence:** [order/plan API](../backend/src/orders/routes.ts), [contract API](../backend/src/contracts/routes.ts), [settlement contract](../blockchain/contracts/ChainRouteSettlement.sol), [frontend routes](../dashboard/src/app/AppRoutes.tsx), [role permissions](../backend/src/auth/authorization.ts).

## Slide 3 — TECHNICAL APPROACH

**Proposed title/subtitle:** Constraint-safe candidates, learned reliability, explicit settlement rules.

**Copy-ready content**

> **React dashboard → Fastify API → AI service / PostgreSQL / local EVM**
>
> **CP-SAT:** capacity, compatibility, origin, deadline and no wagon reuse; greedy warm start and fallback.\
> **Logistic Regression:** deadline slack + cargo variability; predicts on-time probability and reranks candidates.\
> **Solidity:** agreement lifecycle, SLA deductions, disputes and accounting release.
>
> **97.35% accuracy** vs **90.92% majority baseline***\
> Probability MAE **0.00978**
>
> *6,000 synthetic holdout examples; 24,000 training examples. No real railway validation.*

**Recommended visual:** Use the architecture in [the asset plan](SIH_VISUAL_ASSETS.md#2-architecture-diagram), with the backend as the hub. Inside the AI service, show **Greedy + CP-SAT → LR prediction → candidate ranking**. A slim return arrow from EVM to API represents event synchronization. Do not draw the learned probability directly inside the CP-SAT objective.

**Metrics:** Classification accuracy and majority baseline share one small comparison strip. MAE has a separate label because it measures probability error against the simulator. No “99.02% accuracy,” no one-second whole-system guarantee and no optimality certificate.

**Layout:** Approximately two thirds diagram, one third algorithm labels/metric strip. Technology names are labels on real services, not a decorative logo wall. Put synthetic qualification immediately beside the numbers.

**Speaker explanation — approximately 45–55 seconds**

The backend connects the browser to PostgreSQL, the Python AI service and the local EVM node. In the AI service, greedy strategies create fallbacks and a warm start. CP-SAT searches compatible order-route-wagon assignments under capacity, deadline and exclusivity constraints, with priority tiers protected. An important detail is that the search uses a slack heuristic; Logistic Regression scores and reranks the resulting candidate plans afterwards. Its two features are deadline slack and assumed cargo variability. On a saved synthetic holdout, classification accuracy is 97.35 percent against a 90.92 percent majority baseline. Probability MAE is a separate 0.00978. These validate behavior against our simulator, not performance on real railway data. The API then links the accepted plan to Solidity settlement rules.

**Evidence:** [search formulation](../ai-engine/search_agent.py), [pipeline](../ai-engine/allocator.py), [ranking](../ai-engine/ranking.py), [training](../ai-engine/train_prediction_model.py), [prediction](../ai-engine/prediction.py), [frozen metrics](../ai-engine/demo/evidence.json), [Compose](../docker-compose.yml), [contract](../blockchain/contracts/ChainRouteSettlement.sol).

## Slide 4 — FEASIBILITY AND VIABILITY

**Proposed title/subtitle:** Integrated locally; final acceptance and industrial validation remain.

**Copy-ready content**

> **Recorded local validation — 26 October 2026**
>
> **88 AI • 19 API • 73 UI • 60 contract tests passed***\
> Dashboard production build completed
>
> - Late and on-time settlement flows exercised end to end.
> - Persisted node restart, queued actions and duplicate protection checked.
> - 25-order constraint cases; 300-order tests target under 20 seconds.
>
> **Before live demo:** fix overview query; recheck final UI/source.\
> **Before pilot:** railway data, operational constraints, identity/oracle governance.\
> **Pending acceptance:** external machine and unfamiliar-user walkthrough.
>
> *Saved runs predate later edits; not a fresh certification of the current tree.*

**Recommended visual:** A compact evidence matrix with four subsystem counts, then a small **Demonstrated / Remaining** two-column strip. Use the actual test-report timestamps, not an invented “100% ready” gauge. A diagram can illustrate cached read + queued write recovery without adding a second architecture.

**Metrics:** The four recorded test counts; the 300-order **test threshold**, clearly labelled. A repeat of 60 contract tests on another local node may be mentioned orally, but it is not another 60 distinct features or a second-machine pass. Avoid headline totals and production scalability claims.

**Layout:** Upper half evidence, lower half concrete readiness gaps. Three short remaining-work lines are more readable than a risk paragraph. Do not hide the overview issue in tiny text.

**Speaker explanation — approximately 45–55 seconds**

The saved local acceptance run passed the AI, backend, frontend and contract suites shown here, and built the dashboard. Integration exercised both exact settlement scenarios, duplicate-action protection and recovery after the node process restarted. The larger synthetic tests include a 300-order completion threshold; that is useful prototype evidence, not national railway scale. There are two qualifications. The test records precede later working-tree edits, and the saved browser report includes an overview API failure. The current overview query also has a known syntax defect, so a final clean demo run is still needed. An external-machine run and an unfamiliar-user walkthrough remain pending. Industrial feasibility additionally needs actual dispatch records, realistic rake constraints and stronger identity, oracle and ledger governance.

**Evidence:** Local `artifacts/integration/acceptance.json`, suite logs, `artifacts/integration/report.json`, `artifacts/integration/browser/report.json`; [integration harness](../scripts/validate-integration.ps1), [acceptance harness](../scripts/validate-acceptance.ps1), [300-order test](../ai-engine/test_run_log.py), [overview query](../backend/src/dashboard/routes.ts). See [research provenance](SIH_PROJECT_RESEARCH.md#11-recorded-validation-versus-current-readiness) for the report conflict and missing portable evidence folder.

## Slide 5 — IMPACTS AND BENEFITS

**Proposed title/subtitle:** Explain the allocation choice. Make the deduction reproducible.

**Copy-ready content**

> **Demonstrated on synthetic/local cases**
>
> **1 of 2 → 2 of 2 orders served**\
> CP-SAT preserves the scarce wagon for the order with no alternative.
>
> **₹25,000 − ₹1,500 − ₹240 = ₹23,260**\
> Freight − delay penalty − demurrage = accounting payable
>
> **Expected operational value**
>
> Planners: clearer capacity choices\
> Shippers & Carriers: explicit reliability and agreed deductions\
> Administrators & Auditors: traceable reconciliation
>
> Prototype evidence; no measured commercial savings or real-money transfer.

**Recommended visual:** Two compact panels: an order/wagon before–after diagram and a genuine crop of the settlement breakdown. The allocation panel must show both wagons and explain why Yard-B is reserved. The settlement panel must label integer-source INR accounting rather than depict cash moving between wallets.

**Metrics:** Assignment count and the exact monetary waterfall. The toy case has **100% selected-capacity fill in both plans** and increases synthetic total cost **₹25 → ₹75** while serving another order. Include that trade-off in notes; do not label the example a cost-saving or utilization-percentage gain.

**Layout:** Equal-width allocation and settlement panels, with a short stakeholder-value row below. Keep the synthetic/local qualifier above both panels. Avoid sustainability icons or savings percentages without measurement.

**Speaker explanation — approximately 40–50 seconds**

The first example shows what a better allocation decision means in this prototype. A flexible load can use either yard, while another load needs the only wagon at Yard-B. Greedy takes the shortest route for the flexible load and strands the other. The search-backed pipeline reserves that wagon and serves both. Total synthetic cost rises because more freight is moved; this is not a cost-saving claim. The second example makes settlement inspectable: thirteen hours late gives a fifteen-hundred-rupee penalty, and four billable holding hours across twelve wagons gives two hundred forty rupees demurrage. The contract records twenty-three thousand two hundred sixty rupees payable. Better planning and simpler reconciliation are expected benefits; commercial impact still needs a pilot.

**Evidence:** [saved bottleneck scenario](../samples/phase-6-scarce-demo.json), [comparison assertions](../ai-engine/test_ranking.py), [synthetic cost formula](../ai-engine/ranking.py), [Solidity deduction rules](../blockchain/contracts/ChainRouteSettlement.sol), local `artifacts/integration/report.json` and `artifacts/integration/browser/shipper-settlement-1280.png`.

## Slide 6 — RESEARCH AND REFERENCES

**Proposed title/subtitle:** Established methods, a verifiable integration.

**Copy-ready content**

> **1. Problem context:** CUTM, *Internal Hackathon SIH 2025 Report*, p.1 — SAIL / Bokaro rake-planning inspiration. [Source](https://cutm.ac.in/wp-content/uploads/event/2025/Internal%20Hackathon%20SIH%202025%20Report.pdf)
>
> **2. Constraint solving:** Google OR-Tools, *CP-SAT Solver*. [Documentation](https://developers.google.com/optimization/cp/cp_solver)
>
> **3. Freight optimization:** Cacchiani, Caprara & Toth (2010), *Scheduling extra freight trains on railway networks*. [DOI](https://doi.org/10.1016/j.trb.2009.07.007)
>
> **4. Freight prediction:** Barbour, Martinez Mori, Kuppa & Work (2018), *Prediction of arrival times of freight traffic on US railroads using support vector regression*. [DOI](https://doi.org/10.1016/j.trc.2018.05.019)
>
> **5. Logistics blockchain:** Ni & Irannezhad (2024), *Performance analysis of LogisticChain: A blockchain platform for maritime logistics*. [DOI](https://doi.org/10.1016/j.compind.2023.104038)
>
> **6. Shipping agreements:** Harshvardhan & Teoh (2022), *Improving Shipping Efficiency Industry-Led Consortium Blockchain Smart Contact*. [DOI](https://doi.org/10.4018/JGIM.313035)
>
> Official SIH problem card access pending • Blockchain is ChainRoute's extension

**Recommended visual:** A clean two-column bibliography with clickable short links/DOIs. No paper-cover collage. A small repository/evidence link may occupy unused space if readable: [ChainRoute repository](https://github.com/AlimRizvi1/ChainRoute). Local uncommitted work and ignored reports are not necessarily available through that link.

**Metric:** None. References support motivation and method choices; their results are not ChainRoute results.

**Layout:** Three entries per column with meaningful spacing and a visible source-access note. Preserve the template's team-name/footer area using `[confirmed team name]`. Use the full titles above; keep journal/volume details in speaker notes or the report rather than shrinking the slide. “Smart Contact” preserves the publisher's title spelling.

**Speaker explanation — approximately 40–50 seconds**

Our references support three parts of the project: the problem context, the decision methods and contractual transparency. The CUTM report corroborates the SAIL and Bokaro inspiration because the official problem portal was inaccessible during research. OR-Tools documents the solver semantics. Cacchiani and colleagues study freight timetabling, a broader scheduling problem than our current allocation model. Barbour and colleagues study freight arrival prediction using support vector regression. Our own predictor uses synthetic data. LogisticChain and the shipping-agreement study motivate examining ledgers and contractual rules, but their measurements do not validate our prototype. The contribution we can defend is the integration, its traceable decisions and explicit accounting rules, with the limitations and remaining validation stated clearly.

**Evidence:** [verified bibliography and access limits](SIH_PROJECT_RESEARCH.md#15-verified-external-references-and-access-limits), [claim verification](SIH_CLAIMS_VERIFICATION.md). No unverified PS ID is placed on the slide.

## Approval checklist before PowerPoint production

- Confirm competition year, official template, problem identity and registered team/college fields.
- Approve the prototype scope and the synthetic qualification on every quantitative result.
- Approve inclusion of the known overview/final-acceptance gap; do not replace it with “fully completed.”
- Approve the six-slide narrative and proposed assets. Final PPTX generation remains a separate step after approval.
