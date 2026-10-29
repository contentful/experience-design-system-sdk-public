# Experience Design System SDK

> ⚠️ This feature is in Beta, APIs may be unstable

Contentful Experiences lets you compose pages and layouts from your own design system components. The `@contentful/experience-design-system-cli` imports your design system into Contentful. It extracts Component Type definitions from your local codebase, invokes an AI agent to generate Component Definition Format (CDF) definitions, and pushes them to your Contentful space.

Your codebase remains the single source of truth. The CLI analyzes your source files (`.tsx`, `.ts`, `.jsx`, `.js`, `.vue`, `.astro`) using static analysis, then delegates property classification and CDF generation to a coding agent.

## Prerequisites

- **Node.js 24 or later.** Node.js is the program that runs this tool. To see whether you already have it, open a terminal and type `node -v`. If you see an error, or a number lower than 24, download the "LTS" version from [nodejs.org](https://nodejs.org/en/download) and install it. That installer also gives you `npm`, which you will use in the next section.
- **A coding agent.** The tool uses an AI coding agent to help describe your components. Install one of these: Claude Code, Codex, OpenCode, Cursor, or GitHub Copilot. Then sign in to it, and make sure you can start it by typing its command in your terminal.
- **Your Contentful space ID, environment ID, and a CMA token.** The space ID identifies the Contentful space you are importing into. The environment ID identifies which environment inside that space to use, and most spaces use `master`. A CMA token is a secret key that lets this tool make changes in that space, and you can create one in Contentful under **Settings → CMA tokens**. The tool asks you for all three while it runs. If your space is hosted in the EU, enter `api.eu.contentful.com` when it asks for the API host.

## Quick Start

### Install

```bash
npm install -g @contentful/experience-design-system-cli
```

To confirm that the install worked, type `experiences --version`. It should print a version number.

If you are a developer and want to build the tool from its source code instead, follow the steps in the [contributing guide](https://github.com/contentful/experience-design-system-sdk-public/blob/development/CONTRIBUTING.md).

### Run

First, move your terminal into the folder that contains your design system. In the terminal, type `cd` followed by a space, then drag that folder from your file manager (Finder on a Mac) into the terminal window so its path fills in, and press Enter. You can also type the path yourself, for example:

```bash
cd ~/Documents/my-design-system
```

Then start the import by typing:

```bash
experiences import
```

This opens a full-screen guided wizard, so make your terminal window as large as you can before you run it. The wizard walks you through these steps in order: choosing your project folder, adding an optional file of design tokens, entering your Contentful details, reading your components, choosing which components to import, generating the component definitions, reviewing them, and finally sending them to Contentful.

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
