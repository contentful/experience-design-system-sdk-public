# Extraction uses an in-process endpoint

## Status

Accepted

## Date

2026-10-01

## Context

The import wizard previously started a hidden CLI command to extract source
files. The child process communicated progress and the resulting session ID
through text on stdout and stderr. That protocol coupled the wizard to a CLI
binary, made the extraction contract implicit, and required callers to parse
output before they could continue.

Extraction is a library capability, not a web resource. The package needs a
stable interface that can be called by the wizard, tests, and future local
orchestration without introducing an HTTP server or a second transport.

## Decision

The extraction package exposes an in-process `extractEndpoint` contract from
its public entry point.

```ts
interface ExtractionEndpointRequest extends ExtractorOptions {
  readonly filePaths: readonly string[];
  onProgress?: (progress: ExtractionEndpointProgress) => void;
}

interface ExtractionEndpointResponse {
  components: RawComponentDefinition[];
  warnings: string[];
}
```

The endpoint owns the extraction engine, pre-classification, source
inspection, non-authorable signals, scoring, and validation. It validates its
request and returns structured components, warnings, and typed progress. It
does not scan directories, invoke composition agents, write the session
database, or communicate over a network.

The CLI exposes `import/extract-project.ts` and its `extractProject` function as
its orchestration boundary. It resolves
the project and source directory, scans files, calls the extraction-package
endpoint, resolves composition evidence, persists the result in the existing
SQLite session, and returns the session contract needed by the wizard. The
wizard calls this function directly. The CLI module is an orchestration
adapter; it does not define or re-export the extraction contract.

The SQLite step label `analyze extract` remains unchanged for session
compatibility and downstream session resolution. It names persisted pipeline
state; it is not a subprocess or public extraction transport.

## Previous design

The hidden command provided process isolation and a convenient CLI entry point,
but its text protocol was not a typed API. Its progress framing, session
identifier, and error behavior were implementation details that callers had to
reconstruct from output. The command is removed from the production path; the
endpoint preserves the extraction behavior while making the boundary explicit.

## Consequences

- The wizard no longer spawns a subprocess or parses extraction output.
- Extraction can be tested through a package-level contract without a CLI
  binary or a session database.
- Filesystem scanning, composition resolution, analytics, and persistence stay
  in the CLI orchestration layer rather than leaking into the extraction
  package.
- Progress and failures are structured at the in-process boundary; downstream
  generation, review, and apply contracts remain unchanged.
- Consumers that need process isolation must add an adapter around this typed
  contract rather than relying on undocumented output parsing.
