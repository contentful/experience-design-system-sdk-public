import { selectCandidateFiles } from '../../../steps/composition/src/helpers/candidates/candidate-files.js';
import { readCandidateFiles } from './read-candidate-files.js';
import type { RawComponentDefinition } from '../../../steps/extraction/src/types/component.js';
import type { SourceCapture } from '../../../steps/extraction/index.js';

export interface CompositionPromptFiles {
  /** Complete selected candidates inlined into the agent prompt. */
  promptFiles: Array<{ path: string; content: string }>;
  /** EVERY scanned file, used for deterministic evidence (manifest/doc edges). */
  runtimeFiles: Array<{ path: string; content: string }>;
}

/** Select relevant prompt candidates and retain all scanned files for deterministic evidence. */
export async function selectCompositionPromptFiles(
  components: RawComponentDefinition[],
  sourceFiles: string[],
  sourceCapture?: SourceCapture,
): Promise<CompositionPromptFiles> {
  const allFiles = sourceCapture
    ? sourceCapture.files.flatMap((file) =>
        file.captured.kind === 'full' && file.roles.some((role) => role !== 'config')
          ? [{ path: file.canonicalPath, content: file.captured.text }]
          : [],
      )
    : await readCandidateFiles(components, sourceFiles);
  const promptFiles = selectCandidateFiles(allFiles).map((c) => ({ path: c.path, content: c.content }));
  const runtimeFiles = allFiles.map((c) => ({ path: c.path, content: c.content }));
  return { promptFiles, runtimeFiles };
}
