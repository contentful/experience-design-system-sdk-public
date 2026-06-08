# dsi-eval

AI evals for DSI pipeline stages 1 (select) and 2 (generate).

## Setup

```bash
cd services/dsi-eval
pnpm install
```

Set AWS credentials (ask in #dx-design-system-integrations):

```bash
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_SESSION_TOKEN=...
```

## Run

```bash
pnpm start                        # run all corpus entries
pnpm start -- --repo=material-ui  # run one repo
pnpm start:save-baseline          # save scores as new baseline
```

Output: `eval-report.md`
