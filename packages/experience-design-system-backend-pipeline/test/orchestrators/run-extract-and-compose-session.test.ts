import { describe, expect, it } from 'vitest';
import {
  runExtractAndComposeSession,
  type ExtractAndComposeProgress,
  type RunExtractAndComposeSessionRequest,
  type RunExtractAndComposeSessionResponse,
} from '../../src/index.js';

describe('runExtractAndComposeSession — public surface', () => {
  it('is exported from the barrel', () => {
    expect(typeof runExtractAndComposeSession).toBe('function');
  });

  it('exposes a structured progress event shape', () => {
    const extract: ExtractAndComposeProgress = { kind: 'extract', done: 1, total: 2, componentsSoFar: 0 };
    const composition: ExtractAndComposeProgress = { kind: 'composition', phase: 'done' };
    expect(extract.kind).toBe('extract');
    expect(composition.kind).toBe('composition');
  });

  it('surfaces the fields the handoff + legacy summary need', () => {
    const r: RunExtractAndComposeSessionResponse = {
      sessionId: 'sess',
      compositionPhase: 'done',
      components: [],
      warnings: [],
      conflicts: [],
      compositionWarnings: [],
      scannedFileCount: 0,
      sourceCallSiteEvidence: [],
      sourceCallSiteRejections: [],
    };
    // Verifies the type by construction; the real behavioral coverage lives in
    // cli-legacy's `__extract` subprocess tests, which exercise the orchestrator
    // through its canonical caller.
    expect(r.sessionId).toBe('sess');
    expect(r.compositionPhase).toBe('done');
  });

  it('accepts the request shape callers send', () => {
    const req: RunExtractAndComposeSessionRequest = {
      projectPath: '/p',
      outDir: '/p/.contentful',
      filePaths: [],
      agent: 'claude',
      promptOverrides: [],
      noCache: false,
    };
    expect(req.agent).toBe('claude');
  });
});
