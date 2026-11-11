# Experience Design System SDK

> ⚠️ This feature is in Beta, APIs may be unstable

Contentful Experiences lets you compose pages and layouts from your own design system components. The `@contentful/experience-design-system-cli` imports your design system into Contentful. It extracts Component Type definitions from your local codebase and, if you have a design token file, generates design tokens from it. It invokes an AI agent to generate Component Definition Format (CDF) definitions and pushes everything to your Contentful space.

Your codebase remains the single source of truth. The CLI analyzes your source files (`.tsx`, `.ts`, `.jsx`, `.js`, `.vue`, `.svelte`, `.astro`) using static analysis, then delegates property classification and CDF generation to a coding agent.

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

The install adds three commands to your terminal: `experiences`, `exo`, and `experience-design-system-cli`. All three do the same thing. The rest of this guide uses `experiences`.

If you are a developer and want to build the tool from its source code instead, follow the steps in the [contributing guide](https://github.com/contentful/experience-design-system-sdk-public/blob/development/CONTRIBUTING.md).

### Run

Start the import by typing:

```bash
experiences import
```

This opens a full-screen guided wizard, so make your terminal window as large as you can before you run it. The wizard asks for everything it needs on its own screens.

It first asks what you want to import, then asks only for what that choice needs:

| You choose                   | The wizard asks for                                                       |
| ---------------------------- | ------------------------------------------------------------------------- |
| Design tokens and components | Your project folder, a file of design tokens, and your Contentful details |
| Components only              | Your project folder and your Contentful details                           |
| Design tokens only           | A file of design tokens and your Contentful details                       |

After that it works through your components and tokens, you review the result, and it shows what will change in your space before it sends anything to Contentful.

## How it works

The CLI runs your component library through four stages:

**1. Analyze** — Reads your source files and extracts every component: its name, props, types, and source location.

**2. Select** — An AI agent reviews the extracted components and decides which ones make sense to expose in Contentful Experiences (buttons, cards, layouts) and which to skip (hooks, context providers, utilities). The wizard then opens a single **scope-gate** for you to confirm or override that list.

**3. Generate** — An AI agent takes the selected components and produces structured definitions that tell Contentful what each prop is for — whether it holds content, a design token, or interactive state. The wizard then opens a **final-review** field editor where you can edit names, descriptions, defaults, allowed values, and slot constraints inline.

**4. Apply** — Saves a combined `components.json` to disk for source control, shows a diff of what will change in your Contentful space, then pushes.

If you import design tokens only, the CLI skips the component stages: it generates tokens from your token file, shows them for review, then goes straight to the Apply stage.

## Packages

| Package                                                                                                        | Description                                                                                       |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [`@contentful/experience-design-system-cli`](packages/experience-design-system-cli/)                           | The CLI: interactive TUI and wizard to review, generate, validate, and push component definitions |
| [`@contentful/experience-design-system-backend-pipeline`](packages/experience-design-system-backend-pipeline/) | The logic behind the CLI: extraction, composition, selection, generation and apply                |
| [`@contentful/experience-design-system-client`](packages/experience-design-system-client/)                     | Generated client for the Experience Design System Integrations API                                |
| [`@contentful/experience-design-system-types`](packages/experience-design-system-types/)                       | Shared types and schemas for the CDF and DTCG data formats                                        |

## Command Reference

The CLI has one command, `experiences import`. It is also what runs when you start `experiences` with no command. It opens a full-screen home screen with three options: **Import**, **Settings**, and **Help**. Use **Settings** to save your Contentful credentials and choose your coding agent, and **Import** to start the wizard.

## Settings and defaults

Two settings are **on** until you turn them off. Both are under **Settings** on the home screen.

### Usage analytics (Settings → Opt-in Analytics)

The CLI shares anonymous usage data by default. It records which CLI commands are used and where imports succeed or fail. It never includes source code, file paths, credentials, or authored content.

To turn it off, open **Settings → Opt-in Analytics** and press Enter or Space. You can also set the `DISABLE_ANALYTICS` environment variable to any non-empty value (for example `DISABLE_ANALYTICS=1 experiences import`), which turns it off for that run without changing your saved setting.

### Debug logging (Settings → Debug Mode)

The CLI writes debug logs for each screen by default, so there is something to share if you hit a problem. The CMA token is redacted from them. Logs are deleted after 30 days; you can change that to 7 or 14 days, or turn logging off, under **Settings → Debug Mode**.

The logs go in a folder for each terminal session, `<base>/.contentful/<date>-session-<n>/debug`, next to the `tokens.json` and `components.json` each import saves. `<base>` is the **Root Project Directory** if you set one under **Settings → Configuration → Project**, and otherwise the project you are importing. That means that **by default these folders are created inside your own project**. To keep them out of it, set a Root Project Directory somewhere else, or add `.contentful/` to your `.gitignore`.

With Debug Mode off no logs are written and the saved files go in `<project>/.contentful/`. The **Help** screen shows where the current session writes its files.

## If an import fails

When a step fails, the error screen says so and saves a zip of that session's debug logs. It shows the full path to the zip, which looks like `<base>/.contentful/<date>-session-<n>/<date>-session-<n>-debug-logs.zip`.

Send that zip file to Contentful support. The zip sits next to the `debug` folder, so the log cleanup does not delete it. Delete it yourself when you no longer need it.

If Debug Mode is off, there is nothing to zip. The error screen tells you to turn on Debug Mode under **Settings → Debug Mode**, run the import again, and send the zip it saves.
