# CDF validity includes importability

## Status

Accepted requirement, 2026-11-03; shared physical validation and generation
feedback are implemented locally. Integration-service adoption and matched
storage verification accompany the shared package change.

## Contract

A valid CDF document must have an importable definition for every emitted
Component and property. A successful CDF validation result must not be followed
by an importer rejection caused by an unsupported representation, physical type,
property shape or slot constraint. Rendering readiness is a separate obligation.

Structural parsing is one part of validation. It does not establish complete CDF
validity by itself. Raw source types, compiler graphs and retained source/default
intent remain evidence; physical import constraints must not prune that evidence.

## Enforcement

Complete `validateCDF()` and both CDF builders enforce physical import rules,
source-plan ownership and dependency closure. Component admission and generation
feedback reuse the same rules. Structural property/component schemas remain
available for retaining source evidence; their success alone is not complete
document validation.

- Native content supports flat Records and root Arrays, including
  `Array<Record<...>>`; deeper Records/Arrays and Record union branches require
  source-derived model representations.
- Model derivation checks each proposed native field against the physical rules
  and creates model relationships for inadmissible regions, including unions
  nested inside otherwise native Records.
- Native defaults or intrinsic values containing own `__proto__` object keys
  require an alternative that retains their intent without emitting unsafe
  native object values; field identities remain available.
- Slot cardinality, display names, token kinds/references and in-document token
  kinds are checked before export; ordinary composition cycles remain invalid
  while complete source-owned recursive model families remain admissible.
- Generation retains rejected semantics and source identities, returns physical
  diagnostics, and permits repair through supplied model candidates; native
  structural skeletons include import diagnostics instead of implying readiness.

Approved finite-choice mapping loss remains observable. Reconstruction and
rendering requirements remain explicit and deferred; importing definitions does
not establish rendering readiness. Resource prerequisites still resolve against
the target environment during import.

## Verification

Regression controls reproduce physical false-success cases before repair and
cover admissible native definitions, rejected native nesting/unions/defaults,
slot constraints, token kinds and source-derived model alternatives. Connected
tests exercise compiler extraction, generation validation, saved-source
integrity, selected export, client admission and CLI review/save boundaries.

The implementation is generic over compiler source graphs and physical
capabilities; it does not use framework or property-name modeling heuristics.

## End-to-end acceptance

1. Consolidate physical representation and mapping constraints into shared
   validation used by the exporter, review/save flow and importer.
2. Offer source-derived model representations wherever native definitions cannot
   express the complete value; reject unsupported physical choices during
   generation validation with actionable alternative feedback.
3. Apply complete validation to emitted properties, slots and model families,
   without applying physical restrictions to retained source evidence.
4. Verify the actual client-to-service-to-storage path with matched inputs,
   including create, update, repeated import and dependency failure.

Acceptance includes positive native/model controls and negative native-shape,
constraint, ownership and incomplete-family controls. Approved explicit mapping
loss remains observable; validation must not introduce additional silent loss.

## Previous framing, superseded 2026-11-03

The earlier discussion treated a structurally valid CDF and an importable CDF as
separate successful outcomes. That framing is superseded: structural acceptance
alone must not be reported as complete CDF validity. Source analysis remains
broader than the export contract.
