# Debug logs

This directory holds per-screen debug logs written by the v2 CLI's Configuration
and Upgrade flows. Each file records what you did on a screen and what the CLI
did in response — useful for reproducing an issue with Contentful's dev team.

- `sessions/<sessionId>/` — one directory per terminal session, created the
  moment the CLI boots. `sessionId` is a `YYYYMMDD-HHMMSS` timestamp, so
  sessions sort chronologically by name — the most recent run is always the
  last one alphabetically.
- Inside a session directory, subdirectories mirror the menu options you ran
  (e.g. `settings/contentful-configuration/`, `upgrade/`), same as before —
  just nested one level deeper under the session.
- Files are Markdown, one per screen visit, named `<runId>__<flow>__<step>.md`.
- Sensitive values (like `cma_token`) are redacted before anything is written —
  files are safe to paste into Slack or attach to a support ticket.
- You can delete this directory (except this README) at any time with no
  side effects; it will be recreated as needed.
- Turn logging off from Settings › Debug Mode if you'd rather not generate
  these files.
