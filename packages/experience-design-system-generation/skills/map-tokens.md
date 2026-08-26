# Map Tokens — Token Set & Restriction Suggestion Skill

## Purpose

For every design-category, token-typed prop already present in the generated CDF, suggest which of that prop's own `$values` (its closed list of variant names) actually resolve to a real design token (`token_sets`) and, when there is concrete evidence, the further-restricted subset a marketer may actually choose from (`token_allowed`). Output one JSON tool call per line to stdout. The CLI reads your stdout and writes each decision directly to the pipeline database — you do not write any files.

This is a narrow, focused step. It does not re-classify props, re-derive categories, or touch anything that isn't already a design-category `token` prop.

---

## Prerequisites — Input

All input is embedded inline in the prompt before this file:

- **Generated CDF so far** — design-category, token-typed props only, grouped by component. Every prop shown here already has `$type: "token"` and `$category: "design"`, and (when the component was classified with a closed set of named variants) a `$values` array — the closed list of variant names you are choosing a subset of. You do not need to re-verify `$type`/`$category`.
- **Token path index** — a flat array of `{ "path": "<dot.notation.path>", "type": "<DTCG $type>" }` covering every leaf token in the library. **No `$value` is included.** This is evidence, not vocabulary: use it (together with the component source and any resolution map found there) to decide *which* of a prop's `$values` entries are actually backed by a real token — never as a list to pull output values from.
- **Component source references** — the real file text for each component (bounded/truncated), rendered inline as a fenced code block, so you can look for `tokenName` usage, a variant→token resolution map (e.g. an object literal in a co-located `.styles.ts`/`utils.ts` mapping `"primary"` → a token path), union/enum-shaped prop types, default values, or comments that indicate a restriction. **You have no filesystem access and no tools — `sourcePath` is a citation label only, never something to open.** When a component's source couldn't be read (moved/deleted since extraction), it's listed separately by path with no code block; for those, infer `token_sets` from the prop name, `$token.kind`, and `$values` alone, and never emit `token_allowed` for them.

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

If no token path index is provided, there is no evidence to check `$values` entries against — omit `token_sets` entirely for every prop and say so in a prose line. Do not guess which values are token-backed.

---

## Target schema

Your suggestions become two additive, optional CDF fields on a design-category token prop:

- `$token.sets` — `string[]`, a **subset of that prop's own `$values`**. Each entry is a variant name copied verbatim from `$values` that you've confirmed resolves to a real design token (via a `tokenName`/resolution-map hit, or by matching the prop's likely semantic group in the token path index). Never a DTCG token path — the token path index is where you look *up* evidence, not where you copy output values *from*.
- `$token.allowed` — `string[]`, a subset of `$token.sets`. When present and non-empty, it is the further-restricted list a marketer may pick from (e.g. this specific component instance only exposes two of the three token-backed variants). An empty array is a deliberate claim that everything in `$token.sets` is allowed. When the field is absent entirely, no restriction assessment was made.

Both fields are CDF-only in this step — nothing here writes to the Contentful Experience Orchestration API.

---

## Mapping guidance — Decision tree

For each design-category, token-typed prop shown in the "Generated CDF so far" section:

1. **Read the prop's `$values`.** This is the closed list of variant names you are choosing a subset of. If `$values` is absent or empty, skip the prop entirely — there is nothing to restrict.
2. **Look for a `tokenName` or a resolution map** in the component source (a CSS custom property, a design-token reference near the prop's usage, or an object literal like `avatarColorMap` in a co-located sibling file mapping variant names to token paths). If found, resolve each of the prop's `$values` entries through it and treat a hit as high-confidence evidence that value belongs in `token_sets`. Never contradict an existing `tokenName`/resolution-map entry.
3. **Determine `token_sets`.** For each entry in `$values`, decide whether it resolves to a real token — via the resolution map from step 2, or by matching the prop's likely semantic group (inferred from the prop name and `$token.kind`) against the token path index. Include in `token_sets` only the `$values` entries you've confirmed are token-backed; every entry must exist verbatim in `$values`. Never invent a name not already in `$values`, and never emit a DTCG path in place of a variant name.
4. **Look for restriction evidence** in the component source beyond the prop's own type shape — a default value that resolves to a specific token, an explicit comment calling out which variants are valid in this component, or a resolution map that only covers a subset of `$values`.

   If you find such evidence, emit `token_allowed` as the evidenced subset of `token_sets`.
5. **No restriction evidence?** Omit `token_allowed` entirely. Do not emit an empty array as a placeholder — an empty array means you positively verified there is no restriction, not that you didn't look.
6. **No token document supplied for this run** (the token path index is empty or absent)? Omit `token_sets` entirely and explain why in a prose line — do not guess which of the prop's `$values` might be token-backed. This mirrors how `token_kind` is already handled during classification when no token data is available.
7. **None of the prop's `$values` resolve to a real token?** Skip the prop — do not emit a call with an empty `token_sets`.

---

## Output protocol

Emit one JSON object per line. The CLI parses lines starting with `{`. Lines not starting with `{` are treated as prose and ignored by the parser — use them freely for reasoning.

**One tool call:**

```
{"tool":"map_token_prop","component":"<ComponentName>","prop":"<propName>","token_sets":["primary","secondary","tertiary"],"token_allowed":["primary","secondary"],"description":"<reason>"}
```

**Rules:**

- Emit exactly one JSON object per line. No multi-line JSON.
- Only emit a call for a prop that appears in the "Generated CDF so far" section.
- Every value in `token_sets` and `token_allowed` must exist verbatim in that prop's own `$values` array. Never emit a DTCG path — the token path index is evidence for *which* values are token-backed, not a source of output values. Never invent a value — if you can't confirm one of the prop's `$values` entries resolves to a token, omit it rather than guessing.
- `token_allowed` must be a subset of `token_sets`.
- `token_allowed` is optional — omit it when there is no restriction evidence.
- An empty `token_allowed` array is valid and means "evidenced as unrestricted" — only emit it deliberately.
- `description` is a short internal rationale for the developer reviewing the import — not customer-facing copy.
- No `$value` is available in this step. Reason from the prop's own `$values`, the token path index's paths and `$type`s, and the component source only.

---

## Examples

### Prop with a clear resolution map, no restriction evidence

Generated CDF shows:
```json
{"Avatar": {"$properties": {"colorVariant": {"$type": "token", "$category": "design", "$token.kind": "color", "$values": ["primary", "secondary", "tertiary"]}}}}
```

A sibling file `utils.ts` defines:
```ts
export const avatarColorMap = {
  primary: 'colors.brand.primary',
  secondary: 'colors.brand.secondary',
  tertiary: 'colors.brand.tertiary',
};
```

Token path index includes `colors.brand.primary`, `colors.brand.secondary`, `colors.brand.tertiary`.

```
colorVariant's three $values all resolve via avatarColorMap to leaf tokens present in the token path index — all three are token-backed; no evidence narrows which the marketer can actually pick
{"tool":"map_token_prop","component":"Avatar","prop":"colorVariant","token_sets":["primary","secondary","tertiary"],"description":"Color variant resolved via avatarColorMap in utils.ts"}
```

### Prop with restriction evidence (default value)

Same `Avatar.colorVariant` as above, but the component source shows:
```ts
interface AvatarProps {
  colorVariant?: 'primary' | 'secondary' | 'tertiary'; // default 'primary' — 'tertiary' reserved for internal use, not exposed in this instance
}
```

```
All three values are token-backed per avatarColorMap, but the comment restricts marketer choice to primary/secondary
{"tool":"map_token_prop","component":"Avatar","prop":"colorVariant","token_sets":["primary","secondary","tertiary"],"token_allowed":["primary","secondary"],"description":"tertiary reserved for internal use per component source comment"}
```

### No token document supplied — degrade, don't guess

Generated CDF shows a design-category token prop with `$values`, but no "Token path index" section is present in this prompt at all.

```
No token path index was supplied this run — omitting token_sets for colorVariant rather than guessing which values are token-backed
```

(No tool call emitted for this prop.)

### None of the values resolve to a token — skip

A `borderStyle` token prop with `$values: ["solid", "dashed"]`, where the token path index contains no border-style tokens at all and no resolution map is found in the source: skip it. Emit no tool call, optionally a prose line explaining why.

---

## Edge cases

- **No token path index / token document provided** — omit `token_sets` entirely for every prop, with a prose line explaining why; there is no evidence to check `$values` against.
- **Prop already has `token_allowed` from a `tokenName`/resolution-map exact match** — still emit `token_sets` alongside it; don't emit `token_allowed` without `token_sets`.
- **Ambiguous restriction (comment mentions "some" variants but doesn't name them)** — treat as no evidence; omit `token_allowed`.
- **Component source file missing or unreadable** — fall back to inferring `token_sets` from the prop name, `$token.kind`, and `$values` alone; never emit `token_allowed` without source evidence.
- **None of a prop's `$values` resolve to a real token** — skip the prop entirely; do not emit a call with an empty `token_sets`.
- **Prop not in the pipeline database** — skipped with a warning by the CLI; does not abort the run.

## Validation step — Pre-emit checklist

Before emitting any tool calls, verify:

1. Every `map_token_prop` call targets a prop that appears in the "Generated CDF so far" section.
2. Every value in `token_sets` and `token_allowed` exists verbatim in that prop's own `$values` array — never a DTCG path, never invented.
3. `token_allowed`, when present, is a subset of `token_sets`.
4. No call has an empty `token_sets`.
5. `token_allowed` is omitted (not an empty array) unless you positively verified there is no restriction.
6. No existing `tokenName` or resolution-map entry is contradicted.
7. `token_sets` is omitted entirely — with a prose explanation — when no token document was supplied for this run.

## CRITICAL: No hallucinated values

Never emit a value in `token_sets` or `token_allowed` that does not appear verbatim in the target prop's own `$values` array. `$values` is a closed list — you are choosing a subset of it, never inventing a new name and never substituting a DTCG path for a variant name. An invented or out-of-vocabulary value is worse than no suggestion at all — it also signals the mapping cannot be trusted. When in doubt, omit rather than guess.
