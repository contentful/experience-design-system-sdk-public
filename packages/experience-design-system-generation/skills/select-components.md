# Analyze Select — Agent Component Selection Skill

## Purpose

Review the extracted component definition(s) provided below and decide whether each belongs in **Contentful Experience Orchestration** as a Component Type. Use the supplied framework and source evidence; supported inputs may come from more than one UI framework. The input is a JSON array — you may receive 1–N components in a single message. Output one JSON tool call per input component to stdout, named after the component. Tool calls may appear in any order.

---

## What is Contentful Experience Orchestration?

Contentful Experience Orchestration is a Contentful product that enables **designers, developers, and marketers** to compose and manage digital experiences in Contentful. Component Types are used at every layer of the design system:

- **Atoms** — low-level UI primitives: icons, buttons, inputs, badges
- **Molecules** — composed UI units: cards, search fields, modals, navigation items
- **Organisms** — larger sections: heroes, banners, footers, press release lists, parallax sections

All three levels are valid Component Types in Contentful Experience Orchestration. Designers and developers compose atoms into molecules, molecules into organisms. Marketers then configure content and design values on any of these.

The entity being defined — a **Component Type** — is the schema that tells Contentful what is configurable for this component. It defines design properties, content properties, and slots. Even a component with only a few configurable props is a valid Component Type.

---

## Source purpose and inclusion

Assess the component's declared purpose, visible/configurable surface and actual flow from the supplied source and renderer contract.
Do not use component names, framework families, property counts, styles, callback shapes, structural-only inputs or a known component pattern as an authorability recipe.
A renderable input, including a render callback, may be a source-supported configurable region even when its observed callers are missing or text-only.
Reject only when the supplied source establishes why the entity is outside the target component contract; absence from bounded excerpts is uncertainty.
A wrapper's behavior and delegated data are evidence to inspect, not a blanket rejection rule.
Preserve uncertain inclusion for human review and explain what the source supports.

## Using `selectionContext`

If the input includes `selectionContext`, treat it as the only repo-level context you may use. It is already bounded to the customer-provided project files and may include:

- the component source file
- sibling files in the same folder
- import/export summaries
- resolver or registry references
- one likely parent usage site

## Source evidence and selection uncertainty

- Make acceptance or rejection decisions from the supplied definition and captured evidence. Component names, framework labels, familiar patterns, prop counts, or a likely match in an existing model do not prove the component's purpose or rendering behavior by themselves.
- Captured source references, observations, and parent usage are bounded context. A single caller shows an example of use, not the complete contract or all uses. Missing callers, imports, sibling files, or excerpts do not prove that a component is unused, non-rendering, or an infrastructure wrapper.
- Treat existing model summaries as optional alignment context. They cannot force acceptance or rejection, and a mature model does not change the evidence required for a decision.
- When evidence does not establish whether a component defines author-facing UI, preserve that uncertainty in the reason and lower confidence. Do not turn missing evidence into a rejection.
- The inline context does not provide repository tools, filesystem or working-directory access, a complete compiler graph, final consensus, or an authorability guarantee.

The example component names below are illustrative. Apply an example's decision only when the supplied evidence supports the described behavior; a name alone is not evidence.

Use that bounded context to distinguish the author-facing renderer from infrastructure wrappers. In particular:

- If the component imports a sibling renderer and mainly forwards fetched data into it, reject the wrapper and prefer the sibling renderer.
- If sibling files show a presentation-focused renderer with the real authoring props, that renderer is the Component Type.
- Resolver or parent-usage references help show how the repo treats the component, but they do not override the renderer-vs-wrapper rule.
- Do not assume access to any files outside `selectionContext`.

---

## Output protocol

Emit one JSON object on a single line. Lines not starting with `{` are ignored by the parser — use them freely for reasoning.

**Two tool calls — emit exactly one per input component:**

```
{"tool":"select_component","name":"<ComponentName>","reason":"<brief reason>","confidence":<1-5>}

{"tool":"reject_component","name":"<ComponentName>","reason":"<brief reason>","confidence":<1-5>}
```

**Rules:**

- Emit exactly one JSON object per line. No multi-line JSON. No markdown fences.
- Emit exactly one tool call per input component. Tool calls may appear in any order.
- The `name` must match a component name from the input array exactly.
- `reason` is a brief phrase documenting your decision.
- `confidence` is your certainty (1–5) that the decision is correct:
  - **5** — obvious case, no doubt (clear UI atom, or clear infrastructure with no visual output)
  - **4** — likely correct, minor ambiguity
  - **3** — uncertain, borderline component (few props, ambiguous purpose, could go either way)
  - **2** — low confidence, guessing
  - **1** — very unsure, human review strongly recommended
- Emit prose lines (not starting with `{`) to log your reasoning before the final tool call.

---

## Existing entities in the target space

The preamble may include an "Existing components in the target Contentful space" JSON block and a rolled-up token summary. Use them as **signal, not as a filter**. Rules:

1. Never let a name overlap force a decision. Decide from supplied evidence about whether the component renders visible, author-facing UI; a name match does not auto-accept, and a name conflict does not auto-reject.
2. When a codebase component appears to correspond to an existing space component (name overlap, semantic overlap in the description), note it in your `reason` — e.g. `"accepted; likely maps to existing space component 'Button'"`. This surfaces the mapping for downstream review.
3. A mature space does not change the evidence threshold for deciding whether a component is an author-facing UI surface. Record possible duplication for review without using model size to reject a component.
4. When no overlap exists, the acceptance decision is unchanged from the rules above.
