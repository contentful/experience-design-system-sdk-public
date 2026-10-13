import { describe, expect, it } from 'vitest';
import type { ImportHandoff } from '@contentful/experience-design-system-types/handoff';
import { buildFlowStart } from '../../../src/tui/import/steps/10-flow/flow/build-flow-start.js';
import type { ExtractionInput } from '../../../src/tui/import/steps/06-extraction/types.js';

const handoff: ImportHandoff = { credentialsSkipped: false, tokens: { strategy: 'generate' } };
const extraction = (overrides: Partial<ExtractionInput> = {}): ExtractionInput => ({
  projectPath: '/proj',
  rawTokensPath: '/proj/theme.css',
  tokenStrategy: 'generate',
  credentials: { spaceId: 'sp-1', environmentId: 'staging', cmaToken: 'cma-1', host: 'api.eu.contentful.com' },
  agent: 'codex',
  promptOverrides: [],
  noCache: false,
  ...overrides,
});

describe('what the flow starts from', () => {
  it('uses the credentials the user confirmed', () => {
    expect(buildFlowStart({ extraction: extraction(), handoff }).credentials).toEqual({
      spaceId: 'sp-1',
      environmentId: 'staging',
      cmaToken: 'cma-1',
      host: 'api.eu.contentful.com',
    });
  });

  it('prefers them to the saved ones', () => {
    const start = buildFlowStart({
      extraction: extraction(),
      handoff,
      saved: { spaceId: 'old', environmentId: 'old', cmaToken: 'old', host: 'old.example.com' },
    });

    expect(start.credentials.spaceId).toBe('sp-1');
    expect(start.credentials.cmaToken).toBe('cma-1');
  });

  it('falls back to the saved credentials when validation was skipped, as the wizard read them from the store', () => {
    const start = buildFlowStart({
      extraction: extraction({ credentials: null }),
      handoff: { ...handoff, credentialsSkipped: true },
      saved: { spaceId: 'saved-sp', environmentId: 'saved-env', cmaToken: 'saved-cma', host: 'api.eu.contentful.com' },
    });

    expect(start.credentials).toEqual({
      spaceId: 'saved-sp',
      environmentId: 'saved-env',
      cmaToken: 'saved-cma',
      host: 'api.eu.contentful.com',
    });
  });

  it('has empty credentials, on the default environment and host, when there are none anywhere', () => {
    const { credentials } = buildFlowStart({ extraction: extraction({ credentials: null }), handoff });

    expect(credentials).toMatchObject({ spaceId: '', cmaToken: '', environmentId: 'master' });
    expect(credentials.host).not.toBe('');
  });

  it('defaults a blank environment to master', () => {
    const start = buildFlowStart({
      extraction: extraction({ credentials: { spaceId: 's', environmentId: '', cmaToken: 'c', host: '' } }),
      handoff,
    });

    expect(start.credentials.environmentId).toBe('master');
  });

  it('keeps the agent, the project and the raw tokens file', () => {
    expect(buildFlowStart({ extraction: extraction(), handoff })).toMatchObject({
      agent: 'codex',
      projectPath: '/proj',
      rawTokensPath: '/proj/theme.css',
    });
  });

  it('saves into .contentful next to the project by default', () => {
    expect(buildFlowStart({ extraction: extraction(), handoff }).outDir).toBe('/proj/.contentful');
    expect(buildFlowStart({ extraction: extraction({ projectPath: '' }), handoff }).outDir).toBe('');
  });

  it('carries the handoff and a custom prompt, and leaves the prompt out when there is none', () => {
    const withPrompt = buildFlowStart({ extraction: extraction(), handoff, generatePromptPath: '/p.md' });
    expect(withPrompt.handoff).toBe(handoff);
    expect(withPrompt.generatePromptPath).toBe('/p.md');
    expect(buildFlowStart({ extraction: extraction(), handoff })).not.toHaveProperty('generatePromptPath');
  });
});
