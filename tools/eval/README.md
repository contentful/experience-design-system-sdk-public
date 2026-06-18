# dsi-eval

Evals for the two LLM stages of the DSI pipeline:

- **Stage 1 (select)** — given a list of raw extracted components, the LLM picks which ones are worth generating CDF for
- **Stage 2 (generate)** — given the selected components, the LLM generates the CDF component definitions

Stage 0 (AST extraction) is deterministic and covered by unit tests, not evals.

The harness is LLM-provider-agnostic. It defines a `LlmClient` interface and loads a concrete implementation at runtime via the `DSI_EVAL_LLM_CLIENT` env var. The implementation lives outside this repo.

## For Contentful developers

```bash
cd services/dsi-eval
pnpm install
DSI_EVAL_CORPUS_REPO=git@github.com:contentful/dsi-eval-data.git pnpm pull-corpus
DSI_EVAL_LLM_CLIENT=./.corpus-repo/dist/client.js pnpm start
```

`pull-corpus` clones the corpus repo into `.corpus-repo/` (gitignored), installs its dependencies, builds the LLM client, and copies the corpus JSON files and baseline into place. Re-run it any time the corpus is updated.

For authentication setup and any credentials required to run the client, refer to the corpus repo's README.

## For external contributors

This harness is design-system-agnostic. To run it against your own design system, bring your own corpus and your own LLM client.

**Corpus format** — create a `corpus/` directory and add one JSON file per design system:

```json
{
  "repo": "my-design-system",
  "rawComponents": [
    {
      "name": "Button",
      "source": "src/components/Button/Button.tsx",
      "framework": "react",
      "props": [
        { "name": "label", "type": "string", "required": true },
        { "name": "disabled", "type": "boolean", "required": false }
      ],
      "slots": []
    }
  ],
  "expectedComponents": [
    { "name": "Button", "verdict": "accurate" }
  ]
}
```

`rawComponents` is the Stage 0 extraction output — run the DSI CLI extractor on your design system source to generate it. `expectedComponents` is your ground truth: which components should appear in the CDF output and whether they were accurately extracted.

**LLM client** — create a module that exports a `createClient()` function returning an object with an `invoke` method:

```typescript
// my-llm-client.ts
export function createClient() {
  return {
    async invoke(prompt: string, maxTokens = 8096): Promise<string> {
      // call your LLM here and return the text response
    }
  };
}
```

Point `DSI_EVAL_LLM_CLIENT` at the compiled `.js` file and run:

```bash
DSI_EVAL_LLM_CLIENT=./my-llm-client.js pnpm start
```

**Restrictions** — you are responsible for ensuring your corpus data complies with the licenses of any third-party design systems you include. Do not commit corpus data containing third-party source code to a public repository.

## Run

```bash
pnpm start                       # run all corpus entries
pnpm start -- --repo=my-ds       # run one repo
pnpm start:save-baseline         # run and save scores as new baseline
pnpm start -- --json-out=results.json   # also write structured JSON results
```

Output: `eval-report-<timestamp>.md`

## A/B trials between branches

`pnpm trial` runs the eval N times against two branches (control + candidate) using
git worktrees, then aggregates results into a comparison report. Use this to
measure whether a prompt or pre-classifier change moves the metrics in the
expected direction across multiple non-deterministic Bedrock invocations.

```bash
DSI_EVAL_LLM_CLIENT=./.corpus-repo/dist/bedrock-client.js \
DSI_EVAL_CORPUS_REPO=git@github.com:contentful/dsi-eval-data.git \
AWS_PROFILE=bedrock \
pnpm trial \
  --control main \
  --candidate fix/integ-llm-exclude-dom-passthrough-props \
  --trials 3 \
  --repo forma-36       # optional: scope to one corpus entry while iterating
```

The harness creates worktrees under `tools/eval/.eval-worktrees/` (gitignored),
runs `pnpm install --prefer-offline` and `pnpm pull-corpus` once per worktree,
then runs N trials per branch sequentially. Output: `trial-report-<timestamp>.md`
with per-metric mean ± stddev and the candidate − control diff.

Cost: each trial invokes ~22 repos × ~12 components × 2 stages of Bedrock
calls. With `--trials 3` and 2 branches that's ~6× a single eval run. Scope
with `--repo` while iterating.

### Alignment with production

The eval calls `preClassifyComponent()` (from the CLI's static analyzer) on
every corpus entry before building the LLM prompt. This mirrors the production
pipeline (`packages/experience-design-system-cli/src/analyze/command.ts`) so
that pre-classifier changes are measured by the eval, not silently bypassed.

### Dev-prop leakage metric

Each run reports a `devPropLeakage` count: how many DOM / accessibility /
data-* pass-through props ended up as marketer-configurable properties in the
output CDF. Lower is better; 0 means no developer-facing props leaked into
the editor UI. The exclusion list mirrors `pre-classify.ts`'s
`DOM_PASS_THROUGH_PROPS` set (see `src/scorers/dev-props.ts`).
