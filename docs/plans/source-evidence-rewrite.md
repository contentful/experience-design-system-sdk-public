# Source evidence rewrite

## Branches and frozen inputs

- New branch: `feat/import-pipeline-evidence-rewrite`.
- Base branch: `feat/import-pipeline-evidence-and-reasoning-working`.
- Frozen base: `508b83c5c9e633ffdcbc0f72b0ca6b1daf9c9ec4`.
- Donor branch: `feat/import-pipeline-evidence-and-reasoning`.
- Frozen donor: `82b619c6ef52257fdce6c823105ce8dd3ec2d17b`.
- Common ancestor: `a42a407c7229100472fca70acc775c7e821b3b18`.
- The base was clean when copied; both original worktrees are preserved.

## Intent

Carry the donor's seventeen bounded source-evidence improvements into the current
implementation, preserving the base's generation validation, model review, debug
resume and compiler-based composition. This is a new implementation commit on the
base history, without merging the donor history. It does not complete broader
semantic-proof coverage or authorize source-field omission.

## Reconciliation ledger

All seventeen entries are implemented in the combined tree; serial acceptance checks passed.

| Original | Behavior | Reconciliation |
| --- | --- | --- |
| `05c6efda` | Ordered field semantics | Upgrade the earlier collector already present on the base. |
| `ab3c58cf` | Explicit conditional premises | Keep incomplete and runtime-dependent claims uncertain. |
| `1c92e57b` | Component name preservation | Retain exported components regardless of hook-like names. |
| `4cdb3ae1` | Captured-source paired replay | Reproduce comparisons without executing customer code. |
| `af485da3` | Finite branch replay | Preserve branch conditions and bounded alternatives. |
| `950fff6d` | Resolved helper frames | Keep declaration identity, invocation frames and alias bounds. |
| `1404b752` | Applicability preview | Separate value and omission accounting; retain every source field. |
| `caffbc0b` | Local collections | Retain supported finite arrays and explicit uncertainty. |
| `5f717870` | Local iteration | Retain bounded iteration and its unestablished intrinsic premise. |
| `eb852151` | Lexical captures | Keep initialized immutable captures and uncertain effects. |
| `dbb56827` | Local array mapping | Retain callback arguments, identities and finite replay bounds. |
| `81d63dbe` | Closure fact projection | Join source context and facts through verified lexical owners. |
| `45b1b4d5` | Object binding replay | Keep declaration-bound destructuring and exact supported keys. |
| `0000d77a` | Quality neutrality | Remove name/type-based authorability conclusions. |
| `f401a23f` | Raw property retention | Keep explicit categories and all raw source properties. |
| `405914e0` | Helper-result transfer | Keep supported returned records and arrays with original aliases. |
| `82b619c6` | Callable property retention | Keep callable names, signatures and alternatives as source props. |

## Routine decisions

1. Replace the base's earlier field collector with the donor's bounded version 7
   contract and version 9 paired replay; reject incompatible prior evidence.
2. Preserve the base's captured-location rebinding and declaration validation in
   session loading; validate paired replay after that rebinding.
3. Keep generation/model/review changes and the retired composition mapping agent
   intact; compact generation includes validated advisory boundaries and coverage
   counts, with complete projections in the immutable invocation artifact.
4. Preserve original fields, shared shapes, callable names and explicit categories;
   runtime/delivery premises remain unestablished.
5. Keep provider evaluations, EDSI adoption, renderer changes and pipeline-cache work
   outside this rewrite.

## Verification

Fresh backend build and typecheck passed after final prompt integration; all 398
connected controls across seven files passed, including saved-session replay,
compact/full generation evidence and compiler-based composition. Of the 92 files
changed only on the base, 91 remain byte-identical; the sole adaptation is its
compact generation prompt. Scoped lint found one formatting issue, which was
corrected; final affected-project verification is recorded below.

### Frozen-base attribution and harness compatibility

The first normal commit attempt created no commit: its hooks reported 27 backend
and seven CLI failures. A separate detached worktree at the exact frozen base
reproduced all 34 failed checks. The matched backend selection had 100 passes and
27 failures; the matched CLI selection had 11 passes and seven failures. These
results establish that the reported failures predate this rewrite, rather than
attributing them from source inspection alone.

Bounded test-harness updates exercise the existing mandatory validator against
the exact mock output and capture the immutable full context during invocation.
They do not manufacture receipts, change production admission, launch providers,
or restore pipeline result-cache reads. Negative source-adequacy fixtures honor
the existing correction subject inventory and retain their rejection assertions.
Review-save fixtures use the current model-aware write/readback API; cycle checks
explicitly reaccept an automatically rejected cycle before testing finalization.
The model-array check follows the existing compact ordered attachment and verifies
complete logical mappings instead of requiring an obsolete wrapper slot.

The final index also preserves 91 of the 92 base-only files byte-for-byte; its sole
production adaptation is the compact generation prompt. Test-only harness repairs
leave the newer production save, validator, model and cycle behavior unchanged.

### Local acceptance

- All affected lint and typecheck targets passed.
- The full backend suite passed: 160 files, 1,633 tests.
- The full CLI suite passed: 68 files, 495 tests.
- Build, lint, typecheck and test stages were verified serially before the commit.
- The combined change is committed locally using normal repository hooks.
- The staged public-content scan found no private references or secret formats.
- Both original worktrees remain preserved; remote publication is a separate gate.

The rewrite retains conditional source evidence rather than activating semantic
proof or deleting fields. Unknown effects, unsupported operations and runtime or
delivery premises remain explicit limitations. No provider evaluation, pipeline
cache repair, downstream integration or rendering work is included.
