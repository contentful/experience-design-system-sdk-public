# Settings Flow

Settings pages allow users to configure CLI preferences and credentials.

## V1 Store Integration

All settings persist to `~/.contentful/experience-design-system-cli/config.json` (shared with the bundled legacy import, via `@contentful/experience-design-system-types/config`):

- `readV1Store()` / `writeV1Store()` — Generic v1 store read/write
- `analyticsDisabled` — Inverted logic (true = OFF, false = ON)

Each settings screen uses its own store adapter:

- `config-store.ts` — Credentials (space, environment, token, host)
- `analytics-store.ts` — Preferences (analytics enabled/disabled)

New preference screens should follow this pattern:

1. Create a store adapter that imports `readV1Store` / `writeV1Store` from `utils/v1-store.ts`
2. Implement read/write functions following the screen's domain model
3. Use the same UX as debug-mode: load-state, toggle on Enter/Space, navigate on Esc/q

## Import defaults

Settings > Configuration also holds two optional values, the default component directory and the default token file (`defaultComponentDir`, `defaultTokenFile` in `config.json`). The import flow reads them each time it opens and pre-fills the Welcome (project path) and Token input (token file) screens, so you can press Enter instead of retyping. Leaving a field empty removes the default.
