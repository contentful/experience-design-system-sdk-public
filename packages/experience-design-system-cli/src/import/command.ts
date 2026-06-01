import type { Command } from 'commander';
import { resolve, join } from 'node:path';
import { runPipeline } from './orchestrator.js';
import { readExperiencesCredentials } from '../credentials-store.js';

export function registerImportCommand(program: Command): void {
  program
    .command('import')
    .description('Run the full pipeline: analyze → select → generate → push')
    .option('--space-id <id>', 'Contentful space ID (required unless --skip-apply)')
    .option('--environment-id <id>', 'Contentful environment ID (required unless --skip-apply)')
    .option('--cma-token <token>', 'CMA personal access token (or set CONTENTFUL_MANAGEMENT_TOKEN)')
    .option('--project <path>', 'Path to the project root to analyze', '.')
    .option('--out <path>', 'Output directory for pipeline artifacts')
    .option('--agent <name>', 'Agent to use for generate components', 'claude')
    .option('--model <name>', 'Model to use for generate components (defaults to a small/fast model per agent)')
    .option('--tokens <path>', 'Path to a DTCG tokens.json file to push alongside generated components')
    .option('--select-all', 'Select all extracted components for generation (default)')
    .option(
      '--select <pattern>',
      'Select components matching pattern (repeatable)',
      (v, a: string[]) => [...a, v],
      [] as string[],
    )
    .option(
      '--deselect <pattern>',
      'Deselect components matching pattern (repeatable)',
      (v, a: string[]) => [...a, v],
      [] as string[],
    )
    .option('--skip-analyze', 'Skip the analyze step (uses most recent extract session)')
    .option('--skip-generate', 'Skip the generate step (uses most recent generate session)')
    .option('--print', 'Write components.json to --out after generation')
    .option('--skip-apply', 'Skip pushing to Contentful (stops after generate)')
    .option('--no-cache', 'Re-run all steps even if output already exists')
    .option('--yes', 'Skip interactive confirmation in apply push')
    .option('--verbose', 'Show full agent output and all entity progress')
    .option('--viewports <path>', 'JSON file with viewport array (passed to apply push)')
    .option('--host <url>', 'Override API base URL (passed to apply push)')
    .option('--dry-run', 'Print generate components prompt without invoking the agent')
    .action(
      async (opts: {
        spaceId?: string;
        environmentId?: string;
        cmaToken?: string;
        project: string;
        out?: string;
        agent: string;
        model?: string;
        tokens?: string;
        selectAll?: boolean;
        select: string[];
        deselect: string[];
        skipAnalyze?: boolean;
        skipGenerate?: boolean;
        print?: boolean;
        skipApply?: boolean;
        cache?: boolean;
        yes?: boolean;
        verbose?: boolean;
        viewports?: string;
        host?: string;
        dryRun?: boolean;
      }) => {
        const isHeadless =
          opts.skipAnalyze ||
          opts.skipGenerate ||
          opts.skipApply ||
          !!opts.spaceId ||
          !!opts.environmentId ||
          !!opts.cmaToken ||
          opts.yes ||
          opts.dryRun ||
          false;

        if (process.stdout.isTTY && !isHeadless) {
          const { render } = await import('ink');
          const { createElement } = await import('react');
          const { WizardApp } = await import('./tui/WizardApp.js');
          type WizardProps = {
            initialSpaceId?: string;
            initialEnvironmentId?: string;
            initialCmaToken?: string;
            initialHost?: string;
            initialAgent?: string;
            initialProjectPath?: string;
            host?: string;
          };
          const creds = await readExperiencesCredentials();
          const { waitUntilExit } = render(
            createElement<WizardProps>(WizardApp, {
              initialSpaceId: creds.spaceId,
              initialEnvironmentId: creds.environmentId || 'master',
              initialCmaToken: creds.cmaToken,
              initialHost: creds.host,
              initialAgent: opts.agent !== 'claude' ? opts.agent : undefined,
              initialProjectPath: opts.project !== '.' ? resolve(opts.project) : undefined,
              host: opts.host,
            }),
          );
          await waitUntilExit();
          return;
        }

        const skipApply = opts.skipApply ?? false;
        const spaceId = opts.spaceId ?? process.env['CONTENTFUL_SPACE_ID'];
        const environmentId = opts.environmentId ?? process.env['CONTENTFUL_ENVIRONMENT_ID'];
        const cmaToken = opts.cmaToken ?? process.env['CONTENTFUL_MANAGEMENT_TOKEN'];

        if (!skipApply && (!spaceId || !environmentId || !cmaToken)) {
          process.stderr.write(
            'Error: --space-id (or CONTENTFUL_SPACE_ID), --environment-id (or CONTENTFUL_ENVIRONMENT_ID), and --cma-token (or CONTENTFUL_MANAGEMENT_TOKEN) are required unless --skip-apply is set.\n',
          );
          process.exit(1);
          return;
        }

        const projectRoot = resolve(opts.project);
        const outDir = opts.out ? resolve(opts.out) : join(projectRoot, '.contentful');

        const result = await runPipeline(
          {
            project: projectRoot,
            out: outDir,
            spaceId,
            environmentId,
            cmaToken,
            agent: opts.agent,
            model: opts.model,
            tokens: opts.tokens,
            selectAll: opts.selectAll,
            select: opts.select.length > 0 ? opts.select : undefined,
            deselect: opts.deselect.length > 0 ? opts.deselect : undefined,
            skipAnalyze: opts.skipAnalyze ?? false,
            skipGenerate: opts.skipGenerate ?? false,
            print: opts.print ?? false,
            skipApply,
            noCache: opts.cache === false,
            yes: opts.yes ?? false,
            verbose: opts.verbose ?? false,
            viewports: opts.viewports,
            host: opts.host,
            dryRun: opts.dryRun,
          },
          (line) => process.stderr.write(line + '\n'),
        );

        const hasFailed = result.steps.some((s) => s.status === 'failed');
        if (!process.stdout.isTTY) {
          const json = JSON.stringify(result, null, 2) + '\n';
          await new Promise<void>((res) => process.stdout.write(json, () => res()));
        }
        process.exit(hasFailed ? 1 : 0);
      },
    );
}
