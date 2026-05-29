# Squad Team

> squads-demo — virtual boardgame on GitHub Pages, turn-based multiplayer, image-rich (maps/units/cards), rules driven by text docs.

## Coordinator

| Name | Role | Notes |
|------|------|-------|
| Squad | Coordinator | Routes work, enforces handoffs and reviewer gates. |

## Members

| Name | Role | Charter | Status |
|------|------|---------|--------|
| Wedge | Lead / Architect | [charter](agents/wedge/charter.md) | active |
| Lando | Frontend Dev | [charter](agents/lando/charter.md) | active |
| Artoo | Backend / Game Logic | [charter](agents/artoo/charter.md) | active |
| Sabine | Designer / Visual | [charter](agents/sabine/charter.md) | active |
| Cassian | Tester | [charter](agents/cassian/charter.md) | active |
| Scribe | Session Logger | [charter](agents/scribe/charter.md) | active |
| Ralph | Work Monitor | [charter](agents/ralph/charter.md) | active |
| @copilot | Coding Agent | [instructions](../.github/copilot-instructions.md) | active |

<!-- copilot-auto-assign: true -->

## Coding Agent — Capabilities

@copilot is a GitHub-native autonomous coding agent. It picks up issues labeled `squad:copilot`, opens draft PRs from `copilot/*` branches, and works asynchronously while we focus elsewhere.

| Capability | Fit | Notes |
|---|---|---|
| Bug fixes with clear repro | 🟢 | Good first-pass for failing tests, lint errors, type errors |
| Card-effect implementations from clear specs | 🟢 | Once Artoo lands the rules engine + a card pattern, copilot can implement card-by-card |
| Test authoring from documented rules | 🟢 | Cassian sets the harness; copilot can extend coverage |
| Asset metadata JSON from documented schema | 🟢 | Once Sabine lands the english.json template |
| Documentation, README, doc-comment passes | 🟢 | Mechanical writing |
| New architectural decisions | 🔴 | Wedge owns architecture |
| Visual design / asset composition | 🔴 | Sabine owns visual judgment |
| Cross-cutting refactors of state model | 🟡 | Needs Artoo or Wedge review |
| Worker / KV / Cloudflare config changes | 🟡 | Needs review — touches deploy infra |
| Anything ambiguous in rules text | 🔴 | Pin interpretation in a Cassian test first |

**Auto-assign:** disabled. Issues must be manually labeled `squad:copilot` (typically by Wedge during triage).

## Project Context

- **Owner:** Jason T
- **Project:** squads-demo — virtual boardgame representation of a real game, playable through a GitHub Page where turns pass between users
- **Inputs:** text rules documentation; image assets for maps, units, and cards
- **Stack:** TBD (likely TypeScript + a static-site framework deployed via GitHub Pages); turn-passing mechanism TBD (commits, issues, gists, or external store)
- **Created:** 2026-05-20
