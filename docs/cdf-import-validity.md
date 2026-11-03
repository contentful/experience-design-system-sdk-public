# CDF validity includes importability

## Status

Accepted requirement, 2026-11-03; shared validation alignment is not yet implemented.

## Contract

A valid CDF document must have an importable definition for every emitted
Component and property. A successful CDF validation result must not be followed
by an importer rejection caused by an unsupported representation, physical type,
property shape or slot constraint. Rendering readiness is a separate obligation.

Structural parsing is one part of validation. It does not establish complete CDF
validity by itself. Raw source types, compiler graphs and retained source/default
intent remain evidence; physical import constraints must not prune that evidence.

## Implementation plan

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

The parity discussion treated a structurally valid CDF and an importable CDF as
separate successful outcomes. That framing is superseded: structural acceptance
alone must not be reported as complete CDF validity. Source analysis remains
broader than the export contract.
