# Map Tokens — Token Restriction Narrowing Skill

## Purpose

For every design-category, token-typed prop already present in the generated CDF, decide whether there is concrete evidence to narrow it to a restricted subset (`$token.allowed`). Output one JSON tool call per line to stdout — the CLI reads it and writes each decision directly to the pipeline database. You do not write any files.

This is a narrowing fallback, not a classification step: it does not re-classify props or touch anything that isn't already a design-category `token` prop. It also does not name a candidate universe — the universe is implicit, every token in the library whose type matches the prop's `$token.kind`. Your only job is to decide, from source evidence, whether that universe should be narrowed further.

Default-path resolution is deterministic and happens in the CLI before this skill runs. A resolved `$default` is not model input for a mapping decision and never asks you to emit a mapping — a default alone does not restrict the allowed list.

---

## Input

All input is embedded inline in the prompt before this file:

- **Generated CDF so far** — design-category, token-typed props only, grouped by component. Every prop shown here already has `$type: "token"` and `$category: "design"`; you do not need to re-verify either.
- **Token path index** — one or more sections, each a flat list of `path · type` lines (one leaf token per line, `$value` omitted). Every section is pre-scoped: a section titled with a `$token.kind` contains every leaf token of that type and no others; a prop with that `$token.kind` draws its candidates only from the matching section. The "full tree" section — present only when at least one prop has no `$token.kind` — lists every leaf token, unscoped. Never mix candidates across sections.
- **Component source references** — the real file text for each component (bounded/truncated), rendered inline as a fenced code block, so you can look for an explicit restriction: a comment naming the valid tokens, or code that validates the prop against a fixed list of token paths. Content from files the component's own file imports (siblings) is inlined the same way, one hop deep — token-resolution logic often lives one file away from the component itself. When more sibling files were found than could be inlined, or a property has a use that fell outside the excerpt shown, the prompt says so explicitly; treat that as unknown evidence, not absence. **You have no filesystem access and no tools — a citation path is a label only, never something to open.** When a component's source couldn't be read (moved/deleted since extraction), there is no source evidence to narrow from — skip the prop.

If no token path index is provided, there is nothing to narrow against — do not emit any tool calls.

---

## Decision tree

For each design-category, token-typed prop shown in the "Generated CDF so far" section:

1. **Prop type is a union of variant names** (e.g. `'primary' | 'secondary'`)? That prop should not be a `token` at all — the component receives a name and resolves it, which is the `enum` case in the classification step. Do not narrow it; narrowing cannot repair a wrong type. Emit nothing, and note in a prose line that it looks misclassified.
2. **A default value or `tokenReference` is the prop's default, not a restriction.** `padding = tokens.spacingM` or a structured `tokenReference` tells you which token the prop *starts* on — it does not say the author may choose no other. Narrowing to that single path would leave the marketer one option, which is worse than no list. On its own, this evidence yields no tool call. If you narrow on other grounds (step 3), the default's path must be in the list.
3. **Look for an explicit restriction** in the component source or its siblings: a comment naming the valid tokens, or code that validates/maps the prop against a fixed list of token paths (an allowlist array, a `satisfies` over specific token keys). If found, emit `$token.allowed` as the evidenced subset, scoped to tokens of the prop's `$token.kind`.
4. **No explicit restriction?** Emit nothing. Omitting the list means "any token of this kind," which is correct and live — a guessed list is worse than none because it freezes the author's choices.
5. **No plausible candidates at all** (no index entries of the prop's `$token.kind`)? Skip the prop.

---

## Output protocol

Emit one JSON object per line. The CLI parses lines starting with `{`; anything else is prose, ignored by the parser — use it freely for reasoning.

```
{"tool":"map_token_prop","component":"<ComponentName>","prop":"<propName>","token_allowed":["colors.brand.primary","colors.brand.secondary"]}
```

Rules:

- Emit exactly one JSON object per line. No multi-line JSON.
- Only emit a call for a prop that appears in the "Generated CDF so far" section.
- `token_allowed` is required and must be non-empty. If there's nothing to narrow to, emit no call at all.
- Every path in `token_allowed` must be an individual **leaf** path that exists verbatim in the token path index section matching the prop's `$token.kind` (or the "full tree" section, for a prop with no `$token.kind`). Never emit a group/prefix path (e.g. `colors.brand`) — the index has no entry for groups, only leaves. Never invent a path, and never substitute a variant/enum name for a real token path; if you can't find a matching path, omit that entry.
- No `$value` is provided in this step — reason from paths and `$type` only.

---

## Examples

### Explicit restriction — narrow

```ts
interface ButtonProps {
  /** Accepts only the brand colour tokens: colors.brand.primary or colors.brand.secondary. */
  accentColor?: string;
}
const ACCENT_TOKENS = ['colors.brand.primary', 'colors.brand.secondary'] as const;
```

```
accentColor is restricted to two named tokens by the doc comment and the ACCENT_TOKENS allowlist
{"tool":"map_token_prop","component":"Button","prop":"accentColor","token_allowed":["colors.brand.primary","colors.brand.secondary"]}
```

### No restriction evidence — emit nothing

`bgColor` is interpolated generically, with no comment or allowlist naming specific tokens, and no default. Any color token remains valid:

```
bgColor has no restriction evidence in source — any color token remains valid, so no tool call
```

---

## Checklist

Before emitting any tool calls, verify:

1. Every `map_token_prop` call targets a prop that appears in the "Generated CDF so far" section.
2. Every path in `token_allowed` is a leaf path that exists verbatim in the token path index, and matches the prop's `$token.kind` — no group/prefix paths, no variant names, nothing invented.
3. `token_allowed` is never empty.
4. Every emitted list includes the prop's own default token when it has one.
5. No list was emitted on the strength of a default alone, and none targets a prop whose type is a union of variant names.
