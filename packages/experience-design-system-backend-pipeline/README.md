# Exploration and accepted slots

The root of `@contentful/experience-design-system-backend-pipeline` exports callable exploration, comparison, assurance and session adapters; report types and Zod schemas are available from `@contentful/experience-design-system-types`.

| Entry point | Responsibility |
| --- | --- |
| `runExplorationComponentsSession` | Load completed saved extraction evidence, request seven component reports, independently check proposed finite restrictions and atomically save inclusion/slot decisions. |
| `runExplorationDetailSession` | Load saved human scope, request three selected-only inventories, compare reports, tier hypotheses, verify source claims and independently check citations. |
| `runExploreStage`, `parseExploreOutput` | Request or parse structured scope reports without session persistence. |
| `deriveSelectionFromExploration`, `deriveSlotsFromExploration`, `diffExploration` | Compare eligible report coverage and derive decisions/disagreements. |
| `runTierStage`, `runVerifyStage`, `runCheckStage` | Execute typed assurance work through the configured invoker. |
| `projectAcceptedSlots`, `projectAcceptedRawSlots` | Apply accepted slot semantics to CDF entries or raw generation input. |
| `runCdfGenerationService` | Generate stateless CDF; optional typed `acceptedSlots` applies the same slot projection. |

## Session flow

The import wizard uses completed extraction handles for component exploration before the human scope gate; reports 1–5 vote on slots, while reports 6–7 receive source inputs without raw candidate hints.

All seven requested scopes must succeed even when fewer reports cover a particular vote; inclusion uses 75% of eligible covering reports and slot decisions use 60%, with covered omissions counting against and absent noncovering reports supplying no vote.

After saved human acceptance, only accepted direct and closure components receive the three inventories and assurance work; a failed, cancelled or stale phase prevents generation from advancing.

Detail resolutions, categories and category dependencies are retained for review; they do not automatically change generated properties or run a category gate.

New session exploration and its generation path always execute fresh and save results; they do not replay prior exploration or generation artifacts.

## Invoker and report protocol

Each stage accepts an `invoker` with `invoke`, an existing agent/model selection, timeout, abort signal and optional skill content/path override; the subprocess invoker receives bounded prompt text and does not gain repository filesystem access from path metadata.

The default budget is six attempts including the initial call; invocation, prompt construction, parsing and report callback failures consume attempts, with interruptible backoff and source/work identities on receipts.

A component report consists of optional narrative followed by a final fenced JSON companion, or only the JSON companion:

```json
{
  "agentRole": "components-1",
  "components": [
    {
      "name": "Panel",
      "source": "src/panel.tsx",
      "componentId": "panel",
      "included": true,
      "slots": [
        {
          "name": "renderBody",
          "isRealSlot": true,
          "allowedComponents": [],
          "evidence": ["The declared input accepts renderable content."]
        }
      ]
    }
  ]
}
```

Names, sources and IDs must match the assigned session entities; every assigned candidate on an included component requires a boolean ruling, and true slots require evidence.

Custom `select` prompt overrides for this flow must return this scope protocol instead of legacy selection tool calls; generation prompt overrides retain the existing tool-call protocol.

`projectRoot`, `sdkReferencePath`, `existingModelPath` and `callSiteEvidencePath` on the low-level exploration request are compatibility metadata; provide inline source/reference data or use the session adapter. `sharedSource` accepts the public `SharedSource` contract and is rendered when no assurance `sourceInput` is supplied, so source bodies occur once.

`concurrency` remains accepted on verify/check requests, but these adapters execute work serially; `noCache` is unnecessary for new exploration because it always runs fresh.

## Source and renderer reference

Session source prompts are built from the immutable saved evidence envelope, preserving captured canonical paths, line ranges, hashes, diagnostics, omissions and coverage; the whole stage prompt is bounded by the saved capture limit, with source text capped at 160 KiB and 60% of that prompt limit.

Renderer reference input accepts `{ kind: 'text', text, origin }`, `{ kind: 'path', path }` or `{ kind: 'url', url? }`; the default URL is `https://raw.githubusercontent.com/contentful/experiences/main/README.md`.

Reference reads/fetches are bounded to 64 KiB by default, URL fetches have a 30-second timeout, and the saved reference includes origin, SHA-256 digest, retrieval time and byte coverage.

Successful source assurance requires exact saved file/range/quote binding and complete resolution coverage; complete confirmation additionally requires complete declared capture and prompt coverage, while changed byte binding blocks assurance.

An `unverified` extraction-byte binding remains explicit: assurance describes the saved source snapshot and does not prove that extraction used those same bytes or establish runtime parity.

## Slots, persistence and artifacts

| Accepted state | Export and gate behavior |
| --- | --- |
| `false` / `unresolved` | Suppress the raw candidate from CDF export and finite gate edges. |
| `open` | Export the slot and remove stale allowed-component restrictions. |
| `finite` | Export proven accepted children and use those edges for closure/cycle handling. |

Finite restrictions require applicable declared/enforced evidence and an independent support check; observed children, names, defaults and framework conventions do not exhaust an open source domain, and unknown, rejected or self children do not become accepted finite edges.

Requiredness is retained only from supported source facts or an explicit human edit; model agreement alone does not establish it.

Source facts and raw candidates stay separate from replaceable inclusion, slot and detail records; review preserves unchanged evidence/votes/disputes and records explicit human slot edits.

Runs, reports and attempts are bound to session/source/run identities; detail records also bind the component run and saved human scope, so stale callbacks cannot overwrite accepted current results.

Artifacts live beneath the configured output directory by encoded session ID, run ID and phase; each scope is saved incrementally, and finalization writes finalized reports, `accepted.json` or `detail.json`, plus `manifest.json` before SQLite publishes phase success.

The manifest describes computed data, hashes, completed stage attempts and the finalization operation ID; SQLite remains authoritative for publication and the final finalization receipt, including bounded retry failures.

Successful sibling reports survive a later failure; failed final artifact writes do not publish accepted decisions, and no fallible artifact write occurs after phase publication.

## Compatibility limits

Ordinary legacy callers without a completed exploration handle retain their existing path; these adapters do not recreate the exact historical `@contentful/experience-design-system-agents` package address or all historical grouped exports.

This documentation makes no package retirement or publication claim.

The current scope gate rejects ambiguous duplicate component names before exploration; raw entities remain saved, and resolving that limitation belongs to the broader entity-identity contract.

### Saved shared source

`loadSavedSharedSource(db, sessionId, { componentIds, maxBytes, handle })` reads the completed extraction envelope and returns explicit ready/unavailable state; it does not read current source files. `buildSharedSource`, `projectSharedSource` and `renderSharedSource` are callable backend adapters with additive public types at the types package. Existing `ComponentSourceRef` and disk-reader callers remain supported.

The index retains canonical file identities, content hashes, original excerpt ranges, supplied component identities, incoming lexical references and outgoing captured imports. Files appear once even with multiple component owners or roles; export aliases are bindings and declaration files retain definition identity. TypeScript config parsing supports admitted relative inheritance, arrays and JSONC; package/external config expansion remains unsupported and explicit. Broader runtime/value-flow evidence remains separate.

Generation, exploration/assurance and review use the saved session/step snapshot after disk changes or deletion. Source projections count UTF-8 serialization and the shared source renderer header against the declared source-section limit, preserve original-range mappings, and record omitted files/metadata; an irreducible identity payload fails explicitly. This limit does not bound the rest of an assembled prompt. Source-snapshot citations do not establish extraction/runtime byte equivalence; production byte binding remains unverified.
