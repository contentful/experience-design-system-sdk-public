# dsi-eval

Local eval harness for the DSI pipeline's LLM-powered stages (Stage 1: select, Stage 2: generate).

Follows the same pattern as the translation team's local eval runner. Scores each run against a committed `baseline.json` and prints a markdown report.

## Prerequisites

### AWS credentials

The eval calls Claude via Contentful's Bedrock instance. You need AWS credentials with Bedrock access configured in the `us-east-1` region.

**Option A — AWS profile (recommended for local runs)**

```bash
aws configure --profile contentful-bedrock
# enter your Access Key ID, Secret Access Key, region: us-east-1

# then run with:
AWS_PROFILE=contentful-bedrock pnpm start
```

**Option B — environment variables**

```bash
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_SESSION_TOKEN=...   # if using temporary credentials
export AWS_REGION=us-east-1
pnpm start
```

Ask in #dx-design-system-integrations for the Bedrock access credentials or IAM role to assume.

The default model is `us.anthropic.claude-sonnet-4-6`. Override with `BEDROCK_MODEL_ID`:

```bash
BEDROCK_MODEL_ID=us.anthropic.claude-opus-4-7 pnpm start
```

## Setup

```bash
cd services/dsi-eval
pnpm install
```

## Building the corpus

The corpus is a set of frozen Stage 0 snapshots paired with human-verified expected component lists. It is built from:

- **Benchmark run results** — `RepoBenchmarkResult` JSON files produced by running the CLI benchmark pipeline (see `packages/experience-design-system-cli/scripts/component-validation.mjs`)
- **Audit files** — human-verified ground truth in `packages/experience-design-system-cli/benchmarks/component-validation/audits/*.json` (added in PR #9)

**Step 1 — Run the benchmark pipeline** (in the private SDK repo, PR #9 branch)

```bash
# from packages/experience-design-system-cli
pnpm component-validation:prepare     # clones/pins design system repos
pnpm component-validation:run         # runs Stage 0 extraction, writes results to .benchmark-results/
```

**Step 2 — Build corpus from results + audits**

```bash
# from services/dsi-eval
pnpm build-corpus \
  --benchmark-results ../../packages/experience-design-system-cli/.benchmark-results \
  --audits ../../packages/experience-design-system-cli/benchmarks/component-validation/audits \
  --out corpus/
```

This writes one `corpus/<repo>.json` per design system. Each file contains:
- `rawComponents` — the Stage 0 extraction output (frozen input to Stage 1/2)
- `expectedComponents` — component names + verdicts from the audit (ground truth for scoring)

## Running the eval

```bash
# run against all corpus entries
pnpm start

# run against a single repo
pnpm start -- --repo=material-ui

# save current scores as the new baseline
pnpm start:save-baseline
```

Output: `eval-report.md` in the current directory.

## Scoring

| Metric | How it works |
|---|---|
| Component coverage | Ratio of expected component names found in Stage 2 CDF output |
| Hallucination check | Validates all `$type` values against the CDF vocabulary |
| Mapping quality | LLM-as-judge score 1–5 via Bedrock; judges prop category/type accuracy |

Regressions are flagged when coverage drops >5% or mapping quality drops >1 point vs baseline.
