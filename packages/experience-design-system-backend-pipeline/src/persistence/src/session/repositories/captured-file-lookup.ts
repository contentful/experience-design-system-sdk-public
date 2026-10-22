import {
  canonicalSourceFactPath,
  type SourceCapture,
  type SourceFactLocation,
} from '../../../../steps/extraction/index.js';

/** Index the accepted capture once; resolve each observed path once instead of during every comparison. */
export function createCapturedFileLookup(
  files: SourceCapture['files'],
): (path: string | null) => SourceCapture['files'][number] | undefined {
  const byPath = new Map<string, SourceCapture['files'][number]>();
  for (const file of files) if (!byPath.has(file.canonicalPath)) byPath.set(file.canonicalPath, file);
  return (path) => (path ? byPath.get(canonicalSourceFactPath(path)) : undefined);
}

/** Check hashes and exact declaration ranges against the immutable saved bytes. */
export function createCapturedLocationBinder(
  files: SourceCapture['files'],
): (location: SourceFactLocation) => SourceFactLocation {
  const findFile = createCapturedFileLookup(files);
  return (location) => {
    const file = findFile(location.canonicalPath);
    let binding: SourceFactLocation['binding'] = 'unavailable';
    if (file?.captured.kind === 'full' && file.textHash && location.textHash) {
      const text = file.captured.text;
      const start = location.startOffset;
      const end = location.endOffset;
      const range =
        start != null &&
        end != null &&
        start >= 0 &&
        end >= start &&
        end <= text.length &&
        location.startLine === text.slice(0, start).split('\n').length &&
        location.endLine === text.slice(0, end).split('\n').length;
      binding = file.textHash !== location.textHash ? 'changed' : range ? 'verified' : 'unavailable';
    }
    return { ...location, fileId: file?.fileId ?? null, binding };
  };
}
