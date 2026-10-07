# Step 3 — Selection

Runs the AI agent to decide which extracted components belong in the final CDF.

## What it does

1. Builds a selection prompt (`skill: 'select'`, `mode: 'autonomous'`) with the full component list inlined.
2. Invokes the agent via `createLocalCliAgentInvoker` and parses `accept_component` / `reject_component` tool calls.
3. Returns one `ComponentSelection` per decision — accepted entries pass through to generation; rejected entries carry a reason string.

Empty input short-circuits with no agent call.

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

| Field       | Value                                                                                               |
|-------------|-----------------------------------------------------------------------------------------------------|
| **Key**     | `(componentHash, promptHash)` — SHA-256 of the component JSON + SHA-256 of the built prompt         |
| **Value**   | `{ decision, reason }` — one row per component                                                      |
| **Lookup**  | Per component, before agent invocation                                                              |
| **Store**   | Per component, after successful agent invocation                                                    |

## External calls

AI agent via `createLocalCliAgentInvoker` from `@contentful/experience-design-system-generation`. Timeout: `EDS_AGENT_TIMEOUT_MS` env or 5 min. No HTTP calls.

## DSI contribution

Narrows the component set before generation runs — expensive agent calls in Step 4 only fire for accepted components. The CLI records accepted-vs-rejected counts and reasons on command context; these appear on `dsi_cli_command_completed` and inform downstream analysis of which component shapes the agent commonly discards.
