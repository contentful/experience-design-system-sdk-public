# Source extraction


### Compiler read evidence

Configured TypeScript and Vue analysis uses a read-only compiler filesystem with per-run read, byte, probe and directory-entry budgets. `extractionDiagnostics.reads` records exact UTF-8 hashes delivered to the compiler, configuration reads and Vue source snapshots; budget/read/cancellation failures remain explicit unavailable outcomes. Configured module/resolution/strict options are preserved, analysis forces `noEmit`, and only caller-supplied component files are eligible for output.

Saved diagnostics bind observed hashes to the immutable source capture. Matching hashes are verified, changed bytes remain changed, and compiler support files absent from the capture remain unavailable; later disk edits do not replace saved evidence. Vue virtual script receipts describe transformed compiler input separately from original SFC bytes.

Native type graphs record raw property enumeration and admitted wrapper counts. An object exceeding the remaining field/node budget keeps its type/declaration facts and records omitted fields before creating property wrappers. The TypeScript checker's internal synchronous resolution is not preemptible, so these traversal/read limits do not establish a global CPU or semantic-completeness bound.

### Vue declaration evidence

Vue runtime assertions and typed properties retain source type spelling alongside compiler-resolved literal kinds and alternatives; aliases and enums can describe closed domains, while broad, mixed, nested and unknown alternatives retain open or unknown coverage. Constructor aliases use source declarations, and unrelated or shadowed generic assertions do not establish finite choices.

The shared Vue reader resolves declaration-backed constants, member references and straight-line zero-argument returned objects without executing source. Actual Vue import bindings, aliases and returned component constructors reach the TSX/JSX producer; unsupported parameter/control-flow evaluation and legacy unbound helper projections remain explicitly uncertain. Repeated uses retain separate occurrences, while active cycles terminate.

Saved contract, template, access and dynamic slot observations retain their source locations, conditions and fallback text through existing reasoning and review consumers. These observations do not decide final component inclusion, finite slot allowlists or target value domains; accepted downstream decisions own those projections.
