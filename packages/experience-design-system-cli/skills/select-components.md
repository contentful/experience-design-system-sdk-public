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

## The one rule: does it render visible UI?

**Accept** the component if it renders visible UI — regardless of whether it is an atom, molecule, or organism, and regardless of whether it has many or few configurable props. A footer icon with two props (`icon`, `label`) is just as valid as a parallax hero with fifteen props.

**Reject** the component only if its primary purpose produces zero visual output:
- It is a React hook (name starts `use` or `Use`)
- It is a pure context provider with no visual output
- It is a Ninetailed/personalization platform wrapper (its job is routing to variants, not rendering content)
- It is an analytics/event-tracking component (fires events, renders nothing)
- It is a security or infrastructure utility (no UI at all)

---

## What NOT to use as a rejection reason

These are **not** valid reasons to reject a component:

| Invalid reason | Why it is wrong |
|---|---|
| "Only atoms/low-level" | Atoms are first-class Component Types in Contentful Experience Orchestration |
| "Tightly coupled to a parent component" | Contentful Experience Orchestration handles composition at the experience layer |
| "Has A/B testing or personalization-related props" | These props are classified as `state` or excluded in the generate step — their presence does not disqualify the component |
| "Has no marketer-configurable props" | Marketers are not the only users; designers and developers configure components too |
| "Domain-specific or feature-level" | Press releases, newsrooms, search — all valid content components |
| "Server-side or SSR" | Server components that render visible UI are valid |
| "Few configurable props" | One or two props is fine |

---

## Reject only these categories

| Category | Why |
|---|---|
| **React hooks** | `useXxx` / `UseXxx` — functions, not renderable components. Zero visual output. |
| **Pure context providers** | Wrap children to pass context but render no UI themselves |
| **A/B testing or personalization wrappers** | Components whose *entire purpose* is routing users to content variants or tracking experiment participation — they render no UI of their own |
| **Analytics and event tracking** | Components that only fire analytics events and render nothing visible |
| **Security utilities** | Non-visual security primitives with no rendered output |

> **Variant routing rule**: Reject a component if its entire purpose is deciding *which* content variant to show — that is framework infrastructure, not a Component Type. Do **not** reject a component merely because it *contains* some A/B testing or personalization-related props — those props are handled as `state` in the generate step.

---

## Output protocol

Emit one JSON object on a single line. Lines not starting with `{` are ignored by the parser — use them freely for reasoning.

**Two tool calls — emit exactly one:**

```
{"tool":"select_component","name":"<ComponentName>","reason":"<brief reason>"}

{"tool":"reject_component","name":"<ComponentName>","reason":"<brief reason>"}
```

**Rules:**
- Emit exactly one JSON object, on one line. No multi-line JSON. No markdown fences.
- The `name` must match the component name in the input.
- `reason` is a brief phrase documenting your decision.
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
