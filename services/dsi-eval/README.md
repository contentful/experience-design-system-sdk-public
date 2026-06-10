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
DSI_EVAL_CORPUS_REPO=<corpus-repo-ssh-url> pnpm pull-corpus
DSI_EVAL_LLM_CLIENT=./.corpus-repo/dist/client.js pnpm start
```

`pull-corpus` clones the internal corpus repo into `.corpus-repo/` (gitignored), installs its dependencies, builds the LLM client, and copies the corpus JSON files and baseline into place. Re-run it any time the corpus is updated.

For the corpus repo SSH URL, authentication setup, and any credentials required to run the client, refer to the corpus repo's README.

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
```

Output: `eval-report-<timestamp>.md`
