import { describe, expect, it } from 'vitest';
import { buildFlowStart } from '../../../src/tui/import/steps/10-flow/flow/build-flow-start.js';
import type { ExtractionInput } from '../../../src/tui/import/steps/06-extraction/types.js';

describe('remote import flow cancellation boundary', () => {
  it('keeps generation-attempt cancellation out of the preview and apply handoff', () => {
    const controller = new AbortController();
    const handoff = { marker: 'existing review handoff' };
    const flowStart = buildFlowStart({
      extraction: {
        signal: controller.signal,
        projectPath: '/project',
        rawTokensPath: '',
        credentials: null,
        agent: 'claude',
      } as ExtractionInput,
      handoff: handoff as never,
    });

    controller.abort();

    expect(flowStart).not.toHaveProperty('signal');
    expect(flowStart.handoff).toBe(handoff);
    expect(flowStart.credentials).toEqual({
      spaceId: '',
      environmentId: 'master',
      cmaToken: '',
      host: expect.any(String),
    });
  });
});
