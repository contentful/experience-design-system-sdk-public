# Experience Design System SDK

> ⚠️ This feature is in Beta, APIs may be unstable

Contentful Experiences lets you compose pages and layouts from your own design system components. The `@contentful/experience-design-system-cli` imports your design system into Contentful. It extracts Component Type definitions from your local codebase, invokes an AI agent to generate Component Definition Format (CDF) definitions, and pushes them to your Contentful space.

Your codebase remains the single source of truth. The CLI analyzes your source files (`.tsx`, `.ts`, `.jsx`, `.js`, `.vue`, `.astro`) using static analysis, then delegates property classification and CDF generation to a coding agent.

## Prerequisites

- **Node.js 24 or later** — check with `node -v`. If it's missing or older, install the LTS version from [nodejs.org](https://nodejs.org/en/download); this also installs `npm`.
- **A coding agent** — Claude Code, Codex, OpenCode, Cursor, or GitHub Copilot, installed and signed in so its command runs in your terminal.
- **Your Contentful space ID and a CMA token** — create a token under **Settings → CMA tokens** in Contentful. The import wizard asks for both. For EU spaces, set the API host to `api.eu.contentful.com` when prompted.

## Quick Start

### Install

```bash
npm install -g @contentful/experience-design-system-cli
```

Check that it worked with `experiences --version`.

The package publishes three binaries — `experiences`, `exo`, and `experience-design-system-cli`. The docs below use `experiences` since that is the wizard-oriented entry point.

To build the CLI from source instead, see [CONTRIBUTING.md](CONTRIBUTING.md).

### Run

The primary entry point is the import wizard:

```bash
experiences import
```

In an interactive terminal this launches a full-screen TUI that walks you through the project path, an optional token file, credentials, extraction and AI selection, a manual scope review, generation, final review, and push. Run it from your design system project in a full-screen terminal window.

## How it works

The CLI runs your component library through four stages:

**1. Analyze** — Reads your source files and extracts every component: its name, props, types, and source location.

**2. Select** — An AI agent reviews the extracted components and decides which ones make sense to expose in Contentful Experiences (buttons, cards, layouts) and which to skip (hooks, context providers, utilities). The wizard then opens a single **scope-gate** for you to confirm or override that list.

**3. Generate** — An AI agent takes the selected components and produces structured definitions that tell Contentful what each prop is for — whether it holds content, a design token, or interactive state. The wizard then opens a **final-review** field editor where you can edit names, descriptions, defaults, allowed values, and slot constraints inline.

**4. Apply** — Saves a combined `components.json` to disk for source control, shows a diff of what will change in your Contentful space, then pushes.

To apply a checked-in CDF file without the wizard, use `experiences apply <file>`.

## Packages

| Package                                                                                  | Description                                                                                       |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [`@contentful/experience-design-system-cli`](packages/experience-design-system-cli/)     | The CLI: interactive TUI and wizard to review, generate, validate, and push component definitions |
| [`@contentful/experience-design-system-types`](packages/experience-design-system-types/) | Shared types and schemas for the CDF and DTCG data formats                                        |

## Command Reference

Full documentation for every flag and every subcommand lives in [`packages/experience-design-system-cli/README.md`](packages/experience-design-system-cli/README.md).

| Command                    | What it does                                                             |
| -------------------------- | ------------------------------------------------------------------------ |
| `experiences setup`        | Interactive setup — installs prerequisites and saves credentials + agent |
| `experiences doctor`       | Health check — verify Node version, credentials, and agent binaries      |
| `experiences import`       | Run the interactive wizard (extract → select → generate → review → push) |
| `experiences apply <file>` | Write component types and design tokens from one CDF file to Contentful  |
