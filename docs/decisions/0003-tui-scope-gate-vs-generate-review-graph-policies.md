# ADR 0003: DSI TUI — ScopeGate and GenerateReview graph policies

## Status

Accepted — implemented via a graph consolidation plan (milestones M1-M5).

Revised 2026-07-15: added the `compositionMode` axis (`composite | atomic`, default `atomic`). The matrix below describes `composite`; atomic degenerates every graph-derived rule to its trivial value (see "The `compositionMode` axis"). This is a provenance-noted revision, not a new competing decision.

Revised 2026-08-11: the resolution precedence has since grown a step. An explicit `--atomic` flag was added for symmetry with `--composite`, and passing any composition-source option (`--composition-map`, `--composition-agent`, `--composition-refresh`, `--generate-map`) now implies composite without a separate `--composite` flag. Current precedence is `explicit flag > implied composition-source option > env > persisted config > default`, with `--atomic` winning over an implied source if both are present. See `lib/composition-mode.ts`. This does not change the composite/atomic behavior matrix below — only how the mode is selected.

## Date

2026-07-10 (revised 2026-07-15)

## Parent epic

None — internal DSI CLI architecture.

## Original ADR number

Curated into this repo as ADR-0003 (original numbering, planning workspace: ADR-0010).

## Context

Import runs under one of two composition modes, resolved once at command preamble (see "Revised 2026-08-11" above for the current precedence order; default remains **`atomic`**) and consumed at each step *host* (`ScopeGateHost`, `final-review-host`):

- **`composite`** (opt-in, `--composite`) — embedded-component hierarchy is honored: the two review screens run against a shared slot-dependency graph with the divergent semantics this ADR specifies. Everything below describes this mode.
- **`atomic`** (default) — components import flat, with no embedded-component hierarchy. The hosts render the pre-composite step implementations, which never build the graph; every graph-derived rule degenerates (see "The `compositionMode` axis" at the end of the Decision). Atomic is orthogonal to the ScopeGate/GenerateReview split — it crosses both.

In `composite` mode the DSI TUI runs two review screens against the same slot-dependency graph but with divergent semantics:

- **ScopeGateStep** — pre-generation. User is scoping WHICH components to send to AI generation. Read-only source. Cycles are EXPECTED — sending cyclic components to generate is how the user gets them fixed.
- **GenerateReviewStep** — post-generation. User is reviewing / editing AI-generated CDF definitions before push. Full editor. Cycles MUST be resolved (edit or reject) before push — the API rejects cyclic manifests.

Over time this divergence has been implemented as scattered rules across four files (`selection-cascade.ts`, `scope-gate-cascade.ts`, `GenerateReviewStep.tsx`, `ScopeGateStep.tsx`) plus a fourth graph re-derivation inside `GroupedSidebar.tsx.itemsToGraph`. Each place independently decides what to filter, what to cascade, and how to interpret component state. This has produced:

- Silent drift bugs (an ancestor-visibility bug — a rejected ancestor's slot edges dominated the sidebar tier layout because `itemsToGraph` didn't honor `status`).
- Load-bearing subtleties documented only in prose — the "two-graph split" described under Cycle policy below — but not encoded as types or invariants.
- Confusion about what "rejected" means (won't-scope-in vs. won't-ship — the two steps mean different things by the same word).

We need a canonical rule set the code can conform to, and a shared graph-building seam so tier / cycle / closure decisions come from ONE source per step.

## Decision

> **All of Part 1 and Part 2 describe `compositionMode: composite`.** The `atomic` default collapses every graph-derived rule below; see "The `compositionMode` axis" after Part 3.

### Part 1 — Policy matrix (behavioral rules per step, `composite` mode)

**Selection state:**

| | ScopeGate | GenerateReview |
|---|---|---|
| States | `undecided` / `accepted` / `rejected` | `needs-review` / `accepted` / `rejected` |
| Default at entry | Everything `undecided` | Everything `needs-review`, then mount auto-reject flips cycle participants + their transitive ancestors to `rejected` |
| Meaning of `rejected` | "excluded from generation scope" | "won't ship — dropped from push manifest" |

**Selection cascade:**

| Axis | ScopeGate | GenerateReview |
|---|---|---|
| Accept X | Cascade DOWN through slot edges → descendants → `accepted` | Cascade DOWN through slot edges via `computeClosure`. **Short-circuits on cycle:** if ANY cycle exists anywhere in X's reachable set, the returned closure is just `[X]` and no descendants flip. Operator must accept remaining members individually or edit slots to break the cycle first. |
| Reject X | Cascade UP through ancestors → `rejected` | Cascade UP through ancestors → `rejected`, AND deselect descendants back to `needs-review` |
| Cycle-unit cohesion | YES — a cycle is one equivalence class. Any cascade touching a class flips all class members. Overlapping cycles that share a node collapse into one class via union-find (`scope-gate-cascade.ts`). | NO — cascades traverse only real slot edges, AND the accept-cascade refuses to traverse at all when a cycle is reachable (see "Accept X" above). Cycles must be resolved by editing them away or accepting each member individually. Design intent: prevent an operator from opting into a cyclic push manifest with one keystroke. |

**Cycle policy:**

| Axis | ScopeGate | GenerateReview |
|---|---|---|
| Cycles allowed? | YES — expected. User scopes cyclic components in so the editor can fix them. | NO — must be resolved before push. |
| Auto-reject at mount? | No | Yes — every cycle participant + every transitive ancestor that slots one → `rejected`. `[u]` restores the pre-mount snapshot once. |
| Push-safety filtering | Not applicable (no push at scope-gate). Cycle detection runs on the full graph, drives sidebar `(cycle)` badges + guidance banner. | **Two-graph split:** *unfiltered* graph drives sidebar structure (badges, `[c]` panel, closure walk); *filtered* graph (`status !== 'rejected'`) drives push-safety (top banner, `slotCycles` state, `[F]` gate). These are two live views over the same underlying graph, not two separately maintained graphs — see "Consolidate" under Part 3 for how they're kept in sync. |
| Advance gate | Any non-empty accepted set advances. Cycles do NOT block. | `[F]` blocks if the accepted subset contains any cycle. Only fixes: reject enough members to break the cycle, or edit slots to break it structurally. |

**Edit affordance:**

| ScopeGate | GenerateReview |
|---|---|
| None — source is read-only | FieldEditor (Ctrl+S). `recomputeCycles` re-runs on save. Slot edits can BREAK cycles → `slotCycles` clears, `cycleParticipantsMemo` updates, auto-reject signature resets. |

### Part 2 — Canonical scenario semantics (`composite` mode only)

Three topology scenarios that surfaced ambiguity. Frozen behavior. **All three are vacuous under `atomic` mode** — they presuppose cycles/slots, which atomic never computes:

**Scenario A — Parent P and Child C form a cycle with each other (`P.slots⊃C`, `C.slots⊃P`)**

- **ScopeGate:** `{P, C}` is one cycle-unit. Accept or reject EITHER flips BOTH (cycle-unit cohesion). Slot-edge cascade would also connect them; cohesion is redundant but explicit.
- **GenerateReview:** At mount both auto-rejected. `[a]` on P accepts ONLY P — C stays at its prior status. **This is the key GR-vs-SG divergence for cycles:** `computeAcceptCascade` uses `computeClosure`, which short-circuits any closure whose walk detects a cycle and returns just `[target]`. So the accept-cascade does NOT traverse into cycles. To end up with both P and C accepted, the operator presses `[a]` twice (once per member) or edits the slot data. If both are accepted, `[F]` blocks because the cycle survives in the accepted subset. **Why this is intentional:** GR is a "resolve or block" screen — auto-cascading into a cycle would let an operator accidentally opt into shipping a cyclic manifest with one keystroke. Forcing per-member consent surfaces the cycle. The fix path is edit-to-break, not accept-through.

**Scenario B — P slots C; C is in a cycle with unrelated X (P is NOT in the cycle)**

- **ScopeGate:** `{C, X}` is one cycle-unit. P is a plain ancestor. Accepting P cascades DOWN to C, cohesion pulls X into `accepted` as well. Rejecting P cascades UP from P → no ancestors → only P flips; C and X untouched.
- **GenerateReview:** At mount C, X, AND P are auto-rejected (P is a transitive ancestor slotting a cycle participant). If user edits C to remove X → cycle clears → auto-reject does NOT re-fire (signature guard) → statuses unchanged. If user then accepts P, `computeClosure(P)`'s reachable set is `{P, C, X}` and STILL detects a cycle (unless the edit also broke X's reference to C) — closure short-circuits to `[P]`, so `[a]` flips only P. To finish: user accepts C explicitly, then accepts X. Only when every reachable member is individually accepted does the cycle survive into the accepted subset (and `[F]` blocks). **After the edit** (C no longer slots X): `computeClosure(P)` reachable = `{P, C, X}`, but the cycle detection over that subgraph now returns none — closure walks normally, `[a]` on P cascades to accept C AND X. Push-blocking cycle is gone, `[F]` advances.

**Scenario C — P is in a cycle with X; P also slots C (C is NOT in any cycle, C is a descendant only)**

- **ScopeGate:** `{P, X}` is one cycle-unit. C is a downstream leaf. Accept P → cohesion flips X; slot-edge cascade P→C flips C. Reject P → cohesion flips X; cascade UP has no ancestors; C untouched (stays whatever it was, typically `undecided`).
- **GenerateReview:** At mount P and X auto-rejected. **C stays `needs-review`** — the ancestor-flip rule catches ancestors of cycle participants, not descendants. This is a real edge case: user sees a screen with P red, X red, C uncommitted. Manually rejecting P is a no-op (no ancestors); descendants are deselected back to `needs-review` — C was already there. `[a]` on P: `computeClosure(P)` reachable = `{P, X, C}` and detects the P↔X cycle → closure short-circuits to `[P]` → only P flips accepted. To get C accepted the operator either accepts C directly or edits P/X to break the cycle first (after which `[a]` on P cascades normally to C).

### Part 3 — Where the code must conform

**Keep separate (correct divergence):**

- `analyze/selection-cascade.ts` — GenerateReview's cascade helpers (`computeAcceptCascade`, `computeRejectCascade`). Load-bearing, do not modify.
- `analyze/scope-gate-cascade.ts` — ScopeGate's cascade helpers, wrapping selection-cascade with cycle-unit cohesion. Load-bearing, do not modify.

**Consolidate (shared plumbing that has drifted):**

- One canonical graph-building helper (proposed: `analyze/slot-graph.ts` exporting `buildComponentGraph(components, { filterRejected?: boolean }): ComponentGraphNode[]`).
- Both steps consume it. `GroupedSidebar.itemsToGraph` accepts a pre-built graph as a prop OR reuses the same builder — no independent re-derivation from `entry.$slots`.
- The two-graph split in GenerateReview becomes an explicit typed shape (e.g. `type CycleView = { pushBlocking: SlotCycle[]; structural: Set<string> }`) with named consumers on each field, so no downstream reader has to remember "the filtered one is for push-safety."

**Not to touch (pinned scope — these primitives are correct as-is and out of bounds for this refactor):**

- `analyze/composite-closure.ts`
- `analyze/cycle-detection.ts`
- `analyze/lineage.ts`
- `analyze/fuzzy-search.ts`
- `analyze/scope-gate-cascade.ts` (callsite-only)
- `skills/select-components.md`

The refactor operates OVER these primitives; it does not rewrite them.

### The `compositionMode` axis

The matrix in Part 1 describes `compositionMode: composite` — the **opt-in, non-default** mode (`--composite`). The **default is `atomic`**: resolved once at command preamble (current precedence: see "Revised 2026-08-11" above; default `atomic`) and consumed at the step *host* (`ScopeGateHost`, `final-review-host`), which renders the pre-composite step implementation (`AtomicScopeGateStep`, `AtomicGenerateReviewStep`). Atomic is orthogonal to the ScopeGate/GenerateReview split — it applies to both. In atomic mode every graph-derived rule degenerates:

| Axis | ScopeGate (atomic) | GenerateReview (atomic) |
|---|---|---|
| Selection states | `included` / `excluded` (binary; the pre-composite sticky include/exclude model) | `needs-review` / `accepted` / `rejected` (unchanged) |
| Default at entry | all included-by-default (AI-flag may pre-exclude) | all `needs-review`; **NO mount auto-reject** (nothing cyclic to reject) |
| Accept/reject cascade | **none** — each row is independent (plain setter) | **none** — per-component; no `computeClosure` walk |
| Cycle-unit cohesion | N/A — graph not built | N/A — graph not built |
| Cycles allowed? | N/A — cycles never computed | N/A — cycles never computed |
| Auto-reject at mount? | No | No |
| Push-safety filtering | N/A (no push at scope-gate) | N/A — no cycle set; two-graph split not computed |
| Advance gate | any non-empty included set | any accepted set — **no `[F]` cycle gate** |
| Edit affordance | none (read-only source) | FieldEditor YES (prop editing); **slot-composition editing hidden** (host does not pass `projectSlotGraph` to `FieldEditor`) |
| Closures | singletons | singletons |

The "do not touch" primitives (`composite-closure`, `cycle-detection`, `lineage`, `selection-cascade`, `scope-gate-cascade`, `slot-graph`) are simply **not invoked** in atomic mode — the atomic steps never import them. Atomic is therefore a *bypass*, not a new policy over the primitives. **Atomic bypasses the canonical `buildComponentGraph` seam (Part 3) entirely** — it needs no graph builder of its own; a future reader should not add one. On the push path the same guarantee holds structurally: atomic strips `$allowedComponents` at the single serialization point (`loadCDFComponents` / a normalization pass over the components array), so cycle detection operates on empty slot data and returns zero.

## Consequences

### Positive

- **One canonical spec.** Future policy questions ("what happens when a rejected ancestor slots a live cycle member?") have a document to consult rather than needing a code trace.
- **Reduced drift surface.** Bugs of this shape come from independent graph re-derivations. Collapsing to a single builder eliminates the failure mode.
- **Clearer step semantics for readers.** "Rejected" means one thing in each step; the ADR encodes the difference in words instead of leaving it implicit.
- **Testability.** The scenarios in Part 2 become the canonical regression suite. Any change to cascade or cycle logic must preserve them.

### Negative

- **Refactor cost.** The consolidation (Part 3) is a real edit pass across GenerateReviewStep, ScopeGateStep, and GroupedSidebar. Estimated 1-2 engineering days with strict TDD.
- **Risk of regressing the two-graph split.** The `slotCycles` (filtered) / `cycleParticipantsMemo` (unfiltered) pair is subtle. Reifying it as `CycleView` must preserve every consumer's current semantics — this is where tests earn their keep.
- **Scenario-C awkwardness stays.** The ADR pins current behavior (C stays `needs-review` at mount even though its parent P is auto-rejected). If UX later argues that mount auto-reject should also cascade DOWN to descendants of cycle-participants' ancestors, this ADR is where the change gets debated.

### Neutral

- **No user-visible change from the ADR alone.** This is a spec-and-plan document. The consolidation refactor is tracked as a separate follow-up task.
- **Existing behavior stays canonical.** Where the two steps disagree today, the ADR ratifies today's existing undecided-default, auto-reject, and cycle-unit-cohesion behavior — it does not propose new user-facing rules.

## Follow-ups

- **Refactor task** — ✅ SHIPPED via graph consolidation plan (M1-M5). Prerequisite ancestor-visibility fix also shipped.
- **Scenario-based regression tests** — ✅ SHIPPED, covering scenarios A/B/C at the `buildVisibleRows`, `ScopeGateStep`, and `GenerateReviewStep` layers.
- **Known latent bug** — `storeCDFComponents` clobbers `status='generated'`. Independent of this ADR but relevant to the "meaning of rejected" discussion; fix should preserve in-memory status when persisting edited components. **Still outstanding.**
