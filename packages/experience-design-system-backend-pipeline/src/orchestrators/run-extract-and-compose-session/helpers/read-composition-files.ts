import { readCandidateFiles } from './read-candidate-files.js';
import type { RawComponentDefinition } from '../../../steps/extraction/src/types/component.js';
import type { SourceCapture } from '../../../steps/extraction/index.js';

/** Retain complete captured source bytes for deterministic composition evidence. */
export async function readCompositionFiles(
  components: RawComponentDefinition[],
  sourceFiles: string[],
  sourceCapture?: SourceCapture,
): Promise<Array<{ path: string; content: string }>> {
  return sourceCapture
    ? sourceCapture.files.flatMap((file) =>
        file.captured.kind === 'full' && file.roles.some((role) => role !== 'config')
          ? [{ path: file.canonicalPath, content: file.captured.text }]
          : [],
      )
    : await readCandidateFiles(components, sourceFiles);
}
