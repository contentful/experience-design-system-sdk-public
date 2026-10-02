import { describe, expect, it } from 'vitest';
import type { RawComponentDefinition } from '../../../src/types.js';
import { collectSourceCallSiteEvidence } from '../../../src/analyze/composition/source-call-site-evidence.js';
import { resolveMapping } from '../../../src/analyze/composition/resolve-mapping.js';

function component(name: string, sourcePath: string): RawComponentDefinition {
  return { name, source: sourcePath, sourcePath, framework: 'react', props: [], slots: [] };
}

describe('source call-site composition evidence', () => {
  it('captures an exact cross-file JSX call site for a known component', () => {
    const result = collectSourceCallSiteEvidence(
      [
        {
          path: '/project/Card.tsx',
          content: [
            "import { Button } from './Button';",
            '',
            'export function Card() {',
            '  return <Button>Continue</Button>;',
            '}',
          ].join('\n'),
        },
        { path: '/project/Button.tsx', content: 'export function Button() { return null; }' },
      ],
      [component('Card', '/project/Card.tsx'), component('Button', '/project/Button.tsx')],
    );

    expect(result.accepted).toEqual([
      expect.objectContaining({
        parent: 'Card',
        child: 'Button',
        sourcePath: '/project/Card.tsx',
        startLine: 4,
        endLine: 4,
        excerpt: 'return <Button>Continue</Button>;',
      }),
    ]);
    expect(result.rejected).toEqual([]);
  });

  it('rejects a non-allowlisted component name instead of treating it as a relationship', () => {
    const result = collectSourceCallSiteEvidence(
      [{ path: '/project/Card.tsx', content: 'export function Card() { return <Ghost />; }' }],
      [component('Card', '/project/Card.tsx')],
    );

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      expect.objectContaining({
        parent: 'Card',
        candidate: 'Ghost',
        reason: 'unknown-component',
        sourcePath: '/project/Card.tsx',
      }),
    ]);
  });

  it('retains evidence and makes it available to the composition prompt', async () => {
    const evidence = {
      parent: 'Card',
      child: 'Button',
      sourcePath: '/project/Card.tsx',
      startLine: 4,
      endLine: 4,
      excerpt: 'return <Button />;',
      kind: 'jsx-render' as const,
    };
    const prompts: string[] = [];
    const result = await resolveMapping({
      components: [component('Card', '/project/Card.tsx'), component('Button', '/project/Button.tsx')],
      files: [{ path: '/project/Card.tsx', content: 'return <Button />;' }],
      sourceCallSiteEvidence: [evidence],
      sourceCallSiteRejections: [],
      runAgentFn: async ({ prompt }) => {
        prompts.push(prompt);
        return '';
      },
    });

    expect(result.sourceCallSiteEvidence).toEqual([evidence]);
    expect(result.sourceCallSiteRejections).toEqual([]);
    expect(prompts[0]).toContain('/project/Card.tsx');
    expect(prompts[0]).toContain('return <Button />;');
  });

  it('accepts an agent edge only when its citation matches source evidence', async () => {
    const evidence = {
      parent: 'Card',
      child: 'Button',
      sourcePath: '/project/Card.tsx',
      startLine: 4,
      endLine: 4,
      excerpt: 'return <Button />;',
      kind: 'jsx-render' as const,
    };
    const result = await resolveMapping({
      components: [component('Card', '/project/Card.tsx'), component('Button', '/project/Button.tsx')],
      files: [{ path: '/project/Card.tsx', content: 'return <Button />;' }],
      sourceCallSiteEvidence: [evidence],
      runAgentFn: async () =>
        JSON.stringify({
          tool: 'map_edge',
          parent: 'Card',
          child: 'Button',
          citation: { sourcePath: '/project/Card.tsx', startLine: 4, endLine: 4 },
        }),
    });

    expect(result.edges).toEqual([
      expect.objectContaining({
        parent: 'Card',
        child: 'Button',
        citation: { sourcePath: '/project/Card.tsx', startLine: 4, endLine: 4 },
      }),
    ]);
  });

  it('rejects an agent edge with a citation that is not in the evidence set', async () => {
    const result = await resolveMapping({
      components: [component('Card', '/project/Card.tsx'), component('Button', '/project/Button.tsx')],
      files: [{ path: '/project/Card.tsx', content: 'return <Button />;' }],
      sourceCallSiteEvidence: [
        {
          parent: 'Card',
          child: 'Button',
          sourcePath: '/project/Card.tsx',
          startLine: 4,
          endLine: 4,
          excerpt: 'return <Button />;',
          kind: 'jsx-render',
        },
      ],
      runAgentFn: async () =>
        JSON.stringify({
          tool: 'map_edge',
          parent: 'Card',
          child: 'Button',
          citation: { sourcePath: '/project/Card.tsx', startLine: 99, endLine: 99 },
        }),
    });

    expect(result.edges).toEqual([]);
    expect(result.warnings.join(' ')).toContain('citation');
  });

  it('captures a caller-side child rendered into a named slot', () => {
    const result = collectSourceCallSiteEvidence(
      [
        {
          path: '/project/Page.tsx',
          content: [
            "import { Card } from './Card';",
            "import { Button } from './Button';",
            'export function Page() {',
            '  return <Card><Button slot="actions" /></Card>;',
            '}',
          ].join('\n'),
        },
        { path: '/project/Card.tsx', content: 'export function Card() { return null; }' },
        { path: '/project/Button.tsx', content: 'export function Button() { return null; }' },
      ],
      [component('Card', '/project/Card.tsx'), component('Button', '/project/Button.tsx')],
    );

    expect(result.accepted).toEqual([
      expect.objectContaining({ parent: 'Card', child: 'Button', slot: 'actions', startLine: 4, endLine: 4 }),
    ]);
  });
});
