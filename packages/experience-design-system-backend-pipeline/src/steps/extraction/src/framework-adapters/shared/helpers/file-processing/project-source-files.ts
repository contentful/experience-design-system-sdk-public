import type { Project, SourceFile } from 'ts-morph';

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
