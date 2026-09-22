import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Command } from 'commander';
import {
  applyDotPath,
  applyComponentPatch,
  warnOnUnknownPatchComponents,
  type ComponentPatchOperation,
} from '../../lib/component-patch.js';

type GenerateEditOptions = {
  session?: string;
  acceptAll?: boolean;
  reject?: string[];
  patch?: string;
};

type ComponentEntry = { name: string; status?: string; [key: string]: unknown };

function applyPatch(components: ComponentEntry[], operations: ComponentPatchOperation[]): ComponentEntry[] {
  return applyComponentPatch(components, operations, (component, values) => {
    const clone = structuredClone(component) as unknown as Record<string, unknown>;
    for (const [path, value] of Object.entries(values)) {
      applyDotPath(clone, path, value);
    }
    return clone as ComponentEntry;
  });
}

async function loadComponentsFromSession(_sessionId: string | undefined, _skill: string): Promise<ComponentEntry[]> {
  // TODO: read from pipeline.db session when the unified session layer ships
  // For now return empty list; non-interactive flags operate on whatever is in the DB
  process.stderr.write(
    'Error: generate edit requires a session database (not yet implemented — coming in the next release)\n',
  );
  process.exit(1);
}

async function runNonInteractive(opts: GenerateEditOptions, skill: string): Promise<void> {
  let components = await loadComponentsFromSession(opts.session, skill);

  if (opts.acceptAll || (opts.reject ?? []).length > 0) {
    const rejectPatterns = (opts.reject ?? []).map((p) => p.toLowerCase());
    components = components.map((c) => {
      const rejected = rejectPatterns.some((p) => c.name.toLowerCase().includes(p));
      return { ...c, status: rejected ? 'rejected' : 'accepted' };
    });
  }

  if (opts.patch) {
    let patchOps: ComponentPatchOperation[];
    try {
      const raw = await readFile(resolve(opts.patch), 'utf8');
      patchOps = JSON.parse(raw) as ComponentPatchOperation[];
    } catch {
      process.stderr.write(`Error: cannot read or parse --patch file: ${opts.patch}\n`);
      process.exit(1);
      return;
    }

    warnOnUnknownPatchComponents(components, patchOps);
    components = applyPatch(components, patchOps);
  }

  const accepted = components.filter((c) => c.status === 'accepted');
  const rejected = components.filter((c) => c.status === 'rejected');

  process.stderr.write(`Accepted: ${accepted.length}  Rejected: ${rejected.length}\n`);
}

export function registerGenerateEditCommand(parent: Command, skill: string): void {
  // TODO(analytics): bindAnalyticsSessionId when generate edit ships — tracked in schema as generate_edit.
  parent
    .command('edit')
    .description(`Review and correct generate ${skill} output before pushing`)
    .option('--session <id>', 'Session ID to operate on (defaults to most recent active session)')
    .option('--accept-all', 'Accept all definitions without launching the TUI')
    .option('--reject <pattern>', 'Reject definitions whose name contains pattern (repeatable)', collect, [])
    .option('--patch <path>', 'Path to a JSON patch file for structured definition overrides')
    .action(async ({ session, acceptAll, reject, patch }: GenerateEditOptions) => {
      const nonInteractive = acceptAll || (reject ?? []).length > 0 || !!patch;

      if (nonInteractive) {
        await runNonInteractive({ session, acceptAll, reject, patch }, skill);
        return;
      }

      if (!process.stdout.isTTY) {
        process.stderr.write(`Error: generate ${skill} edit requires an interactive terminal\n`);
        process.exit(1);
      }

      // TUI not yet implemented
      process.stderr.write(
        `Error: interactive generate ${skill} edit TUI is not yet available. Use --accept-all, --reject, or --patch for non-interactive mode.\n`,
      );
      process.exit(1);
    });
}

function collect(val: string, prev: string[]): string[] {
  return [...prev, val];
}
