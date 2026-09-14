# Engineering Design and Implementation Standard

## Purpose

This document defines how humans and coding agents: design, implement, test, and review changes for the `experience-design-system-cli-v2` package.

## Project structure
**packages/experience-design-system-cli-v2/src/tui**
This package is the Terminal UI flow that the customer interacts with

**packages/experience-design-system-cli-v2/src/api**
This is where all the api calls are made that the TUI needs

**packages/experience-design-system-cli-v2/.contentful/config**
This stores the configuration settings for a given user like their SPACE_ID, ENV_ID, CMA_TOKEN, OPT_IN_ANALYTICS, and other options that the user flags

**packages/experience-design-system-cli-v2/.contentful/debug**
Stores the output for a given import run in the TUI depending on what option/flow the user chose to execute in the TUI.

## Project Architecture

**packages/experience-design-system-cli-v2/src/tui**
Each directory in `packages/experience-design-system-cli-v2/src/tui` represents a menu item in the TUI and is an indepedent flow of screens. 
Each flow is separate and if that results in code duplication, that is okay. This is because with agentic engineering we do not want to introduce dependencies where one bug in a given flow breaks the another flow. Additionally, by keeping each flow independent, we can easily trace the source of the bug, introduce updates faster, and build more efficiently without having to think about consequences outside of the given flow. 

For each directory and flow, there is always a top level parent container screen named: `PageContainer.tsx`. This defines the outer layer for all the pages for a given flow. Each `PageContainer.tsx` for a given flow is allowed to be different as each flow serves a different purpose. The purpose of `PageContainer.tsx` for a given flow is to unify the same controls, look, theme, and functions that is shared across all pages/screens for a given flow.

## Supported Frameworks
1. React
2. Astro
3. Vue
4. Svelte

## Unsupported Frameworks
5. Angular (coming soon)