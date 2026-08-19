# ADR 0001: Ship DesignToken/ComponentType `source` field with Link, migrate to ResourceLink later

## Status

Accepted

## Date

2026-05-07

## Original ADR number

Curated into this repo as ADR-0001 (original numbering, planning workspace: ADR-0001).

## Context

An optional `source: Link<'DesignSystemSource'>` field was added to the DesignToken and ComponentType entities. Review feedback flagged that new reference fields should use ResourceLink per an accepted platform-wide architectural decision on unifying same-space, cross-space, and external references.

That platform-wide decision states that all entity references in this system should switch from Link to ResourceLink before reaching general availability (Phase 1). This is an accepted architectural decision with cross-team agreement, not an aspirational one.

However, the following blockers prevent using ResourceLink today:

1. **The underlying entity storage layer has no ResourceLink support.** The reference interface it exposes uses `{ path: string; linkType: string }` — Link semantics only. There is no `urn`, no CRN handling, no `$self` resolution. A schema change to that storage layer would be required.
2. **No published timeline for ResourceLink support in that storage layer.** It is owned by a separate team; their roadmap has no ResourceLink item and the platform-wide decision has no due date or action items yet.
3. **No CRN namespace registered for DesignSystemSource.** The platform-wide decision defines CRN paths for `componentTypes` and `designTokens`, but DesignSystemSource is not mentioned. Its CRN would presumably be `crn:contentful:::experience:spaces/$self/environments/$self/designSystemSources/{id}`, but this is unconfirmed.
4. **The `source` field is an internal entity-to-entity reference, not a user-facing content field.** The platform-wide decision's primary motivation is unifying content references for cross-space support. DesignSystemSource is same-space-only by design and is an internal system entity, not something editors link to in content fields.

## Decision

**Ship the field with `Link<'DesignSystemSource'>` format.** Document the migration obligation and revisit when the underlying storage layer adds ResourceLink support.

### Rationale

1. **ResourceLink cannot be used today.** The storage layer doesn't support it, and there is no timeline for that to change.
2. **No customer impact from a future migration.** This system has no external customers yet, so migrating from Link to ResourceLink internally has no customer impact. If the migration happens before general availability, the cost is purely internal.
3. **The platform-wide decision itself acknowledges this is the path.** Phase 1 says "switch from Link to ResourceLink before reaching customers" — implying teams ship with Link now and migrate when the infrastructure is ready.
4. **Blocking delivery on this provides no value.** The feature this field supports has no dependency benefit from waiting on an infrastructure change with no timeline.

## Migration Cost Estimate (when ResourceLink support lands)

| Layer | Change | Effort |
|-------|--------|--------|
| Entity storage layer | New reference type (`ResourceLink`) with CRN parsing, `$self` resolution, and `urn`-based storage | Owned by a separate team — not this repo's work |
| Schema layer | Replace `Link<'DesignSystemSource'>` with `ResourceLink<'Contentful:DesignSystemSource'>` schema | S (type change + tests) |
| Downstream services | Update DesignToken/ComponentType repository layers to emit/consume ResourceLink format | S-M (2-3 services) |
| Entity storage config | Update reference config from `{ path: 'source', linkType: 'DesignSystemSource' }` to ResourceLink equivalent | S (config change) |
| Backfill | Transform all persisted `source` Links to ResourceLink CRNs | S (straightforward ID→CRN transform, same-space only) |
| Import/sync logic | Update source reference resolution logic | S (one resolver path) |
| **Total effort** | | **M (1-2 sprints)** |

The backfill is simple because:
- Same-space only (no cross-space CRNs needed)
- Same-environment only (no environment pinning complexity)
- Transform: `{ sys: { type: 'Link', linkType: 'DesignSystemSource', id: X } }` → `{ sys: { type: 'ResourceLink', linkType: 'Contentful:DesignSystemSource', urn: 'crn:contentful:::experience:spaces/$self/environments/$self/designSystemSources/X' } }`
- No customer-facing API contract to maintain during migration (pre-GA)

## Follow-up Actions

1. **Document the migration obligation** on the field and in onboarding material so the Link format is understood as interim.
2. **Track the migration as tech debt** — when the storage layer ships ResourceLink support, the backlog should include migrating `source` references.

## Consequences

### Positive
- Unblocks feature delivery that depends on this field
- No customer-facing risk (pre-GA, internal only)
- Well-understood migration path with bounded cost

### Negative
- Creates a known tech debt item (Link→ResourceLink migration)
- If ResourceLink support ships soon, entities in the old format will need backfilling

### Neutral
- Consistent with how other entities in this system already use `Link<'ComponentType'>` today
- The platform-wide decision's Phase 1 will batch-migrate all references at once; `source` will be one of many
