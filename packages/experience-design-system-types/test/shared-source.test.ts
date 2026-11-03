import { describe, expect, it } from 'vitest';
import type {
  SharedSource,
  SharedSourceFile,
  SharedSourceCompilerContext,
  SharedSourceCallerCoverage,
} from '../src/shared-source.js';

describe('SharedSource type scaffolding', () => {
  it('assembles a SharedSource exercising every documented field', () => {
    const file: SharedSourceFile = {
      path: '/abs/path/Button.tsx',
      content: 'export function Button() { return null; }',
      partial: false,
      fileId: 'file-1',
      compilerContextId: 'ctx-1',
      canonicalPath: '/abs/path/Button.tsx',
      textHash: 'sha256:deadbeef',
      coverage: 'complete-within-declared-bound',
      ranges: [{ startLine: 1, endLine: 10, displayStartLine: 1 }],
      roles: ['implementation'],
      componentRefs: [
        {
          componentId: 'c-1',
          name: 'Button',
          roles: ['declaration'],
          observations: [{ role: 'jsx-return', startLine: 2, endLine: 2 }],
        },
      ],
    };

    const compilerContext: SharedSourceCompilerContext = {
      contextId: 'ctx-1',
      configPath: '/abs/path/tsconfig.json',
      status: 'configured',
      referenceOutcome: 'selected',
      compilerOptions: { strict: true, jsx: 'react-jsx' },
      configFiles: [{ fileId: 'tsconfig-1', textHash: 'sha256:cafebabe' }],
      diagnostics: [],
    };

    const callerCoverage: SharedSourceCallerCoverage = {
      scope: 'admitted-source',
      analysis: 'lexical-jsx-in-known-component-bodies',
      coverage: 'partial',
      files: [{ path: '/abs/path/App.tsx', status: 'analyzed' }],
      unresolvedReferences: 0,
      unownedReferences: 1,
      components: [
        {
          name: 'Button',
          sourcePath: '/abs/path/Button.tsx',
          referenceCount: 3,
          outcome: 'observed',
          reason: 'rendered-in-app',
        },
      ],
    };

    const source: SharedSource = {
      files: [file],
      compilerContexts: [compilerContext],
      components: [
        {
          component: 'Button',
          source: '/abs/path/Button.tsx',
          refs: [{ path: '/abs/path/App.tsx', role: 'caller', partial: false, fileId: 'app-1' }],
          componentId: 'c-1',
        },
      ],
      coverage: 'complete-within-declared-bound',
      promptCoverage: 'partial',
      captureId: 'capture-1',
      captureDigest: 'sha256:feedface',
      sessionId: 'session-1',
      extractionStepId: 42,
      observations: {
        accepted: [],
        rejected: [],
        callerCoverage,
      },
    };

    expect(source.files).toHaveLength(1);
    expect(source.compilerContexts?.[0]?.status).toBe('configured');
    expect(source.observations?.callerCoverage?.scope).toBe('admitted-source');
    expect(source.components[0]?.refs[0]?.role).toBe('caller');
  });

  it('accepts a minimal SharedSource with only required fields', () => {
    const minimal: SharedSource = { files: [], components: [] };
    expect(minimal.files).toEqual([]);
    expect(minimal.components).toEqual([]);
  });
});
