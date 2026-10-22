# Structured property modeling

## Decision

An editable representation follows source value structure and supported target positions. The number of generated Components is determined by independently editable data and required instance boundaries. Source names, frameworks, directory layouts and library-specific recipes do not determine the representation.

| Source structure | Preferred representation |
| --- | --- |
| Supported scalar | Native property |
| Object whose fields fit a native Record | Native Record property |
| Array whose complete items fit native fields or Records | Native Array property, including Array<Record> |
| Object with editable fields requiring model structure | Model Component; retain native fields within it |
| Optional/nullable union with one nonempty structural value | Underlying model plus explicit optional-value reconstruction |
| Single-field structural envelope without separately editable values | Object-envelope reconstruction with the exact source key |
| Array of model values | Ordered slot of model instances, when element boundaries are preserved |
| Recursive reference | Reuse the existing model definition |

The native candidate takes precedence when the complete source value fits. Objects remain objects and arrays remain arrays. A primitive-only object does not become an Array<Record> unless the source itself is an array.

## Reconstruction mapping

Compaction changes the physical authoring structure without rewriting the compiler graph. Every source occurrence retains its exact identity, path, requiredness, readonly evidence, nullable/undefined domain and default intent.

Removed scaffolding receives a `reconstruction` mapping with one of these operations:

- `optional-value`: identify the union's single nonempty value node.
- `object-envelope`: reconstruct the exact single-field object around its value node.
- `ordered-array`: reconstruct an array from ordered item instances.
- `empty-value`: retain a null, undefined or never source alternative explicitly.
- `fixed-value`: reconstruct a required, nonnullable field with exactly one compiler-declared value, when its model exploration identifies it as fixed structural data.

These operations describe the deferred generic rendering projection. They do not establish deployed reconstruction support or null/omission equivalence; source-bound null judgments and runtime requirements remain separate. Required arrays can be empty, and empty arrays or objects are not substitutes for unset values. Defaults and presence behavior remain in the source model and mapping, including where physical slots have zero instances.

## Boundaries that remain

Compaction retains a model when removing its instance boundary would erase independently meaningful state:

- Nullable or undefined array elements retain their positions rather than disappearing from the list.
- Nested arrays retain grouping rather than becoming one flattened list.
- Array-item envelopes with optional contents retain independently meaningful empty items.
- Multi-alternative unions retain branch selection and discriminator evidence.
- Recursive chains consisting only of structural envelopes retain nesting boundaries.
- Objects containing editable native properties retain those properties and their owner.

Incomplete or held plans retain their source evidence; compaction does not turn an incomplete representation into successful output.

## Enforcement and lifecycle

Shared exploration rules and generation guidance apply this policy. Source analysis offers strategies from the supplied structure; generation selects native properties wherever the category and target position support the complete value. Host derivation compacts model plans, and canonical validation rederives the exact plan. Complete CDF validation checks reconstruction operations against retained source shapes and validates the model dependency closure.

Generated models appear as real Components in review and accompany their source owner in selected CDF output. Model edits remain owned by the selected source plan. Regenerate old plans produced under the previous one-model-per-structural-node derivation; their signed model sets are not interchangeable with compact plans.

## Component-scoped exploration during generation

When generation selects a model representation, each newly derived Component goes through its own scoped exploration before the owner is saved as complete. It uses the existing explorer prompt builder, shared exploration rules, agent invoker and validation-feedback retry loop. This is one targeted authoring pass per model, not a new whole-project exploration or another multi-agent consensus run.

The pass receives the owner's saved source, exact compiler graph and mappings, and existing component-scoped consensus, checked judgments, disagreements and modeling notes. It must return a readable Component name and description, descriptions and source-bound authorability judgments for every property, and descriptions and reasoning for every structural slot. All fields and slots must be accounted for exactly once; source identities, types, domains, requiredness, defaults and relationship cardinality remain host-owned.

An `editable` judgment exposes a native field in its supported content or design category. An `uncertain` judgment keeps the field visible and records the concrete uncertainty for human review. A `fixed` judgment can remove a control only when a required, nonnullable singleton value is proven by the compiler and can be retained as explicit reconstruction metadata. Examples, defaults, readonly syntax and comparisons do not establish an invariant. An open discriminator remains editable or uncertain unless a separate source-grounded representation preserves all its choices.

Validated exploration reports are retained inside the signed representation plan, with field reasoning and modeling notes. Readable names replace internal IDs in references and review labels while original identities remain available for source ownership. A failed model pass prevents that owner from being completed; unrelated generation tasks can continue.

Explicit debug resume from generation upgrades complete saved definitions that lack model exploration by running only those model passes, using their saved owner context. It preserves already explored models and other completed components. Rendering reconstruction, including intrinsic fixed fields, remains deferred; this pass does not implement the integration service or the rendering SDK.

Verification scope for this change uses package builds, typechecks and lint; no tests or live agent evaluations are run under the current execution constraint.
