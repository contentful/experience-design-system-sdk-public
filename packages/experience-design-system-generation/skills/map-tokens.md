# Map Tokens — Token Set & Restriction Suggestion Skill

## Purpose

For every design-category, token-typed prop already present in the generated CDF, suggest the token set it draws from (`token_sets`) and, when there is concrete evidence, the restricted subset a marketer may actually choose from (`token_allowed`). Output one JSON tool call per line to stdout. The CLI reads your stdout and writes each decision directly to the pipeline database — you do not write any files.

This is a narrow, focused step. It does not re-classify props, re-derive categories, or touch anything that isn't already a design-category `token` prop.

---

## Prerequisites — Input

All input is embedded inline in the prompt before this file:

- **Generated CDF so far** — design-category, token-typed props only, grouped by component. Every prop shown here already has `$type: "token"` and `$category: "design"`; you do not need to re-verify either.
- **Token path index** — a flat array of `{ "path": "<dot.notation.path>", "type": "<DTCG $type>" }` covering every leaf token in the library. **No `$value` is included** — the mapping decision only needs paths and their DTCG type, not their concrete values.
- **Component source references** — the real file text for each component (bounded/truncated), rendered inline as a fenced code block, so you can look for `tokenReference` usage, union/enum-shaped prop types, default values, or comments that indicate a restriction. **You have no filesystem access and no tools — `sourcePath` is a citation label only, never something to open.** When a component's source couldn't be read (moved/deleted since extraction), it's listed separately by path with no code block; for those, infer `token_sets` from the prop name and `$token.kind` alone and never emit `token_allowed` for them.

```typescript
interface TokenPathIndexEntry {
  path: string;   // dot-notation, e.g. "colors.brand.primary"
  type: string;   // DTCG $type, e.g. "color"
}

interface ComponentSourceRef {
  component: string;
  sourcePath: string;
  content: string | null;   // real file text, bounded — null when unreadable
}
```

If no token path index is provided, there is nothing to map — do not emit any tool calls.

---

## Target schema

Your suggestions become two additive, optional CDF fields on a design-category token prop:

- `$token.sets` — `string[]` of dot-notation **leaf** token paths naming the semantically relevant set this prop draws from (e.g. `["colors.brand.primary", "colors.brand.secondary", "colors.brand.tertiary"]` for a background-color prop that draws from the brand color group). Every entry must be an individual leaf path that appears verbatim in the token path index — **never a group/prefix path** like `"colors.brand"`. The token path index contains one entry per leaf token only, so a group name will never match it.
- `$token.allowed` — `string[]`, a subset of `$token.sets`. When present and non-empty, it is the restricted list a marketer may pick from. An empty array is a deliberate claim that everything in `$token.sets` is allowed. When the field is absent entirely, no restriction assessment was made.

Both fields are CDF-only in this step — nothing here writes to the Contentful Experience Orchestration API.

---

## Mapping guidance — Decision tree

For each design-category, token-typed prop shown in the "Generated CDF so far" section:

1. **Look for a `tokenReference`** in the component source (a CSS custom property or design-token reference near the prop's usage). If found, resolve it against the token path index and treat the result as high-confidence evidence for both `token_sets` and, if the reference is exact, `token_allowed`. Never contradict an existing `tokenReference`.
2. **Determine `token_sets`.** Infer the semantically relevant token group from the prop's name, its DTCG `$type` (via `$token.kind`), and the component source — e.g. a background-color prop maps to a color group (`colors.brand`, `colors.surface`), a spacing prop maps to a spacing group. Then enumerate **every leaf path under that group that exists in the token path index** (e.g. `colors.surface.default`, `colors.surface.raised`) and list those individually in `token_sets`. Never emit the group name itself — the token path index has no entry for it.
3. **Look for restriction evidence** in the component source:
   - A union or enum-shaped prop type (e.g. `'primary' | 'secondary'`) that maps to specific named tokens
   - A default value that resolves to a specific token
   - An explicit comment calling out which tokens are valid
   
   If you find such evidence, emit `token_allowed` as the evidenced subset of `token_sets`.
4. **No restriction evidence?** Omit `token_allowed` entirely. Do not emit an empty array as a placeholder — an empty array means you positively verified there is no restriction, not that you didn't look.
5. **No plausible token set at all?** Skip the prop — do not emit a call with an empty `token_sets`.

---

## Output protocol

Emit one JSON object per line. The CLI parses lines starting with `{`. Lines not starting with `{` are treated as prose and ignored by the parser — use them freely for reasoning.

**One tool call:**

```
{"tool":"map_token_prop","component":"<ComponentName>","prop":"<propName>","token_sets":["colors.brand.primary","colors.brand.secondary","colors.brand.tertiary"],"token_allowed":["colors.brand.primary","colors.brand.secondary"],"description":"<reason>"}
```

**Rules:**

- Emit exactly one JSON object per line. No multi-line JSON.
- Only emit a call for a prop that appears in the "Generated CDF so far" section.
- Every path in `token_sets` and `token_allowed` must be an individual **leaf** path that exists verbatim in the token path index. Never emit a group/prefix path (e.g. `colors.brand`) — the index has no entry for groups, only leaves. Never invent a path — if you can't find one, omit it.
- `token_allowed` must be a subset of `token_sets`.
- `token_allowed` is optional — omit it when there is no restriction evidence.
- An empty `token_allowed` array is valid and means "evidenced as unrestricted" — only emit it deliberately.
- `description` is a short internal rationale for the developer reviewing the import — not customer-facing copy.
- No `$value` is available in this step. Reason from paths and `$type` only.

---

## Examples

### Prop with a clear token set, no restriction evidence

Generated CDF shows:
```json
{"Card": {"$properties": {"bgColor": {"$type": "token", "$category": "design", "$token.kind": "color"}}}}
```

Token path index includes `colors.surface.default`, `colors.surface.raised`, `colors.brand.primary`.

Component source shows `bgColor` used generically with no union type or default hinting at a specific token.

```
bgColor is a background color token prop — likely draws from the surface color group; enumerating its leaves from the token path index
{"tool":"map_token_prop","component":"Card","prop":"bgColor","token_sets":["colors.surface.default","colors.surface.raised"],"description":"Background color surface for the card container"}
```

### Prop with restriction evidence (union type)

Component source:
```ts
interface ButtonProps {
  variantColor: 'primary' | 'secondary'; // maps to --brand-primary / --brand-secondary
}
```

```
variantColor is restricted to two specific tokens via the union type and the comment; token_sets enumerates all brand leaves from the token path index, token_allowed narrows to the evidenced pair
{"tool":"map_token_prop","component":"Button","prop":"variantColor","token_sets":["colors.brand.primary","colors.brand.secondary","colors.brand.tertiary"],"token_allowed":["colors.brand.primary","colors.brand.secondary"],"description":"Restricted to primary/secondary per the component's variant union type"}
```

### Prop with an existing `tokenReference` — high-confidence, must not contradict

Component source shows `background-color: var(--bg-primary)`, and `--bg-primary` resolves via the sidecar convention to `colors.bg.primary` (present in the token path index).

```
bgColor resolves via tokenReference to colors.bg.primary — treating as high-confidence, not contradicting; token_sets still enumerates the bg group's leaves from the token path index
{"tool":"map_token_prop","component":"Panel","prop":"bgColor","token_sets":["colors.bg.primary","colors.bg.secondary"],"token_allowed":["colors.bg.primary"],"description":"tokenReference --bg-primary resolves to colors.bg.primary"}
```

### No plausible token set — skip

A `borderWidth` token prop where the token path index contains no dimension/border tokens at all: skip it. Emit no tool call, optionally a prose line explaining why.

---

## Edge cases

- **No token path index provided** — emit no tool calls; there is nothing to map against.
- **Prop already has `token_allowed` from a `tokenReference` exact match** — still emit `token_sets` alongside it; don't emit `token_allowed` without `token_sets`.
- **Ambiguous restriction (comment mentions "some" tokens but doesn't name them)** — treat as no evidence; omit `token_allowed`.
- **Component source file missing or unreadable** — fall back to inferring `token_sets` from the prop name and `$token.kind` alone; never emit `token_allowed` without source evidence.
- **Prop not in the pipeline database** — skipped with a warning by the CLI; does not abort the run.

## Validation step — Pre-emit checklist

Before emitting any tool calls, verify:

1. Every `map_token_prop` call targets a prop that appears in the "Generated CDF so far" section.
2. Every path in `token_sets` and `token_allowed` is a leaf path that exists verbatim in the token path index — no group/prefix paths.
3. `token_allowed`, when present, is a subset of `token_sets`.
4. No call has an empty `token_sets`.
5. `token_allowed` is omitted (not an empty array) unless you positively verified there is no restriction.
6. No existing `tokenReference` is contradicted.

## CRITICAL: No hallucinated paths

Never emit a path in `token_sets` or `token_allowed` that does not appear verbatim in the token path index. This includes group/prefix paths (e.g. `colors.brand`, `colors.surface`) — the index only ever contains leaf tokens, so a group name will never match and will be silently dropped downstream with a warning. If the relevant set is a whole group, enumerate its individual leaves instead of naming the group. An invented or group-level path is worse than no suggestion at all — it also signals the mapping cannot be trusted. When in doubt, omit rather than guess.
