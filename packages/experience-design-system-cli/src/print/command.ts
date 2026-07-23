import { createElement } from 'react';
import { render } from 'ink';
import { access, mkdir, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { Command } from 'commander';
import { openPipelineDb, loadCDFComponents, loadDTCGTokens, findLatestSessionForCommand } from '../session/db.js';
import { validateCDFFile } from './validate/validators/cdf-validator.js';
import { validateDTCGTokenFile } from './validate/validators/dtcg-validator.js';
import { formatDiagnostics } from './validate/validators/format-errors.js';
import { ValidateView } from './validate/tui/ValidateView.js';
import type { ValidateViewEntry } from './validate/tui/ValidateView.js';
import type { DTCGTokenGroupNode } from '@contentful/experience-design-system-types';

function die(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function pathExists(p: string): Promise<boolean> {
  return access(p)
    .then(() => true)
    .catch(() => false);
}

async function assertOutIsNotDirectory(outPath: string): Promise<void> {
  if (await pathExists(outPath)) {
    const s = await stat(outPath);
    if (s.isDirectory()) die(`Error: --out must be a file path, not a directory: ${outPath}`);
  }
}

function resolveSession(sessionFlag: string | undefined, command: 'generate components' | 'generate tokens'): string {
  const db = openPipelineDb();
  try {
    const sessionId = sessionFlag ?? findLatestSessionForCommand(db, command);
    if (!sessionId) {
      const hint = command === 'generate components' ? 'generate components' : 'generate tokens';
      die(`Error: no completed ${hint} session found. Run ${hint} first, or pass --session <id>.`);
    }
    return sessionId;
  } finally {
    db.close();
  }
}

function rebuildDTCGTree(
  groups: Array<{ path: string; $description?: string }>,
  tokens: Array<{ path: string; $type: string; $value: unknown; $description?: string }>,
): Record<string, unknown> {
  const root: Record<string, unknown> = {};

  // Apply group descriptions
  for (const group of groups) {
    const segments = group.path.split('.');
    let node = root;
    for (const seg of segments) {
      if (typeof node[seg] !== 'object' || node[seg] === null) {
        node[seg] = {};
      }
      node = node[seg] as Record<string, unknown>;
    }
    if (group.$description) {
      (node as Record<string, unknown>)['$description'] = group.$description;
    }
  }

  // Place leaf tokens
  for (const token of tokens) {
    const segments = token.path.split('.');
    const leafKey = segments[segments.length - 1]!;
    const parentSegments = segments.slice(0, -1);

    let node = root;
    for (const seg of parentSegments) {
      if (typeof node[seg] !== 'object' || node[seg] === null) {
        node[seg] = {};
      }
      node = node[seg] as Record<string, unknown>;
    }

    const leaf: Record<string, unknown> = { $type: token.$type, $value: token.$value };
    if (token.$description) leaf['$description'] = token.$description;
    (node as DTCGTokenGroupNode)[leafKey] = leaf as DTCGTokenGroupNode;
  }

  return root;
}

export function registerPrintCommand(program: Command): void {
  const print = program.command('print').description('Write pipeline artifacts to JSON files or validate them');

  // print components
  print
    .command('components')
    .description('Write generated components to a CDF JSON file')
    .option('--session <id>', 'Session ID to print from (default: most recent generate components session)')
    .option('--out <path>', 'Output file path', 'components.json')
    .option(
      '--allow-empty',
      'Write an empty-but-present components manifest when no components are accepted (a subsequent push then removes ALL components from the target space). Without this, an empty accepted set is an error.',
    )
    .action(async (opts: { session?: string; out: string; allowEmpty?: boolean }) => {
      const outPath = resolve(opts.out);
      await assertOutIsNotDirectory(outPath);

      const sessionId = resolveSession(opts.session, 'generate components');

      const db = openPipelineDb();
      let components: ReturnType<typeof loadCDFComponents>;
      let generateStepStatus: string | null = null;
      let rejectedCount = 0;
      try {
        components = loadCDFComponents(db, sessionId);
        const stepRow = db
          .prepare(
            `SELECT status FROM steps WHERE session_id = ? AND command = 'generate components' ORDER BY id DESC LIMIT 1`,
          )
          .get(sessionId) as { status: string } | undefined;
        generateStepStatus = stepRow?.status ?? null;
        const rejectedRow = db
          .prepare(`SELECT COUNT(*) AS n FROM raw_components WHERE session_id = ? AND status = 'generate-rejected'`)
          .get(sessionId) as { n: number } | undefined;
        rejectedCount = rejectedRow?.n ?? 0;
      } finally {
        db.close();
      }

      if (components.length === 0) {
        if (rejectedCount > 0) {
          // Components WERE generated, but final review left none accepted — every
          // component was rejected or left unresolved. This is a legitimate
          // "clear the space" intent, but it's destructive, so require --allow-empty.
          if (!opts.allowEmpty) {
            die(
              `Error: all ${rejectedCount} generated component${rejectedCount === 1 ? ' was' : 's were'} rejected or left unresolved at final review in session '${sessionId}', so there is nothing to save. Accept at least one component (press [a] on a row, or [A] to accept all), or pass --allow-empty to write an empty manifest that will DELETE all components from the target space on push.`,
            );
          }
          // Fall through: write an empty-but-present components manifest so a
          // subsequent push removes every component from the target space.
        } else {
          die(`Error: no generated components in session '${sessionId}'. Run generate components first.`);
        }
      }

      if (generateStepStatus === 'failed') {
        process.stderr.write(
          `Warning: session '${sessionId}' generate step failed — output may be incomplete (${components.length} components found)\n`,
        );
      }

      const cdfObj: Record<string, unknown> = { $schema: 'https://contentful.com/schemas/cdf/v1' };
      const missingDescription: string[] = [];
      for (const { key, entry } of components) {
        cdfObj[key] = entry;
        if (!entry.$description) missingDescription.push(key);
      }

      if (missingDescription.length > 0) {
        process.stderr.write(
          `Warning: ${missingDescription.length} component${missingDescription.length === 1 ? '' : 's'} missing $description (will fail at apply push): ${missingDescription.join(', ')}\n`,
        );
      }

      await mkdir(resolve(outPath, '..'), { recursive: true });
      await writeFile(outPath, `${JSON.stringify(cdfObj, null, 2)}\n`);
      process.stdout.write(
        `wrote ${basename(outPath)} (${components.length} component${components.length === 1 ? '' : 's'})\n`,
      );
    });

  // print tokens
  print
    .command('tokens')
    .description('Write generated tokens to a DTCG JSON file')
    .option('--session <id>', 'Session ID to print from (default: most recent generate tokens session)')
    .option('--out <path>', 'Output file path', 'tokens.json')
    .action(async (opts: { session?: string; out: string }) => {
      const outPath = resolve(opts.out);
      await assertOutIsNotDirectory(outPath);

      const sessionId = resolveSession(opts.session, 'generate tokens');

      const db = openPipelineDb();
      let result: ReturnType<typeof loadDTCGTokens>;
      try {
        result = loadDTCGTokens(db, sessionId);
      } finally {
        db.close();
      }

      if (result.tokens.length === 0) {
        die(`Error: no generated tokens in session '${sessionId}'. Run generate tokens first.`);
      }

      const tree = rebuildDTCGTree(result.groups, result.tokens);

      await mkdir(resolve(outPath, '..'), { recursive: true });
      await writeFile(outPath, `${JSON.stringify(tree, null, 2)}\n`);
      process.stdout.write(
        `wrote ${basename(outPath)} (${result.tokens.length} token${result.tokens.length === 1 ? '' : 's'})\n`,
      );
    });

  // print validate
  print
    .command('validate')
    .description('Validate CDF or DTCG files against their schemas')
    .option('--components <path>', 'Path to CDF components file')
    .option('--tokens <path>', 'Path to DTCG tokens file')
    .action(async (opts: { components?: string; tokens?: string }) => {
      if (!opts.components && !opts.tokens) {
        process.stderr.write(
          'Error: at least one of --components or --tokens is required.\n\nUsage: print validate [--components <path>] [--tokens <path>]\n',
        );
        process.exit(1);
      }

      const viewResults: ValidateViewEntry[] = [];

      if (opts.components) {
        const r = await validateCDFFile(opts.components);
        viewResults.push({
          filePath: opts.components,
          format: 'CDF v1',
          valid: r.valid,
          summary: r.summary,
          diagnostics: r.diagnostics,
        });
      }

      if (opts.tokens) {
        const r = await validateDTCGTokenFile(opts.tokens);
        viewResults.push({
          filePath: opts.tokens,
          format: 'DTCG',
          valid: r.valid,
          summary: r.summary,
          diagnostics: r.diagnostics,
        });
      }

      const failed = viewResults.some((r) => !r.valid);
      const exitCode = failed ? 1 : 0;

      if (process.stdout.isTTY) {
        const { waitUntilExit } = render(
          createElement(ValidateView, {
            results: viewResults,
            onExit: () => process.exit(exitCode),
          }),
        );
        await waitUntilExit();
      } else {
        const output = viewResults
          .map((r) =>
            formatDiagnostics({
              valid: r.valid,
              summary: r.summary ?? r.filePath,
              diagnostics: r.diagnostics,
            }),
          )
          .join('\n\n');
        process.stdout.write(output + '\n');
        process.exit(exitCode);
      }
    });
}
