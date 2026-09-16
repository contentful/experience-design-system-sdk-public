# Upgrade

## Purpose

Lets you check for and install a newer version of the CLI without leaving the TUI. No more "go check GitHub, `npm install -g` by hand, restart."

## Directory structure

```
upgrade/
├── README.md
├── services/
│   └── version-check.ts   # compares your version vs. the latest git tag
└── ui/
    ├── PageContainer.tsx  # outer chrome (header), wraps the real screen
    └── UpgradeScreen.tsx  # the actual logic: check → install → done/error
```

- **`services/version-check.ts`** — reads your installed version from `package.json`, fetches the repo's tags from GitHub, and tells you if you're `up-to-date`, if an `update-available`, or if the check itself failed (`error`).
- **`ui/PageContainer.tsx`** — thin wrapper, just the "Upgrade" header + padding. Doesn't know anything about upgrade logic.
- **`ui/UpgradeScreen.tsx`** — everything that actually happens: runs the version check, spawns `npm install -g` if there's a newer version, shows a spinner while it works, and shows the result (done/error) with Back/Quit/Restart controls.

## When the option is enabled vs. disabled

The "Upgrade" row on the Start menu checks your version against the latest tag as soon as the app loads, and its label/behavior changes based on the result:

| Version check result | Label shown | Selectable? |
|---|---|---|
| Still checking | `Upgrade` (default) | ✅ yes |
| Check failed (`error`) | `Upgrade` (default) | ✅ yes |
| `update-available` | `Upgrade (vX.Y.Z available) ●` — bold, green | ✅ yes |
| `up-to-date` | `Upgrade (up to date)` — dimmed, muted color | ❌ no — Enter is a no-op |

So it's not just a text swap — you can tell at a glance: green + a dot means there's something to grab, dimmed-out gray means there's nothing to do here.

The rule of thumb: **we only disable it when we're sure there's nothing to upgrade to.** If the check is still running or it failed (bad network, GitHub down, whatever), we don't want to block you from going in — worst case, the screen re-checks and tells you you're already up-to-date.
