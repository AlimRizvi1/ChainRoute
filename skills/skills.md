# ChainRoute skills

This inventory records the Codex guidance available for Track 3 and the skills installed during its preparation. A skill is a set of agent instructions; it does not add a package to the dashboard or backend, install a browser, or register a JavaScript animation library.

## Installed in the user's Codex skills directory

| Skill | Verified source | Purpose and ChainRoute phases | How to use |
|---|---|---|---|
| `impeccable` 4.6.0 | [pbakaus/impeccable](https://github.com/pbakaus/impeccable), Apache-2.0; commit `9304afa97f89b30609e4c538584fb3e0cd4df013`; Codex skill `.agents/skills/impeccable` | Primary interface design, critique, responsive layout, accessibility, UI writing, and motion guidance. Phases 20–25. | Apply the `impeccable` skill to dashboard changes; use `animate`, `critique`, `audit`, `adapt`, and `polish` guidance as each screen is implemented. Read its `craft-floor.md` immediately before a UI edit. Its optional native CLI binary and detector hook are not set up. |
| `vercel-react-best-practices` 1.0.0 | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills), MIT; commit `063bee94c3f4df8453406c830b0a7df0f2860278`; `skills/react-best-practices` | React rendering, request waterfalls, bundle size, data fetching, and responsiveness. Phases 20–25. | Read the rules relevant to a React component, route, data flow, or performance change before implementing it; do not apply Next.js-specific rules to Vite without checking their fit. |
| `security-best-practices` | [openai/skills](https://github.com/openai/skills), curated; commit `49f948faa9258a0c61caceaf225e179651397431`; `skills/.curated/security-best-practices` | Secure-by-default JavaScript/TypeScript guidance. Especially Phases 15–19; also the dashboard's session and data boundaries in Phase 20. | Invoke for explicit security work or secure-by-default implementation. Its trigger is security-focused work; it is not a substitute for the frozen RBAC, API, or chain contracts. |
| `gsap-core` | [greensock/gsap-skills](https://github.com/greensock/gsap-skills), MIT; commit `aed9cfd3277740755f6bfc1155c7aa645403b760` | Tween, easing, reduced-motion, and responsive-animation guidance. Phases 20–25 if GSAP is selected. | Apply to GSAP tweens and `gsap.matchMedia()`; prefer transforms and opacity. |
| `gsap-react` | Same official source and pinned commit as above | React lifecycle, scoped targets, and animation cleanup. Phases 20–25 if GSAP is selected. | Use `useGSAP`, a scoped ref, and automatic context cleanup when authoring GSAP in React. |
| `gsap-timeline` | Same official source and pinned commit as above | Controlled, coordinated animation sequences. Phases 20–25 when a workflow transition merits sequencing. | Use labeled timelines for a meaningful multi-step moment; do not add choreography to routine page loading. |
| `gsap-performance` | Same official source and pinned commit as above | Animation performance, batching, long lists, and cleanup. Phases 20–25 for any GSAP effect. | Prefer compositor-friendly transforms and opacity, pause offscreen animation, and test actual target devices. |

The seven skill trees were installed through the Codex skill installer and their files were byte-for-byte checked against the pinned upstream snapshots. Skill folders contain no application packages. Skills are available to Codex on a subsequent turn; relaunch or refresh Codex if the skills catalog has not reloaded.

## Existing capabilities and verified product fit

- The Codex session also exposes `browser-use:browser` for local browser checks. Read its `SKILL.md` before the first browser action. No browser visual review has occurred in this preparation step.
- A curated `playwright` skill exists in the installer catalog but was not installed. The repository has no Playwright dependency. Revisit it only if the approved test approach actually needs browser automation; do not install Playwright merely for an animation effect.
- The project's verified dashboard stack is React 18.3.1, Vite 6.1.0, and TypeScript 5.7.3. The Phase 20 plan calls for routed pages, a typed API, loading/error states, role-gated navigation, and visual verification. These are roadmap needs, not evidence that packages have been installed.
- The in-session `figma` skills and image-generation capability are available if later work includes a Figma file or a raster illustration. The current plan can use in-app SVG/CSS for route diagrams and does not require external art assets.
- Impeccable's CLI launcher was inspected: it can fetch and run a separately distributed native executable. Its checksum verification and fallback instructions were reviewed, but the executable and hooks were not run or installed. The skill's Markdown guidance remains installed and usable. No `npx`, downloaded binary, or third-party install script was executed.

## Motion-library and dependency guidance

The app currently has no router, charting, map, or motion library. Do not install all candidate libraries as a bundle. First define route structure and the approved screens, then add only the packages needed for that phase and preserve exact lockfile versions.

| Candidate | Verified compatibility | Proposed use |
|---|---|---|
| Motion for React (`motion/react`) | [Official install guide](https://motion.dev/docs/react-installation) says React 18.2+ is supported and Vite needs no special setup. Existing React 18.3.1 fits. | Compare against GSAP before implementation. It is a compact fit for declarative UI presence/layout changes if the team chooses it as the single primary library. No package installed. |
| GSAP and `@gsap/react` | Official [GSAP skills](https://github.com/greensock/gsap-skills) document scoped `useGSAP`, timeline cleanup, `gsap.matchMedia()`, and reduced-motion handling. No framework conflict with React/Vite was found. | Prefer when an authored route/state sequence, interruption, SVG route motion, or timeline control gives a clear workflow benefit. It is not required for button feedback, counters, skeletons, and simple transitions. No packages installed. |
| React View Transition API | Vercel's installed `vercel-react-view-transitions` is a separate skill, but its own documentation states `ViewTransition` requires the React canary release outside Next.js. | Defer; the dashboard pins stable React 18.3.1. A stable-browser View Transition API fallback could be evaluated later, but do not upgrade React to canary for page fades. |
| GSAP ScrollTrigger | Official GSAP skill repository has `gsap-scrolltrigger`. | Not installed: the operate-style dashboard has no scroll-led storytelling requirement. Reconsider only if a later screen makes scroll itself meaningful. |

Use CSS transitions for ordinary hover, active, focus, and button feedback. Keep one animation library at most unless a concrete requirement demonstrates a gap. Never animate continuously just to make KPI cards look busy. Use API-backed values, visibly mark seed/sample data, and honor `prefers-reduced-motion`.

## Related skill dependencies not installed

The Phase 20 plan lists React Router, TanStack Query, Recharts, Leaflet, Testing Library, Vitest, and Playwright as recommended tools. The current dashboard manifest contains React, React DOM, Vite, the React Vite plugin, TypeScript, and type packages only. At Phase 20, choose packages against the finished backend contract and the team's bundle/runtime needs; verify current official documentation and React compatibility then. Do not install GSAP, Motion, or a chart/map library as part of this skills inventory.

## Source and availability notes

The sources above were opened and pinned to immutable Git commit hashes before installation. A directory reported as installed means the complete skill folder and its supporting files were copied and verified, not that a native CLI, plugin, animation package, or project dependency is active. No unavailable or rejected skill source was found; tooling that was deliberately deferred is called out above.
