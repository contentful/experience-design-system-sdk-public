import { dirname } from 'node:path';
import type { ComponentExtractionResult } from '../src/types/component.js';
import type { ExtractorOptions } from '../src/types/options.js';
import { canonicalSourceFactPath } from '../src/candidates/bind-source-candidates.js';
import {
  canonicalSelectedSourcePaths,
  discoverSourceEvidence,
  isWithinEvidenceRoot,
  type SourceEvidenceInventory,
} from './discovery.js';

function commonSelectedDirectory(filePaths: readonly string[]): string {
  if (filePaths.length === 0) return process.cwd();
  let root = dirname(canonicalSourceFactPath(filePaths[0]!));
  for (const path of filePaths.slice(1)) {
    const directory = dirname(canonicalSourceFactPath(path));
    while (!isWithinEvidenceRoot(root, directory)) {
      const parent = dirname(root);
      if (parent === root) break;
      root = parent;
    }
  }
  return root;
}

export function aggregateExtractionSourceInventory(
  filePaths: readonly string[],
  results: readonly ComponentExtractionResult[],
  options: ExtractorOptions = {},
): SourceEvidenceInventory | undefined {
  const inventories = results.flatMap((result) => (result.sourceInventory ? [result.sourceInventory] : []));
  if (inventories.length === 0 && !options.projectRoot) return undefined;
  const projectRoot = canonicalSourceFactPath(options.projectRoot ?? commonSelectedDirectory(filePaths));
  const selectedSourcePaths = canonicalSelectedSourcePaths(projectRoot, filePaths);
  const matching = inventories.find(
    (inventory) =>
      inventory.projectRoot === projectRoot &&
      JSON.stringify(canonicalSelectedSourcePaths(projectRoot, inventory.selectedSourcePaths)) ===
        JSON.stringify(selectedSourcePaths),
  );
  const aborted = options.signal?.aborted
    ? inventories.find(
        (inventory) =>
          inventory.coverage === 'unavailable' &&
          inventory.files.length === 0 &&
          inventory.omissions.some((item) => item.reason === 'source-discovery-aborted'),
      )
    : undefined;
  const inventory = structuredClone(
    matching ??
      aborted ??
      discoverSourceEvidence({
        projectRoot,
        filePaths,
        evidenceFilePaths: options.evidenceFilePaths,
        signal: options.signal,
      }),
  );
  if (aborted && !matching) {
    inventory.projectRoot = projectRoot;
    inventory.selectedSourcePaths = selectedSourcePaths;
  }
  // Adapter inputs are component roots; the returned inventory identifies the original scan.
  const omissions = new Map(
    [...inventory.omissions, ...inventories.flatMap((item) => item.omissions)].map((item) => [
      JSON.stringify(item),
      item,
    ]),
  );
  inventory.omissions = [...omissions.values()].sort(
    (left, right) => left.path.localeCompare(right.path) || left.reason.localeCompare(right.reason),
  );
  if (inventory.omissions.length > 0 && inventory.coverage === 'complete-within-declared-bound')
    inventory.coverage = inventory.files.length ? 'partial' : 'unavailable';
  return inventory;
}
