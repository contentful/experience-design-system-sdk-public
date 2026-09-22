# Import Flag × Mode Coverage Matrix (Regression Firewall)

This suite is a machine-checked guarantee that every supported `experiences import` flag
is inventoried and that supported flags are exercised against the interactive
Ink wizard where applicable.

It keeps the import command's supported flag surface explicit.

## Files

| File | Role |
|------|------|
| `flags.ts` | Source-of-truth inventory: every import flag + metadata (`kind`, `sampleValue`, `modes`, `incompatibleWith`, …). |
| `inventory.test.ts` | **Trip-wire.** Registers the real import command and asserts its flags EXACTLY equal the inventory keys. Also checks value flags have samples and incompatibilities are symmetric. |
| `incompatible-pairs.test.ts` | Behavioral: every declared incompatible pair REJECTS (exit 1 + right message) via the real CLI subprocess. Includes a coverage guard that fails if a declared `incompatibleWith` edge lacks a rejection cell. |

## How to add a flag

1. **Add the `.option(...)` to `src/import/command.ts`** as usual, or to a shared builder in `src/lib/` when the flag is shared across commands. The inventory test registers the real command, so flags are tracked regardless of where they are declared.
2. **Run `inventory.test.ts`** — it will FAIL, naming your new flag as
   "registered flags missing from flags.ts inventory". That is the red.
3. **Add a `FlagSpec` entry to `flags.ts`**: set `kind`, a usable `sampleValue`
   for value flags (must not error before mode dispatch, e.g.
   `--composite`), the `modes`
   it is meaningful in, and any `incompatibleWith` edges (declare them on BOTH
   flags — the symmetry check enforces this).
4. **Add a behavioral cell:**
   - Interactive → add a focused Ink component test under the CLI package.
   - Incompatible pair → add a rejection cell to `incompatible-pairs.test.ts`
     (the coverage guard will otherwise fail).
5. **Green again.**

## Running

```bash
# Headless matrix + inventory (main suite)
./node_modules/.bin/vitest run test/import/flag-matrix

```

## Coverage scope

The inventory and compatibility tests cover the supported interactive import flag surface.
