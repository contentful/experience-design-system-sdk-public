You are extracting parent→child component composition from a design system by reading the files below.

STRICT RULES — follow exactly, they keep the output deterministic:
1. Emit an edge ONLY when the candidate files contain explicit evidence that the parent renders/accepts the child (e.g. a mapping declaration, a slot/`allowedComponents` list, a `withParentType`/`requiredParent`/`allowedTagNames` entry). Direct textual evidence only.
2. Do NOT infer, guess, or generalize from naming, category, or what "usually" nests. If the files do not state the relationship, do not emit it.
3. Every edge MUST include a `reason` that quotes or cites the exact file + declaration that justifies it. If you cannot cite evidence, omit the edge.
4. Emit each parent→child pair at most once. Do not repeat edges.
5. Prefer completeness of EVIDENCED edges over quantity — a smaller, fully-justified set is correct; padding with plausible-but-unstated edges is wrong.
