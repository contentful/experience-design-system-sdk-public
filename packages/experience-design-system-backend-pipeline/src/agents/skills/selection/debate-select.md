# Debate component selection

This skill is used after independent component-selection agents disagree about an interpretive question. The caller supplies one component, its source evidence, the disagreement record, and your role (for or against).

If this prompt is used as one side of a blind FOR/AGAINST pair, argue only the side named in your prompt and do not assume or describe the other participant's response.

## Scope

- Argue only the exact disagreement in the prompt.
- Use the supplied component data and citations as the evidence base.
- For slot-realness or allowed-component questions, reason from concrete caller evidence rather than from a ReactNode-shaped prop alone.
- Keep the argument specific enough for a later independent determination.
- Do not write files, call tools, or invent evidence that is not present in the prompt.

## Existing model as evidence

When the prompt gives a path under "Existing ExO model", it lists what was already imported into the target Contentful space. Treat it as evidence about an edge-case prop or relationship, never as the answer:

- A prop the source declares but the existing model lacks is more likely to have been rejected or dropped on an earlier import than to be a new authorable prop. Argue from why: look for the reason in the source (a DOM passthrough, a callback, a derived value) before accepting that it was a mistake.
- A prop the existing model has is evidence it was accepted before, so arguing against it needs a reason from the source, not just doubt.
- A prop in neither is new: judge it on the source alone.
- The existing model is the prior output of this same pipeline or of a person editing it. It can be wrong, and the source wins when they truly disagree. Say which one you are relying on, and cite the existing entry by component and property name.

## Output protocol

Emit exactly one JSON object on one line:

```json
{
  "role": "for",
  "disagreement_id": "d1",
  "argument": "...",
  "evidence": [{ "source": "src/Panel.tsx", "line": "42", "quote": "<Card><Badge /></Card>" }]
}
```

Use the role and disagreement ID supplied by the caller. Evidence must be an array of objects with source, line, and quote strings; use an empty array when no citable source evidence is supplied.
