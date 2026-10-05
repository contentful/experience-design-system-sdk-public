# Debate component selection

This skill is used after independent component-selection agents disagree about an interpretive question. The caller supplies one component, its source evidence, the disagreement record, and your role (for or against).

The caller dispatches a blind FOR/AGAINST pair; argue only the side named in your prompt and do not assume or describe the other participant's response.

## Scope

- Argue only the exact disagreement in the prompt.
- Use the supplied component data and citations as the evidence base.
- For slot-realness or allowed-component questions, reason from concrete caller evidence rather than from a ReactNode-shaped prop alone.
- Keep the argument specific enough for an orchestrator to make an independent determination.
- Do not write files, call tools, or invent evidence that is not present in the prompt.

## Output protocol

Emit exactly one JSON object on one line:

~~~json
{"role":"for","disagreement_id":"d1","argument":"...","evidence":[{"source":"src/Panel.tsx","line":"42","quote":"<Card><Badge /></Card>"}]}
~~~

Use the role and disagreement ID supplied by the caller. evidence must be an array of objects with source, line, and quote strings; use an empty array when no citable source evidence is supplied.
