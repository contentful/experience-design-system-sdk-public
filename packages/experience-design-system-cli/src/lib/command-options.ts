import type { Command } from 'commander';

export function addArtifactInputOptions(cmd: Command): Command {
  return cmd
    .option('--components <path>', 'Path to components.json (CDF)')
    .option('--tokens <path>', 'Path to tokens.json (DTCG)')
    .option('--session <id>', 'Pipeline session ID to load generated components from');
}

export function addContentfulTargetOptions(cmd: Command): Command {
  return cmd
    .requiredOption('--space-id <id>', 'Contentful space ID')
    .requiredOption('--environment-id <id>', 'Contentful environment ID')
    .option('--cma-token <token>', 'CMA personal access token (or set CONTENTFUL_MANAGEMENT_TOKEN)')
    .option('--host <url>', 'Override API base URL');
}

export function addCompositionOptions(cmd: Command): Command {
  return cmd
    .option('--composite', 'Import embedded-component hierarchy (opt in; default is atomic)')
    .option('--atomic', 'Import flat components with no embedded-component hierarchy (default)');
}

function collectOptionValue(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function addSelectionOptions(cmd: Command): Command {
  return cmd
    .option('--select-all', 'Select all entities without launching TUI')
    .option('--select <pattern>', 'Select entities by ID pattern (repeatable)', collectOptionValue, [])
    .option('--deselect <pattern>', 'Deselect entities by ID pattern (repeatable)', collectOptionValue, []);
}
