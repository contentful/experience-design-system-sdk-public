# Step 1 — Extraction

Parses source files and returns a structured inventory of UI components. First step in the pipeline; everything downstream depends on its output.

## What it does

Walks a set of source file paths, routes each one to the correct framework extractor (React, Vue, Svelte, Astro, Stencil, Angular, web components), and emits a `RawComponentDefinition` per component — name, framework, file path, props, slots, and extractor warnings.

## Input

`ExtractComponentsRequest`

| Field          | Type                                   | Notes                                  |
|----------------|----------------------------------------|----------------------------------------|
| `filePaths`    | `string[]`                             | Non-empty absolute or project-relative |
| `projectRoot`  | `string?`                              | Resolves relative paths                |
| `opts`         | `ExtractorOptions?`                    | Framework and parser overrides         |
| `onProgress`   | `(progress) => void`                   | Fires per processed file (Angular, Astro, Svelte and Vue extractors) |

## Output

`ComponentExtractionResult` — `{ components: RawComponentDefinition[], warnings: string[] }`.

## Cache

**None.** Extraction is a pure, deterministic function over file content. Fast enough that caching would cost more than it saves.

## External calls

None. Pure AST parsing via `ts-morph` and framework-specific parsers under `framework-adapters/`.

## DSI contribution

Produces the component inventory every subsequent step consumes. This step emits no analytics fields itself. The extract-and-compose session (`src/orchestrators/run-extract-and-compose-session/`) records `extracted_component_count` after composition, and returns the extraction warnings to its caller without recording them.
