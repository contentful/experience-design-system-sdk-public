# Step 3 — Selection

Runs the AI agent to decide which extracted components belong in the final CDF.

## What it does

1. Builds a selection prompt (`skill: 'select'`, `mode: 'autonomous'`) with the full component list inlined.
2. Invokes the agent via `createLocalCliAgentInvoker` and parses `select_component` / `reject_component` tool calls.
3. Returns one `ComponentSelection` per decision — accepted entries pass through to generation; rejected entries carry a reason string.

Empty input short-circuits with no agent call. A timeout or a non-zero exit throws.

## Input

`SelectComponentsEndpointRequest`

| Field                                 | Type                             | Notes                                                   |
|---------------------------------------|----------------------------------|---------------------------------------------------------|
| `components`                          | `RawComponentDefinition[]`       | From Step 2 (or Step 1 when composition is skipped)     |
| `agent`                               | `AgentName?`                     | Defaults to `claude`                                    |
| `model`                               | `string?`                        | Per-agent model override                                |
| `promptText` / `promptPath`           | `string?`                        | Override the built-in `select` skill prompt             |
| `onCacheLookup` / `onCacheStore`      | callbacks                        | See **Cache** below                                     |
| `onWarning`                           | callback                         | Human-readable warnings                                 |

## Output

`SelectComponentsEndpointResponse` — `{ selections: ComponentSelection[], warnings: string[] }`. Each selection: `{ name, component_id, decision: 'accepted'|'rejected', reason: string|null }`.

## Cache

This step's service accepts `onCacheLookup` and `onCacheStore` but never calls them. The import does not use `selectComponents`: it runs its own selection in `packages/experience-design-system-cli/src/tui/import/steps/06-extraction/selection.ts`, which does the caching described here.

| Field       | Value                                                                                               |
|-------------|-----------------------------------------------------------------------------------------------------|
| **Key**     | `(componentHash, promptHash, cliVersion)` — the component hash, a hash of the prompt text plus agent and model, and the CLI version |
| **Value**   | `{ decision, reason }` — one row per component, in `selection_cache`                                |
| **Lookup**  | Per component, before agent invocation; `noCache` asks again for everything                        |
| **Store**   | New decisions, in one transaction with the accept and reject writes to `raw_components`             |

## External calls

AI agent via `createLocalCliAgentInvoker` from this package's `src/agents/`. Timeout: `EDS_AGENT_TIMEOUT_MS` env or 5 min. No HTTP calls.

## DSI contribution

Narrows the component set before generation runs — expensive agent calls in Step 4 only fire for accepted components. Selection results are not recorded in analytics today: the completion event has an `accepted_component_count` field, but nothing sets it. Only the extracted component count is recorded.
