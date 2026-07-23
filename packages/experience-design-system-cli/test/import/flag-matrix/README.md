# Import Flag × Mode Coverage Matrix (Regression Firewall)

This suite is a machine-checked guarantee that every `experiences import` flag
is inventoried and that the high-risk flag combinations are exercised in **both**
dispatch modes (headless `runPipeline` and interactive Ink wizard).

It exists because the composition-mode bug was not a logic error — it was an
**untested execution path**: composition flags worked in the PTY wizard but were
silently dropped in the headless orchestrator. Nothing forced a flag to be tested
in both modes. This matrix does.

## Files

| File | Role |
|------|------|
| `flags.ts` | Source-of-truth inventory: every import flag + metadata (`kind`, `sampleValue`, `modes`, `incompatibleWith`, `forcesHeadless`, …). |
| `inventory.test.ts` | **Trip-wire.** Parses `.option(...)` calls out of `src/import/command.ts` (multi-line tolerant) and asserts the parsed set EXACTLY equals the inventory keys. Also checks value flags have samples and incompatibilities are symmetric. |
| `composition-headless-matrix.test.ts` | Behavioral: composition flags × mode, composition sub-flags forwarded to the spawned `analyze extract`, composition × headless-trigger flags, and save/push forks. Uses the `execFile`-mock pattern to inspect forwarded subprocess argv. |
| `auto-reject-cycles-headless-matrix.test.ts` | Behavioral: `--auto-reject-cycles` × `{--composite, --no-push, on/off}` in the headless dispatcher. |
| `incompatible-pairs.test.ts` | Behavioral: every declared incompatible pair REJECTS (exit 1 + right message) via the real CLI subprocess. Includes a coverage guard that fails if a declared `incompatibleWith` edge lacks a rejection cell. |
| `pty-coverage.test.ts` | Marker that reports PTY cells as **NOT verified** (skipped-with-label) unless `PTY_TESTS=1`. Never green-by-default. |
| `../../../tools/dsi-pty-harness/test/import/flag-matrix.pty.test.mjs` | The interactive halves: composition × PTY and `--auto-reject-cycles` × PTY. Opt-in via `PTY_TESTS=1`, runs against `dist/`. |

## How to add a flag

1. **Add the `.option(...)` to `src/import/command.ts`** as usual.
2. **Run `inventory.test.ts`** — it will FAIL, naming your new flag as
   "in command.ts but missing from flags.ts inventory". That is the red.
3. **Add a `FlagSpec` entry to `flags.ts`**: set `kind`, a usable `sampleValue`
   for value flags (must not error before mode dispatch, e.g.
   `--composition-agent-mode parser`, `--on-conflict overwrite`), the `modes`
   it is meaningful in, and any `incompatibleWith` edges (declare them on BOTH
   flags — the symmetry check enforces this).
4. **Add a behavioral cell:**
   - Headless single-flag/pair → extend `composition-headless-matrix.test.ts`
     (subprocess-argv assertion) or add a `runCli` cell.
   - Interactive → extend `flag-matrix.pty.test.mjs` (drive the wizard, assert
     an on-screen effect).
   - Incompatible pair → add a rejection cell to `incompatible-pairs.test.ts`
     (the coverage guard will otherwise fail).
5. **Green again.**

## Running

```bash
# Headless matrix + inventory (main suite)
./node_modules/.bin/vitest run test/import/flag-matrix

# PTY cells (opt-in, against dist/)
pnpm exec nx build experience-design-system-cli
cd tools/dsi-pty-harness && PTY_TESTS=1 ./node_modules/.bin/vitest run test/import/flag-matrix.pty.test.mjs
```

Without `PTY_TESTS=1`, `pty-coverage.test.ts` reports the PTY cells as **NOT
verified** (a skipped, labelled marker) — it never silently passes as green.

## Revert-check (proving the net catches the fish)

To prove the firewall actually fails when the bug returns:

1. In `src/import/orchestrator.ts`, delete the `analyzeArgs.push('--composite')`
   (and the composition sub-flag pushes) in the `analyze extract` arg builder.
2. Run `composition-headless-matrix.test.ts` → a composition × headless cell
   goes RED ("expected [...] to contain '--composite'"). Restore, re-run, green.
3. Same for `--auto-reject-cycles`: revert the wizard `resolveCycleGateAction`
   wiring in `WizardApp.tsx`, run the PTY cell → the accept routes to the cycle
   BLOCK screen (RED). Restore, green.

## Phase 2 (follow-up — NOT implemented here)

This is Phase 1: inventory + trip-wire + the high-value composition×mode /
cycle×mode behavioral cells. Deferred to a follow-up ticket:

- **Full per-flag single-flag coverage** (deliverable 3): a table-driven suite
  asserting every `(flag, mode)` in the inventory has a behavioral test proving
  effect, for all 48 flags in both modes.
- **Long-tail pair registry** (deliverable 4 remainder): the full N×N compatible
  pair enumeration for the non-composition, non-cycle flags, via the `COVERED_BY`
  registry approach.
