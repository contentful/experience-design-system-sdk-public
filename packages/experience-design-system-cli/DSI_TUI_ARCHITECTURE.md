# Engineering Design and Implementation Standard

How humans and coding agents design, implement, test and review changes to the `experience-design-system-cli` package. It supports React, Astro, Vue, Svelte, Stencil, Web Components and Angular codebases.

## Project structure

- `src/tui/`: the terminal UI the customer interacts with.
- `src/api/`: the API calls the TUI needs.
- `~/.contentful/experience-design-system-cli/config.json`: the single settings file, read and written through `@contentful/experience-design-system-types/config` (the only module that knows the path). It holds credentials (spaceId, environmentId, cmaToken, host), preferences (analyticsDisabled, debug, debugMode), agent settings (agent, agentModel, agents) and defaults. `EDS_HOME` relocates the whole folder (tests use it).
- One folder per terminal session, numbered per day. `<root>` is the "Root Project Directory" setting (Settings > Configuration > Project); when it is empty, the session is created once the import starts, in the project being imported:

```
<root>/.contentful/MM-DD-YYYY-session-N/
├── debug/           per-screen debug logs (markdown run snapshots), written only while Debug Mode is on
└── dsi-import-N/    one import run's output: tokens.json, .existing-entities.json, components.json
                     (each import in the session gets the next number, so a second never overwrites the first)
```

## Architecture

Each directory in `src/tui/` is a menu item in the TUI and an independent flow of screens. Flows stay separate even when that duplicates code: with agentic engineering we do not want a bug in one flow to break another, and independence makes bugs easier to trace and changes faster to make.

Every flow has a top-level parent screen named `PageContainer.tsx`. It is the outer layer for all the flow's pages and unifies the controls, look, theme and functions they share. Each flow's `PageContainer.tsx` may differ, because each flow serves a different purpose.

The TUI needs an interactive terminal. `app.tsx` exports `runApp`, which `program.ts` renders for the default command.

### Settings flow (`src/tui/settings/`)

Settings pages persist preferences and credentials to `config.json`. `settings/shared/v1-store.ts` re-exports the shared read and write functions from `@contentful/experience-design-system-types/config`. Each preference screen:

- imports `readV1Store` / `writeV1Store` from `settings/shared/v1-store.ts`;
- has domain-specific store adapters (for example `analytics-store.ts`, `debug-mode-store.ts`);
- follows the same pattern: load state on mount, toggle on Enter or Space, navigate on Esc or q.

**Agent settings** (Settings > Configuration > Agents, `settings/configuration/agents/`) is where the user picks the coding agent the import runs. It writes three keys to `config.json`:

- `agent`: the default agent (`claude`, `codex`, `opencode`, `cursor` or `copilot`). It is written only once the user chooses one, so someone who never chose keeps the built-in default, even if that default changes in a later version.
- `agentModel`: the model for the default agent. It always matches the default agent's entry in `agents`.
- `agents`: each agent's own `model` and `binary` (the path to its command), so changing the default does not lose another agent's settings. An empty model means the agent's built-in default; an empty binary means the command is looked up on the `PATH`.

A saved binary reaches the pipeline through `EDS_AGENT_BINARY_<AGENT>`, which `apply-binary-overrides.ts` sets at startup and after each save. A saved path wins over a variable already in the shell, and clearing it restores the shell's value.

**Project settings** (Settings > Configuration > Project, `settings/configuration/project/`) holds the Contentful credentials (Space ID, Environment ID, CMA Token, API Host), the Root Project Directory that sessions are created in (`contentfulBaseDir`), and the import defaults `defaultComponentDir` and `defaultTokenFile`.

### Import flow (`src/tui/import/`)

The Import menu item. It asks what to import (`steps/00-preflight`), and the choice decides which of the numbered steps `01-welcome` … `10-flow` run; `ARCHITECTURE.md` lists them. `app.tsx` runs the whole import in one process. The flow's state machine is `steps/10-flow/flow/controller.ts`, kept free of React so it can be tested; `flow/use-flow.ts` and `flow/screen.tsx` connect it to the terminal. When the flow ends it reports an exit code, and `PageContainer.tsx` shows the result and resumes the menu.

## TUI design patterns

The TUI uses React 18 and Ink 5, with `ink-text-input` for text fields.

**State.** Each screen manages its own state with `useState`. State flows down through props and up through callbacks. There is no shared store.

**Input.** Use Ink's `useInput` for keys, with one listener per screen (several on one screen conflict). Existing screens treat `q` and `Esc` as "go back" (see `src/tui/home/home.tsx` and `src/tui/settings/debug-mode/screen.tsx`). `useInput` subscribes after the first frame, so a key sent immediately on mount can be dropped.

**Theme.** The shared palette is in `src/tui/theme.ts`, with a dark and a light set chosen from the terminal background. Screens import `PALETTE` and never hardcode colours, including named ones like `'red'` or `'gray'`. Use `PALETTE.accent` for emphasis and `PALETTE.onAccent` for text on an accent background. Do not define a second palette in a flow.

Import it through the `@tui` alias, not a long relative path: `import { PALETTE } from '@tui/theme.js';`. The alias maps `@tui/*` to `src/tui/*` and is set in `tsconfig.json` (`paths`, used by the type check and the esbuild build) and in `vitest.config.ts` (`resolve.alias`), so a new alias needs both. Use it when the relative path goes up three or more folders.

**Shared components** are those used by more than one flow, in `src/tui/shared/components/`. Flows keep any other styling beside their screens.

- `ControlHints`: the one control-hint line, with `[keys]` in the accent colour and the label in the normal text colour, no border. Use it for every screen's key hints, passing `{ keys, label }` entries (add `active: true` to highlight a hint whose mode is on). Do not hand-write hint lines.
- `StepHeader`: the import's tab bar (Extract, Select, Generate, Review, Push) with the version on the right and a rule across the full width. Pass `step="extraction"` and so on; `step="done"` marks every step finished. Render it above the screen's padded content, not inside the padding, so the rule reaches the edges.

**Keep renders light.** Ink redraws every frame, so do expensive work (file I/O, network calls) outside React.

## Multi-step flows

Inside one flow, share code freely but keep each screen small and its parts separate. The import flow is the reference:

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

- Use Ink and its ecosystem for input and layout. Text fields are `ink-text-input`, which handles focus, the cursor, pasting and editing; keys outside a field go through `useInput`. Do not read stdin or parse keys by hand.
- Controls belong to the screen: its key handling and hints live in that step's `controls.ts`.
- Keep comments out of this package's source. Names, types and small functions carry the meaning.
- Props in, a typed result out through callbacks. A screen does not know which screen comes next.
- No `process.exit`, no database, network or subprocess calls, and no filesystem work while rendering. `logic.ts` never imports Ink or React components, so it can be tested without rendering.
- Numbered folders are steps of the happy path. Pieces used by several steps are not steps and stay unnumbered.

### Example screen

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

Use `ink-testing-library` for screen tests. Colors are always on in tests (the vitest config sets `FORCE_COLOR=3`), so match on text rather than ANSI codes. Wait for Ink to subscribe to input before sending keys.

`test/e2e` drives the whole wizard with keystrokes against a fixture project, with only the agent and Contentful faked. See `CONTRIBUTING.md` for how to run it.

## References

Skills in `.claude/skills/`: `ink-api` (core Ink API: Box, Text, colors, hooks) and `ink-ui` (Ink UI component reference). Ink itself: https://github.com/vadimdemedes/ink
