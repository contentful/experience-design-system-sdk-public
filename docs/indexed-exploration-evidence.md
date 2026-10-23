# Indexed exploration evidence

## Purpose

Exploration starts with a task index instead of a serialized project-sized compiler context. Full supplied evidence remains in a private immutable store for targeted reads. This reduces initial prompt size without treating unexpanded records as missing source or changing the canonical output contract.

## Evidence and task boundaries

- Component selection receives exact assigned identities, source definition locations, input counts and source coverage; detailed compiler facts remain readable.
- Candidate-free passes receive captured source and identity metadata without the intentionally withheld compiler candidate and observation hints.
- Detailed inventories page original source inputs and inspect their exact types, requiredness, defaults, constraints, graph roots, nullability and gaps.
- Reconciliation and verification inspect assigned claims and their exact source owners and citations before expanding dependencies.
- Generated-model exploration uses the same reader for its logical graph, source model, mappings and prior owner judgments.
- Representation alternatives are derived for a single requested input using the canonical source-property and candidate helpers, rather than preparing all alternatives during component selection.

The reader does not discover or execute project files. Source paths remain citation labels. Graph cycles retain their original logical node references; storage references only encode JSON records.

## Encoding and reader

A worker writes content-addressed object, array and long-text records into a packed file and records byte offsets in a manifest. Identical records share storage while their original owner paths remain distinct. The reader verifies each requested record hash and reconstructs original values without reparsing the entire evidence document. JSON Pointers resolve within the original task input; returned record IDs also support direct lookup.

The supplied command accepts:

| Operation | Result |
| --- | --- |
| `read POINTER DEPTH` | Structure with explicit references for unread records. |
| `list POINTER OFFSET LIMIT` | Entries with total count and `nextOffset`; no silent truncation. |
| `exact POINTER` | Complete original value with storage references resolved. |
| `inputs COMPONENT_POINTER OFFSET LIMIT` | Source input summaries and references to exact facts and graph nodes. |
| `source FILE_POINTER START_LINE END_LINE` | Original covered source text and explicit gaps in the requested range. |
| `candidates COMPONENT_POINTER SOURCE_INPUT_NAME` | Canonical representation alternatives for one exact input. |

Page sizes and text chunks are navigation choices, not evidence limits. Complete records remain accessible. Nullability, optionality, defaults and source constraints are not inferred from summaries or missing pages.

## Lifecycle and admission

Indexing, serialization and source fact projections execute within the cancellable source-analysis worker boundary. A component exploration phase prepares one candidate-aware view and one candidate-free view lazily, reusing each across applicable passes. Other work units prepare an immutable view that survives their repair attempts. After invocations settle, disposal removes evidence, task context and validator artifacts on success, failure or cancellation.

The logical-input fingerprint retains complete evidence, diagnostics, source bytes, coverage and reference content; temporary artifact paths do not define identity. Existing source identity/timing normalization remains separate from source binding. The response-cache revision changes because task delivery and inclusion guidance changed.

Agents run the canonical draft validator within their conversation. Repair turns retain reader and validator access and receive focused diagnostics. Host parsing and source admission remain mandatory. `included` is strictly Boolean: source uncertainty belongs in modeling notes, with provisional inclusion for human scope review where supplied evidence does not justify exclusion. This provisional ruling does not claim complete source evidence or rendering readiness.

## Capturing definitions first

Capture admits assigned definitions before other selected roots, then resolves configurations and imports. Resolver-probe exhaustion can leave dependency coverage partial but cannot prevent already admitted definitions from being saved. File, byte, read and time limits remain enforced; any remaining missing definition or dependency is an explicit gap. Older snapshots with missing definitions require fresh extraction to acquire those bytes.

## Verification scope

Package builds, typechecks and lint establish static integration. Saved-corpus prompt measurements do not establish agent reasoning quality or successful provider completion; those require a separate interactive import run.
