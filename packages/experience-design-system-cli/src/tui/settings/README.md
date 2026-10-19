# Settings Flow

Settings pages allow users to configure CLI preferences and credentials.

## V1 Store Integration

All settings persist to `~/.contentful/experience-design-system-cli/config.json` (shared with the bundled legacy import, via `@contentful/experience-design-system-types/config`):

- `readV1Store()` / `writeV1Store()` — Generic v1 store read/write
- `analyticsDisabled` — Inverted logic (true = OFF, false = ON)

Each settings screen uses its own store adapter:

- `config-store.ts` — Credentials (space, environment, token, host)
- `analytics-store.ts` — Preferences (analytics enabled/disabled)
- `agents/agent-store.ts` — Agent settings (default agent and each agent's model)

New preference screens should follow this pattern:

1. Create a store adapter that imports `readV1Store` / `writeV1Store` from `utils/v1-store.ts`
2. Implement read/write functions following the screen's domain model
3. Use the same UX as debug-mode: load-state, toggle on Enter/Space, navigate on Esc/q

## Configuration

Settings > Configuration is a menu with two sections, both stored in the same `config.json`:

- **Project** (`contentful-configuration/ProjectConfigScreen.tsx`) — space, environment, token, host, import defaults and the Root Project Directory.
- **Agents** (`agents/AgentsScreen.tsx`) — the **Default agent** row (←/→ or Enter cycles it, saved at once) and one row per supported agent (Claude Code, OpenAI Codex, OpenCode, Cursor, GitHub Copilot). Enter on an agent opens its form, where the model can be set.

Both forms use the shared `shared/FieldForm.tsx` (↑/↓ move, Enter edits a field, `c` clears, `s` saves, Esc/q goes back without saving).

Agent keys in `config.json`: `agent` (the default agent), `agentModel` (the default agent's model) and `agents` (`{ <name>: { model } }`). The import reads `agent` and `agentModel`; `--agent name:model` overrides them. `agentModel` is always rewritten from the default agent's entry in `agents`, so they cannot disagree.

The Help page lists where these settings, the debug logs and each import's `tokens.json` / `components.json` live (`help/file-locations.ts`), based on the Root Project Directory and Debug Mode.

## Import defaults

Settings > Configuration > Project also holds two optional values, the default component directory and the default token file (`defaultComponentDir`, `defaultTokenFile` in `config.json`). The import flow reads them each time it opens and pre-fills the Welcome (project path) and Token input (token file) screens, so you can press Enter instead of retyping. Leaving a field empty removes the default.
