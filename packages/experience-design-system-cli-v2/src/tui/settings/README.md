# Settings Flow

Settings pages allow users to configure CLI preferences and credentials.

## V1 Store Integration

All settings persist to `~/.config/experiences/credentials.json` (shared with cli-v1):

- `readV1Store()` / `writeV1Store()` — Generic v1 store read/write
- `analyticsDisabled` — Inverted logic (true = OFF, false = ON)

Each settings screen uses its own store adapter:

- `config-store.ts` — Credentials (space, environment, token, host)
- `analytics-store.ts` — Preferences (analytics enabled/disabled)

New preference screens should follow this pattern:

1. Create a store adapter that imports `readV1Store` / `writeV1Store` from `utils/v1-store.ts`
2. Implement read/write functions following the screen's domain model
3. For an on/off preference, render it with `ToggleSettingScreen` (load the value, toggle and save on Enter/Space, go back on Esc/q). The screen file only passes its title, label, optional description and the store's read/write, as `debug-mode/screen.tsx` and `opt-in-analytics/screen.tsx` do
