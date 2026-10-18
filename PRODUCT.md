# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

ChainRoute supports four distinct users: Shippers submit freight orders, compare allocations, accept plans, and follow their own contracts; Carriers confirm bookings, report shipment milestones, confirm delivery, and follow assigned contracts; Administrators manage platform records and coordinate contract settlement; Auditors inspect contracts and the audit trail without changing platform or contract state. The overview should balance these four roles rather than prioritize one.

## Product Purpose

ChainRoute connects freight order intake and AI-assisted wagon allocation with smart-contract-backed contract lifecycle tracking and accounting settlement. Success means users can follow an order from submission through allocation, shipment, delivery, and an auditable settlement record while seeing service degradation clearly.

## Positioning

The platform brings an explainable freight allocation service and a blockchain settlement layer into one role-aware workflow. The backend is the integration point; the on-chain contract is authoritative for contract state, deductions, and settlement history. Payment release records accounting values and does not transfer real money.

## Operating Context

Users work through a browser and interact with the platform's TypeScript API, the Track 1 allocation service, PostgreSQL, and the local Track 2 development chain. The main workflow is order submission, optimization, plan review and acceptance, contract booking, shipment updates, delivery confirmation, dispute resolution when needed, payment release, and closure. Local Compose services and demo users support evaluation and development.

## Capabilities and Constraints

- The product has Shipper, Carrier, Administrator, and Auditor roles. The server enforces authorization; the interface mirrors those permissions and hides unavailable actions.
- Freight and settlement values are integer INR paise. The browser displays values returned by the API and does not calculate settlement amounts.
- Contract reads can continue from the PostgreSQL cache during chain outages. State-changing chain calls are queued and retried; the chain remains authoritative.
- The frontend must support a one-setting switch between sample/mock data and the real backend.
- Demo and fixture data are synthetic. The interface must label sample data and must not imply real customers, live commercial traffic, or real-money payment.
- The authenticated API uses short-lived bearer tokens and does not currently provide refresh tokens. The dashboard will use a session-scoped token and return users to login when the token expires.

## Brand Commitments

The product name is ChainRoute. The user requires a responsive platform with connected navigation, smooth page transitions, and purposeful movement in interactive controls and KPI cards. The dashboard should not read as a generic static set of separate pages. Motion must remain usable with reduced-motion preferences.

## Evidence on Hand

- API, role, workflow, and settlement contracts: `docs/Plan.md` and `docs/contracts/platform.openapi.yaml`.
- Synthetic local fixture: `samples/plentiful-dataset.json`.
- Live local contract and backend integration tests: `backend/test/contracts.integration.test.cjs`.
- No real customer research, testimonials, logos beyond the product name, or production performance evidence is present in the repository. Do not invent any.

## Product Principles

- Keep each role's permitted work visible and its restricted work inaccessible.
- Show how an allocation or settlement reached its current state.
- Keep money exact and explain deductions from API and chain data.
- Make unavailable services and queued actions legible without hiding unaffected work.
- Identify synthetic data and keep product claims within the available evidence.
