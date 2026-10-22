# Step 2 — Composition

Resolves parent-child relationships between extracted components and wires children into each parent's slots.

## What it does

1. Filters the full file set to composition candidates (by name pattern and content markers), retaining complete selected files.
2. Collects deterministic edges from manifests and AGENTS.md files colocated with components (ranked above agent output).
3. If any parent still has unresolved children, invokes the AI agent with the complete selected candidate files and parses `map_edge` tool calls.
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

## Source call-site observations

`collectSourceCallSiteEvidence(files, components)` is an opt-in helper over supplied source files. It resolves JSX targets through compiler symbols, matches the extracted declarations, and attributes each reference to its enclosing component declaration. References inside nested functions and callbacks remain visible and are labeled `lexical-reference`; they do not prove execution or constrain a slot allowlist.

`resolveMapping` accepts optional `sourceCallSiteEvidence` and `sourceCallSiteRejections`, retains copies in its result, and appends accepted observations as untrusted data to default or custom prompts. Observations alone never create deterministic edges. Both production composition services collect from the full supplied runtime file set and return both arrays. The extraction/session orchestrator saves them as JSON strings in completed-step outputs (`compositionEvidence` and `compositionRejections`), including explicit empty arrays. This result save is separate from cache storage. Selection can start before composition completes and does not consume these arrays yet. The collector does not read dependency files or project configuration, so unresolved imports and unsupported source declarations remain limitations rather than inferred relationships.

## Cache

| Field       | Value                                                                                               |
|-------------|-----------------------------------------------------------------------------------------------------|
| **Key**     | SHA-256 of (sorted `path+content` hashes of selected candidate files) + agent name                    |
| **Value**   | Raw agent stdout (JSONL of `map_edge` tool calls)                                                   |
| **Lookup**  | Before invoking the agent; skipped when `forceAgent` is true                                        |
| **Store**   | After a successful agent run (`exitCode === 0`)                                                     |

## External calls

AI agent via the backend's shared `runAgent`. Timeout: 120 s. Composition explicitly sends its prompt over stdin. Other shared-agent callers default to stdin for Claude and Codex and retain argv delivery for other agents without an application prompt-size cap. No HTTP calls.

## DSI contribution

Enables accurate downstream generation: without composed slots the generated CDF would list every component as a terminal node. Edge-rank conflicts (`winner` vs `loser` provenance) surface as warnings the CLI attaches to the active command context — visible on `dsi_cli_command_completed` as composition warning count.
