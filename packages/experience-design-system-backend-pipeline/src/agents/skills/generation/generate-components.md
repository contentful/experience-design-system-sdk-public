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
- **Component source references** — the real file text for the component's own source, plus up to 5 sibling files (e.g. a co-located `.styles.ts` or `utils.ts`, or a file reached transitively through another sibling — such as a re-exported component's own styles module), if provided. **You have no filesystem access and no tools — `sourcePath` is a citation label only, never something to open.**
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

The `category` field and deterministic prop buckets are advisory hints. Verify each classification against the declared contract and supplied source evidence. Property names and general domain knowledge are cues for investigation, not proof of a category, value domain, requiredness, or binding behavior. Never produce zero output; preserve uncertain properties and explain unresolved evidence in `reason`.

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
- Every prop in the input must produce exactly one call: `classify_prop` OR `exclude_prop`.
- Every slot must produce exactly one `classify_slot` call.
- Emit `classify_component` once at the start (required). The `description` field is **required** — always provide a brief description of the component's purpose.
- `values` is required for `cdf_type: "enum"` — it must be a non-empty string array for a source-supported closed set of variant names. A default, one caller, or a partial lookup map does not establish the complete set. When no closed set is shown, emit `cdf_type: "string"` without `values`; do not guess.
- **Do NOT include `values` for `cdf_type: "token"`.** The two property types carry different kinds of list. An `enum` prop's list holds _variant names_ the component accepts (`"primary"`, `"secondary"`). A `token` prop's list holds _design token paths_ (`"color.brand.primary"`), produced by the separate token-mapping step (`$token.allowed`) — never by you. Emitting `values` on a token prop makes the definition invalid.
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

Exactly **6** valid types:

| cdf_type   | Use case                                                                   |
| ---------- | -------------------------------------------------------------------------- |
| `string`   | Plain text, URLs, href props, numbers (as string), any string-shaped value |
| `richtext` | Formatted text, HTML, ReactNode used as markup                             |
| `media`    | Images, videos, media assets                                               |
| `enum`     | Fixed set of string choices — requires `values`                            |
| `token`    | Design-token-linked prop — requires `token_kind`                           |
| `boolean`  | Boolean toggle props (visible, disabled, enabled, etc.)                    |

> **IMPORTANT: No `number` type.** The design-systems API only supports the `String` design property variant for numeric values. All numeric props must use `cdf_type: "string"` with the number as a string default (e.g. `"0"`, `"100"`). Boolean props can now use `cdf_type: "boolean"` directly.

> **Avoid `link` type for simple URL props.** Props named `href`, `url`, or holding plain URL strings → `cdf_type: "string"`, `cdf_category: "content"`. Reserve `link` for props that hold a reference to another Contentful entry.

---

### `enum` versus `token`

Both describe a closed set of choices, but the _contents_ differ, and that is the whole distinction:

|         | What the list holds                     | Example                                          |
| ------- | --------------------------------------- | ------------------------------------------------ |
| `enum`  | Variant names the component accepts     | `["primary", "secondary", "ghost"]`              |
| `token` | Design token paths the prop may bind to | `["color.brand.primary", "color.brand.neutral"]` |

The distinction is **what the component does with the value it receives**. That
is decidable from source; it is not inferred from the property's name, from the
component's role, or from the property's TypeScript type.

An `enum` design property is delivered as a plain string, so the component
receives `variant="primary"` — the value its own code branches on. A `token`
property is resolved to the token's value _before_ it reaches the component, so
that same component would receive `variant="#0059c8"` and match no branch.

#### The three-question procedure (closed, ordered)

For every design prop that carries a value (not a boolean), answer these three
questions **in this order**, from the source shown, and stop at the first answer
that decides. There is no fourth question.

- **Q1 — Does the component look the value up, switch on it, or compare it against names?**
  An indexed access (`tokens[fontColor]`, `SPACING[padding]`, a `Record<Variant, Token>`),
  a `switch (variant)` / `if (variant === 'x')` chain, a `styles[variant]` class lookup,
  or a closed declared vocabulary (`allowedValues`, a literal-only union) — these
  show that the component may need the _name_. A type that also permits `string`
  or `number`, or partial comparisons with an open fallback, remains open. A
  presence check (`if (width)`) or arithmetic on the value is not a lookup.
  **Yes → `enum`, names in `values`, stop.** No → Q2.
- **Q2 — Is the value written straight into a style or attribute?**
  `rx={radius}`, `padding: ${padding}`, `style={{ color }}`, `background: var(${bg})` —
  the value reaches the renderer without the component resolving it.
  **No → not `token`; leave this procedure and continue with the type rules.** Yes → Q3.
- **Q3 — Is there a design-token reference at that use?** Any one of:
  the parameter default is a token (`radius = tokens.borderRadiusSmall`), the raw prop
  carries a `tokenReference`, or an inline `tokens.*` / `var(--*)` sits in the same
  expression. The reference must belong to _this_ prop — a `tokens.*` on some other
  line of the file, or in a sibling's style object, is not one.
  **Yes → `token`, stop; resolve `token_kind` from that reference. No → `string`, stop.**

**The raw TypeScript type is not an input to Q1–Q3.** `string`, `number`,
`string | number`, `stringOrNumber` — none of these answers any question above;
they say what the compiler accepts, not what the component does with the value.
"The type accepts any value, the default just happens to be a token reference" is
a Q3-yes described as a no: a token parameter default _is_ the design-token
reference Q3 asks for, and the prop is `token`. Equally, a prop named `color` with
no lookup and no token reference is `string`, however token-like the name.

**Two worked examples — same shape, opposite answers:**

```tsx
// Divider.tsx
export const Divider = ({ thickness = tokens.borderWidthDefault, inset = 0 }: DividerProps) => (
  <hr style={{ borderTopWidth: thickness, marginLeft: inset }} />
);
```

- `thickness` — Q1: no lookup. Q2: yes, `borderTopWidth: thickness`. Q3: yes, the
  parameter default is `tokens.borderWidthDefault`. → **`token`**, `token_kind` from
  `borderWidthDefault` via the sidecar. Its `string | number` annotation changes nothing.
- `inset` — Q1: no lookup. Q2: yes, `marginLeft: inset`. Q3: no, the default is the
  bare number `0` and nothing at this use is a token. → **`string`**, `default: "0"`.

A lookup map from variant names to tokens shows name-based behavior, which answers
Q1. The map establishes a closed `enum` only when the declared contract or source
also establishes that its keys are exhaustive; otherwise keep the domain open.

**`token` is earned by Q2 and Q3 together, and only that way.** Cite both lines
in `reason`: the interpolation and the token reference. Once both are cited, the
prop is `token` — do not then downgrade it because of its type annotation, because
the default "could be overridden" (every default can), or because the tie-break
below exists. Nothing downstream re-derives, corrects, or second-guesses this —
what you emit is what ships.

**Ambiguous behavior does not make a domain closed.** The tie-break applies solely
when the source shown does not let you determine how the value is consumed: the
property is interpolated in one place and looked up in another, the use sits in a
file you cannot see, or the source is truncated at the point of use. Emit `enum`
only when a complete finite set is independently supported by the declared
contract or explicit exhaustive source; otherwise emit `string` and state the
uncertainty in `reason`. When the three
questions _can_ be answered from the source shown, they are answered and the
tie-break does not apply: a clear Q1-yes is `enum` when its domain is closed, a clear Q2-yes + Q3-yes is
`token`, and a type annotation does not create ambiguity. An `enum` is delivered
as the plain string the component was written to receive and remains reachable
from a content-type field; a wrong `token` delivers a resolved value the
component cannot branch on and is permanently excluded from content-type field
mapping. That asymmetric cost is why a genuine tie goes to `enum` — it is not a
reason to call a decided case a tie.

---

## Valid cdf_category values

| cdf_category | Use case                                                                                                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content`    | Data the component _displays_ — what a copywriter or editor fills in: text, labels, headings, body copy, rich text, images, media, URLs, link targets, counts, locale                                                                          |
| `design`     | Values that control _how the component looks_ — what a designer sets: color, size (sm/md/lg), variant (primary/secondary/ghost), layout orientation, alignment, background, visual toggles (imageOnLeft, enableEffect), design tokens          |
| `state`      | Runtime behavioral or interactive flags — not visible in the editor's design or content panel: disabled, loading, expanded, isOpen, isSearchVisible, preview, identifiers used for analytics/tracking (componentId, sectionKey, componentName) |

The pre-classified `category` in the raw input is a starting point — correct it when it is wrong. Contentful uses this category to decide where the property appears in the editor UI, so accuracy matters.

---

## Mapping guidance — Classification decision tree

For each `RawPropDefinition`, apply in order:

1. **Framework / DOM / accessibility pass-through?** → `exclude_prop`. These are escape hatches for developers, not configurable surfaces for marketers. Exposing them in the ExO editor adds noise that obscures the props that actually carry intent.

   **The governing principle:** a prop is pass-through if it is inherited from a base interface the component extends (`React.HTMLAttributes<...>`, `AllHTMLAttributes`, a native element's attribute interface, an ARIA-attributes interface, etc.) or is one of a small set of universal framework hooks, **and the component does not redeclare or give it component-specific meaning**. Test this from the type declaration, not from name-matching against a list — a component that `extends React.HTMLAttributes<HTMLDivElement>` inherits `title`, `lang`, `translate`, `slot`, and dozens more that a fixed list will never enumerate; a component that redeclares one of these with its own type or JSDoc (e.g. its own `title: string` documented as "card heading") has given it new meaning and it is no longer pass-through.

   Always exclude under this principle:
   - Framework internals: `ref`, `innerRef`, event handlers (any `onSomething`), `testId`, `data-testid`, `key`
   - Any prop inherited from an HTML-attributes base interface and not redeclared by the component — this replaces any fixed name list. Common examples include `className`, `class`, `classes`, `classNames`, `rootClassName`, `prefixCls`, `style`, `styles`, `id`, `role`, `tabIndex`, `htmlFor`, `for`, `slot`, `is`, `lang`, `dir`, `hidden`, `draggable`, `spellCheck`, `contentEditable`, `inputMode`, `autoComplete`, `autoFocus`, `translate`, `part`, `exportparts` — but these are examples of the principle, not an exhaustive list; apply the inheritance test to any prop the examples don't cover.
   - Accessibility pass-through: any `aria-*` or `ariaSomething` prop (including bare `aria` as an aria-attributes object), `aria-label`, `aria-hidden`, `aria-describedby`, `aria-controls`
   - Data attributes: any `data-*` prop
   - **Polymorphic component props**: `as`, `element`, `component` (when typed as an HTML tag string or component reference) — these change rendered HTML, not marketer-visible behavior
   - **Framework theming / pass-through escape hatches**: PrimeVue's `dt` / `pt` / `ptOptions` / `unstyled`, MUI/Chakra-style `sx`, anything explicitly typed as a developer "override" / "passthrough" object
   - **Important caveat**: only exclude when the prop is inherited/universal _and unredeclared_. Compound names like `fileName`, `displayName`, `dataset`, `dataSource`, `roleDescription`, `idLabel` are not pass-through — classify them normally. Likewise, a `title` (or any other inherited-attribute name) that the component redeclares with its own type or doc comment is component-specific content, not pass-through — classify it per rule 2 onward, do not exclude it and do not route it through the `title` → `content` correction below.

2. **Common semantic props — DO classify, do not exclude.** The LLM has been over-excluding these because they sound like framework internals; they are not. Classify each per the rest of this tree:
   - `icon` / `leftIcon` / `rightIcon` / `prefixIcon` / `suffixIcon` — slot or `string` (icon name); see slot guidance below
   - `items` / `options` / `actions` / `links` — inspect their declared element shape and use. Do not invent a comma-separated or other flattened representation; keep unresolved structural representation explicit for later schema work.
   - `value` (the bare prop, not `modelValue`) — inspect its declaration and use to classify it. Note: Vue's `modelValue` / `modelModifiers` are excluded by pre-classify because they're v-model framework wiring.
   - `name` — inspect its declaration and use. It may be semantic component data; do not exclude or classify it from its name alone.
   - `form` (when not the literal `<form>` HTML attribute) — typically content; classify as `string` unless it's a complex form-config object
   - `inputId` / `componentId` — these CAN be content (anchor IDs, marketer-set tracking refs). Classify as `string`, `cdf_category: "content"` when the type is a plain string. Only exclude if the prop is clearly internal (e.g. typed as a generated React ID).
   - `accessibleNameRef` / `accessibleDescriptionRef` (web components) — these are ID references for a11y wiring; classify as `string`, `cdf_category: "state"` (behavioral wiring, not design or content).
   - `eventDetails` / similar telemetry props — `cdf_category: "state"`.
3. **Positional/geometric design prop?** (`top`, `bottom`, `left`, `right`, `rotation`, `offset`, `zIndex`) → `classify_prop`, `cdf_type: "string"`, `cdf_category: "design"`.
4. **`enum` or `token`? — run the three-question procedure first.** Before any type-based rule, for every design prop that carries a value, answer Q1–Q3 from "`enum` versus `token`" above, in order, from the source shown:
   - **Q1** looked up / switched on / compared / has its own vocabulary → the component consumes names. Use `enum` only when the complete finite set is supported by the declared contract or explicit source; otherwise use `string` and explain the open or unknown domain.
   - **Q2** not written straight into a style or attribute → not `token`; continue to rules 5–7.
   - **Q3** written straight into a style or attribute **and** a token reference at that use (a `tokens.*` parameter default, a `tokenReference`, an inline `tokens.*` / `var(--*)`) → `cdf_type: "token"`, `token_kind` from that reference via the sidecar, no `values`. Interpolated with no token reference at that use → `cdf_type: "string"`.
   - Q1–Q3 **cannot be answered** from the bounded source shown (unread, truncated, in a file you cannot see, evidence pointing both ways) → preserve any independently declared closed domain; otherwise use `string` and describe the uncertainty. Missing evidence does not close a domain.

   **Do not classify on the component's role.** A layout primitive is not automatically a token consumer. A lookup can show that a component consumes names; it establishes a closed `enum` only when its complete finite key set is also supported:

   ```ts
   // Box.tsx — padding is an enum, despite Box being a layout primitive
   const { padding } = props; // "spacingXs"
   getSpacingStyles({ padding }); // → SpacingTable["spacingXs"] → "0.5rem"
   ```

   Classify that `padding` as `token` and the platform delivers `"0.5rem"`, so `SpacingTable["0.5rem"]` is `undefined` and the spacing silently disappears. A value that is spelled like a token name is still a lookup key (Q1 yes). Curated components with named variant APIs (`Button`, `Tag`, `Badge`, `Avatar`, `Notification`) are `enum` for the same reason. A design system may legitimately produce **zero** token-typed props.

5. **Closed union of string literals** (e.g. `'a' | 'b' | 'c'`)? → `cdf_type: "enum"`, copy every literal into `values`. If the union also includes `string` or `number`, preserve that open alternative and do not convert the listed literals into an exhaustive enum. This applies even when source references show a literal resolving to a design token internally; the declared contract still governs the available alternatives.
6. **Raw type is `string`** and prop name is `href`, `url`, or clearly a URL? → `cdf_type: "string"`, `cdf_category: "content"`.
7. **Raw type is `string` / `number` / `boolean`?** → For `boolean`, use `cdf_type: "boolean"` with `default: true` or `false` (native boolean). For `number`, use `cdf_type: "string"` with `default` as the numeric value as a string (e.g. `"0"`). For `string`, use `cdf_type: "string"`. **A design prop reaches this rule only after leaving rule 4 at Q2 (not written into a style) or Q3 (written into a style with no token reference at that use).** A prop that answered Q3 yes is already `token` and never arrives here — a `string`, `number`, or `string | number` annotation on it does not bring it back to this rule.
8. **Media/image type** (`ImageProps`, `MediaSource`, asset types)? → `cdf_type: "media"`.
9. **Rich text / markup** (`ReactNode` used as content, HTML string)? → `cdf_type: "richtext"`.
10. **Complex type — resolve before excluding** (see below).

---

## Resolving complex types — do not exclude without reasoning

A prop with a complex TypeScript type is **not automatically excluded**. Many props that appear complex carry real marketer-configurable information. Before excluding, ask: _"Could a marketer set this value in Contentful?"_ If yes, classify it.

**Common resolvable patterns:**

| Raw type pattern                                                                                | How to resolve                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'primary' \| 'secondary' \| 'ghost'` (union of literals)                                       | → `enum`, extract `values`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| A named type such as `HeadingSize` or `ButtonVariant`                                             | → `enum` only when the source shown declares or establishes its complete finite values. A type name, lookup table, default, or caller alone does not prove the complete set. Otherwise use `string` and state what evidence is missing. |
| `Variant` / `variant` prop                                                                      | The name alone does not establish a finite domain or category. Use `enum` only for a source-supported closed set; classify its category from the prop's evidenced role.                                                                                                                                                                                                                                                                                                                                                                                            |
| `Section[]` / array of custom items where the structure is unclear                              | Do not invent a flat string representation or exclude the prop solely because its structure is not represented by this output schema. Keep the shape limitation explicit for later schema work.                                                                                                                                                                                                                                                                                                                                                                   |
| `ExperienceConfiguration<Variant>` / deep generic                                               | Personalization config — → `exclude_prop`, reason: `"personalization configuration — framework internal"`                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `React.Dispatch<...>` / setter                                                                  | State setter — → `exclude_prop`, reason: `"React state setter — framework internal"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `React.RefObject<...>` / `ref`                                                                  | → `exclude_prop`, reason: `"ref — framework internal"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `() => void` / callback                                                                         | → `exclude_prop`, reason: `"callback function — framework internal"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `ReactNode` used as a slot-like prop (children, `icon`, `footer`)                               | → classify as a `slot` if it represents an injectable area, or `richtext` if it is inline markup content                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Boolean prop with source evidence that it controls visual appearance                            | → `boolean`, `cdf_category: "design"`; preserve its evidenced default, including `false`                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Boolean prop with source evidence that it controls runtime behavior                             | → `boolean`, `cdf_category: "state"`; preserve its evidenced default, including `false`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| String identifier or locale                                                                     | Use the declared contract and evidenced behavior to choose a category; the name alone does not establish it.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**When to finally exclude:**

- The type is a callback signature or event handler
- The type is a React ref
- The type is a React state setter (`Dispatch`)
- The type is a deep generic used for personalization/A-B testing platform config (e.g. `ExperienceConfiguration<T>`)
- The type is an array of rich objects where no flat representation makes sense for a marketer

If you exclude a prop that could have been classified, the marketer loses the ability to configure it in Contentful. Prefer classifying with a reasonable inference over excluding.

---

## Handling nested object props

When a prop has an inline object type (e.g., `item: { url?: string; alt?: string; target?: string }`),
classify EACH field as a separate prop using underscore notation (parentName_fieldName):

Input:
{"name":"item","type":"{ url?: string; alt?: string; linkUrl?: string; target?: string }","required":true}

Output:
{"tool":"classify_prop","prop":"item_url","cdf_type":"string","cdf_category":"content","required":false,"description":"Image source URL"}
{"tool":"classify_prop","prop":"item_alt","cdf_type":"string","cdf_category":"content","required":false,"description":"Image alt text"}
{"tool":"classify_prop","prop":"item_linkUrl","cdf_type":"string","cdf_category":"content","required":false,"description":"Navigation URL"}
{"tool":"classify_prop","prop":"item_target","cdf_type":"enum","cdf_category":"design","required":false,"values":["_blank","_self","_parent","_top"],"description":"Link open behavior"}

Note: Underscore notation is used (not dot-notation) because the backend's `toDisplayName()`
function splits on `.` and takes only the last segment, producing poor display names. Underscore
produces display names like "Item Url", "Item Alt" which are more readable in the ExO editor.

Rules for nested objects:

- Flatten to max depth 2 (e.g., `item_nested_deep` is acceptable, deeper is not)
- Each leaf field gets its own classify_prop call with underscore-joined name
- Apply the same classification rules as top-level props
- If the object has > 10 fields, classify the most important 10 and exclude the rest
- If the object type cannot be resolved (opaque generic, imported interface without visible fields), exclude the parent prop with reason "opaque nested type"

---

## Resolving `token_kind`

`token_kind` becomes `$token.kind` in the CDF output — the DTCG `$type` of the token the prop binds to. For a prop that earned `cdf_type: "token"` (Q2 yes, Q3 yes), take the token name cited at Q3 (`tokens.borderRadiusSmall`, `var(--brand-primary)`, a raw `tokenReference`) and resolve it against the inline token data: through the token-name sidecar (raw name → DTCG dot-notation path) when one is provided, otherwise by matching the name to the DTCG tree by spelling (`tokens.borderRadiusSmall` → `border-radius.border-radius-small`); the leaf's `$type` (`"dimension"`) is the `token_kind`. If the name cannot be resolved to a leaf, keep `cdf_type: "token"`, omit `token_kind`, and say so in `description` (`"WARNING: token_kind unknown — <name> not found in token data"`).

**Canonical example — a named variant backed by tokens is still `enum`:**

```
Tag.variant has allowedValues ["primary","secondary","warning","negative"] and PillNext.styles.ts
maps each one to a token (primary→tokens.blue100, warning→tokens.orange100, ...). The mapping is
internal to the design system — Tag's prop signature accepts the name, not the token. Classifying
as enum so the author picks "primary" and the component receives "primary".
{"tool":"classify_prop","prop":"variant","cdf_type":"enum","cdf_category":"design","required":false,"values":["primary","secondary","warning","negative"],"default":"primary","description":"Visual variant","reason":"Fully token-backed internally, but the component consumes the variant name. Token classification would deliver a resolved color the component cannot branch on."}
```

---

## Category correction rules

The pre-classified `category` is wrong in predictable ways. Correct silently (document in `description`):

- Visual style props (`color`, `size`, `padding`, `spacing`, `variant`, `theme`, `bgColor`, `imageOnLeft`, `enableXxx`) classified as `content` or `state` → `design`
- Interactive/behavioral state props (`disabled`, `loading`, `expanded`, `selected`, `checked`, `active`, `isOpen`, `isSearchVisible`, `showXxx`, `hideXxx`, `preview`, `componentId`, `sectionKey`, `variantIndex`) classified as `design` or `content` → `state`
- Text/label/data props (`label`, `description`, `caption`, `text`, `boldText`, `labelText`, `richText`, `backgroundImage`, `link`, `placeholder`, `searchValue`, `total`, `slug`) classified as `design` → `content`. `title` is excluded from this auto-correction — it is one of the most common HTML-inherited attribute names (see the pass-through principle above). Only apply this correction to a `title` prop the component redeclares with its own type or documented, component-specific meaning; a `title` that is bare inherited pass-through was already excluded in rule 1 and never reaches this step.
- Locale classified as `content` → `state` (it is a behavioral routing value, not editor-filled text)

> **Key question for category**: "Who fills this in?" — A content editor fills in `content`. A designer configures `design`. Neither fills in `state` — it comes from routing, runtime behavior, or component infrastructure.

---

## Slot classification

The `classify_slot` tool call maps to CDF's `$slots` object. Each slot you classify becomes a `$slots` entry; the `allowed_components` field maps to `$allowedComponents` in the output CDF.

For each `RawSlotDefinition`:

- `name` → `slot` field
- `description` → `description` field
- `allowedComponents` → `allowed_components` (pass through)
- `allowed_components` must contain only exact names from the hard allowlist supplied in the prompt; never invent a child from an import, JSX element, type name, icon name, or implementation helper, and omit any child that is not listed.
- `required`:
  - `true` when the declared contract or explicit source semantics establish that the slot is required
  - `false` when the declared contract or explicit source semantics establish optionality
  - When evidence is missing, use `false` and state that requiredness is unknown in `rationale`; do not infer it from a typical caller or an empty-render guess

**Pre-named slots:** If the input contains a slot whose `name` was already inferred by the pipeline (e.g. `"children"`, `"slot_0"`), treat it as you would any named slot — classify it normally. The pipeline renames empty-named slots to heuristic names before passing them to you; your job is to confirm or enrich the classification (set `required`, `description`, `allowed_components`), not to rename again.

---

## Examples

### Simple component

Input:

```json
{
  "name": "Button",
  "props": [
    {
      "name": "label",
      "type": "string",
      "category": "content",
      "required": true
    },
    {
      "name": "variant",
      "type": "'primary'|'secondary'|'ghost'",
      "category": "design",
      "defaultValue": "'primary'"
    },
    { "name": "disabled", "type": "boolean", "category": "design" },
    { "name": "onClick", "type": "()=>void", "category": "state" },
    { "name": "className", "type": "string" }
  ],
  "slots": [{ "name": "icon", "description": "Optional leading icon" }]
}
```

Output:

```
Starting Button classification — 5 props, 1 slot
{"tool":"classify_component","description":"Primary action button with variant and state support","rationale":{"description":"Button is an atom — a single interactive control that triggers an action. It carries a label, a small set of visual variants, and a disabled flag, which is the minimal surface a marketer needs to configure a call-to-action.","props":"Kept label (content), variant (enum, design), disabled (boolean, state), and className (string, design escape hatch). Excluded onClick because it is an event handler — framework-internal and not configurable in Contentful.","slots":"Kept the icon slot as optional because the button renders correctly without it and the icon is purely decorative."}}
label is a required string content prop
{"tool":"classify_prop","prop":"label","cdf_type":"string","cdf_category":"content","required":true,"description":"Button label text"}
variant is a string union — enum type, category design
{"tool":"classify_prop","prop":"variant","cdf_type":"enum","cdf_category":"design","required":false,"values":["primary","secondary","ghost"],"default":"primary","description":"Visual variant"}
disabled is a boolean state prop — raw category says design, correcting to state
{"tool":"classify_prop","prop":"disabled","cdf_type":"boolean","cdf_category":"state","required":false,"default":false,"description":"Disables the button"}
onClick is an event handler — framework internal
{"tool":"exclude_prop","prop":"onClick","reason":"event handler — framework internal"}
className is a DOM pass-through — developers wire CSS, marketers never set this
{"tool":"exclude_prop","prop":"className","reason":"DOM pass-through — not a marketer-configurable surface"}
icon slot is clearly optional (decorative leading icon)
{"tool":"classify_slot","slot":"icon","required":false,"description":"Optional leading icon","rationale":"Icon is a decorative leading glyph — optional because the button reads cleanly without it, but kept as a slot so marketers can inject a brand-specific icon component when desired."}
```

### Component with multiple slots (Card)

Input:

```json
{
  "name": "Card",
  "props": [
    {
      "name": "title",
      "type": "string",
      "category": "content",
      "required": true
    },
    {
      "name": "elevation",
      "type": "'flat'|'raised'|'floating'",
      "category": "design",
      "defaultValue": "'raised'"
    }
  ],
  "slots": [
    { "name": "body", "description": "Main card body" },
    { "name": "footer", "description": "Optional footer area" }
  ]
}
```

Output:

```
Starting Card classification — 2 props, 2 slots
{"tool":"classify_component","description":"Container that groups related content with a title, body, and optional footer","rationale":{"description":"Card is a molecule — it composes a title with body and footer slots into a single visual container. Useful as a building block for lists and grids of related content.","props":"Kept title (string, content) as the customer-facing label and elevation (enum, design) for the three visual depth variants. Nothing was excluded — both raw props map cleanly to CDF.","slots":"Kept both body (required, primary content area) and footer (optional, supplementary area). Body is required because a card with no body renders empty; footer is optional because many cards do not need one."}}
title is a required content string
{"tool":"classify_prop","prop":"title","cdf_type":"string","cdf_category":"content","required":true,"description":"Card title text"}
elevation is a finite visual variant — enum, design
{"tool":"classify_prop","prop":"elevation","cdf_type":"enum","cdf_category":"design","required":false,"values":["flat","raised","floating"],"default":"raised","description":"Visual depth variant"}
body is the primary content region — required
{"tool":"classify_slot","slot":"body","required":true,"description":"Main card body content","rationale":"Body is the primary content region of the card. Required because a card with no body renders an empty container, which is never a useful editor state."}
footer is supplementary and optional
{"tool":"classify_slot","slot":"footer","required":false,"description":"Optional footer area for actions or metadata","rationale":"Footer is a supplementary region typically used for actions or metadata. Optional because most cards do not need one and the card renders correctly without it."}
```

### Named type (HeadingSize, ButtonVariant, etc.) — do NOT infer the values

When a prop has a named TypeScript type that is not inlined as a union literal,
the value set is whatever that type's declaration says. A type _name_ is not
evidence of its members: `HeadingSize` could be `h1`–`h6`, `sm|md|lg`, or
`s|m|l|xl`. Guessing picks one design system's vocabulary and is wrong more
often than it is right, and a wrong name matches no style rule — the author's
setting silently does nothing.

So: look for the declaration in the source shown. If it is there, copy it. If it
is not, **emit `string`** — `string` is an unrestricted enum, so the author stays
unrestricted but correct.

Members visible in the source shown — copy them, do not paraphrase:

```
titleSize has type HeadingSize; HeadingSize is declared in the excerpt as 'sm' | 'md' | 'lg'
{"tool":"classify_prop","prop":"titleSize","cdf_type":"enum","cdf_category":"design","required":false,"values":["sm","md","lg"],"description":"Heading size","reason":"Copied from the HeadingSize declaration shown in the excerpt."}
```

Members NOT visible in the source shown — degrade to `string`:

```
titleSize has type HeadingSize; HeadingSize is not declared anywhere in the source shown
no evidence for its members, so no values list — string, not a guess
{"tool":"classify_prop","prop":"titleSize","cdf_type":"string","cdf_category":"design","required":false,"description":"Heading size","reason":"HeadingSize is not declared in the source shown, so its members cannot be cited. Emitted as string rather than inventing a value list."}
```

### href prop

```
href is a URL string — cdf_type string (not link), category content
{"tool":"classify_prop","prop":"href","cdf_type":"string","cdf_category":"content","required":false,"description":"Navigation URL"}
```

---

## Edge cases

- **Prop with unresolvable type** (generics, intersection, callback) → `exclude_prop` with reason `"complex type — not representable in CDF"`.
- **Component with zero classified props after exclusions** → still emit `classify_component`. The DB entry will have an empty `$properties` object.
- **Slot not in DB** → skipped with a warning; does not abort the run.
- **Prop not in DB** → skipped with a warning; does not abort the run.

## Validation step — Pre-emit checklist

Before emitting any tool calls, verify:

1. Every prop in the input has exactly one `classify_prop` or `exclude_prop` call
2. Every slot has exactly one `classify_slot` call
3. `classify_component` is emitted exactly once
4. Every `cdf_type: "enum"` has a non-empty `values` array taken from the material shown. A prop whose value set was shown nowhere is `cdf_type: "string"` with no `values` — never an `enum` with a plausible-looking list, and never an `exclude_prop`.
5. Every `cdf_type: "token"` has `token_kind` (or a warning in `description` if lookup failed) and does **not** have `values` set
6. No `cdf_type: "link"` — all href/url props use `string`
7. `required` values are JSON booleans, not strings
8. Framework, DOM, accessibility, and data-_ pass-through props are excluded per the inheritance principle (rule 1) — any prop inherited from an HTML-attributes base interface and not redeclared by the component, plus `aria-_`(and bare`aria`), `data-\*`, polymorphic `as`/`element`/`component`, framework theming `dt`/`pt`/`ptOptions`/`unstyled`/`sx`. A prop matching an inherited-attribute name (including `title`) that the component redeclares with its own type or meaning is NOT excluded. Discrete positional/geometric props (`top`, `bottom`, `left`, `right`, `rotation`, etc.) ARE classified as `string` design props. Common semantic props (`icon`, `items`, `actions`, `options`, `value`, `name`, `form`, `inputId`, `componentId`) are NOT excluded — classify them per their content/design/state nature.
9. No `cdf_type: "link"` used — `link` is reserved and rejected by the CLI parser
10. No `cdf_type: "number"` used — this is not a supported type; use `"string"` with numeric defaults. `cdf_type: "boolean"` IS valid — use it for boolean toggle props.
11. `classify_component` includes a `rationale` object with all three sub-fields (`rationale.description`, `rationale.props`, `rationale.slots`) populated as non-empty strings.
12. Every `classify_slot` includes a non-empty `rationale` string.
13. `rationale.description` follows the same "Description content rules" as `description` — no internal initiative names (`INTEG-*`, `EDSI`, `DSI`, `M1`, `M2`, wave/phase references, etc.).
14. Every `cdf_type: "token"` prop cites a line that interpolates its value into a style **and** a token reference at that use (Q2 yes, Q3 yes), and carries no `values`. If you cannot cite both, it is `enum` or `string`; if you can, it is `token` — its type annotation is not a reason to emit `string`.
15. Use `enum` for a source-supported closed set even when its names map to tokens internally. When consumption or the complete set is unknown, preserve any declared closed domain; otherwise use `string` and explain the uncertainty in `reason`.
16. Every `enum`'s `values` array represents a complete finite set supported by the declared contract or explicit exhaustive source. A default, one caller, one observed value, prop/type name, partial map, or model overlap is not a complete-set proof. When the set is open or unknown, use `cdf_type: "string"`, explain the evidence limit in `reason`, and keep the prop.

Before finishing, review the component output against this checklist and iterate on any warning the supplied evidence can resolve. Preserve unresolved warnings in the relevant `description` or `reason`; do not invent values.

---

## CRITICAL: Zero-output is a failure

You MUST produce at least one classify_prop call for this component. A response with zero
classify_prop/exclude_prop calls means the component will be pushed with no configurable
properties — this is never acceptable.

If you are genuinely uncertain about every prop, classify each as:
{"tool":"classify_prop","prop":"<name>","cdf_type":"string","cdf_category":"content","required":false,"description":"Uncertain classification — review recommended"}

An imperfect classification is infinitely better than no classification. That is
about **classifying a prop rather than dropping it** — it is not a licence to
invent a `values` list. The uncertain answer is `cdf_type: "string"`, every time.

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
