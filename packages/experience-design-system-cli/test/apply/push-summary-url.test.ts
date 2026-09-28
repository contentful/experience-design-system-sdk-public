import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { ServerApplyDone } from '../../src/apply/tui/ServerApplyView.js';
describe('apply — viewUrl emission (Gap 4)', () => {
  it('interactive ServerApplyDone renders the view URL on success', () => {
    const { lastFrame } = render(
      React.createElement(ServerApplyDone, {
        operation: {
          sys: {
            type: 'ApplyOperation' as const,
            id: 'op-1',
            status: 'succeeded' as const,
            createdAt: '2026-01-01T00:00:00Z',
            createdBy: { sys: { type: 'Link' as const, linkType: 'User', id: 'u' } },
          },
          summary: { total: 1, succeeded: 1, failed: 0, pending: 0 },
          items: [],
        },
        spaceId: 'test-space',
        environmentId: 'master',
        host: 'api.contentful.com',
      }),
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('https://app.contentful.com/spaces/test-space/environments/master/views/components');
    expect(frame).toContain('https://app.contentful.com/spaces/test-space/environments/master/views/design_tokens');
  });

  it('interactive ServerApplyDone formats object-form binding failures', () => {
    const { lastFrame } = render(
      React.createElement(ServerApplyDone, {
        operation: {
          sys: {
            type: 'ApplyOperation' as const,
            id: 'op-1',
            status: 'failed' as const,
            createdAt: '2026-01-01T00:00:00Z',
            createdBy: { sys: { type: 'Link' as const, linkType: 'User', id: 'u' } },
          },
          summary: { total: 1, succeeded: 0, failed: 1, pending: 0 },
          items: [
            {
              entityType: 'ComponentType' as const,
              id: 'button-id',
              action: 'create' as const,
              status: 'failed' as const,
              error: {
                code: 'ValidationFailed',
                message:
                  'One or more binding configurations are invalid. Pointer path does not exist for \'[object Object]\': Pointer expression path does not exist in input data type. Default › return GraphQL validation error: Field "Link" of type "Link" must have a selection of subfields. Default › resolvers › r_-gxsm8Pv7v › query',
              },
            },
          ],
        },
        spaceId: 'test-space',
        environmentId: 'master',
        host: 'api.contentful.com',
      }),
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Pointer expression path does not exist in input data type');
    expect(frame).toContain('Field "Link" of type "Link" must have a selection of subfields');
    expect(frame).toMatch(/Default › resolvers ›\s+r_-gxsm8Pv7v › query/);
    expect(frame).not.toContain('[object Object]');
  });
});
