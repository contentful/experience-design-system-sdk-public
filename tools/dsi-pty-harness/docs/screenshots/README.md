# Screenshots (generated, gitignored)

This directory holds text snapshots and rendered PNGs of the wizard's
key states. Both are generated locally and gitignored — never committed.

## Regenerate

```bash
# 1. Capture text snapshots by driving the wizard/CLI. Sanitizes paths
#    to ~/design-system-fixture, normalizes session ids and durations.
#    Produces <slug>.txt in this directory.
node tools/dsi-pty-harness/scripts/capture-screenshots.mjs

# 2. Render each .txt to <slug>.png using silicon (dark terminal theme,
#    ~2000px wide). Requires `brew install silicon`.
node tools/dsi-pty-harness/scripts/render-screenshots.mjs
```

Pass individual slugs to either script to regenerate a single snapshot:

```bash
node tools/dsi-pty-harness/scripts/capture-screenshots.mjs experience-design-system-cli-import-scope-gate
node tools/dsi-pty-harness/scripts/render-screenshots.mjs experience-design-system-cli-import-scope-gate
```

## Manifest

| Slug | Renders |
|---|---|
| `experience-design-system-cli-setup` | `experiences setup` — six-step onboarding, final state after all prompts. |
| `experience-design-system-cli-import-welcome` | Wizard entry after `experiences import` on a fresh install; WelcomeStep with 5-step overview and Project path prompt. |
| `experience-design-system-cli-import-run-picker` | Run-picker with 3 seeded prior runs and their metadata. |
| `experience-design-system-cli-import-scope-gate` | Scope-gate with `--auto-filter`. Both AI-exclusions and Components sections populated. |
| `experience-design-system-cli-import-final-review` | GenerateReviewStep via `--modify`. Sidebar, FieldEditor, `[I]` rationale panel. |
| `experience-design-system-cli-import-pushing` | PushingStep mid-push against mock EMA — `2/3 entities` with spinner. |
| `experience-design-system-cli-import-done` | DoneStep after successful push. Summary counts, webapp URL, run-id echo. |
| `experience-design-system-cli-analyze-extract` | `analyze extract --project` output: scan progress, extracted count, session id. |
| `experience-design-system-cli-analyze-select` | `analyze select-agent`: per-component classify table with reasons. |
| `experience-design-system-cli-generate-components` | Full `import --skip-apply` pipeline output — extract + select + generate + summary JSON. |

## Notes

- Sanitized paths: `~/design-system-fixture` throughout.
- Session IDs → `<session-id>`, durations → fixed `(0.5s)` / `500` for reproducibility.
- Renderer uses Silicon with `Monokai Extended` theme, `Menlo 16pt`,
  `#0d1117` background. Adjust flags in `scripts/render-screenshots.mjs`.
- The 👋 emoji in `import-welcome` doesn't render (Silicon's Menlo lacks
  color-glyph support); shows as a space. Set the font to a compound
  like `Menlo,Apple Color Emoji` if the emoji matters.
