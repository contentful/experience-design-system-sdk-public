import { describe, expect, it } from 'vitest';
import { createLocalCliAgentInvoker } from '../../../src/generate/adapters/local/local-agent-invoker.js';

describe('local agent invoker adapter', () => {
  it('implements the transport-neutral invoker port', () => {
    const invoker = createLocalCliAgentInvoker();

    expect(typeof invoker.invoke).toBe('function');
    expect(typeof invoker.checkAuth).toBe('function');
  });
});
