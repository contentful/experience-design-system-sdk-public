# Generation model, controller, service, and adapter boundary

## Status

Accepted

## Context

The generation package originally concentrated prompt construction, agent configuration, subprocess execution, protocol parsing, progress formatting, and public exports in a small set of root files. That shape made the package difficult to reuse without also importing local-process behavior and made it unclear which responsibilities belonged to the CLI.

The import workflow needs an in-process generation contract, but it must continue to use local coding-agent processes and preserve the existing output protocols, prompt behavior, and published root exports.

## Decision

The generation package is organized into four explicit layers:

- `model` contains transport-neutral contracts and protocol types.
- `controller` coordinates one generation attempt for one of the supported stages.
- `services` owns prompt assembly, skill loading, stage policies, protocol parsing, configuration, authentication, diagnostics, and progress serialization.
- `adapters/local` implements the `AgentInvoker` port with a local subprocess.

`createGenerateEndpoint()` is the package boundary for generation. The stage is derived from the prompt's skill rather than supplied separately, so the request cannot contradict itself and the response carries calls typed for that stage. `execute()` builds the prompt, invokes an adapter once, parses the stage output, and returns typed calls, warnings, run metadata, and a curated failure when the run did not succeed. `preview()` returns the prompt without invoking an agent. An unsupported stage raises `GenerateRequestError`.

The CLI remains responsible for workflow policy: session resolution, cache reads and writes, concurrency, retries, SQLite persistence, parsed-call application, progress presentation, and terminal error handling. The endpoint represents one attempt and does not own those policies.

The package barrel (`src/index.ts`) is the only public entry point and points directly at canonical implementations; the former root modules (`agent-runner.ts`, `prompt-builder.ts`, and similar) were removed because `package.json` publishes no subpath exports. The legacy sentinel parser remains exported for compatibility but is not part of the active generation protocol.

## Consequences

Positive consequences:

- Callers can use generation through a typed in-process API without a hidden command or HTTP server.
- Local process execution can be replaced or tested through the `AgentInvoker` port.
- Prompt and protocol behavior are independently testable without the CLI or a real agent binary.
- Retry, cache, persistence, and terminal concerns remain visible at the workflow boundary.

Tradeoffs:

- Consumers that deep-imported the former root modules must switch to the package root.
- The endpoint intentionally handles one attempt, so callers must implement broader workflow policies.
- The package still ships Markdown skill assets and must preserve their runtime discovery and packaging behavior.

## Invariants

- Supported stages are `components`, `tokens`, `select`, and `map-tokens`.
- Raw component and token context is delivered inline in prompts; generation does not create an intermediary JSON handoff.
- No agent SDK, HTTP server, database, or CLI persistence is introduced into the generation package.
- Meaningful parser warnings and structured run metadata cross the endpoint boundary unchanged.
- The endpoint is the single authority for parsing agent output and deciding whether a run failed; callers do not re-parse `run.stdout` or re-derive the failure.
- A run with zero parsed calls is a failure for every stage except `map-tokens`, where an empty result is valid.
