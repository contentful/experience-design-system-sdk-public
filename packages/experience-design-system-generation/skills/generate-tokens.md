# Generate Tokens — Classification Skill

## Purpose

Classify every raw token from the input into a DTCG token tree. Output one JSON tool call per line to stdout. The CLI reads your stdout and writes each token and group directly to the pipeline database — you do not produce a JSON file.

---

## Prerequisites — Input

All input is embedded inline in the prompt before this file:

- **Raw token source** — the original source file as-is. This may be any format: SCSS/CSS variable declarations, a JavaScript/TypeScript token module, a JSON object, a Style Dictionary config, Tailwind config, or any other token definition format the project uses. Read it as you would any source file.
- **Token-name sidecar** — if provided, maps raw names to DTCG paths (read-only context). Use these as authoritative path assignments when present.

---

## Target schema

The CLI assembles your output into a DTCG token tree. Each `set_group` call produces an intermediate group node; each `set_token` call produces a leaf with `$type` and `$value`. You do not produce JSON directly — emit tool calls and the CLI writes the rows.

---

## Output protocol

Emit one JSON object per line. The CLI parses lines starting with `{`. Lines not starting with `{` are treated as prose and ignored — use them freely for reasoning.

**Two tool calls:**

```
{"tool":"set_group","path":"<dot.notation.path>","description":"<optional>"}

{"tool":"set_token","path":"<dot.notation.path>","type":"<DTCG type>","value":<value>,"description":"<reason>"}
```

Every leaf token must have an explicit `$type` — do not rely on group-level inheritance. Intermediate nodes (groups) must NOT have a `type` field.

**Rules:**
- Emit exactly one JSON object per line. No multi-line JSON.
- Every intermediate group must have a `set_group` call.
- Every leaf token must have a `set_token` call.
- `path` is dot-notation from root, e.g. `colors.brand.primary` — no leading dots or slashes.
- `type` must be one of the 13 valid DTCG types (see table below).
- `value` must be valid JSON — string, number, array, or object depending on the type. Do NOT quote complex values.
- Emit `set_group` calls before the `set_token` calls under them.
- `description` on `set_token` documents your reasoning — always include it.

---

## Valid types

Exactly **13** valid DTCG `$type` values:

| type | Typical values |
|---|---|
| `color` | `"#0066ff"`, `"rgb(0,102,255)"` |
| `dimension` | `"8px"`, `"1rem"`, `"0.5em"` |
| `fontFamily` | `"Inter, sans-serif"` |
| `fontWeight` | `400`, `"bold"` |
| `duration` | `"200ms"`, `"0.3s"` |
| `cubicBezier` | `[0.42, 0, 0.58, 1]` |
| `number` | `1.5`, `100` |
| `strokeStyle` | `"solid"`, `"dashed"` |
| `border` | `{"width":"1px","style":"solid","color":"#000"}` |
| `transition` | `{"duration":"200ms","timingFunction":[0.42,0,0.58,1],"delay":"0ms"}` |
| `shadow` | `{"offsetX":"0px","offsetY":"4px","blur":"8px","spread":"0px","color":"#00000026"}` |
| `gradient` | `[{"color":"#000","position":0},{"color":"#fff","position":1}]` |
| `typography` | `{"fontFamily":"Inter","fontSize":"16px","fontWeight":400,"lineHeight":1.5,"letterSpacing":"0px"}` |

---

## Mapping guidance — Type resolution

For each token value, determine the DTCG `$type` by reading the value and its context:

| Value pattern | Type |
|---|---|
| Starts with `#`, `rgb(`, `hsl(`, `rgba(` | `color` |
| Ends with `px`, `rem`, `em`, `%`, `vw`, `vh` | `dimension` |
| `cubic-bezier(...)` or 4-element array | `cubicBezier` |
| Ends with `ms` or `s` (animation/transition) | `duration` |
| Font family name string | `fontFamily` |
| Numeric `100`–`900`, or `bold`/`normal`/`light` | `fontWeight` |
| Multi-property shadow value | `shadow` |
| Multi-property border value | `border` |
| `solid`, `dashed`, `dotted` alone | `strokeStyle` |
| Composite font shorthand | `typography` |
| Unitless number | `number` |

When a token's type is ambiguous from its value alone, use its name as context (e.g. `$spacing-*` → `dimension`, `$duration-*` → `duration`). Document your reasoning in `description`. If no type fits, use `number` with a `"WARNING: type unknown"` description.

Resolve variable references: if a value references another variable (e.g. SCSS `$black` in `rgba($black, 0.6)`, or a JS alias), substitute the referenced value before classifying.

---

## Grouping

Organize tokens into a nested DTCG hierarchy that reflects their semantic purpose:

1. Examine naming patterns and existing structure in the source (variable prefixes, object nesting, file-level categories).
2. **For already-nested sources (JS/TS objects, JSON, Style Dictionary)**: derive paths directly from the source key hierarchy — lowercase each key segment and join with dots. Do NOT reorganize, rename, or flatten unless the original key is purely implementation-specific (e.g. `DEFAULT` as a single-child wrapper can be elided). The source structure IS the path. Example: `tokens[SPACING].DEFAULT.8` → `spacing.8`; `tokens[COLOR].text.standard` → `color.text.standard`; `tokens[SHADOW].level.1` → `shadow.level.1`.
3. For flat names (SCSS variables, CSS custom properties): strip leading `--` or `$`; replace `-` and `_` separators with `.` to form nested paths. Use the first meaningful segment as the top-level group.
4. If neither rule applies, propose a grouping strategy: by kind (`colors`, `spacing`, `typography`), by semantic role (`brand`, `semantic`, `neutral`), or hybrid.
5. Emit a `set_group` call for every intermediate node before emitting any `set_token` calls under it.

**Determinism rule**: Identical source input MUST produce identical paths on every run. Never invent synonyms, abbreviations, or alternative hierarchies for keys that already exist in the source. If `primary` is the key, the path segment is `primary` — not `brand-primary`, `main`, or `accent`.

If the token-name sidecar is provided, use it as authoritative path assignments — it maps raw names to DTCG dot-notation paths already.

---

## Value handling

Most values pass through as strings. For composite types, parse the raw string into the required JSON structure:

**`border`** — parse `1px solid #ccc` into:
```json
{"width":"1px","style":"solid","color":"#cccccc"}
```

**`shadow`:**
```json
{"offsetX":"0px","offsetY":"4px","blur":"8px","spread":"0px","color":"#00000026"}
```

**`transition`:**
```json
{"duration":"200ms","delay":"0ms","timingFunction":[0.42,0,0.58,1]}
```

**`gradient`** — array of color stops:
```json
[{"color":"#000","position":0},{"color":"#fff","position":1}]
```

---

## Examples

Input (SCSS):
```scss
$brand-primary: #0066ff;
$spacing-sm: 8px;
$anim-speed: 200ms;
$black: #1a1a1a;
$overlay: rgba($black, 0.6);
```

Output:
```
Analyzing SCSS variables: 5 tokens across color, spacing, duration, and composite color categories.
$overlay references $black — resolving to rgba(26, 26, 26, 0.6).
{"tool":"set_group","path":"colors","description":"Brand and UI color tokens"}
{"tool":"set_group","path":"colors.brand","description":"Brand palette"}
{"tool":"set_token","path":"colors.brand.primary","type":"color","value":"#0066ff","description":"Brand primary color"}
{"tool":"set_token","path":"colors.neutral.black","type":"color","value":"#1a1a1a","description":"Base black neutral"}
{"tool":"set_token","path":"colors.neutral.overlay","type":"color","value":"rgba(26, 26, 26, 0.6)","description":"Semi-transparent overlay; $black variable resolved to #1a1a1a"}
{"tool":"set_group","path":"spacing","description":"Spacing scale"}
{"tool":"set_token","path":"spacing.sm","type":"dimension","value":"8px","description":"Small spacing step"}
{"tool":"set_group","path":"motion","description":"Animation timing"}
{"tool":"set_group","path":"motion.duration","description":"Duration values"}
{"tool":"set_token","path":"motion.duration.speed","type":"duration","value":"200ms","description":"Standard animation speed"}
```

---

## Edge cases

- **Empty input** — emit nothing; the CLI will report 0 tokens stored.
- **Path collision** — two raw tokens resolve to the same dot-notation path: append `_2`, `_3` to disambiguate, and add a `description` warning.
- **Unrecognizable value** — no heuristic matches and `inferredKind` is invalid → use `number` with a warning in `description`.
- **Complex composite value** — parse raw string into the required JSON structure; if parsing is ambiguous, use a best-effort parse and document in `description`.

---

## Validation step — Pre-emit checklist

Before emitting any tool calls, verify:

1. Every raw token in the input has exactly one `set_token` call.
2. Every intermediate group has a `set_group` call.
3. All `type` values are from the 13 valid DTCG types.
4. `value` is valid JSON for the given type (string for color/dimension/etc., object for border/shadow/etc., array for gradient/cubicBezier).
5. All `path` values use dot-notation with no leading dots or slashes.
6. No duplicate paths.
7. `set_group` calls precede the `set_token` calls under them.

After the run, the developer can validate with:

```
experience-design-system-cli print validate --tokens <out-path>
```

Re-run or iterate on any tokens flagged by warnings until validation passes.
