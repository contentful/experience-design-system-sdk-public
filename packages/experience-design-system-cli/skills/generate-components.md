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

```typescript
interface RawPropDefinition {
  name: string;
  type: string;            // raw TypeScript type, e.g. "'primary' | 'secondary'"
  required: boolean;
  category?: 'content' | 'design' | 'state';  // pre-classified — verify, do not blindly trust
  allowedValues?: string[];
  defaultValue?: string;
  description?: string;
  tokenReference?: string;  // raw token name, e.g. "--brand-primary"
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
{"tool":"classify_component","description":"<required: one-sentence description of the component>"}

{"tool":"classify_prop","prop":"<propName>","cdf_type":"<type>","cdf_category":"<category>","required":<bool>,"description":"<reason>","values":["a","b"],"token_kind":"color","default":"<value>"}

{"tool":"exclude_prop","prop":"<propName>","reason":"<why excluded>"}

{"tool":"classify_slot","slot":"<slotName>","required":<bool>,"allowed_components":["ComponentName"],"description":"<reason>"}
```

**Rules:**
- Emit exactly one JSON object per line. No multi-line JSON.
- Every prop in the input must produce exactly one call: `classify_prop` OR `exclude_prop`.
- Every slot must produce exactly one `classify_slot` call.
- Emit `classify_component` once at the start (required). The `description` field is **required** — always provide a brief description of the component's purpose.
- `values` is required for `cdf_type: "enum"` — must be a non-empty string array.
- `token_kind` is required for `cdf_type: "token"` — must be a DTCG `$type` string, e.g. `"color"`.
- `required` must be a JSON boolean (`true`/`false`), not a string.
- `description` on `classify_prop` documents your reasoning — always include it.

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
   - DOM pass-through: `className`, `class`, `classes`, `classNames`, `rootClassName`, `prefixCls`, `style`, `styles`, `id`, `role`, `tabIndex`, `name` (the bare HTML form `name` attribute), `htmlFor`, `for`, `slot`, `is`, `lang`, `dir`, `hidden`, `draggable`, `spellCheck`, `contentEditable`, `inputMode`, `autoComplete`, `autoFocus`, `translate`, `part`, `exportparts`
   - Accessibility pass-through: any `aria-*` or `ariaSomething` prop (including bare `aria` as an aria-attributes object), `aria-label`, `aria-hidden`, `aria-describedby`, `aria-controls`
   - Data attributes: any `data-*` prop
   - **Polymorphic component props**: `as`, `element`, `component` (when typed as an HTML tag string or component reference) — these change rendered HTML, not marketer-visible behavior
   - **Framework theming / pass-through escape hatches**: PrimeVue's `dt` / `pt` / `ptOptions` / `unstyled`, MUI/Chakra-style `sx`, anything explicitly typed as a developer "override" / "passthrough" object
   - **Important caveat**: only exclude when the prop is one of these *as the bare HTML attribute or framework-internal pass-through*. Compound names like `fileName`, `displayName`, `dataset`, `dataSource`, `roleDescription`, `idLabel` are not pass-through — classify them normally.
2. **Common semantic props — DO classify, do not exclude.** The LLM has been over-excluding these because they sound like framework internals; they are not. Classify each per the rest of this tree:
   - `icon` / `leftIcon` / `rightIcon` / `prefixIcon` / `suffixIcon` — slot or `string` (icon name); see slot guidance below
   - `items` / `options` / `actions` / `links` — usually array content; if the element shape is simple, classify as `string` (comma-separated names/IDs) and note in `description`. Only exclude when elements are deep nested objects with no flat representation.
   - `value` (the bare prop, not `modelValue`) — content prop, usually `string` (or `enum` if from a fixed set). Note: Vue's `modelValue` / `modelModifiers` are excluded by pre-classify because they're v-model framework wiring.
   - `form` (when not the literal `<form>` HTML attribute) — typically content; classify as `string` unless it's a complex form-config object
   - `inputId` / `componentId` — these CAN be content (anchor IDs, marketer-set tracking refs). Classify as `string`, `cdf_category: "content"` when the type is a plain string. Only exclude if the prop is clearly internal (e.g. typed as a generated React ID).
   - `accessibleNameRef` / `accessibleDescriptionRef` (web components) — these are ID references for a11y wiring; classify as `string`, `cdf_category: "state"` (behavioral wiring, not design or content).
   - `eventDetails` / similar telemetry props — `cdf_category: "state"`.
3. **Positional/geometric design prop?** (`top`, `bottom`, `left`, `right`, `rotation`, `offset`, `zIndex`) → `classify_prop`, `cdf_type: "string"`, `cdf_category: "design"`.
4. **Has `tokenReference`?** → `cdf_type: "token"`, resolve `token_kind` via sidecar lookup (see below). This overrides all other heuristics.
5. **Union of string literals** (e.g. `'a' | 'b' | 'c'`)? → `cdf_type: "enum"`, extract literals into `values`.
6. **Raw type is `string`** and prop name is `href`, `url`, or clearly a URL? → `cdf_type: "string"`, `cdf_category: "content"`.
7. **Raw type is `string` / `number` / `boolean`?** → For `boolean`, use `cdf_type: "boolean"` with `default: true` or `false` (native boolean). For `number`, use `cdf_type: "string"` with `default` as the numeric value as a string (e.g. `"0"`). For `string`, use `cdf_type: "string"`.
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

When `tokenReference` is present, classify with `cdf_type: "token"`. The `token_kind` field becomes `$token.kind` in the CDF output (a DTCG `$type` string, e.g. `"color"`).

1. Look up `tokenReference` in the inline token-name sidecar → get the DTCG dot-notation path
2. Traverse that path in the inline DTCG token data to reach the leaf token
3. Use the leaf's `$type` (e.g. `"color"`) as `token_kind`

Example:
```
tokenReference: "--brand-primary"
  → sidecar["--brand-primary"] → "colors.brand.primary"
  → token data: colors.brand.primary.$type → "color"
  → tool call: {"tool":"classify_prop","prop":"bgColor","cdf_type":"token","cdf_category":"design","token_kind":"color","description":"..."}
```

If `tokenReference` is not found in the sidecar → `cdf_type: "token"`, omit `token_kind`, add `description: "WARNING: tokenReference not found in sidecar — token_kind unknown"`.

If token data was not provided and `tokenReference` is present → `cdf_type: "token"`, omit `token_kind`, add `description: "WARNING: no token data supplied — token_kind unknown"`.

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
{"tool":"classify_component","description":"Primary action button with variant and state support"}
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
{"tool":"classify_slot","slot":"icon","required":false,"description":"Optional leading icon"}
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
5. Every `cdf_type: "token"` has `token_kind` (or a warning in `description` if lookup failed)
6. No `cdf_type: "link"` — all href/url props use `string`
7. `required` values are JSON booleans, not strings
8. Framework, DOM, accessibility, and data-* pass-through props are excluded — `className`/`classes`/`classNames`/`rootClassName`/`prefixCls`, `style`, `id`, `role`, `tabIndex`, `name` (bare HTML form attribute), `aria-*` (and bare `aria`), `data-*`, polymorphic `as`/`element`/`component`, framework theming `dt`/`pt`/`ptOptions`/`unstyled`/`sx`. Discrete positional/geometric props (`top`, `bottom`, `left`, `right`, `rotation`, etc.) ARE classified as `string` design props. Common semantic props (`icon`, `items`, `actions`, `options`, `value`, `form`, `inputId`, `componentId`) are NOT excluded — classify them per their content/design/state nature.
9. No `cdf_type: "link"` used — `link` is reserved and rejected by the CLI parser
10. No `cdf_type: "number"` used — this is not a supported type; use `"string"` with numeric defaults. `cdf_type: "boolean"` IS valid — use it for boolean toggle props.

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
