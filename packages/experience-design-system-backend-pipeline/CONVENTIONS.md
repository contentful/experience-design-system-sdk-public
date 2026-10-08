# backend-pipeline conventions

Enforced on every file in this package. Read before adding or moving anything.

## Top-level layout

```
src/
  index.ts                 public barrel
  steps/                   AI pipeline steps — one dir per step
    extraction/
    composition/
    selection/
    generation/
    apply/
  agents/                  AI runtime (invoker, parsers, prompts, skills)
  persistence/             SQLite + file I/O
  shared/                  pure data types (CDF, DTCG, Sources API)
```

- The CLI reaches into step controllers for pipeline work.
- The CLI reaches into `agents/`, `persistence/`, and `shared/` for infrastructure (session lifecycle, credentials, agent-metadata) — these are NOT steps.
- Nothing inside a step imports from another step. If logic is cross-step, it moves to `agents/`, `persistence/`, or `shared/`.

## Step dir layout

Every step follows the exact same shape:

```
steps/<step>/
  src/
    controller/            public entry points (one function per file)
    service/               internal orchestration (one function per file)
    <entity-dir>/          every noun the step operates on gets its own dir
      <verb>.ts            each file is a verb on that entity
      types/               only cross-file types for this entity
      constants/           only cross-file constants for this entity
      helpers/             sub-helpers if a verb needs further decomposition
    types/                 cross-entity types for this step
    constants/             cross-entity constants for this step
    AGENTS.md              1-page summary — input, output, cache, external calls
  test/
    controller/
    <entity-dir>/
```

## Naming rules

### Directories

- **A directory names an entity (a noun).** Not a verb, not a kind of file, not a vague bucket.
- No `utils/`, `misc/`, `common/`. If it doesn't name an entity, pick a different split.
- A directory is a "capability bucket" only if the capability is the entity (e.g. `fuzzy-match/` where fuzzy-match is the operation and no other noun fits).

### Files

- **A file names a verb.** The directory already supplies the noun — don't repeat it.
  - ✅ `component-patch/apply.ts`
  - ❌ `component-patch/apply-component-patch.ts`
- Exported function may keep a longer, fully-qualified name (`applyComponentPatch`) — the filename is dir-disambiguated.
- Single-verb filenames are preferred when the verb is unambiguous for the entity:
  - `build.ts`, `parse.ts`, `format.ts`, `load.ts`, `store.ts`, `run.ts`
- Multi-verb: use a hyphenated suffix (`parse-select.ts`, `build-dtcg-groups.ts`).
- `index.ts` is only ever a one-line barrel re-exporting the directory's contents. Never business logic.
- Class files use the class name: `api-client/api-client.ts`, `api-errors/api-error.ts`.

### Function names

- Verb-first, descriptive, no stutter.
  - ✅ `findSlotCycles`, `buildComponentGraph`, `applyComponentPatch`
  - ❌ `computeFoo`, `handleBar`, `doThing`
- Avoid vague verbs like `compute`, `process`, `handle` unless the operation genuinely has no better verb.
- Rename legacy names when they're wrong. Document the rename in the commit body.

## File size

- **Max 100 lines per file (hard ceiling).**
- **Target 10 lines or fewer where safe.**
- If a function needs more than 30 lines of logic, consider whether its helpers belong in sibling files.
- Types in their own files. Constants in their own files. No inline interfaces/consts next to a function.
- A single long switch (e.g. per-agent dispatch) is fine as long as each case delegates to a sibling file.

## Types

- Every type lives under `types/<entity>.ts` in the dir of the entity it describes.
- Request/response types for a controller go in `<step>/src/types/<verb>-request.ts` and `-response.ts` — or share `contract.ts` only when they're small and tied to one controller.
- `types/index.ts` is a barrel re-exporting every type file in that `types/` dir.
- Never put a type next to a function. Always its own file.

## Constants

- Same rule as types. `constants/<thing>.ts`, barrel in `index.ts`.
- A single constant object (e.g. `AGENT_BINARIES`) is one file.
- Related constants (e.g. all Bedrock constants) can share a file.
- No inline `const FOO = …` constants at the top of a function file. Move them.

## Barrels

- Every directory with 2+ files has an `index.ts` barrel.
- Barrel is a one-line-per-export re-export. No logic, no imports beyond `./x.js`.
- A directory with one file + a barrel is fine when the file is likely to grow.

## Imports

- Use `.js` extensions in TypeScript import paths (ESM nodenext).
- Prefer deep imports (`'../component-patch/apply.js'`) when importing one function.
- Prefer barrel imports (`'../component-patch/index.js'`) when importing multiple.
- No circular imports. If two entities need each other, the shared type goes to `shared/` or to the parent `types/`.

## Tests

- Mirror the source dir under `test/`.
- Every controller has at least one test for input validation + delegation + happy path.
- Pure helpers get unit tests next to the entity dir (`<entity-dir>/test/<verb>.test.ts`) OR in the step's `test/<entity-dir>/<verb>.test.ts`.
- Legacy-corpus regression tests for cross-step accuracy live under the consuming step's `test/`.

## AGENTS.md per step

Every step has one at `steps/<step>/src/AGENTS.md`:

- One-paragraph summary of what the step does
- **Input** — the shape it accepts
- **Output** — the shape it returns
- **Cache** — key / value / when-to-lookup / when-to-store, or "none"
- **External calls** — HTTP, agent subprocess, SQLite, or "pure"
- **DSI contribution** — fields the step produces for CLI analytics

## When adding a new function

1. Pick the step it belongs to (which TUI call sites consume it).
2. Pick the entity in that step (which noun does it operate on).
3. If the entity dir doesn't exist, create it.
4. Create the verb file (`<verb>.ts`).
5. Add types to `types/`, constants to `constants/`.
6. Export from the dir's barrel.
7. Export from the step's `src/index.ts` barrel.
8. Export from the pipeline's top-level `src/index.ts` barrel if the function is a public controller.
9. Add a test.
10. Keep the file under 100 lines. If it won't fit, split.

## When something doesn't fit

- If a function doesn't fit any step, it's probably not pipeline business logic — it's CLI or infrastructure. Move it to `agents/`, `persistence/`, or `shared/`.
- If it still doesn't fit, re-read the step's AGENTS.md. The step's scope may need to grow — or your function may need to split.
