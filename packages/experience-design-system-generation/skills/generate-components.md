# Generate Components — Classification Skill

## Purpose

Classify every prop and slot in the component definition provided inline for use in **Contentful Experience Orchestration**. Output one JSON tool call per line to stdout. The CLI reads your stdout and writes each decision directly to the pipeline database — you do not write any files.

---

## What is Contentful Experience Orchestration?

Contentful Experience Orchestration is a Contentful product that enables **marketers** to manage both the content and visual presentation of digital experiences — web pages, multi-channel — entirely within Contentful. The entity being defined here is a **Component Type**: the schema that tells Contentful what a marketer can configure for this UI component.

A Component Type has two kinds of configurable properties:

- **Design Properties** — values that control *how the component looks*: color scheme, visual variant (primary/secondary/ghost), size (sm/md/lg), spacing, layout orientation, background color, font style, border style, any visual toggle that changes appearance. These are the values a designer sets once and a marketer may override. Think: "what would a designer put in a design token or a style guide?"
- **Content Properties** — values that are *data the component displays*: labels, headings, body text, rich text, images, media, URLs, counts, IDs used for CMS lookups, locales. These are filled by editors with real CMS content. Think: "what does a copywriter or content editor fill in?"

The third category:
- **State Properties** — values that control *interactive or behavioral state*: disabled, loading, expanded, isOpen, isSearchVisible. These are runtime behavioral flags, not visual design nor content.

Getting this right matters: Contentful uses the category to decide where a property appears in the editor UI. Design properties appear in the design panel, content properties appear in the content panel.

---

## Prerequisites — Input

All input is embedded inline in the prompt before this file:

- **Raw component data** — `RawComponentDefinition[]` (one component for this run)
- **DTCG token data** — full token tree, if provided
- **Token-name sidecar** — raw CSS custom property name → DTCG dot-notation path, if provided
- **Component source references** — the real file text for the component's own source, plus up to 5 sibling files (e.g. a co-located `.styles.ts` or `utils.ts`, or a file reached transitively through another sibling — such as a re-exported component's own styles module), if provided. Use this when `tokenReference` is empty — see "Source-derived tokenReference" below. **You have no filesystem access and no tools — `sourcePath` is a citation label only, never something to open.**
  - A **"declared but no read found"** line may accompany these files, listing properties for which the scanner found no read in any of them. It is computed over the *untruncated* sources, so a property can be absent from that list yet have its use fall outside a truncated excerpt. The scanner recognises direct reads (`props.x`, `const { x } = props`, a destructured parameter, `{ x }` shorthand) and treats a rest spread (`{ a, ...rest }`, `<Child {...props} />`) as reading every prop it forwards; a value read by bracket access or reached through a framework accessor (`this.x`, `$props()`, `p => p.x`) is still not detected. Treat the list as **absence of consumption evidence**, not as proof the component ignores the value. Its only effect on classification is that `token` cannot be earned for a listed property — there is no citable interpolation — so a listed design prop is `enum` (or `string`). It says nothing about non-design props: a forwarded `image` is still `media`, a forwarded `icon` is still a slot, a forwarded `href` is still content.
  - A **"uses not shown"** line may also accompany them. The files are excerpts windowed around the property names, and this line names the properties with at least one use that fell outside the excerpt budget. Treat those properties' consumption as unknown: do not classify them `token` on what is shown, and do not conclude they are unread. Unknown resolves to `enum` (or `string`) per "Ambiguity resolves to `enum`".

```typescript
interface RawPropDefinition {
  name: string;
  type: string;            // raw TypeScript type, e.g. "'primary' | 'secondary'"
  required: boolean;
  category?: 'content' | 'design' | 'state';  // pre-classified — verify, do not blindly trust
  allowedValues?: string[];
  defaultValue?: string;
  description?: string;
  tokenReference?: string;  // raw token name — shape varies by design system, e.g. "--brand-primary" (CSS custom property) or "tokens.blue500" (flat/dotted JS reference)
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

The `category` field on each prop is a pre-classification hint from static analysis heuristics.
It is correct approximately 80% of the time for simple props. You should:
- Trust it for obvious cases (event handlers excluded, text labels as content)
- Override it when your domain knowledge indicates otherwise
- NEVER produce zero output — if you disagree with all hints, explain why in descriptions

---

## Target schema

The CLI assembles your output into CDF (Component Definition Format), a JSON schema with `$schema: "https://contentful.com/schemas/cdf/v1"`. Each component you classify produces a CDF component entry (`$type: "component"`) in the pipeline database. Properties carry `$category` (`content`, `design`, or `state`) and a `$type`. You do not produce this JSON directly — emit tool calls and the CLI writes the DB columns.

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
- `values` is required for `cdf_type: "enum"` — must be a non-empty string array of the variant names the prop accepts.
- **Do NOT include `values` for `cdf_type: "token"`.** The two property types carry different kinds of list. An `enum` prop's list holds *variant names* the component accepts (`"primary"`, `"secondary"`). A `token` prop's list holds *design token paths* (`"color.brand.primary"`), produced by the separate token-mapping step (`$token.allowed`) — never by you. Emitting `values` on a token prop makes the definition invalid.
- `token_kind` is required for `cdf_type: "token"` — must be a DTCG `$type` string, e.g. `"color"`.
- `required` must be a JSON boolean (`true`/`false`), not a string.
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

| cdf_type | Use case |
|---|---|
| `string` | Plain text, URLs, href props, numbers (as string), any string-shaped value |
| `richtext` | Formatted text, HTML, ReactNode used as markup |
| `media` | Images, videos, media assets |
| `enum` | Fixed set of string choices — requires `values` |
| `token` | Design-token-linked prop — requires `token_kind` |
| `boolean` | Boolean toggle props (visible, disabled, enabled, etc.) |

> **IMPORTANT: No `number` type.** The design-systems API only supports the `String` design property variant for numeric values. All numeric props must use `cdf_type: "string"` with the number as a string default (e.g. `"0"`, `"100"`). Boolean props can now use `cdf_type: "boolean"` directly.

> **Avoid `link` type for simple URL props.** Props named `href`, `url`, or holding plain URL strings → `cdf_type: "string"`, `cdf_category: "content"`. Reserve `link` for props that hold a reference to another Contentful entry.

---

### `enum` versus `token`

Both describe a closed set of choices, but the *contents* differ, and that is the whole distinction:

| | What the list holds | Example |
|---|---|---|
| `enum` | Variant names the component accepts | `["primary", "secondary", "ghost"]` |
| `token` | Design token paths the prop may bind to | `["color.brand.primary", "color.brand.neutral"]` |

The distinction is **what the component does with the value it receives**. That
is decidable from source; it is not inferred from the property's name, from the
component's role, or from the property's TypeScript type.

An `enum` design property is delivered as a plain string, so the component
receives `variant="primary"` — the value its own code branches on. A `token`
property is resolved to the token's value *before* it reaches the component, so
that same component would receive `variant="#0059c8"` and match no branch.

#### The three-question procedure (closed, ordered)

For every design prop that carries a value (not a boolean), answer these three
questions **in this order**, from the source shown, and stop at the first answer
that decides. There is no fourth question.

- **Q1 — Does the component look the value up, switch on it, or compare it against names?**
  An indexed access (`tokens[fontColor]`, `SPACING[padding]`, a `Record<Variant, Token>`),
  a `switch (variant)` / `if (variant === 'x')` chain, a `styles[variant]` class lookup,
  or a vocabulary of its own (`allowedValues`, a literal union) — any of these means
  the component needs the *name*. A presence check (`if (width)`) or arithmetic on
  the value is not a lookup.
  **Yes → `enum`, names in `values`, stop.** No → Q2.
- **Q2 — Is the value written straight into a style or attribute?**
  `rx={radius}`, `padding: ${padding}`, `style={{ color }}`, `background: var(${bg})` —
  the value reaches the renderer without the component resolving it.
  **No → not `token`; leave this procedure and continue with the type rules.** Yes → Q3.
- **Q3 — Is there a design-token reference at that use?** Any one of:
  the parameter default is a token (`radius = tokens.borderRadiusSmall`), the raw prop
  carries a `tokenReference`, or an inline `tokens.*` / `var(--*)` sits in the same
  expression. The reference must belong to *this* prop — a `tokens.*` on some other
  line of the file, or in a sibling's style object, is not one.
  **Yes → `token`, stop; resolve `token_kind` from that reference. No → `string`, stop.**

**The raw TypeScript type is not an input to Q1–Q3.** `string`, `number`,
`string | number`, `stringOrNumber` — none of these answers any question above;
they say what the compiler accepts, not what the component does with the value.
"The type accepts any value, the default just happens to be a token reference" is
a Q3-yes described as a no: a token parameter default *is* the design-token
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

A lookup map from variant names to tokens is evidence **for** `enum`, not against
it — that is Q1 answering yes. The map exists precisely because the component was
handed a name it had to resolve itself.

**`token` is earned by Q2 and Q3 together, and only that way.** Cite both lines
in `reason`: the interpolation and the token reference. Once both are cited, the
prop is `token` — do not then downgrade it because of its type annotation, because
the default "could be overridden" (every default can), or because the tie-break
below exists. Nothing downstream re-derives, corrects, or second-guesses this —
what you emit is what ships.

**Ambiguity resolves to `enum` — but only when Q1–Q3 cannot be answered.** The
tie-break applies solely when the source shown does not let you answer the three
questions: the property is interpolated in one place and looked up in another,
the use sits in a file you cannot see, the source is truncated at the point of
use (the "uses not shown" line), or the prop is on the "declared but no read
found" list. In those cases emit `enum` (or `string` when it has no value set)
and record the ambiguity in `reason`. When the three questions *can* be answered
from the source shown, they are answered and the tie-break does not apply: a
clear Q1-yes is `enum`, a clear Q2-yes + Q3-yes is `token`, and a type annotation
does not create ambiguity. An `enum` is delivered as the plain string the
component was written to receive and remains reachable from a content-type
field; a wrong `token` delivers a resolved value the component cannot branch on
and is permanently excluded from content-type field mapping. That asymmetric
cost is why a genuine tie goes to `enum` — it is not a reason to call a decided
case a tie.

---

## Valid cdf_category values

| cdf_category | Use case |
|---|---|
| `content` | Data the component *displays* — what a copywriter or editor fills in: text, labels, headings, body copy, rich text, images, media, URLs, link targets, counts, locale |
| `design` | Values that control *how the component looks* — what a designer sets: color, size (sm/md/lg), variant (primary/secondary/ghost), layout orientation, alignment, background, visual toggles (imageOnLeft, enableEffect), design tokens |
| `state` | Runtime behavioral or interactive flags — not visible in the editor's design or content panel: disabled, loading, expanded, isOpen, isSearchVisible, preview, identifiers used for analytics/tracking (componentId, sectionKey, componentName) |

The pre-classified `category` in the raw input is a starting point — correct it when it is wrong. Contentful uses this category to decide where the property appears in the editor UI, so accuracy matters.

---

## Mapping guidance — Classification decision tree

For each `RawPropDefinition`, apply in order:

1. **Framework / DOM / accessibility pass-through?** → `exclude_prop`. These are escape hatches for developers, not configurable surfaces for marketers. Exposing them in the ExO editor adds noise that obscures the props that actually carry intent. Always exclude:
   - Framework internals: `ref`, `innerRef`, event handlers (any `onSomething`), `testId`, `data-testid`, `key`
   - DOM pass-through: `className`, `class`, `classes`, `classNames`, `rootClassName`, `prefixCls`, `style`, `styles`, `id`, `role`, `tabIndex`, `htmlFor`, `for`, `slot`, `is`, `lang`, `dir`, `hidden`, `draggable`, `spellCheck`, `contentEditable`, `inputMode`, `autoComplete`, `autoFocus`, `translate`, `part`, `exportparts`
   - Accessibility pass-through: any `aria-*` or `ariaSomething` prop (including bare `aria` as an aria-attributes object), `aria-label`, `aria-hidden`, `aria-describedby`, `aria-controls`
   - Data attributes: any `data-*` prop
   - **Polymorphic component props**: `as`, `element`, `component` (when typed as an HTML tag string or component reference) — these change rendered HTML, not marketer-visible behavior
   - **Framework theming / pass-through escape hatches**: PrimeVue's `dt` / `pt` / `ptOptions` / `unstyled`, MUI/Chakra-style `sx`, anything explicitly typed as a developer "override" / "passthrough" object
   - **Important caveat**: only exclude when the prop is one of these *as the bare HTML attribute or framework-internal pass-through*. Compound names like `fileName`, `displayName`, `dataset`, `dataSource`, `roleDescription`, `idLabel` are not pass-through — classify them normally.
2. **Common semantic props — DO classify, do not exclude.** The LLM has been over-excluding these because they sound like framework internals; they are not. Classify each per the rest of this tree:
   - `icon` / `leftIcon` / `rightIcon` / `prefixIcon` / `suffixIcon` — slot or `string` (icon name); see slot guidance below
   - `items` / `options` / `actions` / `links` — usually array content; if the element shape is simple, classify as `string` (comma-separated names/IDs) and note in `description`. Only exclude when elements are deep nested objects with no flat representation.
   - `value` (the bare prop, not `modelValue`) — content prop, usually `string` (or `enum` if from a fixed set). Note: Vue's `modelValue` / `modelModifiers` are excluded by pre-classify because they're v-model framework wiring.
   - `name` — content prop, usually `string`. Treat it as semantic component data, not as a DOM pass-through.
   - `form` (when not the literal `<form>` HTML attribute) — typically content; classify as `string` unless it's a complex form-config object
   - `inputId` / `componentId` — these CAN be content (anchor IDs, marketer-set tracking refs). Classify as `string`, `cdf_category: "content"` when the type is a plain string. Only exclude if the prop is clearly internal (e.g. typed as a generated React ID).
   - `accessibleNameRef` / `accessibleDescriptionRef` (web components) — these are ID references for a11y wiring; classify as `string`, `cdf_category: "state"` (behavioral wiring, not design or content).
   - `eventDetails` / similar telemetry props — `cdf_category: "state"`.
3. **Positional/geometric design prop?** (`top`, `bottom`, `left`, `right`, `rotation`, `offset`, `zIndex`) → `classify_prop`, `cdf_type: "string"`, `cdf_category: "design"`.
4. **`enum` or `token`? — run the three-question procedure first.** Before any type-based rule, for every design prop that carries a value, answer Q1–Q3 from "`enum` versus `token`" above, in order, from the source shown:

   * **Q1** looked up / switched on / compared / has its own vocabulary → `cdf_type: "enum"`, names in `values`, no `token_kind`. This holds even when every name maps 1:1 to a design token; the map is the component resolving a name it was given.
   * **Q2** not written straight into a style or attribute → not `token`; continue to rules 5–7.
   * **Q3** written straight into a style or attribute **and** a token reference at that use (a `tokens.*` parameter default, a `tokenReference`, an inline `tokens.*` / `var(--*)`) → `cdf_type: "token"`, `token_kind` from that reference via the sidecar, no `values`. Interpolated with no token reference at that use → `cdf_type: "string"`.
   * Q1–Q3 **cannot be answered** from the source shown (unread, truncated, in a file you cannot see, evidence pointing both ways) → `cdf_type: "enum"` (or `string`). See "Ambiguity resolves to `enum`" above. The "declared but no read found" note is one input here, but it is a scanner result with known blind spots (rest spreads, bracket access, framework accessors) — it withdraws the possibility of `token`; it does not tell you what the component does.

   A `tokenReference` on the raw prop does not decide the type on its own. If the prop also has `allowedValues` of friendly names, Q1 is yes and the prop is an `enum`.

   **Cardinality is the tell.** `tokenReference` is a single-value field — it can only ever assert "this prop links to one token." A prop's *values* resolving to several distinct token targets (a `Record<Variant, Token>`, a `switch`, found via the "Source-derived tokenReference" evidence below) is a different, stronger signal, and it points the other way: one token target is the shape of a genuine token prop; many distinct token targets means the prop is a selector *over* tokens, which makes it an enum. Do not treat a bare `tokenReference` on the raw prop as if it were multi-value resolution evidence — it never is one.

   An `enum` design property is stored and delivered as a plain string, so the component receives `variant="primary"` — the value its own code branches on. A token-typed property is stored as a token reference and is resolved to the token's value before it reaches the component, so the component would receive `variant="#0059c8"` and match no branch. Classify by what the component does with the value, not by what the prop's type annotation admits.

   Token classification has a second, independent cost beyond the render contract: `modeling-workspace`'s content-type-to-design-property mapping deliberately excludes every DTCG token type as unreachable from a content-type field's value, while a `String` design property (what an `enum` prop compiles to) is reachable from a `Symbol`/`Text` field. A prop classified `token` becomes permanently ineligible for content-type field mapping in the upgrade workspace. This cost applies to every token prop, genuine ones included, so it does not by itself decide enum versus token — Q1–Q3 do that. It is the reason the tie-break goes to `enum` when Q1–Q3 cannot be answered.

   **Do not classify on the component's role.** A layout primitive is not automatically a token consumer. Design systems routinely key their primitives on token *names*, and those props are `enum` — the component needs the name to perform its own lookup:

   ```ts
   // Box.tsx — padding is an enum, despite Box being a layout primitive
   const { padding } = props;                  // "spacingXs"
   getSpacingStyles({ padding });               // → SpacingTable["spacingXs"] → "0.5rem"
   ```

   Classify that `padding` as `token` and the platform delivers `"0.5rem"`, so `SpacingTable["0.5rem"]` is `undefined` and the spacing silently disappears. A value that is spelled like a token name is still a lookup key (Q1 yes). Curated components with named variant APIs (`Button`, `Tag`, `Badge`, `Avatar`, `Notification`) are `enum` for the same reason. A design system may legitimately produce **zero** token-typed props.
5. **Union of string literals** (e.g. `'a' | 'b' | 'c'`)? → `cdf_type: "enum"`, extract literals into `values`. (Rule 4's Q1 will normally have decided this already — a literal union is the prop's own vocabulary.) This applies even when Component source references show each literal resolving to a design token internally (see "Source-derived tokenReference" below) — a resolved token map is evidence about the component's internals, not its interface.
6. **Raw type is `string`** and prop name is `href`, `url`, or clearly a URL? → `cdf_type: "string"`, `cdf_category: "content"`.
7. **Raw type is `string` / `number` / `boolean`?** → For `boolean`, use `cdf_type: "boolean"` with `default: true` or `false` (native boolean). For `number`, use `cdf_type: "string"` with `default` as the numeric value as a string (e.g. `"0"`). For `string`, use `cdf_type: "string"`. **A design prop reaches this rule only after leaving rule 4 at Q2 (not written into a style) or Q3 (written into a style with no token reference at that use).** A prop that answered Q3 yes is already `token` and never arrives here — a `string`, `number`, or `string | number` annotation on it does not bring it back to this rule.
8. **Media/image type** (`ImageProps`, `MediaSource`, asset types)? → `cdf_type: "media"`.
9. **Rich text / markup** (`ReactNode` used as content, HTML string)? → `cdf_type: "richtext"`.
10. **Complex type — resolve before excluding** (see below).

---

## Resolving complex types — do not exclude without reasoning

A prop with a complex TypeScript type is **not automatically excluded**. Many props that appear complex carry real marketer-configurable information. Before excluding, ask: *"Could a marketer set this value in Contentful?"* If yes, classify it.

**Common resolvable patterns:**

| Raw type pattern | How to resolve |
|---|---|
| `'primary' \| 'secondary' \| 'ghost'` (union of literals) | → `enum`, extract `values` |
| `HeadingSize` / `ButtonVariant` / any named type that is clearly a finite set of visual options | → `enum`, infer likely values from the prop name and context (e.g. `['sm', 'md', 'lg']` for size, `['primary', 'secondary']` for variant). Document your inference in `description`. |
| `Variant` / `variant` prop | Usually a visual design variant. → `enum`, `cdf_category: "design"`. Infer values from context. |
| `Section[]` / array of custom items where the structure is unclear | → `exclude_prop` only if the array elements are complex objects with no obvious flat representation. If items are simple (title, label, id), consider representing as `string` (a comma-separated IDs or keys) or note in `description` why. |
| `ExperienceConfiguration<Variant>` / deep generic | Personalization config — → `exclude_prop`, reason: `"personalization configuration — framework internal"` |
| `React.Dispatch<...>` / setter | State setter — → `exclude_prop`, reason: `"React state setter — framework internal"` |
| `React.RefObject<...>` / `ref` | → `exclude_prop`, reason: `"ref — framework internal"` |
| `() => void` / callback | → `exclude_prop`, reason: `"callback function — framework internal"` |
| `ReactNode` used as a slot-like prop (children, `icon`, `footer`) | → classify as a `slot` if it represents an injectable area, or `richtext` if it is inline markup content |
| `boolean` with a name like `hideChevron`, `imageOnLeft`, `enableBackgroundColorEffect` | → `boolean`, `cdf_category: "design"`, `default: true` or `false` — these control visual appearance |
| `boolean` with a name like `preview`, `hideContentForPersonalization` | → `boolean`, `cdf_category: "state"`, `default: false` — these control behavior |
| `string` used as a `componentId`, `sectionKey`, `componentName` | → `string`, `cdf_category: "state"` — these are identifiers for tracking/lookup |
| `string` locale (e.g. `locale: string`) | → `string`, `cdf_category: "state"` — locale is a behavioral/routing value |

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

## Token-aware mapping

A `tokenReference` establishes *which token kind applies* once a prop is classified as `cdf_type: "token"` per the decision tree above — it does not by itself decide enum vs. token. Once a prop is classified as `token`, resolve `token_kind` from its `tokenReference` — **regardless of what the reference string looks like.** `tokenReference` is not limited to CSS-custom-property syntax; a flat/dotted JS-style name (`"tokens.blue500"`), a bare token name (`"blue500"`), or any other design-system-specific convention all count equally. Any non-empty `tokenReference` value on a token-classified prop triggers this lookup.

The `token_kind` field becomes `$token.kind` in the CDF output (a DTCG `$type` string, e.g. `"color"`).

1. Look up `tokenReference` in the inline token-name sidecar → get the DTCG dot-notation path
2. Traverse that path in the inline DTCG token data to reach the leaf token
3. Use the leaf's `$type` (e.g. `"color"`) as `token_kind`

Example (CSS custom property):
```
tokenReference: "--brand-primary"
  → sidecar["--brand-primary"] → "colors.brand.primary"
  → token data: colors.brand.primary.$type → "color"
  → tool call: {"tool":"classify_prop","prop":"bgColor","cdf_type":"token","cdf_category":"design","token_kind":"color","description":"..."}
```

Example (flat/dotted JS reference — same rule, different syntax):
```
tokenReference: "tokens.blue500"
  → sidecar["tokens.blue500"] → "blue500"
  → token data: blue500.$type → "color"
  → tool call: {"tool":"classify_prop","prop":"borderColor","cdf_type":"token","cdf_category":"design","token_kind":"color","description":"..."}
```

Both fallbacks below apply **only to a prop that has already earned `cdf_type: "token"` through the consumption test**. The presence of a `tokenReference` never decides the type on its own — a prop with a `tokenReference` that the component looks up or branches on, or that you cannot find read at all, is still `enum` (or `string`), and neither fallback applies to it.

If the prop is `token` and its `tokenReference` is not found in the sidecar → keep `cdf_type: "token"`, omit `token_kind`, add `description: "WARNING: tokenReference not found in sidecar — token_kind unknown"`.

If the prop is `token`, token data was not provided, and `tokenReference` is present → keep `cdf_type: "token"`, omit `token_kind`, add `description: "WARNING: no token data supplied — token_kind unknown"`.

### Source-derived tokenReference (no structured `tokenReference` field)

`RawPropDefinition.tokenReference` only captures token linkage the static extractor found in the component's *own* file. Real design systems frequently define the variant→token lookup one file away — e.g. a co-located `.styles.ts` or a shared `utils.ts` — which the extractor doesn't see. When `tokenReference` is empty, check the **Component source references** section (the component's own file, then each sibling file) for evidence such as:

- A lookup object keyed by the prop's allowed values, whose entries are design-token references rather than raw literals — a DTCG dot-path (`"color.blue.500"`), a flat/dotted JS reference (`tokens.blue500`), a CSS custom property (`var(--color-blue-500)`), or a bare token name (`"blue500"`)
- A direct `tokens.xxx` / `var(--xxx)` reference inline in the render logic, keyed off the prop's value
- A `switch` statement or `if`/`else if` chain branching on the prop's value, where one or more branches resolve to a `tokens.*`, `var(--...)`, or DTCG-path reference — this is equally valid evidence as an object-literal lookup map. Don't require the resolution to be a plain object; a switch/if chain that ends in a token reference is the same signal in a different syntax.

**This evidence describes the component's internals, not its interface — it does not override rule 4 of the decision tree.** A `Record<Variant, Token>` keyed by ordinary variant names (e.g. `{ neutral: tokens.gray300, positive: tokens.green300 }`) is still a variant→token resolution map, but the prop's signature accepts the variant *name*, not the token. That is exactly the Q1-yes enum case in rule 4: classify as `enum` with the names in `values` (see the PillNext example below), and do not derive a `tokenReference` for it.

Only derive a `tokenReference` from this evidence — and classify `cdf_type: "token"` — when the prop has **no vocabulary of its own**: no `allowedValues`, no literal union, and source showing the value interpolated into a style directly, with no lookup or branch for the component to resolve. In that case, note in `description` which file the evidence came from (e.g. `"token linkage found in utils.ts's backgroundMap"`) so the developer can verify it.

If the source shows only raw literal values (hex colors, pixel values) with no token reference anywhere — that's a real enum/string prop, not a token. Don't force a token classification without an actual token reference in evidence.

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
- Text/label/data props (`title`, `label`, `description`, `caption`, `text`, `boldText`, `labelText`, `richText`, `backgroundImage`, `link`, `placeholder`, `searchValue`, `total`, `slug`) classified as `design` → `content`
- Locale classified as `content` → `state` (it is a behavioral routing value, not editor-filled text)

> **Key question for category**: "Who fills this in?" — A content editor fills in `content`. A designer configures `design`. Neither fills in `state` — it comes from routing, runtime behavior, or component infrastructure.

---

## Slot classification

The `classify_slot` tool call maps to CDF's `$slots` object. Each slot you classify becomes a `$slots` entry; the `allowed_components` field maps to `$allowedComponents` in the output CDF.

For each `RawSlotDefinition`:
- `name` → `slot` field
- `description` → `description` field
- `allowedComponents` → `allowed_components` (pass through)
- `required`:
  - `true` if the component does not render correctly without content in this slot (primary content area of a Card, Dialog body, etc.)
  - `false` if clearly optional (icon slot, footer slot with a default, decorative slot)
  - Default to `true` when the source gives no signal

**Pre-named slots:** If the input contains a slot whose `name` was already inferred by the pipeline (e.g. `"children"`, `"slot_0"`), treat it as you would any named slot — classify it normally. The pipeline renames empty-named slots to heuristic names before passing them to you; your job is to confirm or enrich the classification (set `required`, `description`, `allowed_components`), not to rename again.

---

## Examples

### Simple component

Input:
```json
{
  "name": "Button",
  "props": [
    {"name":"label","type":"string","category":"content","required":true},
    {"name":"variant","type":"'primary'|'secondary'|'ghost'","category":"design","defaultValue":"'primary'"},
    {"name":"disabled","type":"boolean","category":"design"},
    {"name":"onClick","type":"()=>void","category":"state"},
    {"name":"className","type":"string"}
  ],
  "slots": [{"name":"icon","description":"Optional leading icon"}]
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
    {"name":"title","type":"string","category":"content","required":true},
    {"name":"elevation","type":"'flat'|'raised'|'floating'","category":"design","defaultValue":"'raised'"}
  ],
  "slots": [
    {"name":"body","description":"Main card body"},
    {"name":"footer","description":"Optional footer area"}
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

### Named type (HeadingSize, ButtonVariant, etc.)

When a prop has a named TypeScript type that is not inlined as a union literal, reason from the prop name and type name to infer the finite value set.

```
titleSize has type HeadingSize — this is a named enum controlling heading size
inferring likely values: ["h1", "h2", "h3", "h4", "h5", "h6"] — documenting inference
{"tool":"classify_prop","prop":"titleSize","cdf_type":"enum","cdf_category":"design","required":false,"values":["h1","h2","h3","h4","h5","h6"],"description":"Heading level — inferred from HeadingSize type name; actual values may be h1–h6 or sm/md/lg"}
```

### Token-linked prop

```
bgColor has tokenReference "--bg-primary" — looking up sidecar
{"tool":"classify_prop","prop":"bgColor","cdf_type":"token","cdf_category":"design","token_kind":"color","description":"Background color token linked via --bg-primary → colors.bg.primary"}
```

### Token-linked prop (non-CSS-var reference shape)

```
borderColor (on a Box layout primitive) has tokenReference "tokens.blue500" — not a CSS custom property, but still a tokenReference — looking up sidecar
{"tool":"classify_prop","prop":"borderColor","cdf_type":"token","cdf_category":"design","token_kind":"color","description":"Border color linked via tokens.blue500"}
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
- **tokenReference present but not in sidecar** → `cdf_type: "token"`, omit `token_kind`, add `description` warning.
- **Slot not in DB** → skipped with a warning; does not abort the run.
- **Prop not in DB** → skipped with a warning; does not abort the run.

## Validation step — Pre-emit checklist

Before emitting any tool calls, verify:

1. Every prop in the input has exactly one `classify_prop` or `exclude_prop` call
2. Every slot has exactly one `classify_slot` call
3. `classify_component` is emitted exactly once
4. Every `cdf_type: "enum"` has a non-empty `values` array
5. Every `cdf_type: "token"` has `token_kind` (or a warning in `description` if lookup failed) and does **not** have `values` set
6. No `cdf_type: "link"` — all href/url props use `string`
7. `required` values are JSON booleans, not strings
8. Framework, DOM, accessibility, and data-* pass-through props are excluded — `className`/`classes`/`classNames`/`rootClassName`/`prefixCls`, `style`, `id`, `role`, `tabIndex`, `aria-*` (and bare `aria`), `data-*`, polymorphic `as`/`element`/`component`, framework theming `dt`/`pt`/`ptOptions`/`unstyled`/`sx`. Discrete positional/geometric props (`top`, `bottom`, `left`, `right`, `rotation`, etc.) ARE classified as `string` design props. Common semantic props (`icon`, `items`, `actions`, `options`, `value`, `name`, `form`, `inputId`, `componentId`) are NOT excluded — classify them per their content/design/state nature.
9. No `cdf_type: "link"` used — `link` is reserved and rejected by the CLI parser
10. No `cdf_type: "number"` used — this is not a supported type; use `"string"` with numeric defaults. `cdf_type: "boolean"` IS valid — use it for boolean toggle props.
11. `classify_component` includes a `rationale` object with all three sub-fields (`rationale.description`, `rationale.props`, `rationale.slots`) populated as non-empty strings.
12. Every `classify_slot` includes a non-empty `rationale` string.
13. `rationale.description` follows the same "Description content rules" as `description` — no internal initiative names (`INTEG-*`, `EDSI`, `DSI`, `M1`, `M2`, wave/phase references, etc.).
14. Every `cdf_type: "token"` prop has no `values`, and its accepted values are token references rather than friendly names.
15. Every prop whose values are friendly names is `enum` with a non-empty `values` array, even when each name resolves to a design token internally.
16. Every `cdf_type: "token"` prop can be justified by a line of source that interpolates its value into a style **and** a token reference at that use (Q2 yes, Q3 yes). If you cannot cite both, it is not a `token` — re-emit it as `enum` or `string`. Conversely, every design prop for which you *can* cite both is `token` — its type annotation is not a reason to emit `string`.
17. No prop named in the "declared but no read found" list is classified `token`. Its non-design props were classified on their own merits (media, slot, content), not forced to `enum`/`string` by the list.
18. Every prop for which Q1–Q3 could not be answered from the source shown was emitted as `enum` (or `string`), with the ambiguity stated in `reason`. No prop for which Q1–Q3 *were* answerable was called ambiguous.

After the run completes, the developer can validate the pipeline output with:

```
experience-design-system-cli print validate --components <out-path>
```

Re-run or re-iterate on any components flagged by warnings until the output passes validation.

---

## CRITICAL: Zero-output is a failure

You MUST produce at least one classify_prop call for this component. A response with zero
classify_prop/exclude_prop calls means the component will be pushed with no configurable
properties — this is never acceptable.

If you are genuinely uncertain about every prop, classify each as:
{"tool":"classify_prop","prop":"<name>","cdf_type":"string","cdf_category":"content","required":false,"description":"Uncertain classification — review recommended"}

An imperfect classification is infinitely better than no classification.
