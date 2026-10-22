import { canonicalSourceFactPath, type SourceCapture } from '../../../../steps/extraction/index.js';

/** Index the accepted capture once; resolve each observed path once instead of during every comparison. */
export function createCapturedFileLookup(
  files: SourceCapture['files'],
): (path: string | null) => SourceCapture['files'][number] | undefined {
  const byPath = new Map<string, SourceCapture['files'][number]>();
  for (const file of files) if (!byPath.has(file.canonicalPath)) byPath.set(file.canonicalPath, file);
  return (path) => (path ? byPath.get(canonicalSourceFactPath(path)) : undefined);
}
