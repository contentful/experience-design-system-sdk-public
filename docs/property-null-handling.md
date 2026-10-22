# Null handling in property generation

Source types describe runtime inputs. An editable property describes what an author can configure. The source graph retains its complete nullable domain even when the editable representation uses an optional underlying type.

## Policy

| Source behavior | Editable representation |
| --- | --- |
| Null and omission have equivalent behavior | An optional underlying type, with an explicit source-bound judgment |
| Null clears a value, suppresses a default or selects different behavior | Preserve the distinction through a compatible representation |
| Null behavior is unknown | Retain the selected type and specific uncertainty; validation keeps the definition incomplete |

Nullable does not imply optional. Requiredness remains source-owned. Empty strings, false, zero and empty containers are not substitutes for null. Null alone does not justify a JSON property or model Component.

Agents assess supplied source evidence for defaults, comparisons, forwarding and output effects. Their judgment is recorded separately from compiler facts; the validator checks the judgment's structure, source identity, named nullable union, requiredness and the remaining representation contract. It does not independently prove behavioral equivalence from an agent's rationale.

## Decision metadata

A generation decision using omission equivalence includes its current property `source_revision`, root `source_node_id`, and one judgment per nullable union:

```json
{
  "null_handling": [
    {
      "sourceNodeId": "<nullable-union-node-id>",
      "handling": "omit-equivalent",
      "reason": "Both null and omission select the same source behavior; no default or forwarded use distinguishes them."
    }
  ]
}
```

`distinct` and `unknown` are also valid judgments, but do not authorize collapsing null into omission. A judgment cannot make a required input optional or remove a null array element. Non-null alternatives and native finite-value constraints remain checked. Original source graphs are never rewritten.

For an optional property whose source default is null and whose omission equivalence is established, the editable scalar default stays absent; the original null default remains in the saved source model. An explicitly supplied null scalar default is rejected.

## Completion

Every retained `classify_prop` must select a supported native `cdf_type` or a supplied source-bound model candidate. Incomplete drafts can receive repair feedback, but generation succeeds only when all subjects are accounted for and every retained local representation is ready. Exhausting the repair attempt limit cannot turn a pending representation into success. Exclusions remain semantic decisions, not an escape from representation validation.

[Structured-property modeling](structured-property-modeling.md) compacts nullable/optional structural wrappers into reconstruction metadata. This removes redundant authoring Components without deleting source alternatives, changing requiredness or asserting null/omission equivalence. Nullable array elements retain an instance boundary where required to preserve their positions.

The same validation runs in the supplied agent draft validator and in host generation. Exploration can preserve unresolved evidence for generation to resolve. Remote mapper availability and rendering capabilities remain separate constraints.
