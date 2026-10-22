import { resolve } from 'node:path';
import { loadRendererReference } from '../../../../orchestrators/run-exploration-session/helpers/load-renderer-reference.js';
import type { ExploreStageRequest } from '../types.js';

export async function loadStageContext(request: ExploreStageRequest): Promise<{
  callSites?: string;
  rendererReference?: string;
  existingModel?: string;
}> {
  const read = async (path: string): Promise<string> =>
    (
      await loadRendererReference(
        { kind: 'path', path: resolve(request.projectRoot ?? process.cwd(), path) },
        { signal: request.signal },
      )
    ).text;
  return {
    callSites:
      request.callSiteEvidenceInline ??
      (request.callSiteEvidencePath ? await read(request.callSiteEvidencePath) : undefined),
    rendererReference:
      request.rendererReferenceInline ?? (request.sdkReferencePath ? await read(request.sdkReferencePath) : undefined),
    existingModel: request.existingModelPath ? await read(request.existingModelPath) : undefined,
  };
}
