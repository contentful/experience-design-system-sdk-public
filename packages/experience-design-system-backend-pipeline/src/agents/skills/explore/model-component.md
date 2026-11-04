# Explore one derived model Component

Evaluate only the assigned, already-derived model Component. It represents data supplied to its source owner; it is not a newly discovered visual component. Reuse the owner's prior exploration judgments, disagreements and modeling notes as advisory evidence, and inspect the supplied immutable source and compiler graph to determine what authors should edit. Paths, framework names and familiar component names do not establish authorability.

Return one JSON object, with no tool calls:

```json
{
  "modelKey": "<exact original model key>",
  "nodeId": "<exact logical model node id>",
  "sourceRevision": "<exact source revision>",
  "name": "<readable unique component identifier>",
  "description": "<purpose and what authors can configure>",
  "properties": [
    {
      "name": "<exact field name>",
      "description": "<purpose of this field>",
      "category": "content",
      "authorability": "editable",
      "reasoning": "<source-grounded authoring judgment>",
      "sourceNodeIds": ["<supplied logical node mapped to this exact field>"]
    }
  ],
  "slots": [
    {
      "name": "<exact structural slot name>",
      "description": "<purpose, item grouping and order>",
      "reasoning": "<source-grounded explanation>",
      "sourceNodeIds": ["<supplied slot binding node id>"]
    }
  ],
  "modelingNotes": []
}
```

- Cover every supplied field and structural slot exactly once, including recursive relationships; do not introduce fields, slots, models or source declarations.
- Choose a concise name beginning with a letter and containing only letters, digits, underscores or hyphens. Use the source owner/property context to distinguish its purpose, avoid all reserved names, and omit compiler union indexes and hashes.
- Supply nonempty descriptions and reasoning for every field and slot. Categories are `content` or `design`, chosen from source usage and native target capabilities; type support alone is not authorability.
- `editable` means meaningful user-supplied data or presentation choice affects the source component's output; an implementation-looking name alone does not justify hiding a field.
- `fixed` removes an editor control only for a required, nonnullable intrinsic value with exactly one compiler-declared value and a singleton native representation. The host derives its reconstruction value from source evidence. Defaults, examples, comparisons, caller samples and readonly syntax do not establish an invariant. Never hide an open discriminator merely because the renderer branches on it.
- Use `uncertain` with concrete modeling notes when authoring intent cannot be established. Its existing representation is retained visibly for human review; never silently discard source data or claim a safe exclusion.
- Preserve original field names, types, declared domains, requiredness, defaults, collection grouping, ordering and cardinality. Do not manufacture finite restrictions from observed values, nor reclassify model relationships as visual slots requiring `isRealSlot` evidence.
- Return arrays for properties, slots and modelingNotes, including empty arrays. Each sourceNodeIds list must use the exact supplied field mappings or slot binding.
- Rendering reconstruction remains an explicit runtime requirement; an authoring judgment does not prove that it has been deployed.
