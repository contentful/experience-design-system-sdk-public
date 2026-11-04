import type ts from 'typescript';
import { SourceValueBindings } from './source-value-bindings.js';

interface MutationScan {
  values: SourceValueBindings;
  incompleteFiles: ts.SourceFile[];
}

// A compiler program owns immutable source snapshots. Reuse only within that program.
const scans = new WeakMap<ts.Program, Map<string, MutationScan>>();

export function scanReferenceMutations(
  program: ts.Program,
  files: readonly ts.SourceFile[],
  nodesPerFile: number,
  signal?: AbortSignal,
): MutationScan {
  const key = JSON.stringify([nodesPerFile, files.map((file) => file.fileName)]);
  const programScans = scans.get(program) ?? new Map<string, MutationScan>();
  const existing = programScans.get(key);
  if (existing) return existing;
  const values = new SourceValueBindings(program.getTypeChecker());
  const incompleteFiles: ts.SourceFile[] = [];
  for (const file of files) {
    if (signal?.aborted || !values.scan(file, nodesPerFile)) incompleteFiles.push(file);
  }
  const result = { values, incompleteFiles };
  if (!signal?.aborted) {
    programScans.set(key, result);
    scans.set(program, programScans);
  }
  return result;
}
