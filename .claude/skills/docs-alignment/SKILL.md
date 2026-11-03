---
name: docs-alignment
description: Keep the repo docs and the public Contentful docs in step with changes to the CLI. Use after changing commands, options, import steps, the home or Settings screens, supported agents or frameworks, file types, log retention, or the Node version.
---

# Docs alignment

The CLI is documented in two places. A change to the CLI can leave either one wrong.

| Docs | Where | Reader |
| --- | --- | --- |
| Repo docs | `README.md`, `ARCHITECTURE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `packages/experience-design-system-cli/DSI_TUI_ARCHITECTURE.md` | Contributors, and people who find the repo |
| Public docs | `contentful/contentful-docs`, `fern/docs/pages/experience-orchestration/import-design-system/` (`getting-started`, `import-flow`, `command-reference`, `faq`, `overview`) | People who install and use the CLI |

## 1. Find what is out of date

```bash
python3 scripts/docs-alignment/check.py
```

It reads facts from the code and checks that the repo docs agree: the registered commands and options, the supported agents, the import stages, the home menu, the supported frameworks and file types, log retention, and the Node version. It prints each place that disagrees.

To check the public docs too, point it at a copy of that folder:

```bash
python3 scripts/docs-alignment/check.py --public-docs-dir /path/to/contentful-docs/fern/docs/pages/experience-orchestration/import-design-system
```

In CI the same script runs on every PR to `main` and `development`. It also warns when a PR changes code that usually needs a doc update and changes no doc.

## 2. Fix the repo docs

Edit the lines the check points to, in the same PR as the code change. Describe what the code does. Do not describe commands or flags that do not exist: the CLI registers one command, `import`.

## 3. Fix the public docs

The public docs are a separate repo, so this is a second PR.

1. Branch from `main` in `contentful/contentful-docs` and edit only the pages the change affects.
2. Check each claim against the code or the published package, not against another doc.
3. Keep to the conventions the pages already follow:
   - Write for a developer. Keep sentences short and say only what the reader needs.
   - Say "guide", not "page", in introductions.
   - The import is driven from the CLI screens. Do not tell readers to pass terminal flags.
   - Number the import steps and name the stages as the CLI shows them: Setup, Extract, Select, Generate, Review, Push.
   - Link to other pages by path and anchor, and make sure the anchor exists.
4. Put a Jira key in the PR title, for example `docs(exo-dsi): update the import steps [INTEG-1234]`. The docs repo checks it.
5. Open the PR as a draft and link it from the SDK PR. Public docs go live when the PR merges, so merge it after the CLI release that makes the new behavior true.

## 4. Extend the check

When a new fact starts to matter, add a rule to `scripts/docs-alignment/check.py`:

- Read the fact from the code in `extract_facts`.
- Add a check in `check_local` or `check_public`.
- If a path in the code should always trigger a doc review, add it to `SENSITIVE_PATHS`.

Keep rules precise. A rule that raises false alarms gets ignored.
