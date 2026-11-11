# Step 4 — Generation

Runs the AI agent per component to produce typed CDF entries — property types, categories, slot definitions, and descriptions.

This describes the `generateCdfComponents` endpoint and its service. The import does not call it: the TUI runs `runGenerateComponentsSession` (`src/orchestrators/run-generate-components-session/`), which has its own per-component run, cache and worker pool. The step also holds token generation and mapping (`controller/map-tokens/`, `helpers/token-defaults/`), which this file does not cover.

## What it does

For each accepted component, concurrently (up to `concurrency`, default 3):

1. Builds a per-component prompt (`skill: 'components'`, `mode: 'autonomous'`) with the raw definition inlined.
2. Hashes input and prompt; checks the cache.
3. On miss, invokes the agent via `createLocalCliAgentInvoker` and parses tool calls — `classify_component`, `classify_prop`, `classify_slot`.
4. Assembles a `CDFComponentEntry` from the tool calls, dropping any prop or slot name the agent invented that the component doesn't actually declare.
5. Stores the resulting entry in the cache.

Timeouts and non-zero exit codes become per-component `CdfGenerationFailure` entries; the rest of the batch continues.

## Input

`GenerateCdfComponentsRequest`

| Field                                 | Type                                                       | Notes                                   |
|---------------------------------------|------------------------------------------------------------|-----------------------------------------|
| `components`                          | `RawComponentDefinition[]`                                 | Only accepted components from Step 3    |
| `tokens`                              | `DTCGTokenEntry[]?`                                        | Accepted by the type; the service does not read it |
| `agent`                               | `AgentName?`                                               | Defaults to `claude`                    |
| `model`                               | `string?`                                                  | Per-agent model override                |
| `concurrency`                         | `number?`                                                  | Default 3                               |
| `skillPathOverride` / `skillContentOverride` | `string?`                                           | Override the built-in `components` skill prompt |
| `onProgress` / `onWarning`            | callbacks                                                  | Progress fires per component            |
| `onCacheLookup` / `onCacheStore`      | callbacks                                                  | See **Cache** below                     |

## Output

`GenerateCdfComponentsResponse` — `{ components: CDFComponentEntry[], warnings: string[], failures: CdfGenerationFailure[] }`.

## Cache

- **Key:** `(inputHash, promptHash)`: SHA-256 of `JSON.stringify(component)` and SHA-256 of the built prompt
- **Value:** the `CDFComponentEntry`, JSON-serialized
- **Lookup:** per component, before agent invocation
- **Store:** per component, after a successful agent run and tool-call parsing


## External calls

AI agent via `createLocalCliAgentInvoker` from this package's `src/agents/`. Timeout: 120 s per component. No HTTP calls.

## DSI contribution

Produces the component half of the CDF document that Step 5 ships to Contentful. Per-component failures (agent errors, timeouts and non-zero exits) flow back as `CdfGenerationFailure[]`. Nothing in the CLI or the analytics layer reads them today.
