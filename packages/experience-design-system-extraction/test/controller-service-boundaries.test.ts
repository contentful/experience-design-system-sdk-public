import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExtractionEndpointResponse } from '../src/extract/model/contract.js';
import type { ExtractionServiceRequest } from '../src/extract/services/extraction-service.js';

const { runExtractionService } = vi.hoisted(() => ({
  runExtractionService: vi.fn(),
}));

vi.mock('../src/extract/services/extraction-service.js', () => ({ runExtractionService }));

import { extractEndpoint } from '../src/extract/controller/extract-controller.js';

const tempDirs: string[] = [];

afterEach(async () => {
  runExtractionService.mockReset();
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('extract controller and service boundary', () => {
  it('maps the service progress contract to the public endpoint contract', async () => {
    const response: ExtractionEndpointResponse = { components: [], warnings: [] };
    runExtractionService.mockResolvedValue(response);
    const progress: Array<{ phase: 'extract'; filesProcessed: number; totalFiles: number; componentsFound: number }> =
      [];

    await extractEndpoint({
      filePaths: ['/project/Button.tsx'],
      projectRoot: '/project',
      resolveUnreachable: 'auto',
      onProgress: (update) => progress.push(update),
    });

    expect(runExtractionService).toHaveBeenCalledTimes(1);
    const serviceRequest = runExtractionService.mock.calls[0]?.[0] as ExtractionServiceRequest;
    expect(serviceRequest).toEqual(
      expect.objectContaining({
        filePaths: ['/project/Button.tsx'],
        projectRoot: '/project',
        resolveUnreachable: 'auto',
        onProgress: expect.any(Function),
      }),
    );

    serviceRequest.onProgress?.({ filesProcessed: 1, componentsFound: 0 });
    expect(progress).toContainEqual({ phase: 'extract', filesProcessed: 1, totalFiles: 1, componentsFound: 0 });
    expect(progress.at(-1)).toEqual({ phase: 'extract', filesProcessed: 1, totalFiles: 1, componentsFound: 0 });
  });

  it('validates public input before invoking the service', async () => {
    await expect(extractEndpoint({ filePaths: ['   '] })).rejects.toThrow(
      'extractEndpoint requires filePaths to contain non-empty strings',
    );
    expect(runExtractionService).not.toHaveBeenCalled();
  });
});

describe('runExtractionService integration contract', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('returns scored and validated components without CLI persistence', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'extraction-service-'));
    tempDirs.push(projectRoot);
    const sourcePath = join(projectRoot, 'Button.tsx');
    await writeFile(
      sourcePath,
      'export function Button({ label }: { label: string }) { return <button>{label}</button>; }',
    );

    const { runExtractionService: runRealExtractionService } = await vi.importActual<{
      runExtractionService: (request: ExtractionServiceRequest) => Promise<ExtractionEndpointResponse>;
    }>('../src/extract/services/extraction-service.js');
    const result = await runRealExtractionService({ filePaths: [sourcePath], projectRoot });

    expect(result.components[0]).toEqual(
      expect.objectContaining({ name: 'Button', extractionConfidence: 5, validationIssues: [] }),
    );
    expect(result.warnings).toEqual([]);
  });
});
