import { mkdir } from 'node:fs/promises';
import type { AgentName } from '@contentful/experience-design-system-generation';
import {
  openPipelineDb,
  getOrCreateSession,
  createStep,
  storeRawComponents,
  getCliCacheVersion,
} from '../../session/db.js';
import { collectSourceFiles } from '../services/collect-source-files.js';
import { runExtractionWithCache } from '../services/extract-with-cache.js';
import { resolveCompositionMapping } from '../services/resolve-composition-mapping.js';
import { persistExtractResults } from '../services/persist-extract-results.js';
import { readCandidateFiles } from '../helpers/resolve-composition-agent.js';
import { enrichCommandResult } from '../../analytics/index.js';

export interface AnalyzeExtractOrchestratorRequest {
  projectRoot: string;
  sourceDirectory: string;
  outDir: string;
  noCache: boolean;
  forceAgent: boolean;
  agent: AgentName;
  compositionPrompt?: string;
  resolveUnreachable: 'auto' | 'always' | 'never';
  onScanProgress?: (count: number) => void;
  onCompositionProgress?: (phase: string) => void;
  onSessionCreated?: (sessionId: string) => void | Promise<void>;
}

export interface AnalyzeExtractOrchestratorResult {
  sessionId: string;
  sourceFileCount: number;
  componentCount: number;
  warnings: string[];
}

export async function executeAnalyzeExtractOrchestrator(
  request: AnalyzeExtractOrchestratorRequest,
): Promise<AnalyzeExtractOrchestratorResult> {
  await mkdir(request.outDir, { recursive: true });

  const sourceFiles = await collectSourceFiles(request.sourceDirectory, (count) => {
    request.onScanProgress?.(count);
  });

  const db = openPipelineDb();
  try {
    const cacheVersion = await getCliCacheVersion();

    const extraction = await runExtractionWithCache({
      db,
      sourceFiles,
      noCache: request.noCache,
      resolveUnreachable: request.resolveUnreachable,
      projectRoot: request.projectRoot,
      cacheVersion,
      onProgress: request.onScanProgress,
    });

    const { sessionId } = getOrCreateSession(db, undefined, undefined, {
      command: 'analyze extract',
      inputPath: request.projectRoot,
      outDir: request.outDir,
    });

    const stepId = createStep(db, sessionId, 'analyze extract', { project: request.projectRoot });

    storeRawComponents(db, sessionId, extraction.components);
    await request.onSessionCreated?.(sessionId);

    const allFiles = await readCandidateFiles(extraction.components, sourceFiles);

    const composition = await resolveCompositionMapping({
      db,
      components: extraction.components,
      allFiles,
      noCache: request.noCache,
      forceAgent: request.forceAgent,
      agent: request.agent,
      promptOverride: request.compositionPrompt,
      cacheVersion,
      onProgress: request.onCompositionProgress,
    });

    await persistExtractResults({
      db,
      sessionId,
      stepId,
      projectRoot: request.projectRoot,
      sourceFiles,
      components: composition.components,
    });

    enrichCommandResult({ extracted_component_count: composition.components.length });

    return {
      sessionId,
      sourceFileCount: sourceFiles.length,
      componentCount: composition.components.length,
      warnings: [...extraction.warnings, ...composition.warnings],
    };
  } finally {
    db.close();
  }
}
