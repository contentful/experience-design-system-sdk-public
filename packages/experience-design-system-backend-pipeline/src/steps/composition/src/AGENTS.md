# Step 2 — Composition

Resolves parent-child relationships between extracted components and wires children into each parent's slots.

## What it does

1. Retains the complete supplied or captured source file set for deterministic evidence collection.
2. Collects typed-slot and structural edges from extracted components, plus explicit manifest and documentation edges.
3. Collects compiler-resolved source call-site observations, rejections and caller coverage independently of edges.
4. Merges deterministic edges and applies them to the component list, synthesizing slots when a high-trust edge targets a missing slot name.
5. Saves source observations with the completed extraction snapshot so component exploration can interpret them directly.

Composition never invokes an AI agent, builds an agent prompt, or reads or writes composition-agent cache entries. Unresolved composition stays explicit for downstream exploration.

## Input

`ComposeComponentsRequest`

| Field                                 | Type                                      | Notes                                 |
|---------------------------------------|-------------------------------------------|---------------------------------------|
| `components`                          | `RawComponentDefinition[]`                | From Step 1                           |
| `allFiles`                            | `Array<{ path, content }>`                | Full project file set                 |
| `onProgress` / `onWarning`            | callbacks                                 | Phase strings and human-readable text |

Legacy `agent`, `forceAgent`, `promptOverride`, `onCacheLookup` and `onCacheStore` inputs remain accepted as deprecated, ignored options; none can enable agent execution or cached agent output.

## Output

`ComposeComponentsResponse` includes `components`, `warnings`, `sourceCallSiteEvidence`, `sourceCallSiteRejections` and optional `sourceCallSiteCoverage`. Returned components carry deterministic `slots[].allowedComponents`.

## Source call-site observations

`collectSourceCallSiteEvidence(files, components)` projects the shared compiler reference index captured during extraction. Both production composition paths use it without building another compiler project. Supplied bytes must match indexed source hashes; unavailable indexes retain unknown caller coverage. References inside nested functions and callbacks remain visible and are labeled `lexical-reference`; they do not prove execution or constrain a slot allowlist. The module's standalone collector is an explicit diagnostic utility and is not used by the pipeline.

`resolveMapping` retains copies of source observations and rejections, plus caller coverage, separately from deterministic edges. Observations alone never create deterministic edges. Both production composition services project indexed observations against the full supplied runtime file set and return both arrays. The extraction/session orchestrator atomically saves final components, the source envelope and observations before marking extraction complete. Exploration loads these saved observations and coverage as untrusted source evidence. Compiler configuration and dependencies come from the shared index; missing or unmatched evidence remains explicit rather than being rediscovered under fallback settings.

## External calls

None. Import runs deterministic source analysis in a cancellable worker; the public composition service projects supplied indexed evidence in-process. Neither path starts an agent subprocess. The observation-count summary also reports partial caller coverage; unknown coverage never establishes the absence of callers.

## DSI contribution

Enables accurate downstream generation: without composed slots the generated CDF would list every component as a terminal node. Edge-rank conflicts (`winner` vs `loser` provenance) surface as warnings the CLI attaches to the active command context — visible on `dsi_cli_command_completed` as composition warning count.
