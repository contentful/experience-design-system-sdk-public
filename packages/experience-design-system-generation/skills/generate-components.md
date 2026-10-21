# Generate Components — Classification Skill

## Purpose

Classify every prop and slot in the component definition provided inline for use in **Contentful Experience Orchestration**. Output one JSON tool call per line to stdout. The CLI reads your stdout and writes each decision directly to the pipeline database — you do not write any files.

---

## What is Contentful Experience Orchestration?

Contentful Experience Orchestration is a Contentful product that enables **marketers** to manage both the content and visual presentation of digital experiences — web pages, multi-channel — entirely within Contentful. The entity being defined here is a **Component Type**: the schema that tells Contentful what a marketer can configure for this UI component.

A Component Type has two kinds of configurable properties:

- **Design Properties** — values that control _how the component looks_: color scheme, visual variant (primary/secondary/ghost), size (sm/md/lg), spacing, layout orientation, background color, font style, border style, any visual toggle that changes appearance. These are the values a designer sets once and a marketer may override. Think: "what would a designer put in a design token or a style guide?"
- **Content Properties** — values that are _data the component displays_: labels, headings, body text, rich text, images, media, URLs, counts, IDs used for CMS lookups, locales. These are filled by editors with real CMS content. Think: "what does a copywriter or content editor fill in?"

The third category:

- **State Properties** — values that control _interactive or behavioral state_: disabled, loading, expanded, isOpen, isSearchVisible. These are runtime behavioral flags, not visual design nor content.

Getting this right matters: Contentful uses the category to decide where a property appears in the editor UI. Design properties appear in the design panel, content properties appear in the content panel.

---

## Prerequisites — Input

All input is embedded inline in the prompt before this file:

- **Raw component data** — `RawComponentDefinition[]` (one component for this run)
- **DTCG token data** — full token tree, if provided
- **Token-name sidecar** — raw CSS custom property name → DTCG dot-notation path, if provided
- **Component source references** — the real file text for the component's own source, plus up to 5 sibling files (e.g. a co-located `.styles.ts` or `utils.ts`, or a file reached transitively through another sibling — such as a re-exported component's own styles module), if provided. **`sourcePath` is a citation label only, never something to open. Read-only access is limited to supplied invocation artifacts and the exact supplied representation validator command when present; do not read or execute the live repository/source.**
- A **"uses not shown"** line may accompany these files. The files are bounded excerpts, and this line names the properties with at least one use outside the excerpt budget. Treat those uses as unknown: do not conclude the property is unread or that the shown alternatives are exhaustive.

```typescript
interface RawPropDefinition {
  name: string;
  type: string; // raw TypeScript type, e.g. "'primary' | 'secondary'"
  required: boolean;
  category?: 'content' | 'design' | 'state'; // pre-classified — verify, do not blindly trust
  allowedValues?: string[];
  defaultValue?: string;
  description?: string;
  tokenReference?: string; // raw token name — shape varies by design system, e.g. "--brand-primary" (CSS custom property) or "tokens.blue500" (flat/dotted JS reference)
}

interface RawSlotDefinition {
  name: string;
  description?: string;
  allowedComponents?: string[];
}

interface RawComponentDefinition {
  name: string;
  source: string;
  props: RawPropDefinition[];
  slots: RawSlotDefinition[];
}
```

The `category` field and deterministic prop buckets are advisory hints. Verify each classification against the declared contract and supplied source evidence. Property names and general domain knowledge are cues for investigation, not proof of a category, value domain, requiredness, or binding behavior. Account for the complete retained inventory; preserve uncertain properties and explain unresolved evidence in `reason`.

## Source evidence and uncertainty

- The declared type and contract govern available alternatives and open domains. Copy a finite declared literal union as declared; a union that includes `string` or `number` remains open and must not be narrowed to only its literal members.
- A closed enum requires evidence of the complete allowed set, such as a closed declared union, an explicit `allowedValues` contract, or source that establishes an exhaustive finite set. A default, one caller, one observed value, a prop name, a partial lookup table, or an existing model is an example or alignment clue; none alone proves the complete set.
- Preserve the input's declared prop `required` value. Change it only when explicit source evidence establishes the contract. Typical caller presence, a default, empty-render guesses, or model overlap do not establish requiredness.
- Preserve valid defaults exactly, including `false`, `0`, and the empty string. Do not treat a default as the only permitted value.
- Source refs and observations are bounded. Missing imports, callers, excerpts, or source files leave those facts unknown; they do not establish that a prop is unused, a component is non-rendering, alternatives are absent, or capture is complete.
- Keep uncertain properties in the output when evidence is incomplete. State what is unknown in `reason` instead of dropping the property or inventing a domain, requirement, token restriction, or source fact.
- Existing model summaries are optional alignment context. They may identify a possible match, but source evidence controls the current component's prop names, alternatives, defaults, and requiredness.

---

## Target schema

The CLI assembles your output into CDF (Component Definition Format), a JSON schema with `$schema: "https://contentful.com/schemas/cdf"`. Each component you classify produces a CDF component entry (`$type: "component"`) in the pipeline database. Properties carry `$category` (`content`, `design`, or `state`) and a `$type`. You do not produce this JSON directly — emit tool calls and the CLI writes the DB columns.

## Output protocol

Emit one JSON object per line. The CLI parses lines starting with `{`. Lines not starting with `{` are treated as prose and ignored by the parser — use them freely for reasoning.

**Four tool calls:**

```
{"tool":"classify_component","description":"<required: one-sentence description of the component>","rationale":{"description":"<why this component is classified this way>","props":"<why these props were chosen / excluded>","slots":"<why these slots were chosen / excluded>"}}

{"tool":"classify_prop","prop":"<propName>","cdf_type":"<type>","cdf_category":"<category>","required":<bool>,"description":"<short customer-facing description>","reason":"<full internal rationale; not customer-facing>","values":["a","b"],"token_kind":"color","default":"<value>"}

{"tool":"exclude_prop","prop":"<propName>","reason":"<why excluded>"}

{"tool":"classify_slot","slot":"<slotName>","required":<bool>,"allowed_components":["ComponentName"],"description":"<short customer-facing description>","rationale":"<why this slot was kept / its role>"}
```

**Rules:**

- Emit exactly one JSON object per line. No multi-line JSON.
- Root array and record definitions carry complete recursive `items` / `fields` metadata using CDF `$type`, `$required`, `$description`, `$values`, `$items` and `$fields`; preserve exact own keys and true/false requiredness at every node.
- Defaults are typed JSON values; omit them when unknown, use `default_intent: {"action":"clear"}` to clear a decision, and never execute source expressions or narrow a declared domain from observed/default values.
- Source graphs and defaults remain independent of advisory shape/category/representation; unsupported deeper or cyclic positions retain source evidence and require an explicit plan with unknown mapper/cardinality context.
- Proposal stdout is staged typed drafts only; caller readiness and activation are separate.
- Every property in the host-owned required decision inventory must produce exactly one call: `classify_prop` OR `exclude_prop`, including inputs absent from advisory props.
- Every `classify_prop` requires `cdf_category`: `content`, `design` or `state`, including when `cdf_type` is omitted for unresolved representation.
- Every slot must produce exactly one `classify_slot` call.
- Emit `classify_component` once at the start (required). The `description` field is **required** — always provide a brief description of the component's purpose.
- `values` is optional for `cdf_type: "string"` — it must be a non-empty string array for a source-supported closed set of variant names. A default, one caller, or a partial lookup map does not establish the complete set. When no closed set is shown, emit `cdf_type: "string"` without `values`; do not guess.
- **Do NOT include `values` for `cdf_type: "token"`.** The two property types carry different kinds of list. A string domain's list holds _variant names_ the component accepts (`"primary"`, `"secondary"`). A `token` prop's list holds _design token paths_ (`"color.brand.primary"`), produced by the separate token-mapping step (`$token.allowed`) — never by you. Emitting `values` on a token prop makes the definition invalid.
- `token_kind` is required for `cdf_type: "token"` — must be a DTCG `$type` string, e.g. `"color"`.
- `required` must be a JSON boolean (`true`/`false`), not a string. Preserve the input contract's requiredness unless explicit source evidence establishes a different contract.
- `description` on `classify_prop` is customer-facing — keep it short and subject to the description content rules below.
- `reason` on `classify_prop` is **required** and is your internal rationale — shown to the developer reviewing the import, never to end-users. Use it to explain your reasoning in detail. The customer-facing description content rules below apply to `description` only, not to `reason`.
- `rationale` on `classify_component` is **REQUIRED**. It is an object with three REQUIRED string sub-fields:
  - `rationale.description` — why this component is classified the way it is (its purpose, where it fits in the design system, atom/molecule/organism reasoning). **Subject to the same "Description content rules" as the `description` field — no internal initiative names, no `INTEG-*`, no `EDSI`/`DSI`/`M1`/`M2`/wave/phase references.**
  - `rationale.props` — operator-facing explanation of which props you accepted vs excluded and why. Audience is the developer reviewing the import (not the customer), so you may discuss types, framework internals, and category corrections in technical terms. Do not include internal initiative names.
  - `rationale.slots` — operator-facing explanation of which slots you kept vs collapsed and why. Same audience and rules as `rationale.props`.
  - All three sub-fields are required strings, minimum one sentence each. Never emit an empty string. If the component has zero slots, `rationale.slots` should state that explicitly (e.g. `"No slots — the component renders no injectable regions."`).
- `rationale` on `classify_slot` is **REQUIRED**. It is a single string explaining why this slot exists and what role it plays in the component (operator-facing; minimum one sentence). Same audience and rules as `rationale.props` / `rationale.slots` above.

**Description content rules (CRITICAL — applies to every `description` field on `classify_component`, `classify_prop`, and `classify_slot`, AND to `rationale.description` on `classify_component`):**

- Write **customer-facing technical descriptions**. The audience is a third-party developer or content editor configuring this component in Contentful — not a Contentful engineer.
- **Never** reference internal Contentful initiatives, project code names, sprint or roadmap labels, product development phases, or implementation milestones. This includes (non-exhaustive) terms like `P1`, `P2`, `P3`, `M1`, `M2`, `EXT-*`, `INTEG-*`, `DSI`, `EDSI`, `CDF compliance`, `wave 1`, `wave 2`, `phase 1`, `phase 2`, "for compliance with…", "to support the … initiative", or any internal-sounding rationale.
- Do not invent rationale. If you do not know **why** a prop exists, describe **what** it does (its observable effect on the component) — never guess at organizational context.
- Descriptions should explain WHAT the prop/component does in terms a developer reading the public component catalog would understand. Stick to behavior, appearance, and configuration semantics.

---

## Valid cdf_type values

Valid local CDF types:

| cdf_type               | Use case                                                |
| ---------------------- | ------------------------------------------------------- |
| `string`               | Plain text and string-shaped source values              |
| `richtext`             | Formatted text, HTML, ReactNode used as markup          |
| `media`                | Images, videos, media assets                            |
| `string` with `values` | Fixed declared set of string choices                    |
| `token`                | Design-token-linked prop — requires `token_kind`        |
| `boolean`              | Boolean toggle props (visible, disabled, enabled, etc.) |

> Native `number`, `array` and `record` definitions preserve typed values and complete recursive metadata locally; this vocabulary does not prove remote mapper capability.

> **Avoid `link` type for simple URL props.** Props named `href`, `url`, or holding plain URL strings → `cdf_type: "string"`, `cdf_category: "content"`. Reserve `link` for props that hold a reference to another Contentful entry.

---

### Source domains and token values

Use string with declared values only for a complete finite declared or enforced domain; partial lookups, observations, defaults and existing models cannot prove completeness.
A domain with an open alternative remains open even when its known values are also design token names.
Use `token` only when the source contract consumes a resolved design token value; a lookup vocabulary consumes names and is not itself a token value.
Preserve all source-supported alternatives and explain unrepresented alternatives for review; do not invent a narrower type to resolve uncertainty.
For DTCG tokens, look up `$type` and `$token.kind` from supplied token data or the token-name sidecar.
Do not include `values` when `cdf_type` is `token`; `$token.allowed` is handled by the separate mapping stage.

## Valid cdf_category values

| cdf_category | Use case                                                                                                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content`    | Data the component _displays_ — what a copywriter or editor fills in: text, labels, headings, body copy, rich text, images, media, URLs, link targets, counts, locale                                                                          |
| `design`     | Values that control _how the component looks_ — what a designer sets: color, size (sm/md/lg), variant (primary/secondary/ghost), layout orientation, alignment, background, visual toggles (imageOnLeft, enableEffect), design tokens          |
| `state`      | Runtime behavioral or interactive flags — not visible in the editor's design or content panel: disabled, loading, expanded, isOpen, isSearchVisible, preview, identifiers used for analytics/tracking (componentId, sectionKey, componentName) |

The pre-classified `category` in the raw input is a starting point — correct it when it is wrong. Contentful uses this category to decide where the property appears in the editor UI, so accuracy matters.

---

## Mapping guidance — source semantics

Classify each input from its declared contract and actual consumption, with the supplied renderer reference as context.
Names, frameworks, known component patterns, inherited shapes and category labels do not establish authorability or exhaustive domains.
Choose `content`, `design` or `state` from the evidenced responsibility of the input; keep unsupported reasoning explicit.
Exclude an input only when its source purpose establishes why it cannot be represented by the target contract.
A ref, event handler or style-shaped input still needs its own source reasoning; do not exclude it from its spelling alone.
Keep structured/complex alternatives and source defaults in the evidence record when the target format cannot represent them; preserve that capability limit for review.
Never manufacture requiredness from callers, typical usage or model agreement.

## Handling structured source properties

- Emit one definition for the original source property, retaining exact field keys in `fields` and array item metadata in `items`.
- Root Array, root Record and direct Array<Record> may use the supported local native profile; retain every declared field and nested/item requiredness.
- Full source graph/type/census/default/domain evidence is authoritative; advisory shape is optional and cannot establish completeness.
- Preserve deeper, open-indexed, tuple, union, cyclic, imported and unresolved source evidence with explicit coverage and outcomes; propose generic source-derived alternatives when native mapping is unavailable.
- Alternate definitions require source revision/node identity, complete field accounting and dependency closure, plus caller-owned mapper/cardinality/readiness context; no draft can authorize activation.

## Resolving `token_kind`

`token_kind` becomes `$token.kind` in the CDF output — the DTCG `$type` of the token the prop binds to. For a prop that earned `cdf_type: "token"` (Q2 yes, Q3 yes), take the token name cited at Q3 (`tokens.borderRadiusSmall`, `var(--brand-primary)`, a raw `tokenReference`) and resolve it against the inline token data: through the token-name sidecar (raw name → DTCG dot-notation path) when one is provided, otherwise by matching the name to the DTCG tree by spelling (`tokens.borderRadiusSmall` → `border-radius.border-radius-small`); the leaf's `$type` (`"dimension"`) is the `token_kind`. If the name cannot be resolved to a leaf, keep `cdf_type: "token"`, omit `token_kind`, and say so in `description` (`"WARNING: token_kind unknown — <name> not found in token data"`).

**Canonical example — a named variant backed by tokens is still a string domain:**

```
Tag.variant has allowedValues ["primary","secondary","warning","negative"] and PillNext.styles.ts
maps each one to a token (primary→tokens.blue100, warning→tokens.orange100, ...). The mapping is
internal to the design system — Tag's prop signature accepts the name, not the token. Classifying
as string with declared values so the author picks "primary" and the component receives "primary".
{"tool":"classify_prop","prop":"variant","cdf_type":"string","cdf_category":"design","required":false,"values":["primary","secondary","warning","negative"],"default":"primary","description":"Visual variant","reason":"Fully token-backed internally, but the component consumes the variant name. Token classification would deliver a resolved color the component cannot branch on."}
```

---

## Slot classification

`classify_slot` maps to `$slots`; `allowed_components` maps to `$allowedComponents`.
Preserve the exact original source input name, including render-function names; do not rename an input from observed markup or a familiar pattern.
Accepted slot decisions are authoritative: false/unresolved suppress export, open removes restrictions, and finite accepts only independently supported declared/enforced restrictions.
Known names are an address allowlist, not a complete source domain, and observed children do not close an open slot.
Preserve declared requiredness, including `false`; omit requiredness when its source contract is unknown.
Detail/category resolutions are recorded for review and never applied as automatic generation facts.

## Examples

A declared input `renderRegion` accepting arbitrary renderable values stays named `renderRegion` with an open slot domain even if one caller passes a single known component.
A declared `string` alternative alongside literal alternatives stays open; a falsy default such as `false`, `0` or an empty string is preserved as declared.

## Edge cases

- **Unresolved representation** → retain the input with a reasoned `classify_prop` that omits `cdf_type`; exclude only when its semantics justify exclusion.
- **Component with zero classified props after exclusions** → still emit `classify_component`. The DB entry will have an empty `$properties` object.
- **Unknown slot** → explicit protocol failure; use only retained source slots.
- **Unknown property** → explicit protocol failure; preserve exact inventory names.

## Validation step — Pre-emit checklist

Before emitting any tool calls, verify:

1. Every prop in the input has exactly one `classify_prop` or `exclude_prop` call, using the host-owned required decision inventory rather than the advisory prop list.
2. Every slot has exactly one `classify_slot` call.
3. `classify_component` is emitted exactly once with non-empty `rationale.description`, `rationale.props` and `rationale.slots`.
4. Every finite enum has the complete source-supported alternatives; Missing evidence does not close a domain.
5. Every token-typed property has a source-supported token kind and no `values`.
6. `required` is a source-supported JSON boolean; omitted requiredness remains unknown.
7. Use current supported output types and typed numeric values; do not coerce numbers into strings or infer a ResourceLink contract.
8. Every slot uses its original source name and authoritative accepted state; unknown restrictions are unset.
9. Every `classify_slot` has a non-empty rationale; descriptions follow Description content rules.
10. Input names, structural shapes, framework labels and observed children do not substitute for source reasoning.

Before finishing, review the component output against this checklist and iterate on any warning the supplied evidence can resolve. Preserve unresolved warnings in the relevant `description` or `reason`; do not invent values.

## Complete source decisions

Use the independent source inventory, including retained inputs absent from advisory props, to account for every subject exactly once.
Emit exactly one component decision even when there are no properties; accepted source-owned slots account for their original inputs without a conflicting property decision. Such owned inputs are already omitted from the required property inventory. Matching property and slot names alone do not establish ownership; any property still listed requires its own decision.
For an input whose semantics are retained but whose representation is unresolved, emit `classify_prop` with its exact `prop`, the required `cdf_category` (`content`, `design` or `state`), a non-empty `reason`, and no `cdf_type` or representation companions.
Without `cdf_type`, omit `required`, `values`, `token_kind`, `default`, `default_intent`, `items` and `fields`; source requiredness and defaults remain in the independent evidence.
For example, an unresolved content input may emit `{"tool":"classify_prop","prop":"body","cdf_category":"content","reason":"Display content is retained; its representation is unresolved."}`; choose the category from source semantics rather than copying this example's category.
This is an accounted held decision requiring review; do not invent String or another native type.
Use reasoned `exclude_prop` only for an explicit semantic exclusion.
Defaults remain typed JSON with independent original source evidence; absent intent preserves a known source default, while generation must never set or clear a different known default.
When a correction is requested, emit decisions only for reported missing/rejected subjects and pending representations; preserve successful decisions, accepted exclusions/slots and the original source.
Pending semantic decisions retain the same property, category, description and source identity; repair only representation metadata and update the reason with concrete evidence or capability limits, without creating a duplicate or replacing the property with an exclusion.

## Host validation and bounded representation repair

The host validates drafts through the canonical source-bound materializer, CDF validation and projection rules; a complete inventory does not establish an admissible representation.
Per-property feedback reports missing representations, incompatible structure/domain, contradictions with declared/compiler facts, candidate alternatives and explicit capability requirements.
Inspect supplied source facts before choosing a representation; alternatives are drafts with unapproved mapper/cardinality requirements, and local native support does not prove deployed mapper support.
When the prompt supplies a read-only representation validator command, you may execute that exact command with current draft JSON tool-call lines on stdin and read its immutable evidence artifact; these permissions do not authorize reading or executing source paths or modifying files.
If tools are unavailable, use the host's correction feedback; host validation always remains authoritative.
The host keeps one operation deadline and at most two attempts, retaining successful decisions and requesting only missing subjects or pending representation repairs.
If repair cannot resolve a property, retain its semantic decision with no `cdf_type` or representation companions and explain the exact missing evidence or capability in `reason`; never force String, narrow an open source domain, drop a field or invent support to satisfy validation.

---

## Existing entities in the target space

The preamble may include an "Existing components in the target Contentful space" JSON block with a `likelyMatch` (a fuzzy-matched space component that may correspond to the codebase component), an `otherComponents` list, and a rolled-up token summary. Treat these as optional alignment context; the current component's declared contract and source evidence govern its classification.

### When `likelyMatch` is present — record possible alignment for review

Use the context to explain possible alignment during review. It does not establish the current source component's names, categories, slot shape, requiredness, or value domain.

1. **Prop names**: `classify_prop.prop` MUST always be the codebase prop name — that's the DB lookup key. When a codebase prop looks like it corresponds to an existing space prop (e.g. codebase `kind` ↔ space `variant`, codebase `text` ↔ space `label`), keep `prop` as the codebase name and put the alignment note in `reason`, e.g. `"looks like existing space prop 'variant' — customer may want to reconcile at review"`. Never rewrite `prop` itself; reconciliation happens downstream, not in this tool call.
2. **Categories**: classify from the current source evidence. If a likely equivalent space prop uses a different category, note the difference in `reason` for review; the space category does not override the current evidence.
3. **Slot names**: preserve names from the current component contract. Note a possible match to a space slot in `rationale` when supported.
4. **Enum values**: preserve the current component's source-supported domain. If it differs from the space's values, cite the difference in `reason` for review; do not bridge the mismatch with guessed values.
5. **Never realign silently.** Every classification influenced by the `likelyMatch` MUST cite it in `reason`.

### When only `otherComponents` is present (no direct match)

Use the list to constrain slot `allowed_components` — do not propose a slot that accepts component types the space doesn't have.

### Token binding

The preamble's "Existing design tokens" section lists tokens (by name + DTCG type) already in the space.

1. When classifying a `design`-category, `token`-typed prop, prefer binding to an existing token name over inventing a new one. Cite the target token in `reason`.
2. If no existing token semantically matches, proceed with the current rules — propose a new token. The diff surfaces this for review.

## Richer content representations

The desired CDF vocabulary additionally includes `Integer`, `DateTime`, `Literal`, `RichText`, `JSON` and `ResourceLink`; these are content representations. Local file validity does not establish deployed mapper support.

- `Integer` requires a complete, compiler-established integral source domain; names, a numeric default and observed callers do not prove it.
- `DateTime` requires a complete source domain of timezone-qualified ISO strings; preserve their spelling and do not convert Date objects or infer semantics from names.
- `Literal` requires an exact source singleton, `value` and recursive CDF `valueType` in the same call; a default is separate from its intrinsic value and must equal it. Singleton proof does not establish RichText or ResourceLink semantics for an underlying type.
- `RichText`, `JSON` and `ResourceLink` require `representation_proposal` in the same classification call. Copy the host-supplied `componentId`, `propertyId`, `key`, `sourceRevision` and source-node identities; use `name` equal to the exact source property. Supply independent `declaredConstraints`, `provenConstraints`, `observations`, `judgment`, `desiredType`, complete target `desiredDefinition`, and `compatibility` with `status`, `sourceUseRefs` and `unresolvedRequirements`. Readiness is host-owned and must not be included in the draft.
- A judged-compatible proposal must cite current positive output-flow references. A primitive string is not a RichText document; lowercase `richtext` retains its existing markup projection. JSON requires proven JSON-compatible semantics and an explicitly justified opaque contract, rather than a fallback for unknown or meaningful editable structure.
- ResourceLink restrictions use `Contentful:Entry` with `allowedTypes`, or `Contentful:Asset`, and the exact same-space source `crn:contentful:::content:spaces/$self/environments/$self`. Keep resource and delivery prerequisites explicit; neither a URL nor a matching name proves a resource identity.
- RichText and JSON cannot have target defaults; source defaults remain evidence. ResourceLink defaults require a verified delivery contract and remain held. Retain unresolved proposals and source facts instead of inventing proof.
- When no representation is established, omit `value`, `valueType`, `allowedResources` and `representation_proposal` as well as all other representation companions.
