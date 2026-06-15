# SP-2: Generation Guard — Strip Invalid Fields Before LLM + Post-Generate Sanitization

**Parent spec:** `2026-06-12-integ-4156-validation-recovery-master.md`
**Layer:** Generation (prompt build + post-generate manifest sanitization)
**Risk:** Low

---

## Problem

Even if SP-1 lands and select-all refuses errored components, there are two remaining ways empty-named slots/props can reach the manifest:

1. **The LLM hallucinating an empty slot name** — the skill file currently has no rule against it. The LLM can emit `{"tool":"classify_slot","slot":""}` and the parser skips it with a warning, but the source `RawSlotDefinition { name: "" }` remains in the DB and ends up in the manifest.

2. **The pre-prompt input itself contains empty names** — `runOneComponent` serializes the component's `props` and `slots` directly from the DB row without filtering. An empty-named slot goes into the prompt JSON, the LLM sees it, tries to classify it, emits a call with `slot: ""` (which the parser rejects), and the raw record still has `name: ""`.

This is the deepest layer of the prevention stack. It should be belt-and-suspenders on top of SP-1, not a replacement.

---

## What We Already Have

- `agent-runner.ts:217`: `if (typeof rec.slot !== 'string' || !rec.slot)` → `warnings.push('classify_slot missing slot name — skipped')`
- Same pattern for `classify_prop` at line 177
- `generate-components.md` skill file: no mention of empty names

**The gap:** The guard is on the LLM *output*, not the *input*. Empty names in the raw component definition are passed into the prompt verbatim. And even if the LLM somehow produces the right output, there's no post-generate sanitization that verifies zero-length keys don't exist in the DB before building the manifest.

### Carry-forward from SP-1 (stashed work, recovery instructions)

During SP-1 implementation, a "rescue" path was prototyped but **deferred to SP-2** to keep SP-1's blast radius scoped to the select-step gate. The work is **stashed** on the SP-1 branch and must be recovered as the first step of SP-2 implementation:

```bash
git stash list
# stash@{0}: ... SP-2 generation guard work (renameEmptySlots) — to be picked up in INTEG-4165 PR-B
git stash apply stash@{0}
```

What the stash contains:

- **`src/session/db.ts` — `renameEmptySlots(db, sessionId, componentId, componentName, slotCount)`**: finds slots with `trim(name) = ''`, renames a single one to `"children"` and multiples to `"slot_<position>"`. Mutates the DB row directly via `UPDATE raw_slots SET name = ?`. Returns `{ renames, warnings }`.
- **`src/generate/command.ts` — `runOneComponent` hook**: calls `renameEmptySlots` before building `rawComponentsInline`, then patches the in-memory `component.slots` so the prompt JSON reflects the rename. Emits the rename warnings to stderr (NOT yet surfaced to the wizard — see UX concern below).
- **`skills/generate-components.md` — pre-named slots note**: tells the LLM to treat heuristic names like `"children"` and `"slot_<n>"` as already-named slots and to classify them normally rather than rename again.
- **`test/session/db.test.ts` — `renameEmptySlots` tests**: 3 cases (no-op when all named, single empty → `children`, multiple → positional).

This rescue **changes the design of SP-2 significantly**: instead of *stripping* empty-named slots before the prompt (Option B in the original D2 framing), it *renames* them so the LLM can still classify them. That's strictly better — it preserves slot information rather than dropping it — but it means the spec's D2 framing was revisited:

- **Option B (pre-prompt strip)** → **rejected; replaced by the rename approach.** Stripping loses information that the rename preserves.
- **Option D (post-generate sanitization in `loadCDFComponents`)** → demoted to **hallucination-only insurance**, since rename happens before the prompt and ensures no empty-keyed slot exists in the DB before generation. Whether to ship Option D at all depends on the `buildManifest` precondition check below.
- **Option C (skill-file rule)** → still additive; the new note about heuristic names is the right shape.

**Implementer note:** When picking this up, do NOT just commit the existing diff — the SP-2 scope must also include the work below (see Acceptance Criteria for the full list):

1. Idempotency test for `renameEmptySlots` (what if `runOneComponent` runs twice?)
2. Re-extract overwrites rename test (`storeRawComponents` deletes rows; verify the original `name: ''` returns and the rename re-fires).
3. Wizard surfacing of rename warnings (currently buried in subprocess stderr → `WIZARD_LOG`; the user never sees them). Reuse `formatAcceptanceSummary`'s pattern from SP-1 — pass a count back through stdout, surface on the `review-generated-gate` or `generating` screen.
4. End-to-end test through `extract → select → generate → buildManifest` with at least one empty-named slot in the fixture, asserting the resulting manifest is valid.
5. Resolution of the `buildManifest` empty-key precondition (see below) before deciding whether Option D ships.

---

## [DECISION D2] Strip Location: Pre-Prompt, Post-Generate, or Both

> **This decision must be made before the implementation plan is written.**

### Option B — Pre-prompt strip only

Before `runOneComponent` serializes the component for the prompt, filter out any slot or prop with an empty `name` field. The LLM never sees the invalid field.

```typescript
// In runOneComponent, before building rawComponentsInline:
const safeProps = component.props.filter(p => p.name.trim());
const safeSlots = component.slots.filter(s => s.name.trim());
```

- **Pro:** Clean. LLM never has a chance to do the wrong thing.
- **Pro:** No change to DB schema needed.
- **Con:** If the LLM hallucinates an empty-named slot *not present in the input*, we have no guard.
- **Con:** Doesn't protect against other callers (e.g. `generate edit` or `apply push`) that read the DB directly without going through `runOneComponent`.

### Option D — Post-generate sanitization only

After `applyToolCalls` writes classifications to DB and before `buildManifest()` is called, run a sanitization pass that deletes or nullifies any rows with empty-string slot/prop keys.

- **Pro:** Covers all callers — manifest build is always clean.
- **Pro:** Catches LLM hallucinations of empty names that weren't in the input.
- **Con:** Requires knowing which DB table/column to sanitize (currently `cdf_props` and `cdf_slots`, or however the schema stores classified output).
- **Con:** Silent removal from DB is harder to debug and audit.

### Option B+D — Both (recommended)

Pre-prompt strip prevents the problem from occurring. Post-generate sanitization catches anything that slips through (LLM hallucination, future code paths).

- **Pro:** Defense in depth.
- **Con:** Slightly more code. Worth it.

### Option C — Skill file instruction (additional hardening, not a standalone control)

Add to `generate-components.md`: "If a slot or prop in the input has an empty name string, do not emit a classify_slot/classify_prop call for it."

- **Note:** LLM compliance is probabilistic. Option C is **not an alternative to B or D** — it cannot be chosen instead of them. It is a supplementary hardening layer that reduces the probability of hallucinated empty-name calls. Always implement alongside B+D, not in place of them.

### Recommended default (if no decision is made): **Option B+D**

Reasoning: Pre-prompt strip is 5 lines of code and is the right place to prevent the problem. Post-generate sanitization is the backstop that makes the invariant "no empty-named slot key in manifest" a system property rather than a best-effort one.

---

## Preconditions (must resolve before writing implementation code)

1. **`buildManifest` empty-key behavior.** Confirm whether `buildManifest` in `@contentful/experience-design-system-types` already strips empty-string `$slots` / `$properties` keys, or faithfully passes them through. Five-minute investigation:
   ```bash
   grep -n 'buildManifest' node_modules/@contentful/experience-design-system-types/dist/*.{js,d.ts} packages/experience-design-system-types/src/**/*.ts
   ```
   - If `buildManifest` already strips: Option D (post-generate sanitization) is dead weight. Implement rename + skill-file rule only.
   - If `buildManifest` passes through: Option D is load-bearing. Implement the `loadCDFComponents` filter.
   - Document the answer in the SP-2 retro under "Findings & Observations" so future readers don't need to re-investigate.

2. **`storeRawComponents` re-extract behavior.** Verify that re-running `analyze extract` deletes the rename via `DELETE FROM raw_components` (db.ts:604) before re-inserting. This is what makes the rename idempotent on re-extract. Add a test that asserts: rename → re-extract → rename re-fires. If the behavior is different than expected, `renameEmptySlots` may need to be defensive.

## Proposed Implementation (rename approach + post-generate Option D conditional on Precondition 1)

### Files to change

| File | Change |
|------|--------|
| `src/session/db.ts` | Add `renameEmptySlots(db, sessionId, componentId, componentName, slotCount): { renames, warnings }` — DB write that renames slots with `trim(name) = ''` to `children` (single) or `slot_<position>` (multiple). From the stash. |
| `src/generate/command.ts` | In `runOneComponent`: call `renameEmptySlots` before building `rawComponentsInline`; patch the in-memory `component.slots` so the prompt sees the renamed names; emit rename warnings via stdout (not just stderr) so the orchestrator can capture them. From the stash, plus stdout-surfacing addition. |
| `src/import/tui/WizardApp.tsx` | Capture rename warnings from the `generate components` subprocess output; thread a `renamedSlotsCount` state field through to the `review-generated-gate` or `generating` step description so the user sees what was renamed. Mirror the pattern of `formatAcceptanceSummary` from SP-1. |
| `src/session/db.ts` (`loadCDFComponents`) | **Conditional on Precondition 1.** If `buildManifest` does NOT strip empty keys, add a filter here: `$slots` and `$properties` entries with empty-string keys are dropped before returning. Hallucination insurance only. |
| `skills/generate-components.md` | Add the heuristic-names note: the LLM should treat `children` / `slot_<n>` as pre-named slots and classify them normally. From the stash. |

### Where the post-generate sanitization should live

Need to confirm the exact call chain: `loadCDFComponents(db, sessionId)` → `buildManifest(components, tokens)`. The sanitization should be in `loadCDFComponents` or as a step between load and build — not inside `buildManifest` itself (which is in the types package and we'd prefer not to modify it for this).

Currently `loadCDFComponents` is in `src/session/db.ts`. A filter there would cover:
- The wizard's `runPreview` path
- The `apply push` command path
- The `print components` path

All three paths call `loadCDFComponents`. Centralizing the sanitization there is the right place.

### Warning format

Rename warnings should be structured and attributable. The stash currently emits to stderr only; SP-2 should also pass the warnings (or at minimum a count) through stdout so the wizard can surface them:

```
PageLink: slot at position 2 had empty name — renamed to "slot_2" for classification
```

**UX concern — wizard surface (CARRIED, NOT RESOLVED):** The generate step's stderr is captured by `WizardApp.tsx` but not currently shown to the user (it goes to the wizard log file only). If a slot is silently renamed during generation and the component generates successfully, the user may be confused later about why their slot is named `children` in Contentful when their source code uses an unnamed `ReactNode` prop. SP-2 must ensure this surfaces — mirror SP-1's `formatAcceptanceSummary` pattern: thread a `renamedSlotsCount` through `WizardState`, surface on the `review-generated-gate` or `generating` step. This is now a hard acceptance criterion, not a "concern" (see below).

### Acceptance Criteria

- [ ] `renameEmptySlots` is called from `runOneComponent` before the prompt is built; no slot with `trim(name) === ''` reaches the LLM
- [ ] Rename produces `children` for a single unnamed slot, `slot_<position>` for multiple
- [ ] Each rename emits a structured warning to stderr AND a machine-parseable line to stdout (so the orchestrator/wizard can count without regex-fragility on stderr)
- [ ] **Idempotency:** calling `renameEmptySlots` twice on the same DB state is a no-op (no double-rename, no error)
- [ ] **Re-extract overwrites:** running `analyze extract` after a rename restores the original `name: ''` (since `storeRawComponents` deletes existing rows); next generate run re-fires the rename — verified by test
- [ ] **Wizard surfacing:** the wizard reads renamed-slot count from the generate subprocess output and displays it on the `review-generated-gate` (or `generating`) step. User sees e.g. `5 components generated, 2 unnamed slots renamed (slot_0, children)`. Mirror the `formatAcceptanceSummary` pattern from SP-1.
- [ ] **Skill file:** `generate-components.md` includes the heuristic-names note (`children`, `slot_<n>` are pre-named, classify normally, don't rename)
- [ ] **Conditional on Precondition 1:** if `buildManifest` does not strip empty keys, `loadCDFComponents` filters them before returning — hallucination insurance for cases the rename can't reach
- [ ] **End-to-end test:** fixture with at least one `RawSlotDefinition { name: '' }` → `analyze extract` → `analyze select --select-all` (gate accepts because rename hasn't run yet, but the slot still has empty name) — wait, this is the boundary problem. See "Boundary with SP-1" below.
- [ ] Tests cover: rename happy path, idempotency, re-extract restoration, wizard surfacing, skill file content; integration test through `extract → select → generate → buildManifest` asserting valid manifest

### Boundary with SP-1 (must resolve during implementation)

SP-1's gate auto-rejects components with `EMPTY_SLOT_NAME` errors. So in the headless / bulk-approve path, a component with `RawSlotDefinition { name: '' }` is **rejected at the select step** and never reaches generation — the rename never runs. That's correct: the gate is the cheaper, earlier protection.

The rename only fires when:
1. **Interactive TUI users override the gate** — they see the `⚠` badge and manually accept the errored component anyway.
2. **The validator missed something** — a slot/prop name that wasn't empty at extraction time but becomes problematic later (e.g. an LLM hallucinates one).

Implementer must clarify in the retro: **what is the actual surviving population of components that hit `renameEmptySlots`?** If it's only TUI overrides, that's a narrow case; the SP-2 acceptance criteria above should be re-evaluated to make sure they exercise the right scenarios.

If during implementation the boundary turns out to be even narrower (e.g. the gate is so reliable that the rename never fires in practice), SP-2 may want to soften scope to **just** the post-generate sanitization (Option D) plus the skill file rule. Document this decision in the retro.

---

## Open Questions

1. ~~Should the pre-prompt strip also handle props/slots where `name.trim() !== name` (leading/trailing whitespace)?~~ **Resolved.** PR-A normalized validator behavior: `validate.ts` now `.trim()`-s consistently across `EMPTY_*` checks AND `PROP_SLOT_NAME_COLLISION`. The rename logic should follow the same convention — `trim()` before comparing to empty. This is consistent with the SQL predicate already in the stash (`WHERE trim(name) = ''`).

2. ~~Does `buildManifest` in `@contentful/experience-design-system-types` already guard against empty keys?~~ **Promoted to Precondition 1 above.** Must be verified before writing implementation code; gates whether Option D ships.

---

## Summary & Retrospective

> **Fill this in after SP-2 is implemented and tests are passing. Read the SP-1 summary first — carry forward its D1 answer and any concerns it flagged.**

**Spec:** SP-2 — Generation guard (pre-prompt rename + post-generate sanitization + skill file rule)
**Date completed:** 2026-06-12
**Status:** Implemented on `feat/integ-4165-generation-guard`, branched from `feat/integ-4167-extraction-gate` (PR #32, A2)

---

### What Was Built

| File | Purpose |
|------|---------|
| `src/session/db.ts` | `renameEmptySlots(db, sessionId, componentId, componentName, slotCount)` — DB write that renames slots with `trim(name) = ''` to `children` (single) or `slot_<position>` (multiple). |
| `src/session/db.ts` (`loadCDFComponents`) | Hallucination-insurance filter: drops props/slots whose name fails `trim()` before they reach `buildManifest`. Option D ships because Precondition 1 confirmed `buildManifest` passes empty keys through. |
| `src/generate/command.ts` | `runOneComponent` calls `renameEmptySlots` after the cache miss path, patches in-memory `effectiveSlots` for the prompt, and threads `renamedSlotsCount` through `ComponentRunResult`. The aggregate count is emitted to stdout as `renamed-slots: <N>` so the wizard / orchestrator can read it without parsing stderr. |
| `src/import/tui/WizardApp.tsx` | New `formatGeneratedSummary()` (mirrors `formatAcceptanceSummary` from SP-1). `runGenerate` parses `renamed-slots: <N>` from stdout, threads `renamedSlotsCount` through `WizardState`, and the `review-generated-gate` summary surfaces it to the user. |
| `skills/generate-components.md` | Heuristic-names note: the LLM treats `children` / `slot_<n>` as already-named slots and classifies them normally (no double-rename). |
| `test/session/db.test.ts` | New tests: rename happy path, idempotency, re-extract restoration, whitespace-only names, `loadCDFComponents` empty-key drop for both `$slots` and `$properties`, end-to-end `extract → rename → applyToolCalls → loadCDFComponents → buildManifest` asserting the final manifest has no empty slot keys. |

---

### Deviations From the Plan

| Change | Reason |
|--------|--------|
| Rename approach (preserves slot info) replaced the originally-framed pre-prompt *strip* (Option B). | The SP-1 stash already prototyped the rename. Stripping would have lost the slot entirely; rename keeps it classifiable. |
| Both Option D (`loadCDFComponents` sanitization) and the rename ship — not "either/or". | Precondition 1 investigation confirmed `buildManifest` passes empty keys straight through (`packages/experience-design-system-types/src/sources-api/manifest/utils.ts:6-40` — `stripUnsupportedSlotFields` only drops `$required`, never the slot key). So Option D is load-bearing as hallucination insurance: a future LLM emitting a classify call for an empty-named row that wasn't in the input would still slip past the rename. The filter at the load-from-DB seam covers all three callers (`apply push`, `print components`, wizard `runPreview`). |
| Sanitization filter applies to **both** `$properties` and `$slots`, not just slots. | The original 422 was on slots, but the same hallucination class applies to props. Symmetric coverage is cheap. |
| Wizard surfacing uses a stdout marker (`renamed-slots: <N>`), not stderr regex parsing. | Stderr already carries progress lines (`[1/N]`) and per-rename `⚠` warnings. A dedicated stdout key is regex-stable and matches the spec's "machine-parseable line" acceptance criterion. |

---

### Test Coverage

| File | What it covers |
|------|----------------|
| `test/session/db.test.ts` (`renameEmptySlots` describe) | No-op when all slots named, single empty → `children`, multiple slots with one empty → `slot_<position>`, idempotency on second call, re-extract restores `name=''` and rename re-fires, whitespace-only name (`'   '`) treated as empty (matches validator's `.trim()` convention). |
| `test/session/db.test.ts` (`loadCDFComponents — empty-key sanitization` describe) | Empty-named slots dropped from `$slots`; empty-named props dropped from `$properties`; end-to-end extract→rename→`applyToolCalls`→`loadCDFComponents`→`buildManifest` produces a manifest whose `$slots` keys array is `['children']` (no `''`). |

Suite: 953/953 CLI tests pass; 15/15 types tests pass; lint clean (after `--fix` for prettier formatting).

---

### Build & Runtime Status

- `pnpm exec nx run experience-design-system-cli:compile` — clean.
- `pnpm exec nx run experience-design-system-cli:test` — 953/953 pass.
- `pnpm affected:test` — types + cli green.
- Lint — clean after a single prettier auto-fix pass.

Stderr noise: per-rename `⚠` warnings only fire on the unhappy path (component had at least one empty-named slot at extraction time). For the common case the only new output is the stdout `renamed-slots: 0` marker, which the wizard reads but doesn't render unless the count is non-zero.

---

### Findings & Observations

#### What went well
- The SP-1 stash applied cleanly onto A2 (PR #32). The rename approach was already correct in shape; SP-2's job was wiring the surfaces (stdout marker, wizard state, sanitization filter, additional tests) on top of it.
- The `formatAcceptanceSummary` pattern from SP-1 transferred 1:1 to `formatGeneratedSummary`. Reusing the shape means a future reader sees the same "summary helper + state field + GateStep summary prop" trio across both gates.
- Boundary check during implementation: the SP-1 select-step gate already rejects empty-named components in the headless path. So in practice the rename only fires on TUI overrides + LLM hallucinations. Both populations are correctly covered by Option D as backstop.

#### What was harder than expected
- Precondition 1 (`buildManifest` behavior) turned out load-bearing: the function strips `$required` from slots but passes empty keys through verbatim (`utils.ts:9-13`). Without Option D shipping, a hallucinated empty-key in the DB after rename would still 422. So the spec's "conditional on Precondition 1" Option D became unconditional.
- The stash's e2e test was almost runnable, but I had to correct the `ToolCall` field names (`cdf_type` not `cdfType`, no `componentName` field) — the runtime is snake_case while the parsed wire format and TypeScript types both follow the same shape.

#### Patterns to reuse in future specs
- **Stdout-as-machine-channel.** When a subprocess needs to surface a non-error fact to its parent (rename count, here), emit a stable `key: value\n` line on stdout rather than scraping stderr regex. Stderr is for human progress/warnings; stdout for orchestration data. This matches the existing `session=<id>` and `generate complete` markers and avoids fragile parsing.
- **Defense in depth at the data seam.** Putting the post-generate filter in `loadCDFComponents` (rather than in `buildManifest`, the wizard, or `apply push` individually) gives all three downstream callers the same invariant for free. Centralizing on the load-from-DB function is cheaper than three matching filters.

---

### Open Questions

- **D2 final answer:** Rename (replaces Option B) + Option D (post-generate sanitization) + Option C (skill-file rule) — all three ship. Original D2 text framed Option D as conditional, but Precondition 1 turned it load-bearing.
- **`buildManifest` behavior:** Confirmed it passes empty keys straight through. `stripUnsupportedSlotFields` in `packages/experience-design-system-types/src/sources-api/manifest/utils.ts:6-14` only drops `$required` from slot value objects — not the slot keys themselves. SP-3/SP-4 can rely on the invariant that any 422 they see for empty-named slots/props originated *upstream* of the rename + filter (server-side rules, race condition, code path that bypasses `loadCDFComponents`), not from a known-broken extractor row.
- **Whitespace-only names:** The rename uses `WHERE trim(name) = ''` and `loadCDFComponents` filters with `!s.name.trim()` / `!p.name.trim()`. Both match the validator's `.trim()` convention from PR-A.

---

### Concerns for Future Specs

- **SP-3 / SP-4 dependency:** SP-3 and SP-4 both parse 422 errors to identify offending components. If SP-2's post-generate sanitization silently strips the empty-named slot *before* the manifest is built, the 422 may never fire — which is the goal. But it also means SP-3 and SP-4 tests need to be written for cases SP-2 *doesn't* catch (e.g. server-side rules we don't model locally). Make sure the 422 test scenarios in SP-3/SP-4 use failures that SP-2 wouldn't have prevented.
- **Warning noise:** If many components have empty-named fields stripped pre-prompt, the warning output could become noisy. If the test suite finds more than a handful of real-world cases in the fixture data, consider aggregating warnings ("3 components had empty-named fields stripped") rather than one line per field.
