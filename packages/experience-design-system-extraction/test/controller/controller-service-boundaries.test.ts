import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExtractionEndpointResponse } from '../../src/extract/types/contract.js';
import type { ExtractionOrchestratorRequest } from '../../src/extract/orchestrator/execute-extraction-orchestrator.js';

const { executeExtractionOrchestrator } = vi.hoisted(() => ({
  executeExtractionOrchestrator: vi.fn(),
}));

vi.mock('../../src/extract/orchestrator/execute-extraction-orchestrator.js', () => ({ executeExtractionOrchestrator }));

import { extractEndpoint } from '../../src/extract/controller/extract-controller.js';

const tempDirs: string[] = [];

afterEach(async () => {
  executeExtractionOrchestrator.mockReset();
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('extract controller and orchestrator boundary', () => {
  it('maps the orchestrator progress contract to the public endpoint contract', async () => {
    const response: ExtractionEndpointResponse = {
      components: [],
      warnings: [],
    };
    executeExtractionOrchestrator.mockResolvedValue(response);
    const progress: Array<{
      phase: 'extract';
      filesProcessed: number;
      totalFiles: number;
      componentsFound: number;
    }> = [];

    await extractEndpoint({
      filePaths: ['/project/Button.tsx'],
      projectRoot: '/project',
      resolveUnreachable: 'auto',
      onProgress: (update) => progress.push(update),
    });

    expect(executeExtractionOrchestrator).toHaveBeenCalledTimes(1);
    const orchestratorRequest = executeExtractionOrchestrator.mock.calls[0]?.[0] as ExtractionOrchestratorRequest;
    expect(orchestratorRequest).toEqual(
      expect.objectContaining({
        filePaths: ['/project/Button.tsx'],
        projectRoot: '/project',
        resolveUnreachable: 'auto',
        onProgress: expect.any(Function),
      }),
    );

    orchestratorRequest.onProgress?.({ filesProcessed: 1, componentsFound: 0 });
    expect(progress).toContainEqual({
      phase: 'extract',
      filesProcessed: 1,
      totalFiles: 1,
      componentsFound: 0,
    });
    expect(progress.at(-1)).toEqual({
      phase: 'extract',
      filesProcessed: 1,
      totalFiles: 1,
      componentsFound: 0,
    });
  });

  it('validates public input before invoking the orchestrator', async () => {
    await expect(extractEndpoint({ filePaths: ['   '] })).rejects.toThrow(
      'extractEndpoint requires filePaths to contain non-empty strings',
    );
    expect(executeExtractionOrchestrator).not.toHaveBeenCalled();
  });
});

describe('executeExtractionOrchestrator integration contract', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('returns scored and validated components without CLI persistence', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'extraction-orchestrator-'));
    tempDirs.push(projectRoot);
    const sourcePath = join(projectRoot, 'Button.tsx');
    await writeFile(
      sourcePath,
      'export function Button({ label }: { label: string }) { return <button>{label}</button>; }',
    );

    const { executeExtractionOrchestrator: runRealOrchestrator } = await vi.importActual<{
      executeExtractionOrchestrator: (request: ExtractionOrchestratorRequest) => Promise<ExtractionEndpointResponse>;
    }>('../../src/extract/orchestrator/execute-extraction-orchestrator.js');
    const result = await runRealOrchestrator({
      filePaths: [sourcePath],
      projectRoot,
    });

    expect(result.components[0]).toEqual(
      expect.objectContaining({
        name: 'Button',
        extractionConfidence: 5,
        validationIssues: [],
      }),
    );
    expect(result.warnings).toEqual([]);
  });
});
