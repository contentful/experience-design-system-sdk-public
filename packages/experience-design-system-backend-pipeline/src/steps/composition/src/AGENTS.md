# Step 2 — Composition

Resolves parent-child relationships between extracted components and wires children into each parent's slots.

## What it does

1. Filters the full file set to composition candidates (by name pattern and content markers), caps the result to the prompt token budget.
2. Collects deterministic edges from manifests and AGENTS.md files colocated with components (ranked above agent output).
3. If any parent still has unresolved children, invokes the AI agent with the capped candidate files and parses `map_edge` tool calls.
4. Merges agent edges with deterministic edges (manifest and typed-slot evidence wins on conflict).
5. Applies merged edges to the component list, synthesizing slots when a high-trust edge targets a missing slot name.

## Input

`ComposeComponentsRequest`

| Field                                 | Type                                      | Notes                                 |
|---------------------------------------|-------------------------------------------|---------------------------------------|
| `components`                          | `RawComponentDefinition[]`                | From Step 1                           |
| `allFiles`                            | `Array<{ path, content }>`                | Full project file set                 |
| `agent`                               | `AgentName?`                              | Defaults to `claude`                  |
| `forceAgent`                          | `boolean?`                                | Skips cache lookup                    |
| `promptOverride`                      | `string?`                                 | Replaces the default agent prompt     |
| `onProgress` / `onWarning`            | callbacks                                 | Phase strings and human-readable text |
| `onCacheLookup` / `onCacheStore`      | callbacks                                 | See **Cache** below                   |

## Output

`ComposeComponentsResponse` — `{ components: RawComponentDefinition[], warnings: string[] }`. Returned components carry populated `slots[].allowedComponents`.

## Cache

| Field       | Value                                                                                               |
|-------------|-----------------------------------------------------------------------------------------------------|
| **Key**     | SHA-256 of (sorted `path+content` hashes of capped candidate files) + agent name                    |
| **Value**   | Raw agent stdout (JSONL of `map_edge` tool calls)                                                   |
| **Lookup**  | Before invoking the agent; skipped when `forceAgent` is true                                        |
| **Store**   | After a successful agent run (`exitCode === 0`)                                                     |

## External calls

AI agent via `runAgent` from `@contentful/experience-design-system-generation`. Timeout: 120 s. Prompt is sent over stdin. No HTTP calls.

## DSI contribution

Enables accurate downstream generation: without composed slots the generated CDF would list every component as a terminal node. Edge-rank conflicts (`winner` vs `loser` provenance) surface as warnings the CLI attaches to the active command context — visible on `dsi_cli_command_completed` as composition warning count.
