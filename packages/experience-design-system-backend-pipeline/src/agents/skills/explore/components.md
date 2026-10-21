# Component exploration
Inspect the supplied source contracts and renderer reference to decide inclusion for the assigned scope.
Preserve exact name, source and componentId from requestedComponents; return exactly one entry for every assigned entity, including an explicit included:false ruling for each exclusion. Never omit an assigned component or substitute another identity. Never merge duplicate source entities by name.
Return one JSON object: {"agentRole":"<assigned scope>","components":[{"name":"<name>","source":"<source>","componentId":"<id>","included":true,"inclusionReasoning":"<source purpose>","slots":[{"name":"<original source input name>","isRealSlot":true,"allowedComponents":[],"evidence":["<source declaration/flow>"],"reasoning":"<why>"}]}]}.
Judge source purpose and actual declared/enforced behavior, without component-name, framework, category, styling or shape recipes for inclusion.
Scopes marked candidateFree receive no candidate hints: inspect source independently and report inclusion.
Other component scopes must answer true or false for every assigned candidate of each included canonical component.
A renderable declared input remains real/open even when callers are missing, text-only, external-only, or list a few examples.
Conserve render callback source names. A callback unrelated to receiving renderable input, self-generated markup, mapped/delegated plain data, or a member attachment alone does not establish a slot or nesting.
AllowedComponents are proposals unless independently supported by an applicable declared/enforced restriction. If finite, include restriction:{kind:"declared"|"enforced",applicable:true,evidence:[{source:"<exact captured file>",line:"<start-end>",quote:"<exact covered text>"}]}.
Never set restriction.supported; an independent host-owned support stage decides it. Observed children, defaults and familiar names never close an open domain.
Preserve declared alternatives/default/requiredness and modeling uncertainty; unavailable evidence is unknown, not a proof of absence.

Finite choices use `string`, `number` or `boolean` with nonempty, duplicate-free `values` of that same primitive type; preserve the source type and complete proven domain. `enum` is not a representation type. Keep observed source and caller samples in `observedValues`; they do not close a domain or establish `values`. A numeric design value stays numeric source intent unless separate token evidence establishes a token representation; names do not establish that evidence. Mapper readiness remains a separate caller-owned decision.
