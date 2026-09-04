# Map Tokens — Token Restriction Narrowing Skill

## Purpose

For every design-category, token-typed prop already present in the generated CDF that arrived **without** an existing token list, decide whether there is concrete evidence to narrow it to a restricted subset (`$token.allowed`). Output one JSON tool call per line to stdout. The CLI reads your stdout and writes each decision directly to the pipeline database — you do not write any files.

This is a narrowing fallback, not a classification step. It does not re-classify props, re-derive categories, or touch anything that isn't already a design-category `token` prop. It also does not name a candidate universe — the universe is implicit: every token in the library whose type matches the prop's `$token.kind`. Your only job is to decide, from source evidence, whether that universe should be narrowed further.

---

## Prerequisites — Input

All input is embedded inline in the prompt before this file:

- **Generated CDF so far** — design-category, token-typed props only, grouped by component. Every prop shown here already has `$type: "token"` and `$category: "design"`; you do not need to re-verify either. A prop that already carries a `$token.allowed` entry was resolved earlier from source evidence — leave it alone. Only decide for props that arrive with no `$token.allowed` at all.
- **Token path index** — a flat array of `{ "path": "<dot.notation.path>", "type": "<DTCG $type>" }` covering every leaf token in the library. **No `$value` is included** — the mapping decision only needs paths and their DTCG type, not their concrete values. A prop's candidates are always the subset of this index whose `type` matches the prop's `$token.kind` — ignore every entry outside that type.
- **Component source references** — the real file text for each component (bounded/truncated), rendered inline as a fenced code block, so you can look for an explicit restriction: a comment naming the valid tokens, or code that validates the prop against a fixed list of token paths. A default value or a `tokenReference` is the prop's *default*, not a restriction — see the decision tree. **You have no filesystem access and no tools — `sourcePath` is a citation label only, never something to open.** When a component's source couldn't be read (moved/deleted since extraction), it's listed separately by path with no code block; for those, there is no source evidence to narrow from — skip the prop.

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

If no token path index is provided, there is nothing to narrow against — do not emit any tool calls.

---

## Target schema

Your decision becomes one additive, optional CDF field on a design-category token prop:

- `$token.allowed` — `string[]` of dot-notation **leaf** token paths, all of the prop's `$token.kind` type, naming the restricted list a marketer may actually choose from. Every entry must appear verbatim in the token path index and match the prop's `$token.kind`. Omitting the field entirely means "any token of this kind" — the correct and live default. Never emit an empty array as a placeholder.

This field is CDF-only in this step — nothing here writes to the Contentful Experience Orchestration API.

---

## Mapping guidance — Decision tree

For each design-category, token-typed prop shown in the "Generated CDF so far" section:

1. **Already has `$token.allowed`?** Skip it. It was resolved from source evidence earlier in the pipeline and must not be contradicted or overwritten.
2. **Prop type is a union of variant names** (e.g. `'primary' | 'secondary'`)? That prop should not be a `token` at all — the component receives a name and resolves it, which is the `enum` case in the classification step. Do not narrow it; narrowing cannot repair a wrong type. Emit nothing, and note in a prose line that it looks misclassified so the developer can re-run classification.
3. **A default or a `tokenReference` is a default, not a restriction.** `padding = tokens.spacingM`, `background: var(--bg-primary)`, or a structured `tokenReference` tells you which token the prop *starts* on. It does not say the author may choose no other. Narrowing to that single path would leave the marketer one option, which is worse than no list. On its own, this evidence yields no tool call. If you do narrow on other grounds (step 4), the default's path must be in the list — never emit a list that excludes the prop's own default.
4. **Look for an explicit restriction** in the component source:
   - A comment that names the valid tokens (`// accepts colors.brand.primary or colors.brand.secondary only`)
   - Code that validates or maps the prop against a fixed list of token paths (an allowlist array, a `satisfies` over specific token keys)

   If you find such evidence, emit `$token.allowed` as the evidenced subset, scoped to tokens of the prop's `$token.kind` from the index.
5. **No explicit restriction?** Emit nothing for this prop. Omitting the list means "any token of this kind," which is correct and live — a guessed list is worse than none because it freezes the author's choices.
6. **No plausible candidates at all?** (No index entries of the prop's `$token.kind`.) Skip the prop.

---

## Output protocol

Emit one JSON object per line. The CLI parses lines starting with `{`. Lines not starting with `{` are treated as prose and ignored by the parser — use them freely for reasoning.

**One tool call:**

```
{"tool":"map_token_prop","component":"<ComponentName>","prop":"<propName>","token_allowed":["colors.brand.primary","colors.brand.secondary"],"description":"<reason>"}
```

**Rules:**

- Emit exactly one JSON object per line. No multi-line JSON.
- Only emit a call for a prop that appears in the "Generated CDF so far" section, and only when it arrived **without** an existing `$token.allowed`.
- `token_allowed` is required and must be non-empty. Never emit a call with an empty or missing `token_allowed` — if there's nothing to narrow to, emit no call at all.
- Every path in `token_allowed` must be an individual **leaf** path that exists verbatim in the token path index, and must be of the prop's `$token.kind` type. Never emit a group/prefix path (e.g. `colors.brand`) — the index has no entry for groups, only leaves. Never invent a path, and never include a variant/enum name in place of a real token path — if you can't find a matching path, omit that entry.
- `description` is a short internal rationale for the developer reviewing the import — not customer-facing copy.
- No `$value` is available in this step. Reason from paths and `$type` only.

---

## Examples

### Prop with no restriction evidence — emit nothing

Generated CDF shows:
```json
{"Card": {"$properties": {"bgColor": {"$type": "token", "$category": "design", "$token.kind": "color"}}}}
```

Token path index includes `colors.surface.default`, `colors.surface.raised`, `colors.brand.primary` (all `color`).

Component source shows `bgColor` interpolated generically with no comment or allowlist naming specific tokens.

```
bgColor has no restriction evidence in source — any color token remains valid, so no tool call
```

### Prop with an explicit restriction (comment or allowlist)

Component source:
```ts
interface ButtonProps {
  /** Accepts only the brand colour tokens: colors.brand.primary or colors.brand.secondary. */
  accentColor?: string;
}
const ACCENT_TOKENS = ['colors.brand.primary', 'colors.brand.secondary'] as const;
```

```
accentColor is restricted to two named tokens by the doc comment and the ACCENT_TOKENS allowlist
{"tool":"map_token_prop","component":"Button","prop":"accentColor","token_allowed":["colors.brand.primary","colors.brand.secondary"],"description":"Restricted per the accentColor doc comment and ACCENT_TOKENS allowlist in Button.tsx"}
```

### Prop with a token default only — emit nothing

Component source shows `bgColor = tokens.bgPrimary` as the parameter default, interpolated into `background: ${bgColor}`. `tokens.bgPrimary` resolves via the sidecar to `colors.bg.primary`.

```
bgColor defaults to colors.bg.primary but nothing restricts it to that token — a default is not an allowlist, so no tool call
```

Narrowing to `["colors.bg.primary"]` here would leave the marketer a picker with one entry. The default is already carried by `$default`; the allowlist stays open.

### Token prop with a union of variant names — looks misclassified, emit nothing

Generated CDF shows `Tag.variant` as `$type: "token"`, and the source has `variant: 'primary' | 'secondary'` resolved through a `Record<Variant, Token>`.

```
Tag.variant accepts variant names and resolves them itself — this is an enum, not a token; narrowing cannot fix the type, so no tool call. Flagging for reclassification.
```

### Prop that already arrived with `$token.allowed` — skip

Generated CDF shows:
```json
{"Badge": {"$properties": {"variant": {"$type": "token", "$category": "design", "$token.kind": "color", "$token.allowed": ["colors.status.success"]}}}}
```

This prop was already resolved from source evidence earlier in the pipeline. Emit no tool call for it — narrowing it further, or differently, would contradict proven evidence.

### No plausible candidates — skip

A `borderWidth` token prop where the token path index contains no dimension/border tokens at all: skip it. Emit no tool call, optionally a prose line explaining why.

---

## Edge cases

- **No token path index provided** — emit no tool calls; there is nothing to narrow against.
- **Prop already has `$token.allowed`** — always skip; never contradict a prior narrowing.
- **Ambiguous restriction (comment mentions "some" tokens but doesn't name them)** — treat as no evidence; emit nothing.
- **Only a default or `tokenReference` in evidence** — that is the prop's default, not a restriction; emit nothing.
- **Token prop whose type is a union of variant names** — a classification problem, not a narrowing one; emit nothing and flag it in prose.
- **Component source file missing or unreadable** — there is no source evidence to narrow from; skip the prop.
- **Prop not in the pipeline database** — skipped with a warning by the CLI; does not abort the run.

## Validation step — Pre-emit checklist

Before emitting any tool calls, verify:

1. Every `map_token_prop` call targets a prop that appears in the "Generated CDF so far" section and does **not** already carry `$token.allowed`.
2. Every path in `token_allowed` is a leaf path that exists verbatim in the token path index, and matches the prop's `$token.kind` — no group/prefix paths, no variant names.
3. `token_allowed` is never empty — if there's nothing to narrow to, no call is emitted for that prop.
4. No prior `$token.allowed` is contradicted, and every emitted list includes the prop's own default token when it has one.
5. No list was emitted on the strength of a default or `tokenReference` alone, and none targets a prop whose type is a union of variant names.

## CRITICAL: No hallucinated paths

Never emit a path in `token_allowed` that does not appear verbatim in the token path index. This includes group/prefix paths (e.g. `colors.brand`, `colors.surface`) — the index only ever contains leaf tokens, so a group name will never match and will be silently dropped downstream with a warning. It also includes variant or enum names (e.g. `"primary"`) that are not themselves token paths. An invented, group-level, or variant-name path is worse than no suggestion at all — it also signals the mapping cannot be trusted. When in doubt, omit rather than guess.
