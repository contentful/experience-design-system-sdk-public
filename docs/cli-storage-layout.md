# CLI Storage Layout and Migration

## Status

Implemented in the v1 CLI. This document records the storage boundary,
migration behavior, and compatibility contract.

## Decision summary

Keep project outputs in the project, and consolidate machine-local CLI state
under one application-owned root:

```text
~/.contentful/experience-design-system-cli/
├── config/
│   └── credentials.json
├── state/
│   ├── pipeline.db
│   ├── pipeline.db-shm
│   ├── pipeline.db-wal
│   ├── reviews/
│   │   └── <session-id>/
│   └── runs.json
└── logs/
    └── debug/
```

The subdirectories preserve the distinction between credentials,
mutable state, and diagnostic output without exposing three unrelated roots to
users. The project-local `<project>/.contentful/` directory remains separate
because its contents are generated outputs selected by the project owner and
may be checked in, copied, or passed to another tool.

## Current evidence

| Concern | Canonical location | Legacy source | Code evidence | Ownership |
| --- | --- | --- | --- | --- |
| Generated project output | `<project>/.contentful/` | — | `extractProject()` in `src/import/extract-project.ts`, `WizardApp.tsx:659-661` | Project-local and user-controlled |
| Pipeline/session database | `~/.contentful/experience-design-system-cli/state/pipeline.db` | `~/.contentful/experience-design-system-cli/pipeline.db` | `src/session/db.ts:232-236` | Machine-local CLI state; `EDS_PIPELINE_DB_PATH` overrides it |
| Review artifacts | `~/.contentful/experience-design-system-cli/state/reviews/` | `~/.contentful/experience-design-system-cli/reviews/` | `src/analyze/select/persistence.ts:15-20` | Machine-local CLI state; `EDS_REVIEW_ARTIFACTS_DIR` overrides it |
| Debug logs | `~/.contentful/experience-design-system-cli/logs/debug/` | `~/.contentful/experience-design-system-cli/debug/` | `src/lib/debug-logger.ts:85-90` | Machine-local diagnostics; `EDSI_DEBUG_ROOT` and `EDSI_DEBUG_LOG` override it |
| Credentials | `~/.contentful/experience-design-system-cli/config/credentials.json` | `~/.config/experiences/credentials.json` | `src/credentials-store.ts:22-24` | Machine-local secret configuration |
| Import run history | `~/.contentful/experience-design-system-cli/state/runs.json` | `~/.config/experiences/runs.json` | `src/runs/store.ts:57-62` | Machine-local CLI state |

The startup migration relocates these owned artifacts together while leaving
unrelated files in `~/.config/experiences/` untouched. The legacy paths in this
table are retained as recoverable `.migrated`, `.legacy`, or
`.pre-migration` backups when applicable.

## Path resolution contract

The shared storage-root resolver uses this precedence:

1. An explicit artifact override continues to win, preserving the existing
   `EDS_PIPELINE_DB_PATH`, `EDS_REVIEW_ARTIFACTS_DIR`, `EDSI_DEBUG_ROOT`, and
   `EDSI_DEBUG_LOG` behavior.
2. A new `EDSI_STORAGE_ROOT` override replaces the default application root and
   is used by credentials, runs, and any artifact without a more specific
   override.
3. The default is `~/.contentful/experience-design-system-cli/`.

The resolver must compute paths at call time rather than capture `homedir()` at
module initialization. This keeps test isolation and explicit environment
overrides reliable.

The root and its private files should retain restrictive permissions:

- Root and containing directories: mode `0700` where the platform supports it.
- Credentials, database files, run history, review state, and debug logs:
  mode `0600` where the platform supports it.
- Existing permissions must not be weakened during migration.

## Migration plan

Migration should be one-time, idempotent, and non-destructive.

### Legacy sources

The migration reads only artifacts owned by this CLI:

- `~/.contentful/experience-design-system-cli/pipeline.db` and its SQLite
  `-wal`/`-shm` siblings.
- `~/.contentful/experience-design-system-cli/reviews/`.
- `~/.contentful/experience-design-system-cli/debug/`.
- `~/.config/experiences/credentials.json`.
- `~/.config/experiences/runs.json`.
- The legacy `import.db` source already recognized by session migration.

Project-local `.contentful/` outputs are not moved.

### First-run sequence

1. Resolve the canonical root and explicit overrides.
2. Detect legacy artifacts before opening the canonical database or writing new
   state.
3. If the canonical artifact is absent, move the legacy artifact into its
   canonical location atomically where the filesystem permits.
4. For SQLite, treat `pipeline.db`, `pipeline.db-wal`, and `pipeline.db-shm` as
   one unit and migrate the available files before the CLI opens the canonical
   database.
5. Preserve a migration marker and retain a recoverable backup or rename record
   until the migration has been verified.
6. Make subsequent runs no-ops; a failed artifact migration must not mark the
   whole migration complete.

### Collisions and partial state

The CLI must never silently overwrite or merge incompatible state:

- Credentials: if both files exist, use the canonical file, preserve the legacy
  file as a backup, and emit an actionable warning.
- Run history: merge records by run ID only when both files are valid; canonical
  records win duplicate IDs, legacy-only records are retained, and the legacy
  input is preserved until verification.
- Reviews: move session directories independently; canonical session directories
  win collisions and conflicting legacy directories are retained for manual
  resolution.
- Debug logs: move files independently and rename collisions instead of
  overwriting either log.
- SQLite: do not attempt a row-level merge; if both databases are present and
  differ, retain both and direct the operator to an explicit migration path.
- Malformed credentials and run-history files remain at their source and prevent
  completion; other unreadable artifacts retain recoverable source backups and
  produce a warning without exposing credential values.

The migration must not delete the old root automatically. Cleanup can be a
separate, explicitly confirmed operation after the canonical state has been
validated.

## Rollout and compatibility

Use a compatibility window rather than changing every path in one release:

1. Introduce the shared resolver and migration planner behind the current
   per-artifact APIs.
2. Write all new state to the canonical layout; the first startup copies
   supported legacy artifacts and preserves recoverable backups.
3. Emit migration warnings for collisions and failures without printing
   credential contents.
4. After one stable release has supported migration, remove legacy migration
   support only in a separately documented cleanup change.

The existing per-artifact environment variables remain supported throughout the
compatibility window so CI, tests, and operators can isolate one concern when
needed. `EDSI_STORAGE_ROOT` becomes the documented default override for new
integrations and tests.

Automatic legacy migration runs only when the CLI is using the default storage
layout. Supplying a storage-root or artifact-path override intentionally opts
that invocation out of home-directory migration, which keeps isolated CI and
test runs from inspecting or moving another installation's state.

## Implementation and verification slices

The implementation is organized into these independently verifiable slices:

1. Resolve default and overridden paths through one storage module.
2. Persist credentials, run history, pipeline state, review artifacts, and debug
   logs under the canonical layout while preserving artifact-specific overrides.
3. Run non-destructive startup migration before opening the canonical database,
   including SQLite sidecars, run-history merging, collision warnings, and an
   idempotent completion marker.
4. Verify path precedence, single-source moves, collisions, run-history merges,
   sidecars, idempotence, and explicit-override isolation with focused tests.
5. Document canonical paths, override precedence, migration behavior, and
   recovery artifacts in user-facing documentation.

## Explicit non-goals

- Do not move or reinterpret project-local generated outputs.
- Do not add a cache or database to the newer stateless pipeline.
- Do not merge arbitrary files from `~/.config/experiences/`.
- Do not delete legacy state automatically.
- Do not define the layout for a future per-run archival system beyond the
  current `runs.json` history file.
