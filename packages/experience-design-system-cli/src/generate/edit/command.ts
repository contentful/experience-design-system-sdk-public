import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Command } from 'commander';

type GenerateEditOptions = {
  session?: string;
  acceptAll?: boolean;
  reject?: string[];
  patch?: string;
};

interface PatchOperation {
  component: string;
  status?: 'accepted' | 'rejected';
  set?: Record<string, unknown>;
}

const SAFE_PATH_RE = /^[a-zA-Z0-9_.$[\]=]+$/;
const PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function applyDotPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  if (!SAFE_PATH_RE.test(path)) {
    process.stderr.write(`Warning: --patch path contains invalid characters: '${path}', skipping\n`);
    return;
  }
  const parts = path.split('.');
  if (parts.some((p) => PROTO_KEYS.has(p))) {
    process.stderr.write(`Warning: --patch path contains forbidden key: '${path}', skipping\n`);
    return;
  }
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    const arrayMatch = /^(.+)\[name=(.+)\]$/.exec(part);
    if (arrayMatch) {
      const [, fieldName, matchValue] = arrayMatch;
      const arr = current[fieldName!] as Array<Record<string, unknown>>;
      if (Array.isArray(arr)) {
        const item = arr.find((el) => el['name'] === matchValue);
        if (item) {
          current = item;
        } else {
          process.stderr.write(
            `Warning: --patch array item [name=${matchValue}] not found in '${fieldName}', skipping\n`,
          );
          return;
        }
      }
    } else {
      if (typeof current[part] !== 'object' || current[part] === null) {
        process.stderr.write(`Warning: --patch path '${path}' — '${part}' is not an object, skipping\n`);
        return;
      }
      current = current[part] as Record<string, unknown>;
    }
  }
  const lastPart = parts[parts.length - 1]!;
  current[lastPart] = value;
}

type ComponentEntry = { name: string; status?: string; [key: string]: unknown };

function applyPatch(components: ComponentEntry[], ops: PatchOperation[]): ComponentEntry[] {
  return components.map((c) => {
    const op = ops.find((o) => o.component === c.name);
    if (!op) return c;

    let updated = { ...c };
    if (op.status) {
      updated = { ...updated, status: op.status };
    }
    if (op.set) {
      const clone = structuredClone(updated) as unknown as Record<string, unknown>;
      for (const [path, value] of Object.entries(op.set)) {
        applyDotPath(clone, path, value);
      }
      updated = clone as ComponentEntry;
    }
    return updated;
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
    let patchOps: PatchOperation[];
    try {
      const raw = await readFile(resolve(opts.patch), 'utf8');
      patchOps = JSON.parse(raw) as PatchOperation[];
    } catch {
      process.stderr.write(`Error: cannot read or parse --patch file: ${opts.patch}\n`);
      process.exit(1);
      return;
    }

    const knownNames = new Set(components.map((c) => c.name));
    for (const op of patchOps) {
      if (!knownNames.has(op.component)) {
        process.stderr.write(`Warning: --patch targets unknown component '${op.component}', skipping\n`);
      }
    }

    components = applyPatch(components, patchOps);
  }

  const accepted = components.filter((c) => c.status === 'accepted');
  const rejected = components.filter((c) => c.status === 'rejected');

  process.stderr.write(`Accepted: ${accepted.length}  Rejected: ${rejected.length}\n`);
}

export function registerGenerateEditCommand(parent: Command, skill: string): void {
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
