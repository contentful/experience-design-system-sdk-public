# dsi-eval

Evals for the two LLM stages of the DSI pipeline:

- **Stage 1 (select)** — given a list of raw extracted components, the LLM picks which ones are worth generating CDF for
- **Stage 2 (generate)** — given the selected components, the LLM generates the CDF component definitions

Stage 0 (AST extraction) is deterministic and covered by unit tests, not evals.

## For Contentful developers

```bash
cd services/dsi-eval
pnpm install
DSI_EVAL_CORPUS_REPO=git@github.com:contentful/dsi-eval-data.git pnpm pull-corpus
AWS_PROFILE=bedrock pnpm start
```

## For external contributors

This harness is design-system-agnostic. To run it against your own design system you must bring your own corpus.

**Corpus format** — create a `corpus/` directory and add one JSON file per design system with this shape:

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

`rawComponents` is the Stage 0 extraction output — run the DSI CLI extractor on your design system source to generate it. `expectedComponents` is your ground truth: which components should appear in the final CDF output and whether they were accurately extracted.

**Restrictions** — you are responsible for ensuring your corpus data complies with the licenses of any third-party design systems you include. Do not commit corpus data containing third-party source code to a public repository.

## Run

```bash
pnpm start                       # run all corpus entries
pnpm start -- --repo=my-ds       # run one repo
pnpm start:save-baseline         # save scores as new baseline
```

Output: `eval-report.md`

AWS credentials are picked up automatically by the SDK (IAM role, `~/.aws/credentials`, or env vars).
