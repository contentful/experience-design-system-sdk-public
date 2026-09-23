import { readFile } from 'node:fs/promises';
import os from 'node:os';
import type { Project, SourceFile } from 'ts-morph';

/**
 * How many files to extract at once, defaulting to one worker per CPU core.
 * `EDS_EXTRACT_CONCURRENCY` overrides it; read per call so a value set after
 * import still applies.
 */
export function extractConcurrency(): number {
  return Number(process.env['EDS_EXTRACT_CONCURRENCY'] ?? 0) || os.cpus().length;
}

export type FileExtractionOutcome<T, M = undefined> = {
  item: T | null;
  warnings?: string[];
  metadata?: M;
};

type FileExtractionProgress = {
  filesProcessed: number;
  componentsFound: number;
};

export async function runFileExtractionWorkers<T, M = undefined>(
  filePaths: string[],
  concurrency: number,
  extractFile: (filePath: string, source: string) => Promise<FileExtractionOutcome<T, M>>,
  formatError: (filePath: string, error: unknown) => string,
  onProgress?: (progress: FileExtractionProgress) => void,
  onResult?: (filePath: string, outcome: FileExtractionOutcome<T, M>) => void,
): Promise<{ items: T[]; warnings: string[] }> {
  const warnings: string[] = [];
  const items: T[] = [];
  let filesProcessed = 0;

  const queue = [...filePaths];
  async function worker() {
    while (queue.length > 0) {
      const filePath = queue.shift();
      if (!filePath) break;

      try {
        const source = await readFile(filePath, 'utf-8');
        const outcome = await extractFile(filePath, source);
        warnings.push(...(outcome.warnings ?? []));
        if (outcome.item) items.push(outcome.item);
        onResult?.(filePath, outcome);
      } catch (error) {
        warnings.push(formatError(filePath, error));
      }

      filesProcessed++;
      onProgress?.({ filesProcessed, componentsFound: items.length });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, filePaths.length) }, worker));

  return { items, warnings };
}

export function createSortedExtractionResult<T extends { name: string }>(
  components: T[],
  warnings: string[],
): { components: T[]; warnings: string[] } {
  return {
    components: components.sort((a, b) => a.name.localeCompare(b.name)),
    warnings,
  };
}

export function extractProjectSourceFiles<T>(
  project: Project,
  extractFile: (sourceFile: SourceFile, warnings: string[]) => T[],
): { items: T[]; warnings: string[] } {
  const warnings: string[] = [];
  const items: T[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    try {
      items.push(...extractFile(sourceFile, warnings));
    } catch (error) {
      warnings.push(
        `Failed to extract from ${sourceFile.getFilePath()}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { items, warnings };
}
