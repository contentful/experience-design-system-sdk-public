# Analyze Select — Agent Component Selection Skill

## Purpose

Review the single extracted React/Next.js component provided below and decide whether it belongs in **Contentful Experience Orchestration** as a Component Type. Output one JSON tool call to stdout.

---

## What is Contentful Experience Orchestration?

Contentful Experience Orchestration is a Contentful product that enables **designers, developers, and marketers** to compose and manage digital experiences in Contentful. Component Types are used at every layer of the design system:

- **Atoms** — low-level UI primitives: icons, buttons, inputs, badges
- **Molecules** — composed UI units: cards, search fields, modals, navigation items
- **Organisms** — larger sections: heroes, banners, footers, press release lists, parallax sections

All three levels are valid Component Types in Contentful Experience Orchestration. Designers and developers compose atoms into molecules, molecules into organisms. Marketers then configure content and design values on any of these.

The entity being defined — a **Component Type** — is the schema that tells Contentful what is configurable for this component. It defines design properties, content properties, and slots. Even a component with only a few configurable props is a valid Component Type.

---

## The one rule: is this the author-facing UI component?

**Accept** the component if it is the component that directly defines the author-facing UI surface — regardless of whether it is an atom, molecule, or organism, and regardless of whether it has many or few configurable props. A footer icon with two props (`icon`, `label`) is just as valid as a parallax hero with fifteen props.

**Reject** the component if its primary purpose is framework or data-loading infrastructure rather than the author-facing UI surface:

- It is a React hook (name starts `use` or `Use`)
- It is a pure context provider with no visual output
- It is a Ninetailed/personalization platform wrapper (its job is routing to variants, not rendering content)
- It is a data-fetch wrapper that loads data for a sibling renderer and then forwards that data into the sibling renderer
- It is an analytics/event-tracking component (fires events, renders nothing)
- It is a security or infrastructure utility (no UI at all)

---

## What NOT to use as a rejection reason

These are **not** valid reasons to reject a component:

| Invalid reason                                     | Why it is wrong                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| "Only atoms/low-level"                             | Atoms are first-class Component Types in Contentful Experience Orchestration                                              |
| "Tightly coupled to a parent component"            | Contentful Experience Orchestration handles composition at the experience layer                                           |
| "Has A/B testing or personalization-related props" | These props are classified as `state` or excluded in the generate step — their presence does not disqualify the component |
| "Has no marketer-configurable props"               | Marketers are not the only users; designers and developers configure components too                                       |
| "Domain-specific or feature-level"                 | Press releases, newsrooms, search — all valid content components                                                          |
| "Server-side or SSR"                               | Server components that render visible UI are valid                                                                        |
| "Few configurable props"                           | One or two props is fine                                                                                                  |

---

## Reject only these categories

| Category                                    | Why                                                                                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **React hooks**                             | `useXxx` / `UseXxx` — functions, not renderable components. Zero visual output.                                                                                     |
| **Pure context providers**                  | Wrap children to pass context but render no UI themselves                                                                                                           |
| **A/B testing or personalization wrappers** | Components whose _entire purpose_ is routing users to content variants or tracking experiment participation — they render no UI of their own                        |
| **Data-fetch wrappers**                     | Components whose job is to load or resolve data for a sibling renderer. Even if they eventually return visible UI, the sibling renderer is the real Component Type. |
| **Analytics and event tracking**            | Components that only fire analytics events and render nothing visible                                                                                               |
| **Security utilities**                      | Non-visual security primitives with no rendered output                                                                                                              |

> **Variant routing rule**: Reject a component if its entire purpose is deciding _which_ content variant to show — that is framework infrastructure, not a Component Type. Do **not** reject a component merely because it _contains_ some A/B testing or personalization-related props — those props are handled as `state` in the generate step.

> **Data-fetch wrapper rule**: Reject a component if it imports or calls a generated query hook, loads data, and then forwards that data into a sibling renderer. The sibling renderer is the Component Type; the data-loader wrapper is not.

> **Utility-wrapper rule**: Reject a component if **all three** of the following are true:
>
> 1. It has no props that meaningfully shape user-facing content (no text strings, headings, image URLs, links, body content, rich text, or media references).
> 2. The props it does have are purely structural or behavioral — e.g., `container`, `target`, `as`, `asChild`, render-prop callbacks, internal `ref` forwarding, focus/portal targets, debug toggles, or `children` only.
> 3. It is a utility wrapper rather than a composable content surface. Concrete examples to reject under this rule: `Portal`, `SrOnly` (screen-reader-only wrappers), `FocusTrap`, `ErrorBoundary`, `Suspense` fallbacks, debug-only wrappers, and provider-shaped components whose only job is to forward children.
>
> Use `reject_component` with a reason like `"Utility wrapper — no authorable content surface"` or `"Structural-only component — no user-shaping props"`. This rule is additive to the categories above; do **not** use it to reject a component that has even one author-shaping prop (e.g., a `label`, `title`, `text`, `href`, `src`, or `richText` prop) — those still belong as Component Types per the "one rule" above.

## Using `selectionContext`

If the input includes `selectionContext`, treat it as the only repo-level context you may use. It is already bounded to the customer-provided project files and may include:

- the component source file
- sibling files in the same folder
- import/export summaries
- resolver or registry references
- one likely parent usage site

Use that bounded context to distinguish the author-facing renderer from infrastructure wrappers. In particular:

- If the component imports a sibling renderer and mainly forwards fetched data into it, reject the wrapper and prefer the sibling renderer.
- If sibling files show a presentation-focused renderer with the real authoring props, that renderer is the Component Type.
- Resolver or parent-usage references help show how the repo treats the component, but they do not override the renderer-vs-wrapper rule.
- Do not assume access to any files outside `selectionContext`.

---

## Output protocol

Emit one JSON object on a single line. Lines not starting with `{` are ignored by the parser — use them freely for reasoning.

**Two tool calls — emit exactly one:**

```
{"tool":"select_component","name":"<ComponentName>","reason":"<brief reason>","confidence":<1-5>}

{"tool":"reject_component","name":"<ComponentName>","reason":"<brief reason>","confidence":<1-5>}
```

**Rules:**

- Emit exactly one JSON object, on one line. No multi-line JSON. No markdown fences.
- The `name` must match the component name in the input.
- `reason` is a brief phrase documenting your decision.
- `confidence` is your certainty (1–5) that the decision is correct:
  - **5** — obvious case, no doubt (clear UI atom, or clear infrastructure with no visual output)
  - **4** — likely correct, minor ambiguity
  - **3** — uncertain, borderline component (few props, ambiguous purpose, could go either way)
  - **2** — low confidence, guessing
  - **1** — very unsure, human review strongly recommended
- Emit prose lines (not starting with `{`) to log your reasoning before the final tool call.

---

## Examples

```
Analytics — fires analytics events, no visual output
{"tool":"reject_component","name":"Analytics","reason":"analytics tracker — no visual output"}
```

```
CanaryToken — security utility, no visual output
{"tool":"reject_component","name":"CanaryToken","reason":"security utility — no visual output"}
```

```
ClientExperience — personalization wrapper whose entire purpose is routing users to content variants
{"tool":"reject_component","name":"ClientExperience","reason":"variant routing wrapper — entire purpose is A/B routing, not rendering UI"}
```

```
ComponentMarker — experimentation marker component, no visual output
{"tool":"reject_component","name":"ComponentMarker","reason":"experimentation marker — no visual output"}
```

```
ComponentTracker — variant attribution tracker, no visual output
{"tool":"reject_component","name":"ComponentTracker","reason":"variant attribution tracker — no visual output"}
```

```
Refresh — client-side route refresh utility for personalization platform, no visual output
{"tool":"reject_component","name":"Refresh","reason":"personalization route refresh utility — no visual output"}
```

```
ServerExperience — server-side variant routing wrapper, no visual output
{"tool":"reject_component","name":"ServerExperience","reason":"server-side variant routing wrapper — no visual output"}
```

```
UseHelpNavigation — React hook, not a renderable component
{"tool":"reject_component","name":"UseHelpNavigation","reason":"React hook — not a renderable component"}
```

```
Providers — React context provider with no visual output
{"tool":"reject_component","name":"Providers","reason":"pure context provider — no visual output"}
```

```
HeroBannerGql — fetch wrapper that loads data and forwards it into HeroBanner
It may eventually return visible UI, but the author-facing component is HeroBanner, not HeroBannerGql.
{"tool":"reject_component","name":"HeroBannerGql","reason":"data-fetch wrapper — loads data for a sibling renderer rather than defining the author-facing UI surface"}
```

```
FooterIcon — atom: renders an icon with optional label in the footer
{"tool":"select_component","name":"FooterIcon","reason":"UI atom — renders icon with configurable icon and label"}
```

```
FeedbackModal — modal dialog with visibility state
{"tool":"select_component","name":"FeedbackModal","reason":"modal UI component with configurable visibility and content"}
```

```
ActiveFilters — renders active filter chips with remove controls
{"tool":"select_component","name":"ActiveFilters","reason":"filter UI component — renders visible filter chips"}
```

```
FullSizeBarNoContent — full-width text bar with link; has some personalization state props
The personalization props (hideContentForPersonalization, componentId) are state props handled in the generate step.
The component renders real visual UI — a bar with text, chevron, and link.
{"tool":"select_component","name":"FullSizeBarNoContent","reason":"content bar UI — renders visible bar with configurable text, link, and design"}
```

```
ParallaxComponent — parallax marketing section; has some A/B testing props alongside real content props
The A/B testing props (abmFallback, abmLinkedFromAccount) are state props, not the component's primary purpose.
The component renders a parallax section with title, subtitle, and visual effects.
{"tool":"select_component","name":"ParallaxComponent","reason":"marketing section UI — renders parallax content with configurable title, subtitle, and design"}
```

```
NewsroomLandingPressReleases — press release list with pagination and locale
{"tool":"select_component","name":"NewsroomLandingPressReleases","reason":"content list UI — renders press releases with configurable locale and pagination"}
```

```
ServerHelpNavigation — server-side navigation with configurable search visibility and locale
{"tool":"select_component","name":"ServerHelpNavigation","reason":"navigation UI — renders help navigation with configurable locale and search toggle"}
```

```
TextImageCard — card with rich text and background image
{"tool":"select_component","name":"TextImageCard","reason":"content card UI — configurable rich text, image, and layout"}
```

```
SearchInput — search field with dropdown
{"tool":"select_component","name":"SearchInput","reason":"search UI — configurable placeholder and state"}
```
