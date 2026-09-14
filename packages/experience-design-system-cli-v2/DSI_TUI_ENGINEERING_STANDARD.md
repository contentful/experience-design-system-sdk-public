# EDSI Engineering Design and Implementation Standard

## Purpose

This document defines how humans and coding agents design, implement, test, and review changes in EDSI repositories.

Our primary goal is software that remains safe and easy to change as the system grows. We prefer established patterns, explicit behavior, centralized policy, and readable code over cleverness, novelty, or minimizing line count.

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** express requirement strength. A deviation from a **MUST** requires an explicitly documented exception. A deviation from a **SHOULD** requires sound engineering judgment but does not necessarily require formal approval.

### How to read this document

The standard is in two parts.

**Part I — Engineering principles** (§ 1–13) applies to any change, in any language, at any layer. It is durable: it should rarely need editing as the system evolves.

**Part II — EDSI conventions** (§ 14–27) states the concrete, repository-specific rules that implement those principles here — file layout, boundary policy, library placement, alerting, and so on. It changes as the repository changes.

When Part II states a rule, it is because Part I's principle alone left a real decision ambiguous and we chose an answer. Where a Part II rule cites its Part I parent, follow both.

### Scope of application

These rules govern **new code and deliberate refactors**. This document is not a remediation backlog. When you touch an area non-trivially, bring it toward these rules; when you are merely passing through, leave it alone.

Several Part II sections cite existing code that does not follow the rule stated above it. Those citations exist to show the rule is grounded in a real failure mode, not to assign work.

### Where the facts live

This document says *how to work*. It deliberately does not restate *what the system currently does* — duplicating that here would create a second source of truth that drifts, which is the exact failure § 27 exists to prevent. When you need current behavior:

| Question | Document |
| --- | --- |
| What is the system, end to end? | `ARCHITECTURE.md` |
| What routes, dependencies, and gaps does a service have? | `docs/current/service-behavior.md` |
| What external systems do we touch, and who owns what? | `docs/current/system-boundaries.md` |
| How does code reach an environment? | `docs/current/operations-and-deployment.md` |
| What is logged, measured, and alarmed? | `docs/current/observability.md` |
| Where does a concern live in the tree? | `docs/reference/repo-map.md` |
| What commands exist, and what does CI enforce? | `docs/reference/testing-and-quality.md` |
| Why does the system look like this? | `docs/decisions/` (ADRs) |
| What is a term of art here? | `docs/reference/glossary.md` |
| What are the trust boundaries and known security gaps? | `docs/security/threat-model.md` |
| Something is broken — where do I look? | `docs/runbooks/debugging.md` |
| Where do docs and code currently disagree? | `docs/trajectory/discrepancy-register.md` |
| Coordination rules for parallel and agent contribution | `AGENTS.md` |

`docs/archive/` is unmaintained by design. Never cite it as current behavior; see its README.

Two consequences worth stating plainly. **A rule here that contradicts observed code is a bug in this document** — fix it, or record the exception (§ 13). And a document in the table above that contradicts the code is the failure § 27 governs: fix it in the same PR that caused the drift.

## Engineering priorities

When principles conflict, use this order of precedence:

1. Correctness and security
2. API contract and data integrity
3. Reliability and operability
4. Consistency with established patterns
5. Maintainability and human readability
6. Measured performance and cost
7. Local elegance and style

Performance may move higher when a documented requirement or production measurement shows that it is critical. The reason and tradeoff MUST then be recorded in an ADR, design document, or PR description.

---

# Part I — Engineering principles

## 1. Start with the existing system

Before implementing a change, contributors MUST inspect the relevant repository context, including:

- analogous implementations;
- shared utilities and domain types;
- callers and downstream consumers;
- tests and fixtures;
- public and internal contracts;
- generated artifacts;
- configuration and deployment assumptions.

Contributors SHOULD extend an established pattern when it satisfies the new requirement. They MUST NOT introduce a competing pattern merely because it is locally convenient or familiar from another codebase.

If no suitable pattern exists, the contributor MUST make that explicit and document any significant new approach. A new pattern SHOULD be designed for the immediate, demonstrated requirements, not speculative future use cases.

## 2. Optimize for maintainability

Code MUST make its behavior, inputs, outputs, side effects, and failure modes understandable to another engineer.

Prefer:

- straightforward control flow;
- explicit domain concepts;
- small, cohesive units with clear responsibilities;
- descriptive names;
- typed API contracts;
- immutable data, where practical;
- dependencies that are visible at the call site or constructor boundary;
- early validation at system boundaries.

Avoid:

- clever or surprising control flow;
- hidden mutation or implicit global state;
- unnecessary wrappers and pass-through layers;
- abstractions with only hypothetical reuse;
- boolean parameters whose meaning is unclear at the call site;
- dense expressions that combine unrelated decisions;
- defensive branches for states made impossible by the type or schema;
- dead code, speculative hooks, and unused extensibility;
- large functions that mix orchestration, policy, transport, parsing, and persistence.

Function size is a signal, not a rule. Split a function when it contains multiple responsibilities or when extracting a named concept makes behavior easier to understand. Do not fragment a cohesive operation into trivial helpers that force readers to jump between multiple functions or files.

## 3. Apply DRY to knowledge and policy

DRY means that each business rule, protocol rule, mapping, schema, and cross-service policy has one authoritative source.

Behavior reused across EDSI services or packages MUST be centralized when independent copies could drift. This includes:

- error classification and public-exposure mappings;
- schemas and protocol types;
- retry, deadline, and pagination behavior;
- authorization rules;
- parsers and serialization rules;
- shared fixtures and contract assertions;
- logging and metric conventions.

Before adding a utility or copying an implementation, contributors MUST search for an existing implementation and either reuse it or explain why it is not suitable.

Incidental similarity is not automatically shared knowledge. Contributors SHOULD NOT create a generic abstraction when similar code represents different domain behavior, is likely to evolve independently, or becomes harder to understand when combined.

Prefer a small amount of obvious duplication over the wrong abstraction. Once duplicated code represents a shared rule or changes together, it MUST be centralized.

See § 16 for where shared code lives once centralized.

## 4. Preserve behavioral policies

Changes MUST preserve system-wide policies, not merely local function behavior. Relevant variants include:

- authorization is enforced on every path;
- an operation produces no more side effects than intended;
- retryable operations are idempotent;
- pagination returns complete, nonduplicated results and terminates correctly;
- typed failure reasons survive service boundaries;
- public APIs maintain their documented response contracts;
- partial failure cannot silently appear as complete success.

When an invariant spans multiple modules or services, it SHOULD be documented close to its authoritative contract and tested at the narrowest boundary that proves it.

## 5. Keep boundaries typed and explicit

Every service boundary MUST validate external input and preserve meaningful structured metadata.

Do not interpret HTTP status alone when status values are overloaded. Classification SHOULD use all available signals, including status, headers, structured error codes, body, authorization context, and documented provider semantics.

Known conditions MUST remain distinguishable, including:

- unauthenticated or unauthorized;
- forbidden;
- suspended or disabled;
- rate-limited;
- not found;
- dependency or provider failure;
- genuinely unclassified failure.

Typed errors MUST retain relevant fields such as `reason`, `code`, `retryAfter`, `resetAt`, retriable classification, and request context. Code MUST NOT flatten these errors into strings or generic exceptions and reconstruct their meaning later.

Provider errors, stack traces, internal identifiers, and uncontrolled provider messages MUST NOT be exposed to customers. Known failures MUST map to curated, stable public responses. Generic HTTP 500 responses are reserved for genuinely unclassified failures.

Boundaries include storage and provider reads, not only inbound HTTP — see § 18.

## 6. Treat retries, pagination, and deadlines as one operation

Retries and pagination MUST operate within one operation-wide deadline. Each attempt or page MUST NOT receive a fresh full timeout unless the contract explicitly requires it.

Attempt limits alone are insufficient. A retry policy MUST define:

- retriable failure conditions;
- the operation-wide deadline;
- maximum attempts where useful;
- backoff and jitter;
- rate-limit handling using `retryAfter` or `resetAt` when available;
- idempotency expectations;
- behavior when the retry budget is exhausted.

Contributors MUST consider whether retries belong in memory or in a durable asynchronous operation. The decision should account for execution time, process termination, downstream limits, customer latency, resource use, idempotency, and partition tolerance.

Retries MUST NOT duplicate side effects, amplify an outage, ignore provider rate limits, or continue after the operation deadline.

See § 22 for the asynchronous-work rules that implement this.

## 7. Follow the established architecture

New code MUST use the repository's established patterns for transport, validation, configuration, dependency injection, errors, logging, metrics, testing, and file organization.

Layer responsibilities SHOULD remain distinct:

- transport code translates protocol concerns;
- application code coordinates the use case;
- domain code owns business rules;
- infrastructure code integrates with external systems.

Do not leak provider-specific payloads, SDK types, or transport concerns into the domain unless they are intentionally part of the domain contract.

If an existing pattern is unsafe or unsuitable, do not silently work around it. Document the problem, propose the replacement, and migrate affected code deliberately so that two competing patterns do not persist indefinitely.

§ 14 states the concrete file-level shape this implies.

## 8. Test observable behavior

Tests MUST verify meaningful behavior rather than mirror private implementation details.

Where applicable, cover:

- the normal path;
- real limits and caps;
- multiple, empty, and partial pages;
- malformed or incomplete dependency responses;
- negative authentication and authorization cases;
- suspended and rate-limited states;
- response status, body, and headers;
- retry exhaustion and operation-wide deadlines;
- idempotency and prohibited side effects;
- logs and metrics when they are contractual or operationally important;
- the disabled state of anything gated by a feature flag.

Tests SHOULD use shared fixtures and assertions for shared contracts. Test setup MUST remain readable enough that the scenario, action, and expected result are apparent without tracing excessive abstraction.

A bug fix SHOULD include a test that fails without the fix. A new behavior MUST include tests at the lowest level that proves the rule, plus boundary or integration coverage when unit tests cannot prove the contract.

## 9. Make behavior observable

Behavior that matters in production MUST be measurable in production. This is especially important for:

- hot paths;
- expensive operations;
- retries and pagination;
- external calls;
- batch and asynchronous processing;
- explicit performance tradeoffs.

Use appropriate structured logs and metrics, such as latency, throughput, attempt count, page count, queue delay, batch size, processed-item count, rate-limit events, and deadline exhaustion.

Telemetry MUST NOT expose secrets or sensitive payloads and MUST avoid uncontrolled high-cardinality dimensions. Do not add redundant instrumentation when existing telemetry already measures the behavior adequately.

Do not introduce complexity for theoretical performance. Performance optimizations SHOULD be supported by a requirement, benchmark, profile, or production measurement, and MUST preserve correctness and observability.

Observability that no one is paged by is incomplete — see § 25 for the required logging, error-tracking, metric, and alerting baseline.

## 10. Keep documentation durable

Significant architectural, behavioral, compatibility, reliability, or performance decisions MUST be documented in an ADR, design document, PR description, or another durable record.

The record SHOULD include:

- the chosen approach;
- material alternatives;
- constraints and assumptions;
- relevant tradeoffs;
- operational consequences;
- required follow-up work.

Code comments SHOULD explain stable intent, constraints, or nonobvious reasons. They MUST NOT merely restate the code or preserve temporary decision history.

Comments MUST NOT depend on ticket names, source locations, or references to other files or ADRs as a substitute for explaining the stable local constraint. Incorrect or obsolete comments MUST be updated or removed with the code change.

Generated artifacts are part of the contract. Contributors MUST update their authoritative source and regenerate them; they MUST NOT manually patch generated output.

§ 27 states when a change is obligated to update current-state documentation.

## 11. Trace the complete change surface

A change is not complete until all affected surfaces have been evaluated. Depending on scope, this includes:

- sibling endpoints and equivalent workflows;
- OpenAPI and other generated specifications;
- schemas and generated types;
- internal clients and SDKs;
- producers and consumers;
- fixtures and contract tests;
- feature flags and configuration;
- migrations and backward compatibility;
- deployment and infrastructure assumptions;
- current-state documentation.

A current correctness or compatibility gap MUST NOT be deferred to an unspecified future PR. Deliberately staged changes MAY be incomplete only when they are nonfunctional or safely gated and the staging plan is documented.

## 12. Requirements for coding agents

Coding agents MUST follow the same standards as human contributors. Before modifying code, an agent MUST:

1. Read applicable repository instructions.
2. Inspect nearby code and at least one analogous implementation when available.
3. Search for existing types, utilities, policies, fixtures, and patterns before creating new ones.
4. Identify affected callers, consumers, contracts, and generated artifacts.
5. State material assumptions when repository evidence is incomplete.

Agents MUST NOT:

- invent repository conventions without checking;
- create a new abstraction solely to make the current diff appear DRY;
- add speculative compatibility behavior or impossible-state handling;
- silently change public contracts;
- omit tests because the generated code appears straightforward;
- claim validation that was not performed;
- leave temporary commentary, planning notes, ticket references, or generated-code explanations in source files.

Agent-created code SHOULD be simpler than the code it replaces or provide a clear, documented benefit that justifies added complexity.

## 13. Exceptions and evolution

These standards are defaults, not a substitute for engineering judgment. Exceptions are appropriate when a requirement, production constraint, or safer design demands one.

Any exception to a **MUST** rule MUST document:

- the rule being bypassed;
- why following it would be harmful or infeasible;
- the resulting tradeoff or risk;
- whether and when the exception should be revisited.

Repeated exceptions indicate that the standard or repository pattern may need to change. Update the authoritative standard deliberately rather than allowing undocumented divergence.

---

# Part II — EDSI conventions

## Structure and composition

## 14. Service structure

A service, or the contract library it registers against, MUST follow this file-level shape. This implements § 7 (follow the established architecture) as a concrete layout.

**Service root** (`services/<name>/src/`):

| File | Owns | Must not |
| --- | --- | --- |
| `index.ts` | Lambda entrypoint and bootstrap | Business logic |
| `config.ts` | One typed config object | — |
| `container.ts` | All dependency construction and wiring | — |
| `service.ts` | Contract registration, cross-cutting middleware | Domain logic |
| `secrets.ts` | Secret resolution | Anything else |
| `feature-flags.ts` | Flag-client construction, local flag helpers | Canonical flag keys (those live in the shared lib) |
| `types.ts` | The service's container and context types | Domain types belonging to a contract lib |

No file other than `config.ts` reads `process.env` directly. Nothing outside `container.ts` constructs a client or store.

**Per entity** (`services/<name>/src/<entity>/`):

- `index.ts` — the controller. Parses input already validated by the contract, delegates to the entity service, shapes the response.
- `<entity>-service.ts` — orchestration and business logic for that entity. New operations extend it rather than accreting into the controller.
- `types.ts` — entity-local types not shared outside the service.
- `errors.ts` — entity-specific typed error classes.

A controller MUST stay thin. If a controller method needs to sort, compare, derive a field, or coordinate across stores, that is service-layer work. Controllers pass values through, catch known errors, and shape the response envelope.

Service modules are scoped to an **entity**, not to a field or an endpoint. Adding an operation to an existing entity extends that entity's service module; a new entity gets a new one.

A `<concern>-routes.ts` file is an accepted variant of the controller when a route group carries a materially different auth guard or audience than the main contract.

**Contract library** (`libs/<name>-api-contract/src/`):

- `schemas/<resource>.ts` — request and response schemas. The single source of truth for shape; services never redeclare a shape ad hoc.
- `<resource>.ts` — the route-contract object per resource, consumed at registration.
- `<consumer>-client.ts` — a typed client for calling this contract from another service. Cross-service calls go through these rather than hand-rolled `fetch`.
- `index.ts` — re-exports the public surface.

**Configuration and secrets SHOULD resolve eagerly at service construction**, not lazily inside a request handler. Workers already do this; HTTP services are inconsistent, and a new service should not inherit the inconsistency.

## 15. Service boundaries

- One deployable service owns one bounded responsibility. A new service is warranted when a responsibility carries a genuinely distinct deployment, scaling, or trust boundary — not to isolate code for organizational convenience.
- **No service owns a private domain database.** Persistence goes through the shared repository libraries.
- **A cross-service policy MUST have exactly one implementation**, imported by every service that needs it. This includes auth resolution, error classification, and retry and idempotency rules. Never re-derive a policy per service, even when the copies currently agree — agreement now is not agreement later.
- **A trust boundary MUST have exactly one enforcement point, and that point MUST be load-bearing.** A boundary claiming to be internal-trusted (VPC-only) or edge-verified needs one authoritative place where the claim is enforced, with real fail-closed behavior. Two layers that each assume the other is responsible produce a boundary that is enforced nowhere.
- An external provider integration follows the same rule: one authoritative client for a given provider, consumed by everything that talks to it.

*Grounding:* `resolveOrganizationId` exists twice — in `sources-api/src/clients.ts` and as a module in `providers-api/src/gatekeeper.ts` — and the copies have already diverged, with only one carrying a request timeout. Separately, webhook HMAC is documented as edge-only but also verified in the ingress Lambda, whose Function URL is unauthenticated at AWS while its IP allowlist permits an empty range list.

## 16. Library placement

- **A library is warranted when code is consumed, or imminently and concretely will be consumed, by two or more services or packages.** "Code" means any artifact: logic, types, schemas, fixtures, constants. A duplicated type is as much a DRY violation as duplicated logic.
- Code used by exactly one service stays local to it, however generic it looks, until a second consumer actually exists. Speculative extraction is an abstraction with hypothetical reuse (§ 2).
- When the second consumer arrives, extraction happens in the **same unit of work** that introduces it — not a follow-up ticket (§ 11).
- **The rule applies between libraries too.** A library MUST NOT re-implement a policy another library already owns.
- A promoted library MUST have a real test target, a scoped doc if its contract isn't self-evident from its types, and one owner for the policy it encodes.

**Tiers.** `libs/` holds domain and contract libraries consumed directly by services at its top level. Libraries whose primary consumers are other libraries — low-level client wrappers that domain libraries build on — live in a dedicated subfolder, so the dependency direction is visible from the layout.

*Grounding:* two libraries independently implement a Lambda-extension secrets client. Both are already shared; neither consumes the other.

## 17. Naming

- Package names keep the `@contentful/design-system-*` prefix.
- **A reused type, class, function, or exported constant MUST be unique repository-wide** and exported from exactly one location. Uniqueness within a file or library is not sufficient.
- An error class name SHOULD say what failed. Generic per-package names for the same failure (a `TransportError` in each package) signal that the client and its error type belong in one shared library (§ 16), not that they need distinguishing suffixes.
- File names follow the established forms: `<entity>-service.ts`, `<concern>-client.ts`, `schemas/<resource>.ts`, `errors.ts`.
- File, function, variable, and type names MUST be semantically meaningful to a reader who did not write them.

*Grounding:* `SourcesApiTransportError` is declared twice in the same package, in `github-client.ts` and `sources-client.ts` — identical name, identical shape, two runtime identities. An `instanceof` check against the wrong one silently returns `false`.

## Contracts and data integrity

## 18. Validation at storage and provider boundaries

§ 5 requires boundary validation. In practice the gap is below transport, inside repository adapters and provider clients.

Every read whose shape this codebase does not control — a DynamoDB item, a provider API response, a staged S3 payload, a webhook body — MUST be parsed against a declared schema before its fields are treated as trustworthy. A cast is not validation.

- **A parse failure MUST be its own typed outcome.** It MUST NOT be coerced into an unrelated domain state. Collapsing "malformed or unreachable" into "absent" destroys the distinction between a legitimate empty result and a broken dependency, and callers cannot recover a distinction the layer below erased.
- `unknown` or `any` at a boundary is acceptable only where the schema is **deliberately permissive by contract** — customer-authored input validated field-by-field downstream, for instance — never as a substitute for writing the schema.
- Casting is acceptable immediately after a successful parse, to narrow a validated union. It is not acceptable as the sole mechanism turning `unknown` into a typed value.
- Shared contract types MUST be the validation source across services, rather than each service declaring its own shape for the same boundary.

*Grounding:* `getConnectionStatus` catches every DynamoDB read failure and returns `'not_found'` — the same value it returns when the row genuinely does not exist. A caller cannot distinguish an unconnected organization from an unavailable table.

## 19. Errors

- Every error crossing a caller-observable boundary — HTTP response, queue failure surfaced to a caller, public SDK — MUST extend `ContentfulError` from `@contentful/errors`, or one of its typed subclasses. Never a bare `Error`, never an ad hoc object.
- A subclass MUST carry a stable machine-readable discriminator (`id`, or a typed `reason` union). **Callers MUST NOT have to branch on `message`.** Message text is for humans and will change; discriminators are contract.
- Known failures map to curated public responses (§ 5). A generic 500 is for genuinely unclassified failures only, never for a condition the system had enough information to classify.
- **i18n metadata.** Once the platform i18n mechanism lands, every customer-facing error MUST carry what is needed to localize it — a translation key plus interpolation parameters — rather than a pre-rendered English string as its only representation. Until then, new error classes MUST take their message as a parameter rather than hardcoding it internally, so the migration is mechanical rather than a rewrite.

*Grounding:* `BindError` and `AuthorizationError` both model this well — typed `reason`, stable `id`, callers branching on structure. The pattern exists; it is not yet applied at every boundary.

## 20. Contract evolution

The mechanics of propagating a published contract change are documented in `AGENTS.md`. This is the policy governing what may change.

- A change to a published contract schema MUST be classified before merge as **additive** (new optional field, new endpoint, widened response union) or **breaking** (removed or renamed field, narrowed type, changed required-ness, changed status-code semantics).
- Additive changes ship normally: regenerate the spec, sync the client, done.
- **A breaking change to a surface already consumed by the generated public client MUST NOT ship as a silent replacement.** It requires either preserved backwards compatibility, or an ADR recording why compatibility is infeasible and which consumers are affected. This is § 13's exception discipline applied to the one boundary whose callers this repository cannot enumerate.
- Because the spec is author-carried into the public SDK repository, a PR making a breaking contract change MUST link its counterpart SDK PR **before merge**. The two are one unit of work.
- Internal-only routes are excluded — they are not in the published contracts.

*Grounding:* producer and consumer schemas for the same callback already disagree on which fields are optional, and at least one query parameter is read at runtime without appearing in its contract.

## Runtime behavior and operations

## 21. Authorization model

Authorization in this repository runs through several genuinely distinct mechanisms at distinct boundaries — resource policy checks, organization resolution, provider installation ownership, and edge trust. They are not redundant and should not be collapsed.

They MUST, however, be inventoried in **one** document that states, per boundary: what identity or credential arrives, what it is checked against, and what fail-closed means concretely there. That document links out to the ADRs holding rationale; a reader MUST NOT have to reconstruct the model from five of them.

A new endpoint or service MUST be checked against that inventory before it ships, and MUST update it when introducing or changing a boundary.

*Grounding:* most provider operations perform a resource-policy check; the organization-scoped status path relies on token verification and entitlement middleware without one. With no inventory to check against, it is unclear whether that is a reviewed exception or an oversight — which is the cost of not having the document.

## 22. Asynchronous work: idempotency and budgets

§ 6 requires one operation-wide deadline. For work spanning a queue, a redrive, or checkpointed steps, three things MUST be decided together, before the code is written:

1. **The idempotency key** — what makes a redelivered or retried message a no-op instead of a duplicate side effect. The key MUST be derivable from data present at *every* point the operation can be redriven. A key that depends on a sometimes-absent field is not a key.
2. **The operation-wide deadline** — one budget across attempts, pages, and steps.
3. **Exhaustion behavior** — DLQ for manual triage, whole-operation failure, or a distinct terminal state visible to the customer. All three are legitimate; the requirement is that the choice is deliberate rather than inherited from queue defaults.

Both accepted consumer shapes exist in this repository and neither is wrong:

- **Redrive-on-failure** — the message fails, the queue retries it, the DLQ catches what never succeeds. Right when a single event must eventually be processed.
- **Checkpoint-and-continue** — each unit records its outcome and the consumer proceeds, so one failure does not fail its siblings. Right for a batch of independent actions.

A new consumer MUST state which shape it uses and why. Side effects MUST be idempotent under either.

*Grounding:* a webhook delivery-dedupe store keys on organization ID and silently no-ops when that field is absent — which is precisely the case for org-less webhook envelopes. The dedupe exists and does nothing.

## 23. Feature flags and rollout gates

- A new customer-facing capability, or a change to existing behavior on a live route, MUST be gated until rollout completes, and the gate MUST **fail closed**: unresolvable flag state means off.
- Flag keys MUST live in the shared feature-flag library as the single canonical source. No service inlines a raw flag-key string.
- A rollout flag MUST have a documented owner and a removal trigger. A flag with no removal plan is debt from the day it is created.
- **Every gated capability MUST have a test proving the off state actually disables the behavior** (§ 8). A test of the on state proves the feature works, not that the gate does.

## 24. Configuration and secrets

Every configuration value belongs to exactly one of four buckets, chosen by its failure mode — not by copying whatever a neighboring value does.

| Bucket | For | Failure behavior |
| --- | --- | --- |
| Secrets Manager, no fallback | Credentials, signing keys — anything where a stale or missing value is dangerous | Fail loudly at boot |
| Secrets Manager with documented fallback | Values where serving with a cached value is *safer* than refusing to boot | Degrade deliberately |
| TFC variable → env var | Non-secrets: resource names, region and stage identifiers | Absence is a config bug |
| Feature flag service | Runtime *decisions*: on/off, percentage rollout, targeting | Fail closed (§ 23) |

**The fallback bucket is the exception, not the default.** A new secret defaults to fail-fast. Choosing the fallback requires an articulable reason why degraded operation beats a hard failure for that specific value — the reasoning that justified it for the flag-service SDK key, not a general preference for resilience.

A value that never changes without a deploy does not belong in the flag service, even when it is boolean-shaped.

Placement MUST be justified at review time. "The code near mine did it this way" is not a justification, though it may be the same conclusion.

## 25. Observability and alerting

§ 9 requires that behavior be observable. This is the floor.

**Logging.** Structured logging through the shared logger. No service falls back to a bespoke or console logger once a shared one is available in its container.

**Log level is chosen by what should reach production, not by how the author felt while debugging it.** Ask what happens if this line fires on every request, forever, in production, at full traffic:

- **The default, happy path of an operation MUST NOT emit on its own.** Parsing input, resolving a value, calling a dependency that succeeds, proceeding to the next step — none of these earn a log line just for happening. If a step needs to be seen while you are actively debugging it, that is what a debug level and local log-level overrides are for; it is not a reason to ship an `info` line that runs at production volume forever.
- **An edge case, a short-circuit, or an error MUST emit.** A denial, a fallback path taken, a retry, a cache miss that matters, a validation failure, an exception — these are exactly the lines a human will need at 2 a.m., and they are cheap precisely because they are rare.
- **The operation's own outcome is the one exception to "default path stays quiet."** One line for the unit of work's final success or failure — a request completed, an operation resolved, a message processed — is legitimate at `info`, because it is bounded by the operation, not by every step inside it. It replaces the five-lines-per-request pattern below, not adds to it.
- **A guard, middleware, or hot-path function that logs a line per branch is the anti-pattern.** If reading the code requires stepping through what a request logs to understand what it does, the logging has replaced the code as documentation — flip it around: let the code be readable, and let logs mark only what a reader could not otherwise infer after the fact.

*Grounding:* `sources-api`'s `publicCmaGuard` logs at `info` up to five times per request on its ordinary path — entitlement-check-started, org-resolution-result, entitlement-check-completed-or-skipped, and access-decision — every time, whether or not the request was allowed. At production request volume, all of that runs forever for the overwhelmingly common case of "the request was fine." The one branch that is actually worth a log line — an entitlement check throwing — already has its own `logger.error`; it did not need four `info` lines around it to be findable. Contrast with the apply worker, which logs once when an envelope resolves, once when the operation finishes, and reserves `error` for the paths where EMA execution actually failed — that shape is what this rule asks for.

**Error tracking.** Wired for any service serving customer traffic or running unattended. A service that can fail silently — no crash reporting, no DLQ visibility — is the failure mode to design against.

**Metrics.** Required at:

- every external call — latency, success and failure;
- every queue consumer — processed count, failure count, age or lag where obtainable;
- every retry loop — attempt count, and outcome after exhaustion;
- every customer-visible unit of work — duration and outcome;
- every authorization or entitlement rejection — as a count, so rejection *rates* are visible without grepping logs.

Telemetry MUST NOT carry secrets, tokens, whole payload bodies, or uncontrolled high-cardinality dimensions. Organization and user identifiers are acceptable tags; free-text error messages are not.

**Alerting.** Alarms are part of the definition of done for a new Lambda, queue, or DLQ — not polish added afterward. Every deployable service ships with:

- an **error-rate alarm**, so an unhandled exception pages rather than accumulating in logs;
- a **throttle alarm** for any Lambda serving synchronous customer traffic, since concurrency exhaustion degrades customers before it surfaces anywhere else;
- a **DLQ-depth alarm** for every queue consumer with a DLQ. One message in a DLQ means a customer operation failed permanently, and nobody knows unless this fires;
- **routing through the shared incident-routing module** on both alarm and OK actions — not a bespoke topic, and not "someone watches the console";
- a **description stating operational meaning** — likely cause and customer impact — ending with the shared in-hours description. The difference between an alarm that tells the on-call engineer what to do and one that reports a threshold crossing.

*Grounding:* alarm coverage is the best-followed convention in the repository — every service carries an observability module with the alarm set above, routed to incident routing. Crash reporting, by contrast, covers two of five services, and one worker still uses a local console logger while logging complete action bodies.

## Delivery and documentation

## 26. New service onboarding

A service is not done when its handlers pass review. The bar:

- [ ] Follows § 14's file shape.
- [ ] Registered as a project with `lint`, `test`, `typecheck`, `build`, and `package` targets. CI runs these across all projects — a service missing a target silently skips that check rather than failing loudly.
- [ ] A Terraform module provisioning the function, IAM role, log group, and network registration if it serves traffic.
- [ ] An observability module carrying § 25's alarm set, routed to incident routing.
- [ ] Wired into the deploy scripts and rolling out through the stable-environment model — not a bespoke path.
- [ ] Serverless instrumentation and crash reporting wired (§ 25).
- [ ] Behind a rollout gate if it serves a public surface (§ 23) — not open by default.
- [ ] A health route if it serves HTTP, so the deploy smoke check can verify it. A service with no health route is unverified on every deploy, and there is no automatic rollback to catch what the check would have.
- [ ] Documentation, **in the same PR** (§ 27): an ADR introducing it, plus `ARCHITECTURE.md`'s service table and topology diagram, `docs/current/service-behavior.md`, `docs/current/system-boundaries.md` if it adds an external dependency, and `docs/reference/repo-map.md`.

The same bar applies in spirit to a new **library**: § 16 for whether it should exist at all, a real `test` target, a doc if its contract is not self-evident from its types, an owner, and an entry in `docs/reference/repo-map.md`.

## 27. Documentation drift

`AGENTS.md` defines the documentation hierarchy. This is its enforcement rule.

- A PR changing shipped, user-visible, or operationally significant behavior MUST update the affected current-state page — or the architecture document, where no current-state page owns that fact — **in the same PR**. This is § 11 applied to documentation: a current gap is not deferred to an unspecified future PR.
- **A reviewer MUST treat a stale doc claim the way they would treat a stale test:** a blocking finding, not a nit, when the PR's own diff caused the staleness.
- The discrepancy register is for known, tracked mismatches awaiting reconciliation. It is not a parking spot for drift the author noticed and chose not to fix.

**Which page owns which fact.** Use this to find the pages a change touches, rather than guessing:

| If your change… | Update |
| --- | --- |
| adds, removes, or re-scopes a route | `docs/current/service-behavior.md` |
| changes how a route is authenticated or authorized | `service-behavior.md`, and `docs/security/threat-model.md` if a trust boundary moves |
| adds or drops a dependency on another system | `docs/current/system-boundaries.md`, and the topology diagram in `ARCHITECTURE.md` |
| changes deploy, rollout, or environment behavior | `docs/current/operations-and-deployment.md` and `docs/runbooks/deploy-and-rollback.md` |
| changes logging, metrics, or alarms | `docs/current/observability.md` |
| adds or removes a service or library | `ARCHITECTURE.md`, `docs/reference/repo-map.md`, and an ADR (§ 26) |
| changes a health route or smoke-check behavior | `observability.md`, `operations-and-deployment.md`, and `service-behavior.md` |
| introduces a term a newcomer would not know | `docs/reference/glossary.md` |
| changes what CI enforces | `docs/reference/testing-and-quality.md` |
| invalidates an ADR's decision | mark that ADR superseded and write the replacement (§ 26) |

**Two things a `last_verified` date means.** It asserts the *whole page* was checked, not the lines you edited. Refreshing it on a page you only partly reviewed is worse than leaving it stale, because it removes the next reader's reason to be suspicious. And a page whose `source_artifacts` reference a deleted file is stale regardless of its date — check those too.

*Grounding:* every failure mode above has occurred here. A rollout mechanism was deleted and five current-state pages plus two runbooks kept describing it for four months, including a documented rollback command whose flag no longer existed. A documented LaunchDarkly gate was removed and four pages continued to assert it as an enforced security control. One page's `source_artifacts` cited two Terraform files that no longer exist, and its date had been refreshed after that deletion. In each case the change shipped without an ADR, so nothing forced a sweep.

---

# Review

## Priority of findings

Findings are grouped and prioritized as:

1. **Correctness or security blocker** — incorrect behavior, data loss, unauthorized access, information exposure, or another vulnerability.
2. **Contract or reliability risk** — a broken or weakened API contract, retry policy, error classification, compatibility guarantee, deployment assumption, or operational behavior.
3. **Maintainability or readability improvement** — policy drift, duplicated behavior, unclear ownership, fragile coupling, unnecessary complexity, or code that is hard to understand and modify safely.
4. **Optional style nit** — a nonfunctional preference with no correctness, reliability, security, performance, readability, or maintenance impact.

Reviews prioritize the first three. Optional style feedback MUST NOT obscure higher-impact findings.

## Review posture

Reviewers evaluate system behavior, contract integrity, reliability, security, performance, readability, and maintainability — not merely local syntax.

Do not approve a change solely because each modified function appears locally correct; look for invariants spanning functions and services (§ 4).

Every finding SHOULD identify the affected behavior, explain the concrete risk or failure scenario, cite the relevant code, and recommend a correction where one is reasonably clear. A finding that is a risk or an assumption rather than a confirmed defect MUST say so, and say what evidence would confirm it.

Do not report purely hypothetical issues with no plausible execution path. Do not report the same underlying issue as several findings. Do not request process artifacts that CI or required checks already enforce.

When a review finds nothing, say so explicitly, and name any residual uncertainty that still deserves human attention.
