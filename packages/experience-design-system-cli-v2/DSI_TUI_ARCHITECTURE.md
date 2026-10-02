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
      screen.tsx         # UI only: renders props and state, including the copy it displays and its props type
      controls.ts        # this screen's shortcuts (Esc, q) and the key hints shown for it
      logic.ts           # decisions: validation, derived values, loaders, result building
```

Rules for a screen:
- Use Ink and its ecosystem for input and layout instead of writing our own. Text fields are `ink-text-input`, which handles focus, the cursor, pasting and editing; keys that are not part of a field go through Ink's `useInput`. Do not read stdin or parse keys by hand.
- Controls belong to the screen: its shortcuts and the hints shown for it live in that step's `controls.ts`, not in a shared file. Controls that really are common to every import screen belong in `PageContainer.tsx`.
- Keep comments out of v2 source. Names, types and small functions should carry the meaning.
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

---

## TUI Design Patterns & Architecture

The v2 wizard uses React and Ink for a modern, step-by-step guided experience. Design patterns are documented here and adapted from PostHog's wizard architecture.

### State Management

**Default approach: Component-driven**

Each screen manages its own React state via `useState`. State flows down via props, mutations flow up via callbacks.

```tsx
export function MyScreen({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState("");

  return (
    <TextInput value={value} onChange={setValue} onSubmit={() => onDone()} />
  );
}
```

**When to upgrade: Shared state (Jotai)**

If 3+ screens read/write the same data (e.g., credentials, extracted components), use Jotai atoms:

```ts
// src/tui/wizard-store.ts
import { atom } from "jotai";

export const $credentials = atom<Credentials | null>(null);
export const $sessionId = atom<string | null>(null);
```

Then in screens:

```tsx
import { $credentials } from "../wizard-store.js";
import { useAtom } from "jotai";

export function CredentialsScreen() {
  const [creds, setCreds] = useAtom($credentials);
  // ...
}
```

**Decision tree**:

- Single screen, local data → `useState`
- 2–3 screens share data → pass via props + callbacks
- 3+ screens, frequent mutations → upgrade to Jotai

### Theme & Styling

**Always use `src/tui/ui/theme.ts`** — centralized colors, spacing, icons:

```ts
export const COLORS = {
  primary: "#06b6d4",
  success: "#22c55e",
  error: "#ef4444",
  muted: "#9ca3af",
} as const;

export const SPACING = {
  xs: 1,
  sm: 2,
  md: 4,
  lg: 8,
} as const;
```

Import and use everywhere:

```tsx
import { COLORS, SPACING } from "../../ui/theme.js";

<Box padding={SPACING.md} borderColor={COLORS.primary}>
  <Text>Content</Text>
</Box>;
```

**Benefits**:

- Single point of change for redesigns
- Consistent color semantics
- Easy to add dark mode later

### Layout Primitives

**When to extract: After 4+ screens with repeated structure**

Create simple wrappers in `src/tui/ui/primitives/`:

```tsx
// primitives/ScreenFrame.tsx
export function ScreenFrame({ title, subtitle, children }) {
  return (
    <Box flexDirection="column" paddingX={SPACING.md} paddingY={SPACING.md}>
      <Text bold color={COLORS.primary}>
        {title}
      </Text>
      {subtitle && <Text color={COLORS.muted}>{subtitle}</Text>}
      <Box marginTop={SPACING.sm}>{children}</Box>
    </Box>
  );
}
```

Then use:

```tsx
<ScreenFrame title="Import Settings" subtitle="Step 1 of 3">
  {/* content */}
</ScreenFrame>
```

**Start simple**: If you only have 2–3 screens, keep inline `<Box>` hierarchies. Refactor when you hit 4+ screens with identical structure.

### Flow Router (Optional)

**When to add: 5+ steps with complex interdependencies**

Create `src/tui/wizard-router.ts` to centralize decision logic:

```ts
export type WizardStep = "home" | "credentials" | "extracting" | "done";

export interface FlowDecision {
  step: WizardStep;
  canAdvance(state: WizardState): boolean;
  description: string;
}

export const FLOW: FlowDecision[] = [
  {
    step: "home",
    canAdvance: (s) => s.confirmed,
    description: "User clicked Start",
  },
  // ...
];

export function canAdvance(step: WizardStep, state: WizardState): boolean {
  return FLOW.find((f) => f.step === step)?.canAdvance(state) ?? false;
}
```

Then in screens, gate the "Next" button:

```tsx
const nextEnabled = canAdvance(currentStep, wizardState);

<Button disabled={!nextEnabled} onClick={() => onDone()}>
  Continue
</Button>;
```

**Don't add prematurely**: The current step-based approach works fine. Add a router only when flow logic becomes too complex to reason about.

### Terminal Compatibility

**Always detect at startup** — v2 is TUI-only:

```ts
// src/tui/terminal.ts
export function requireInteractiveTerminal(): void {
  const isTTY = process.stdout.isTTY ?? false;
  const cols = process.stdout.columns ?? 80;
  const isSmall = cols < 80;
  const isCI = !!process.env.CI;

  if (!isTTY || isSmall || isCI) {
    process.stderr.write(
      "Error: v2 wizard requires an interactive terminal (80+ columns, not CI).\n" +
        'Use "exo importv2" in a real terminal.\n',
    );
    process.exit(1);
  }
}
```

Call in entry point before rendering:

```tsx
export function WizardApp() {
  requireInteractiveTerminal();
  // ... render wizard ...
}
```

### @inkjs/ui Components

Use official components from `@inkjs/ui` when possible:

- **`Select`** — Menu with arrow-key navigation, Enter to confirm
- **`TextInput`** — Single-line text entry
- **`Confirm`** — Yes/No prompt
- **`Spinner`** — Animated loading indicator (dots, line, pipe, etc.)
- **`ProgressBar`** — Visual progress indicator

See `.claude/skills/ink-ui/SKILL.md` for full API and examples.

### Example Screen

```tsx
import { Box, Text, useInput } from "ink";
import { TextInput } from "@inkjs/ui";
import { useState } from "react";
import { COLORS, SPACING } from "../../ui/theme.js";

export function CredentialsScreen({
  onDone,
}: {
  onDone: (status: string) => void;
}) {
  const [spaceId, setSpaceId] = useState("");
  const [token, setToken] = useState("");

  return (
    <Box flexDirection="column" paddingX={SPACING.md} paddingY={SPACING.sm}>
      <Text bold color={COLORS.primary}>
        Contentful Credentials
      </Text>

      <Box marginTop={SPACING.md} flexDirection="column" gap={1}>
        <Text>Space ID:</Text>
        <TextInput
          value={spaceId}
          onChange={setSpaceId}
          focus
          placeholder="sp_..."
        />

        <Text marginTop={SPACING.md}>Management Token:</Text>
        <TextInput
          value={token}
          onChange={setToken}
          mask="*"
          placeholder="CFPAT-..."
        />
      </Box>

      <Box marginTop={SPACING.md} gap={2}>
        <Box
          onClick={() => onDone("completed")}
          borderStyle="round"
          padding={1}
        >
          <Text color={spaceId && token ? COLORS.primary : COLORS.muted}>
            {spaceId && token ? "→ Continue" : "  (fill both fields)"}
          </Text>
        </Box>
        <Box
          onClick={() => onDone("cancelled")}
          borderStyle="round"
          padding={1}
        >
          <Text color={COLORS.muted}>Cancel</Text>
        </Box>
      </Box>
    </Box>
  );
}
```

## Testing

### Mock Terminal Detection

```ts
vi.mock("../terminal.ts", () => ({
  requireInteractiveTerminal: () => {
    // no-op in tests
  },
}));
```

### Mock Stores (Jotai)

```ts
vi.mock("../wizard-store.ts", () => ({
  useWizardStore: () => ({
    sessionId: ["test-123", vi.fn()],
    credentials: [{ spaceId: "sp_123" }, vi.fn()],
  }),
}));
```

### Render Components

Use `ink-testing-library`:

```ts
import { render } from 'ink-testing-library';

const { lastFrame } = render(<MyScreen onDone={vi.fn()} />);
expect(lastFrame()).toContain('My Title');
```

Set `NO_COLOR=1` in test environment to suppress ANSI codes in snapshots.

## Performance Tips

1. **Keep renders light** — Ink renders every frame. Move expensive computations outside React (e.g., file I/O, network calls)
2. **Use `useCallback` for inline functions** — Prevents child re-renders
3. **Only one `useInput` listener** — Multiple listeners on the same screen conflict
4. **Don't inline large arrays** — Define `COLORS`, `SPACING` once at module level

## When to Reach for Each Pattern

**Rule of thumb**: Start simple (component-driven state, inline layouts). Refactor only when the pattern becomes painful. \

## Skills & Resources

### Available Skills

- **`ink-api`** — Core Ink API (Box, Text, colors, hooks)
- **`ink-ui`** — @inkjs/ui components (Select, TextInput, Confirm, Spinner, ProgressBar)

### External References

- **Ink GitHub**: https://github.com/vadimdemedes/ink
- **@inkjs/ui docs**: https://github.com/vadimdemedes/ink/tree/master/packages/ui
