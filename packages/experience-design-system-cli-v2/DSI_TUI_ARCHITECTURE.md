# Engineering Design and Implementation Standard

## Purpose

This document defines how humans and coding agents: design, implement, test, and review changes for the `experience-design-system-cli-v2` package.

## Project structure
**packages/experience-design-system-cli-v2/src/tui**
This package is the Terminal UI flow that the customer interacts with

**packages/experience-design-system-cli-v2/src/api**
This is where all the api calls are made that the TUI needs

**~/.config/experiences/credentials.json**
Shared v1 store for credentials (SPACE_ID, ENV_ID, CMA_TOKEN, host) and preferences (analyticsDisabled, debug). Managed by v2's settings flow via `src/tui/settings/utils/v1-store.ts`.

**~/.contentful/debug/sessions**
Per-session debug logs. v2 creates `MM-DD-YYYY-session-N/` directories with markdown run snapshots for each flow visit.

## Project Architecture

**packages/experience-design-system-cli-v2/src/tui**
Each directory in `packages/experience-design-system-cli-v2/src/tui` represents a menu item in the TUI and is an indepedent flow of screens. 
Each flow is separate and if that results in code duplication, that is okay. This is because with agentic engineering we do not want to introduce dependencies where one bug in a given flow breaks the another flow. Additionally, by keeping each flow independent, we can easily trace the source of the bug, introduce updates faster, and build more efficiently without having to think about consequences outside of the given flow. 

For each directory and flow, there is always a top level parent container screen named: `PageContainer.tsx`. This defines the outer layer for all the pages for a given flow. Each `PageContainer.tsx` for a given flow is allowed to be different as each flow serves a different purpose. The purpose of `PageContainer.tsx` for a given flow is to unify the same controls, look, theme, and functions that is shared across all pages/screens for a given flow.

### Settings Flow (`src/tui/settings/`)

Settings pages persist user preferences and credentials to `~/.config/experiences/credentials.json` (shared with cli-v1). The `utils/v1-store.ts` module provides generic read/write functions for this store.

Each preference screen:
- Imports `readV1Store` / `writeV1Store` from `utils/v1-store.ts`
- Implements domain-specific store adapters (e.g., `analytics-store.ts`, `debug-mode-store.ts`)
- Follows the same UX pattern: load state on mount, toggle on Enter/Space, navigate on Esc/q

See `src/tui/settings/README.md` for implementation details.

### Multi-step flows

The duplication rule above is about separate flows (menu items) staying independent of each other. Inside one flow, share code freely, but keep each screen small and its parts separate. The import flow is the reference:

```
src/tui/import/
  PageContainer.tsx      # parent container: what all import screens share (layout, controls, theme)
  steps/
    index.ts             # public entry: one export line per screen
    01-welcome/          # steps are numbered in the order they appear in the flow
      screen.tsx         # UI only: renders props and state, wires input to callbacks
      logic.ts           # everything else: validation, derived values, loaders, result building
      types.ts           # props and result types
  input/                 # small helpers shared by several screens, such as single-line editing
test/import/             # mirrors src/tui/import, one test file per source file
```

Rules for a screen:
- Props in, a typed result out through callbacks. A screen does not know which screen comes next.
- No `process.exit`, no database, network or subprocess calls, and no filesystem work while rendering. `logic.ts` never imports Ink or React components, so it can be tested without rendering.
- Numbered folders are steps of the happy path. Pieces used by several steps are not steps and stay unnumbered.

## Supported Frameworks
1. React
2. Astro
3. Vue
4. Svelte

## Unsupported Frameworks
5. Angular (coming soon)