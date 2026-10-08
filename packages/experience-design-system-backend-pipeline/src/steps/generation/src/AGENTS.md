# Step 4 — Generation

Runs the AI agent per component to produce typed CDF entries — property types, categories, slot definitions, and descriptions.

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
| `tokens`                              | `DTCGTokenEntry[]?`                                        | Available tokens for `$token.kind` resolution |
| `agent`                               | `AgentName?`                                               | Defaults to `claude`                    |
| `model`                               | `string?`                                                  | Per-agent model override                |
| `concurrency`                         | `number?`                                                  | Default 3                               |
| `skillPathOverride` / `skillContentOverride` | `string?`                                           | Override the built-in `components` skill prompt |
| `onProgress` / `onWarning`            | callbacks                                                  | Progress fires per component            |
| `onCacheLookup` / `onCacheStore`      | callbacks                                                  | See **Cache** below                     |

## Output

`GenerateCdfComponentsResponse` — `{ components: CDFComponentEntry[], warnings: string[], failures: CdfGenerationFailure[] }`.

## Cache

| Field       | Value                                                                                               |
|-------------|-----------------------------------------------------------------------------------------------------|
| **Key**     | `(inputHash, promptHash)` — SHA-256 of `JSON.stringify(component)` + SHA-256 of the built prompt    |
| **Value**   | `CDFComponentEntry` (JSON-serialized)                                                               |
| **Lookup**  | Per component, before agent invocation                                                              |
| **Store**   | Per component, after successful agent invocation and tool-call parsing                              |

## External calls

AI agent via `createLocalCliAgentInvoker` from `@contentful/experience-design-system-generation`. Timeout: 120 s per component. No HTTP calls.

## DSI contribution

Produces the component half of the CDF document that Step 5 ships to Contentful. Per-component failures (timeouts, exit codes, unparseable tool calls) flow back as `CdfGenerationFailure[]` — the CLI counts these on command context and the terminal `dsi_cli_command_completed` event, which is how we track agent reliability per release.
