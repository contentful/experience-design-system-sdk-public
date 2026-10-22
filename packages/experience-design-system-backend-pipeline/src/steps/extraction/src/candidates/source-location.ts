import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { Node } from 'ts-morph';
import type { SourceFactLocation } from './types.js';

export function sourceTextLocation(
  sourcePath: string,
  sourceText: string,
  range: { startLine: number; endLine: number; startOffset: number; endOffset: number },
): SourceFactLocation {
  return {
    fileId: null,
    canonicalPath: resolve(sourcePath),
    textHash: createHash('sha256').update(sourceText).digest('hex'),
    ...range,
    binding: 'unverified',
  };
}

export function sourceLocation(declaration: Node): SourceFactLocation {
  const sourceFile = declaration.getSourceFile();
  return sourceTextLocation(sourceFile.getFilePath(), sourceFile.getFullText(), {
    startLine: declaration.getStartLineNumber(),
    endLine: declaration.getEndLineNumber(),
    startOffset: declaration.getStart(),
    endOffset: declaration.getEnd(),
  });
}
