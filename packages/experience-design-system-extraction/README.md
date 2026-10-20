# Source extraction


### Compiler read evidence

Configured TypeScript and Vue analysis uses a read-only compiler filesystem with per-run read, byte, probe and directory-entry budgets. `extractionDiagnostics.reads` records exact UTF-8 hashes delivered to the compiler, configuration reads and Vue source snapshots; budget/read/cancellation failures remain explicit unavailable outcomes. Configured module/resolution/strict options are preserved, analysis forces `noEmit`, and only caller-supplied component files are eligible for output.

Saved diagnostics bind observed hashes to the immutable source capture. Matching hashes are verified, changed bytes remain changed, and compiler support files absent from the capture remain unavailable; later disk edits do not replace saved evidence. Vue virtual script receipts describe transformed compiler input separately from original SFC bytes.

Native type graphs record raw property enumeration and admitted wrapper counts. An object exceeding the remaining field/node budget keeps its type/declaration facts and records omitted fields before creating property wrappers. The TypeScript checker's internal synchronous resolution is not preemptible, so these traversal/read limits do not establish a global CPU or semantic-completeness bound.
