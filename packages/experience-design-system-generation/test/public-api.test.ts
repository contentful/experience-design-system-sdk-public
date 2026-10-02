import { describe, expect, expectTypeOf, it } from 'vitest';
import * as publicApi from '../src/index.js';
import type { AgentName, Mode, Skill } from '../src/index.js';

const CURRENT_RUNTIME_EXPORTS = [
  'AGENT_NAMES',
  'DEFAULT_AGENT_NAME',
  'agentSupportsBedrock',
  'buildArgs',
  'buildPrompt',
  'checkAgentAuth',
  'createLocalCliAgentInvoker',
  'createGenerateEndpoint',
  'describeAgentFailure',
  'extractSentinelOutput',
  'formatCustomPromptBanner',
  'formatGenerateProgressLine',
  'isAgentName',
  'parseMapTokenPropToolCallLines',
  'parseSelectToolCallLines',
  'parseTokenToolCallLines',
  'parseToolCallLines',
  'resolveAgentModel',
  'resolveBinary',
  'resolveSkillPath',
  'runAgent',
] as const;

describe('published generation package API', () => {
  it('preserves the complete current runtime export surface', () => {
    expect(Object.keys(publicApi).sort()).toEqual([...CURRENT_RUNTIME_EXPORTS].sort());
  });

  it('preserves the agent and prompt contract values at the package root', () => {
    expect(publicApi.AGENT_NAMES).toEqual(['claude', 'codex', 'opencode', 'cursor', 'copilot']);
    expect(publicApi.DEFAULT_AGENT_NAME).toBe('claude');
    expect(publicApi.isAgentName('claude')).toBe(true);
    expect(publicApi.isAgentName('unknown-agent')).toBe(false);
    expect(publicApi.resolveSkillPath('components')).toMatch(/skills\/generate-components\.md$/);
  });

  it('keeps the exported type unions aligned with the current contract', () => {
    expectTypeOf<AgentName>().toEqualTypeOf<'claude' | 'codex' | 'opencode' | 'cursor' | 'copilot'>();
    expectTypeOf<Skill>().toEqualTypeOf<'components' | 'tokens' | 'select' | 'map-tokens'>();
    expectTypeOf<Mode>().toEqualTypeOf<'autonomous'>();
  });
});
