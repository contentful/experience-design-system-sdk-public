# Engineering Design and Implementation Standard

## Purpose

This document defines how humans and coding agents: design, implement, test, and review changes for the `experience-design-system-cli` package.

## Project structure

**packages/experience-design-system-cli/src/tui**
This package is the Terminal UI flow that the customer interacts with

**packages/experience-design-system-cli/src/api**
This is where all the api calls are made that the TUI needs

**~/.config/experiences/credentials.json**
Shared v1 store for credentials (SPACE_ID, ENV_ID, CMA_TOKEN, host) and preferences (analyticsDisabled, debug). Managed by v2's settings flow via `src/tui/settings/utils/v1-store.ts`.

**packages/experience-design-system-cli/.contentful/debug/sessions**
Per-session debug logs, written inside the installed package directory. v2 creates `MM-DD-YYYY-session-N/` directories with markdown run snapshots for each flow visit. Logging is toggled from Settings > Debug Mode.

## Project Architecture

**packages/experience-design-system-cli/src/tui**
Each directory in `packages/experience-design-system-cli/src/tui` represents a menu item in the TUI and is an indepedent flow of screens.
Each flow is separate and if that results in code duplication, that is okay. This is because with agentic engineering we do not want to introduce dependencies where one bug in a given flow breaks the another flow. Additionally, by keeping each flow independent, we can easily trace the source of the bug, introduce updates faster, and build more efficiently without having to think about consequences outside of the given flow.

For each directory and flow, there is always a top level parent container screen named: `PageContainer.tsx`. This defines the outer layer for all the pages for a given flow. Each `PageContainer.tsx` for a given flow is allowed to be different as each flow serves a different purpose. The purpose of `PageContainer.tsx` for a given flow is to unify the same controls, look, theme, and functions that is shared across all pages/screens for a given flow.

### Settings Flow (`src/tui/settings/`)

Settings pages persist user preferences and credentials to `~/.config/experiences/credentials.json` (shared with cli-v1). The `utils/v1-store.ts` module provides generic read/write functions for this store.

Each preference screen:

- Imports `readV1Store` / `writeV1Store` from `utils/v1-store.ts`
- Implements domain-specific store adapters (e.g., `analytics-store.ts`, `debug-mode-store.ts`)
- Follows the same UX pattern: load state on mount, toggle on Enter/Space, navigate on Esc/q

See `src/tui/settings/README.md` for implementation details.

## Supported Frameworks

1. React
2. Astro
3. Vue
4. Svelte

## Unsupported Frameworks

5. Angular (coming soon)

---

## TUI Design Patterns

The v2 TUI uses React 18 and Ink 5, the same copies v1 uses. Its only runtime dependencies are `ink`, `react`, `commander` and `semver`.

### State

Each screen manages its own React state with `useState`. State flows down via props and up via callbacks. There is no shared store.

### Input

Use Ink's `useInput` for keys. The existing screens treat `q` and `Esc` as "go back" (see `src/tui/home/home.tsx` and `src/tui/settings/debug-mode/screen.tsx`). `useInput` subscribes after the first frame, so a keypress sent immediately on mount can be dropped.

### Theme

Each flow owns its styling. The home menu keeps its palette in `src/tui/home/home.theme.ts`; other flows define theirs beside their screens. There is no shared `ui/` folder.

### The Import flow

`src/tui/import/` is the Import menu item. Its `PageContainer.tsx` currently stops reading stdin, spawns the bundled legacy `import` with inherited stdio (`spawn-v1-import.ts`, `terminal-input.ts`), then resumes the menu. `src/legacy/legacy-cli-path.ts` locates the bundled legacy CLI (`legacy/bin/cli.js` in an installed package, the sibling `experience-design-system-cli-legacy` package in the monorepo). This package must never import legacy code.

### Terminal

The TUI needs an interactive terminal. `app.tsx` exports `runApp`, which `program.ts` renders for the default command.

### Example Screen

```tsx
import { Box, Text, useInput } from "ink";

export function ConfirmScreen({
  onDone,
  onBack,
}: {
  onDone: () => void;
  onBack: () => void;
}) {
  useInput((input, key) => {
    if (key.return) onDone();
    if (key.escape || input === "q") onBack();
  });

  return (
    <Box flexDirection="column" paddingX={2}>
      <Text bold>Continue?</Text>
      <Text dimColor>Enter to confirm, Esc to go back</Text>
    </Box>
  );
}
```

## Testing

Use `ink-testing-library` for screen tests and set `NO_COLOR=1` to suppress ANSI codes. Wait for Ink to subscribe to input before sending keys.

## Performance Tips

1. **Keep renders light** — Ink renders every frame. Move expensive work (file I/O, network calls) outside React
2. **Only one `useInput` listener per screen** — multiple listeners on the same screen conflict

## Skills & Resources

### Available Skills

- **`ink-api`** — Core Ink API (Box, Text, colors, hooks)
- **`ink-ui`** — Ink UI component reference

### External References

- **Ink GitHub**: https://github.com/vadimdemedes/ink
