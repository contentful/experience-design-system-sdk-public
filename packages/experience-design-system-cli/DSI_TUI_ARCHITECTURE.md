# Engineering Design and Implementation Standard

## Purpose

This document defines how humans and coding agents: design, implement, test, and review changes for the `experience-design-system-cli` package.

## Project structure

**packages/experience-design-system-cli/src/tui**
This package is the Terminal UI flow that the customer interacts with

**packages/experience-design-system-cli/src/api**
This is where all the api calls are made that the TUI needs

**~/.contentful/experience-design-system-cli/config.json**
The single settings file, read and written through `@contentful/experience-design-system-types/config` (the only module that knows the path). Holds credentials (spaceId, environmentId, cmaToken, host), preferences (analyticsDisabled, debug, debugMode) and defaults. The CLI and the bundled legacy import share it; `EDS_HOME` relocates the whole folder (used by tests).

**~/.contentful/experience-design-system-cli/debug/sessions**
Per-session debug logs. v2 creates `MM-DD-YYYY-session-N/` directories with markdown run snapshots for each flow visit. Logging is toggled from Settings > Debug Mode.

## Project Architecture

**packages/experience-design-system-cli/src/tui**
Each directory in `packages/experience-design-system-cli/src/tui` represents a menu item in the TUI and is an indepedent flow of screens.
Each flow is separate and if that results in code duplication, that is okay. This is because with agentic engineering we do not want to introduce dependencies where one bug in a given flow breaks the another flow. Additionally, by keeping each flow independent, we can easily trace the source of the bug, introduce updates faster, and build more efficiently without having to think about consequences outside of the given flow.

For each directory and flow, there is always a top level parent container screen named: `PageContainer.tsx`. This defines the outer layer for all the pages for a given flow. Each `PageContainer.tsx` for a given flow is allowed to be different as each flow serves a different purpose. The purpose of `PageContainer.tsx` for a given flow is to unify the same controls, look, theme, and functions that is shared across all pages/screens for a given flow.

### Settings Flow (`src/tui/settings/`)

Settings pages persist user preferences and credentials to `~/.contentful/experience-design-system-cli/config.json` (shared with the bundled legacy import). `utils/v1-store.ts` re-exports the shared read/write functions from `@contentful/experience-design-system-types/config`.

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

`src/tui/import/` is the Import menu item. The Import menu item shows the Welcome step (`steps/01-welcome`) and collects the project path, then the Token input step (`steps/02-token-input`) and collects the token file, then the Path validation step (`steps/03-path-validation`), which scans the project folder and asks the user to confirm it. `app.tsx` then stops reading stdin and spawns the bundled legacy `import` with `--project <path> --tokens <file>`, so the legacy wizard starts at its own steps after these. `PageContainer.tsx` shows the result when it exits with inherited stdio (`spawn-v1-import.ts`, `terminal-input.ts`), then resumes the menu. `src/legacy/legacy-cli-path.ts` locates the bundled legacy CLI (`legacy/bin/cli.js` in an installed package, the sibling `experience-design-system-cli-legacy` package in the monorepo). This package must never import legacy code.

### Multi-step flows

Inside one flow, share code freely, but keep each screen small and its parts separate. The import flow is the reference:

```
src/tui/import/
  PageContainer.tsx      # the import result screen, and what all import screens will share
  steps/
    index.ts             # public entry: one export line per screen
    01-welcome/          # steps are numbered in the order they appear in the flow
      screen.tsx         # UI only: renders props and state, including the copy it displays
      controls.ts        # this screen's keyboard handling and key hints
      logic.ts           # decisions: validation, derived values, key meanings
```

Rules for a screen:

- Use Ink and its ecosystem for input and layout. Text fields are `ink-text-input`, which handles focus, the cursor, pasting and editing; keys that are not part of a field go through Ink's `useInput`. Do not read stdin or parse keys by hand.
- Controls belong to the screen: its key handling and the hints shown for it live in that step's `controls.ts`.
- Keep comments out of v2 source. Names, types and small functions carry the meaning.
- Props in, a typed result out through callbacks. A screen does not know which screen comes next.
- No `process.exit`, no database, network or subprocess calls, and no filesystem work while rendering. `logic.ts` never imports Ink or React components, so it can be tested without rendering.
- Numbered folders are steps of the happy path. Pieces used by several steps are not steps and stay unnumbered.

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
      <Text>[Enter] Confirm · [Esc] Back</Text>
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
