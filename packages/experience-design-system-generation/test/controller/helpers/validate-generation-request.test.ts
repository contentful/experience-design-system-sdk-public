import { describe, expect, it } from 'vitest';
import { validateGenerationRequest } from '../../../src/controller/helpers/validate-generation-request.js';
import type { GenerationEndpointRequest } from '../../../src/types/contract.js';

const VALID_REQUEST: GenerationEndpointRequest = {
  agent: 'claude',
  timeoutMs: 30000,
  promptOptions: { skill: 'components', mode: 'autonomous', outDir: '/tmp' },
};

describe('validateGenerationRequest', () => {
  it('accepts a valid request', () => {
    expect(() => validateGenerationRequest(VALID_REQUEST)).not.toThrow();
  });

  it('throws when request is not an object', () => {
    expect(() => validateGenerationRequest(null as unknown as GenerationEndpointRequest)).toThrow(TypeError);
    expect(() => validateGenerationRequest('bad' as unknown as GenerationEndpointRequest)).toThrow(TypeError);
  });

  it('throws when agent is not a valid agent name', () => {
    expect(() => validateGenerationRequest({ ...VALID_REQUEST, agent: 'gpt-5' as never })).toThrow(TypeError);
    expect(() => validateGenerationRequest({ ...VALID_REQUEST, agent: '' as never })).toThrow(TypeError);
  });

  it('accepts all valid agent names', () => {
    for (const agent of ['claude', 'codex', 'opencode', 'cursor', 'copilot'] as const) {
      expect(() => validateGenerationRequest({ ...VALID_REQUEST, agent })).not.toThrow();
    }
  });

  it('throws when timeoutMs is zero or negative', () => {
    expect(() => validateGenerationRequest({ ...VALID_REQUEST, timeoutMs: 0 })).toThrow(TypeError);
    expect(() => validateGenerationRequest({ ...VALID_REQUEST, timeoutMs: -1 })).toThrow(TypeError);
  });

  it('throws when timeoutMs is not a number', () => {
    expect(() => validateGenerationRequest({ ...VALID_REQUEST, timeoutMs: '30000' as unknown as number })).toThrow(
      TypeError,
    );
  });

  it('throws when promptOptions is not an object', () => {
    expect(() => validateGenerationRequest({ ...VALID_REQUEST, promptOptions: null as never })).toThrow(TypeError);
  });

  it('throws when onOutput is provided but not a function', () => {
    expect(() => validateGenerationRequest({ ...VALID_REQUEST, onOutput: 'nope' as unknown as () => void })).toThrow(
      TypeError,
    );
  });

  it('accepts a valid onOutput function', () => {
    expect(() => validateGenerationRequest({ ...VALID_REQUEST, onOutput: () => {} })).not.toThrow();
  });

  it('accepts optional model and bedrock fields', () => {
    expect(() => validateGenerationRequest({ ...VALID_REQUEST, model: 'opus', bedrock: true })).not.toThrow();
  });
});
