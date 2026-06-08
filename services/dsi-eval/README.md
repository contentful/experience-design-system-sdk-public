# dsi-eval

Evals for the two LLM stages of the DSI pipeline:

- **Stage 1 (select)** — given a list of raw extracted components, the LLM picks which ones are worth generating CDF for
- **Stage 2 (generate)** — given the selected components, the LLM generates the CDF component definitions

Stage 0 (AST extraction) is deterministic and covered by unit tests, not evals.

## Setup

```bash
cd services/dsi-eval
pnpm install
```

AWS credentials are picked up automatically by the SDK (IAM role, `~/.aws/credentials`, or env vars).

## Run

```bash
pnpm start                        # run all corpus entries
pnpm start -- --repo=material-ui  # run one repo
pnpm start:save-baseline          # save scores as new baseline
```

Output: `eval-report.md`
