# Settings Flow

Settings pages allow users to configure CLI preferences and credentials.

## Layout

The folders mirror the menu, so the tree reads like Settings in the TUI:

```
Settings                              settings/
├─ Configuration                      ├─ PageContainer.tsx            the Settings menu
│  ├─ Project                         ├─ configuration/
│  └─ Agents                          │  ├─ ConfigurationScreen.tsx   the Project / Agents menu
├─ Opt-in Analytics                   │  ├─ project/                  Project
└─ Debug Mode                         │  └─ agents/                   Agents
                                      ├─ opt-in-analytics/
                                      ├─ debug-mode/
                                      └─ shared/                      FieldForm and the config.json adapter
```

Each screen's folder holds its screen and its store adapter. `shared/` is only for what more than one screen uses.

## V1 Store Integration

All settings persist to `~/.contentful/experience-design-system-cli/config.json` (via `@contentful/experience-design-system-types/config`):

- `readV1Store()` / `writeV1Store()` (`shared/v1-store.ts`) — Generic store read/write
- `analyticsDisabled` — Inverted logic (true = OFF, false = ON)

Each settings screen uses its own store adapter:

- `configuration/project/project-store.ts` — Credentials (space, environment, token, host)
- `opt-in-analytics/analytics-store.ts` — Preferences (analytics enabled/disabled)
- `configuration/agents/agent-store.ts` — Agent settings (default agent, and each agent's model and command path)

New preference screens should follow this pattern:

1. Create a store adapter that imports `readV1Store` / `writeV1Store` from `shared/v1-store.ts`
2. Implement read/write functions following the screen's domain model
3. Use the same UX as debug-mode: load-state, toggle on Enter/Space, navigate on Esc/q

## Configuration

Settings > Configuration is a menu with two sections, both stored in the same `config.json`:

- **Project** (`configuration/project/ProjectScreen.tsx`) — space, environment, token, host, import defaults and the Root Project Directory.
- **Agents** (`configuration/agents/AgentsScreen.tsx`) — a read-only **Default agent** line, then one row per supported agent (Claude Code, OpenAI Codex, OpenCode, Cursor, GitHub Copilot) with a status. ↑/↓ move through the agents, Enter makes the focused one the default (saved at once), and → opens its own screen (`AgentDetail.tsx`), where its command path and model are set and a test can be run.

Both forms use the shared `shared/FieldForm.tsx` (↑/↓ move, Enter edits a field or runs an action, `c` clears, `s` saves, Esc/q goes back without saving).

Agent keys in `config.json`: `agent` (the default agent), `agentModel` (the default agent's model) and `agents` (`{ <name>: { model, binary } }`, only what was set). The import reads `agent` and `agentModel`; `--agent name:model` overrides them. `agentModel` is always rewritten from the default agent's entry in `agents`, so they cannot disagree. A saved `binary` is copied into `EDS_AGENT_BINARY_<AGENT>` at startup (`apply-binary-overrides.ts`), so it wins over the same variable set in the shell.

The Help page lists where these settings, the debug logs and each import's `tokens.json` / `components.json` live (`help/file-locations.ts`), based on the Root Project Directory and Debug Mode.

Debug logs are written under a `flow` name (`settings/agents`, `settings/contentful-configuration`) that is part of the log's path on disk. It is not the folder name, and was not renamed with the folders, so existing logs keep landing in the same place.

## Import defaults

Settings > Configuration > Project also holds two optional values, the default component directory and the default token file (`defaultComponentDir`, `defaultTokenFile` in `config.json`). The import flow reads them each time it opens and pre-fills the Welcome (project path) and Token input (token file) screens, so you can press Enter instead of retyping. Leaving a field empty removes the default.
