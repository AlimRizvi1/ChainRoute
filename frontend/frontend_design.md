# ChainRoute frontend design constitution

This is the canonical design reference for Dashboard Phases 20–25. The product plan, frozen API, blockchain ABI, and approved team decisions control functionality and business meaning. This document proposes the visual and interaction direction; it does not authorize new API fields, operational states, financial calculations, or blockchain actions.

## Design philosophy and brand

ChainRoute should feel like an active freight network that an operator can trust and steer. The first screen should reveal the work moving through the platform: orders enter, the optimizer assigns wagons and routes, an accepted plan becomes a contract, and the shipment's ledger-backed timeline resolves into settlement. Each screen links to the next step in that journey. Build a responsive, navigable application rather than a set of static demo pages.

Keep the result premium and unmistakably operational. Use an architectural page grid, a clear shipment or allocation feature area, restrained card framing, crisp typography, and small rail-inspired route markings that encode real relationships. Introduce a distinctive signal-orange accent against warm paper and ink. Use table density only where it helps operators compare shipments, assignments, or agreements. Familiar controls should stay familiar and direct.

The existing blue service-status page is evidence of the Phase 2 walking skeleton, not an established multi-screen brand system. The current experience has no route architecture or durable design tokens. Expand it into the command-center direction below without changing established product facts or the running-status behavior until Phase 20 explicitly addresses the application shell.

## Foundations and proposed design tokens

Tokens below are proposals for Phase 20, not an existing visual system. Check color contrast in the rendered interface before accepting them. Semantic colors always carry a text label, shape, or icon too.

```css
:root {
  color-scheme: light;
  --canvas: #f6f5f1;
  --surface: #fffefa;
  --surface-muted: #eeefeb;
  --ink: #182923;
  --ink-muted: #53645c;
  --ink-subtle: #68756e;
  --line: #d8ded7;
  --line-strong: #aebbb0;
  --navy: #183a46;
  --teal: #26776d;
  --orange: #c84c27;
  --orange-wash: #f9e8df;
  --success: #25684d;
  --success-wash: #e4f1e9;
  --warning: #80550c;
  --warning-wash: #fbf1d6;
  --danger: #9b332a;
  --danger-wash: #fae8e5;
  --info: #285574;
  --info-wash: #e8f0f5;
  --shadow-panel: 0 10px 34px rgb(24 41 35 / 7%);
  --shadow-popover: 0 18px 52px rgb(24 41 35 / 16%);
  --radius-control: 0.6rem;
  --radius-card: 0.9rem;
  --radius-panel: 1.15rem;
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.5rem;
  --space-6: 2rem;
  --space-7: 3rem;
  --duration-feedback: 120ms;
  --duration-state: 190ms;
  --duration-layout: 280ms;
  --ease-enter: cubic-bezier(0.16, 1, 0.3, 1);
  --content-max: 88rem;
  --sidebar-width: 16rem;
  --tablet: 52rem;
  --mobile: 39rem;
}
```

Use one highly legible sans family for interface text, with tabular numerals for money, IDs, counts, and metrics. Start with a native system sans stack because no font asset or approved font dependency exists. Set a compact, consistent scale: 0.75rem overline, 0.875rem detail, 1rem body, 1.25rem section, 1.75rem page title, and a bounded 2–3rem operational headline. Keep data labels at readable sizes and never rely on a display face for values.

Use navy for hierarchy and navigation; teal for the network and confirmed routes; signal orange for the primary action, an active route, or an important current state. Red indicates a true error or breach only. Use warm neutral surfaces for quiet focus. Avoid luminous gradients, constant glass overlays, glowing outlines, decorative icon tiles, and rounded cards nested inside other rounded cards.

## Application shell and navigation

Use a persistent left rail on wide screens, a compact top bar and toggleable navigation on tablets, and a simple reachable navigation drawer or bottom navigation pattern on mobile. Put the same authenticated user identity, role, and live/degraded service status in each shell. Keep navigation destinations stable and preserve deep links on reload.

Role filtering only hides routes and controls. The API remains responsible for authorization. Every successful action returns the user to the related resource: accepting an optimization plan opens its new contract; clicking an active shipment or its KPI opens tracking; closing a detail returns to its list with the prior filter preserved. Browser Back and Forward remain useful. Use a breadcrumb for deeper contract detail.

Use direct, descriptive labels: “Run optimization”, “Accept plan”, “Confirm booking”, “Post status”, “Confirm delivery”, “Raise dispute”, and “Resolve dispute”. Place the next action where its prerequisite data is visible. Disable an action while it submits and preserve the user's entered state after a service error.

## Reusable component system

Define shared shell, page header, button, icon button, form field, validation message, status badge, KPI/link card, data table, filter bar, empty state, skeleton, panel error, confirmation dialog, toast, event timeline, and responsive page grid. Each interactive component needs rest, hover, keyboard focus, pressed, disabled, loading, and error states as applicable. Use native semantic buttons and forms. Keep touch targets at least 44 by 44 CSS pixels where practical.

KPI cards are actionable only when a real destination exists. Make the whole card keyboard-focusable with one accessible name and clear link/action treatment. A click or Enter opens the appropriate filtered list or screen. Animate a KPI count only when it first resolves from a loading state or changes due to a successful data refresh; do not count up on every render or auto-refresh tick. An animated value also includes its final exact text and a screen-reader announcement that does not repeat every poll.

Charts and timelines name the underlying values, units, interval, and data source. Include a readable legend and a compact tabular or text summary. Do not make color the only way to follow a plotted shipment, a status, or a settlement outcome.

## Motion thesis and transition system

The signature moment is the handoff from an accepted freight plan into its contract: the selected route line extends to the agreement marker, the summary settles into the contract detail, and the state timeline highlights “Created”. This expresses a real workflow connection. It plays once after a successful, confirmed response, never when a request merely starts, and always ends in a usable static screen if motion is unavailable.

Use CSS for focus, hover, button press, accordion, badge, and color changes. A modest state transition lasts 120–200 ms; drawers and hierarchy transitions can last 200–280 ms. Entrances ease out, exits finish faster, and sibling lists cap their total stagger at 240 ms. Use GSAP only if actual route continuity or an interruptible multi-step transition needs a timeline; otherwise keep the dependency out. Scope GSAP to component refs and clean it up on unmount. Animate transforms and opacity rather than layout. Use Web Animations or CSS for any smaller feedback still uncovered by the chosen primary library; do not stack animation libraries.

Use a reduced-motion path for every nonessential animation. Remove route travel and staggered movement when `prefers-reduced-motion` is enabled while retaining immediate action feedback and clear final states. Do not make data values depend on watching an animation. Never use a looping decorative pulse or page-load choreography to make the dashboard look active.

| Interaction | Intended transition |
|---|---|
| App route to another top-level page | Brief shared-shell continuity and content fade; no long horizontal sweep between unrelated tabs. |
| Contract list to detail | A restrained forward transition with selected contract title/route continuity; browser Back returns to the filtered list. |
| Sidebar collapse or mobile drawer | Smooth width/transform, with focus held in a modal drawer and returned to the trigger on close. |
| Optimize submit | Button confirms press immediately; a labeled progress state and staged result panels appear only for actual request progress. |
| New plan loaded | KPI values settle to exact response numbers; assignments arrive in a short capped stagger. |
| Shipment event appended | The event marker advances on the timeline and the new row is announced once. |
| Booking, delivery, dispute, settlement | State badge, action result and timeline change together only after backend confirmation. A queued state is labeled queued, not confirmed. |
| Table, KPI, alert row hover | Subtle surface and border response; never wobble, rotate, or shift position in a way that affects adjacent text. |
| Toast, dialog, or drawer | Enter and exit in 160–240 ms, with a reduced-motion path and complete keyboard behavior. |

## Screen direction and data boundaries

**Phase 20 — Foundation.** Login, role-aware navigation, typed backend client, degraded-service state, and reusable loading/error/empty views. Sample mode must be unmistakably identified and switchable through one configuration value. Direct navigation must redirect consistently. Never place a private signing key in frontend code or storage.

**Phase 21 — Overview.** Lead with an operational status band, useful next action, priority alerts, and the busiest current shipment or allocation detail. Follow with role-appropriate summary numbers and a readable utilization trend. Keep the content related to the freight workflow and allow cards to navigate to real filtered screens. The current frozen summary has pending-order, active-contract, delivered-contract, and total-freight-value fields only. Do not fabricate wagon utilization, payment counts, route positions, or today's run activity. If sample data is displayed, label it. The map requirement has no coordinates in the fixtures/API; use a truthful route schematic or list until geographic data and a tile-source decision exist.

**Phase 22 — Run Optimization.** Show freight order intake and weight controls together as one clear setup, with normalized shares next to the sliders or number fields. Prevent duplicate submissions, show live progress, preserve inputs on failure, and present ranked results with a comparison against the previous what-if run. Make route and wagon assignments legible. Explain unassigned reasons in plain language using the upstream message. Accepting a plan moves to the created contract after confirmation.

**Phase 23 — Contracts.** Provide a filterable list with state, shipment parties, and SLA deadline. The detail page puts terms, lifecycle position, chronological immutable events, and the next authorized action together. Dispute state should branch clearly from the ordinary lifecycle. Keep history useful when long. The ledger is authoritative; the browser renders the backend response and never creates lifecycle state.

**Phase 24 — Tracking and Settlement.** Show shipment route and SLA deadline prominently, then a milestone timeline with timestamp, event, and actor. Allow only carrier actions that the current role and state permit. Present each INR amount as paise formatted consistently from the exact API integer string; any conversion to INR is presentation formatting only. Display gross, penalty, demurrage, cap if supplied, and net. Preserve zero-amount lines. Mark disputes and pending chain actions as on hold/queued. Never derive penalties or recalculate the net in the browser.

**Phase 25 — Alerts, export, and polish.** Keep a bounded alert feed with filters, an unread count, meaningful links, and WebSocket-driven updates. Offer export beside the matching plan or settlement and ensure it matches the currently shown record. Audit every flow at 375, 768, 1280, and 1440 pixels; verify keyboard completion, reduced motion, and color contrast.

## Data visualization and trust

Render figures from typed API responses. Preserve the API precision; format quantities in tonnes, distances in km, times in the selected locale, and contract money as integer INR paise. Label what is estimated (for example, AI-predicted on-time probability) separately from observed, contracted, or ledger-recorded events. A probability from the synthetic model is not a real-world performance guarantee.

Use charts only when they help compare route/load, trends, or plan alternatives. Pick simple bars, lines, and milestone progress over ornamental gauges. Every chart needs axis labels, accessible text, empty and unavailable states, and an equivalent text summary. Provide a route list whenever a map source cannot load. The current domain data gives route names and distances, not train location coordinates or a geography timeline, so a route illustration must not masquerade as live GPS.

## Accessibility and responsive behavior

Meet WCAG 2.2 AA contrast targets for body text and meaningful UI; verify every proposed color pair during visual review. Provide a visible focus ring distinct from hover. Use headings in order, landmarks, labels tied to fields, associated errors, keyboard-accessible menus and dialogs, and status text announced through a stable live region. Never put focus on an element while hiding it or moving it out from under the keyboard user. Ensure focus returns after an overlay closes.

At widths below 832 pixels, reduce or collapse the navigation rail, simplify multi-column summaries, and let tables switch to readable stacked records or purposeful horizontal scrolling within a labeled region. At 624 pixels and below, keep one content column, full-width high-value actions, readable field stacking, and touch-sized controls. Never hide a table's essential fields or force the entire page to scroll sideways. Charts may simplify; data and controls stay available.

## Performance and reliability

Keep the existing Vite build as the baseline. Prefer CSS transitions and React's built-in facilities where sufficient. Lazy-load an expensive map or chart module only when its screen is entered. Avoid autoplay work while a page is hidden. Animate only visible records in long histories and lists. Keep polling frequency and WebSocket reconnect states visible and purposeful. Keep loading skeleton geometry stable to prevent shifts.

The existing plan targets dashboard summary data in under two seconds under normal demo conditions. Treat that as the key load budget; profile before accepting new UI packages. Keep route transitions below 300 ms for routine work. Give every data panel independent loading, empty, error, and degraded states so one missing service never blanks unrelated content.

## UI review checklist

- [ ] The current screen clearly serves the operator's immediate job.
- [ ] It follows this design system and visually connects to the next step in the freight workflow.
- [ ] No action, statistic, route, or status is invented; sample values are explicitly labeled.
- [ ] All interactive elements are usable with a keyboard and have visible focus and complete states.
- [ ] All values and chart summaries retain units, precision, and data meaning.
- [ ] Every motion has an explanatory purpose, finishes quickly, and respects reduced motion.
- [ ] 375, 768, 1280, and 1440 pixel layouts remain readable without page-level horizontal overflow.
- [ ] Empty, loading, failed, offline, and success states look deliberate and preserve the user's work.
- [ ] Browser visual review, accessibility inspection, and the relevant build/tests have been completed and their findings recorded.
