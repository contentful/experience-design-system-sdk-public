# Temporary import debugging checkpoints

Imports save a small checkpoint after extraction. Source evidence, component reports, property and slot reviews, and generated decisions remain in the existing session database. Generation additionally saves each agent attempt and its decision feedback, including failed results.

Open the restart menu directly:

```sh
experiences import --debug-resume
experiences import --debug-resume <session-id>
```

The first command selects the most recent completed extraction session. The menu offers these restart steps:

| Step | Saved work reused | Work run again |
| --- | --- | --- |
| `scope` | Source extraction and component exploration | Human selection, detail reviews, generation and token mapping |
| `details` | Source extraction, component exploration and saved human selection | All three property/slot review passes, generation and token mapping |
| `generation` | Source extraction, all exploration/reconciliation and valid completed definitions | Held or incomplete component definitions, then token mapping |
| `tokens` | Exploration and all completed definitions | Token mapping |
| `review` | Completed definitions and token mapping | Final human review and local save |

Skip the restart menu by naming a step:

```sh
experiences import --debug-resume <session-id> --debug-from generation
```

A resume uses the saved source snapshot, even if source files or prompts have since changed. Saved decisions still undergo current source/definition validation; held or incomplete definitions cannot skip to token mapping or final review. To regenerate previously valid definitions with updated prompts or pipeline behavior, restart from `details`; to analyze changed source, run a normal import.

Debug resumes skip credentials and remote push and retain the normal final review. They do not invoke extraction or component exploration again. These options are a temporary debugging route, with no automatic cross-session reuse or cache invalidation policy.

## Storage

Checkpoint metadata and generation attempts are stored beside `pipeline.db`:

```text
~/.contentful/experience-design-system-cli/debug-resume/<session-id>/
  checkpoint.json
  token-mapping.json
  generation/<component-id>/*-attempt-*.json
  generation/<component-id>/*-decisions.json
```

`EDS_PIPELINE_DB_PATH` relocates this directory alongside the selected database. Checkpoints contain paths, model and prompt choices, and extraction handoff metadata, without credentials. Attempt artifacts contain the exact generation prompt and agent response and are private local debugging files. A successful component is durable independently of failures in sibling components.

## Imports made before these checkpoints

Source, exploration and generated decisions are already in the session database. Supply the original output folder once to recover the missing handoff metadata:

```sh
experiences import --debug-resume <session-id> \
  --debug-output /path/to/project/.contentful/session-folder/dsi-import-1
```

Recovery uses that folder's `tokens.json` and `.existing-entities.json` when present, plus the current configured agent/model; it does not fetch or regenerate them. Use the folder containing the token file used by the original import. Older attempts have no new generation artifact files, but successfully persisted definitions can still be reused.
