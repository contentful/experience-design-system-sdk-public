import { parentPort, workerData, type MessagePort } from 'node:worker_threads';
import { captureSourceEvidence } from '../steps/extraction/index.js';
import { extractComponents } from '../steps/extraction/src/controller/extract-components-endpoint.js';
import { collectManifestDocEdges } from '../steps/composition/src/helpers/edges/manifest-doc-evidence.js';
import { collectSourceCallSiteEvidence } from '../steps/composition/src/helpers/edges/source-call-site-evidence.js';
import type { SourceAnalysisTask } from './types.js';
import { buildExplorationSourceInput } from '../orchestrators/run-exploration-session/helpers/build-source-input.js';

const port = parentPort;
if (!port) throw new Error('Source analysis must run in a worker thread.');

async function analyze(task: SourceAnalysisTask, port: MessagePort): Promise<unknown> {
  switch (task.kind) {
    case 'indexExploration': {
      const { writeIndexedEvidence } = await import('../source-evidence/indexed-evidence/write.js');
      return writeIndexedEvidence(task.input);
    }
    case 'deduplicatePrompt': {
      const { deduplicatePromptInput } = await import('../agents/prompts/helpers/deduplicate-prompt-input.js');
      return deduplicatePromptInput(task.input.json);
    }
    case 'loadSession': {
      const { readExplorationSession } = await import('./read-exploration-session.js');
      return readExplorationSession(task.input);
    }
    case 'projectExploration':
      return buildExplorationSourceInput(task.input.envelope, task.input.diagnostics);
    case 'extract':
      return extractComponents({
        ...task.input,
        onProgress: (progress) => port.postMessage({ kind: 'progress', progress }),
      });
    case 'capture':
      return captureSourceEvidence(task.input);
    case 'composition': {
      const { files, components } = task.input;
      port.postMessage({
        kind: 'activity',
        activity: 'Reading declared relationships from manifests and documentation…',
      });
      const extraEdges = collectManifestDocEdges(files, components, new Set(components.map(({ name }) => name)));
      port.postMessage({ kind: 'activity', activity: 'Resolving component references and call-site evidence…' });
      const sourceCallSites = collectSourceCallSiteEvidence(files, components);
      return {
        extraEdges,
        sourceCallSites,
      };
    }
  }
}

try {
  const result = await analyze(workerData as SourceAnalysisTask, port);
  port.postMessage({ kind: 'result', result });
} catch (error) {
  port.postMessage({
    kind: 'error',
    error: {
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
    },
  });
} finally {
  port.close();
}
