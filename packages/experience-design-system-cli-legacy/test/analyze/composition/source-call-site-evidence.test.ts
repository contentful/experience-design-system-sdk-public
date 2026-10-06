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
    expect(result.rejected).toEqual([
      expect.objectContaining({ parent: 'Button', candidate: '<text>', reason: 'text-only-child' }),
    ]);
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

  it('turns accepted evidence into cited call-site edges and retains the evidence', () => {
    const evidence = {
      parent: 'Card',
      child: 'Button',
      sourcePath: '/project/Card.tsx',
      startLine: 4,
      endLine: 4,
      excerpt: 'return <Button />;',
      kind: 'jsx-render' as const,
    };
    const result = resolveMapping({
      components: [component('Card', '/project/Card.tsx'), component('Button', '/project/Button.tsx')],
      sourceCallSiteEvidence: [evidence],
      sourceCallSiteRejections: [],
    });

    expect(result.sourceCallSiteEvidence).toEqual([evidence]);
    expect(result.sourceCallSiteRejections).toEqual([]);
    expect(result.edges).toEqual([
      expect.objectContaining({
        parent: 'Card',
        child: 'Button',
        provenance: 'call-site',
        citation: { sourcePath: '/project/Card.tsx', startLine: 4, endLine: 4 },
      }),
    ]);
  });

  it('produces no edge for a pair without a call site', () => {
    const result = resolveMapping({
      components: [component('Card', '/project/Card.tsx'), component('Button', '/project/Button.tsx')],
      sourceCallSiteEvidence: [],
      sourceCallSiteRejections: [
        { parent: 'Card', candidate: 'Button', sourcePath: '/project/Card.tsx', reason: 'no-call-site' },
      ],
    });

    expect(result.edges).toEqual([]);
    expect(result.sourceCallSiteRejections).toHaveLength(1);
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

  it('retains text-only content as rejected evidence', () => {
    const result = collectSourceCallSiteEvidence(
      [
        {
          path: '/project/Page.tsx',
          content: "import { Card } from './Card';\nexport function Page() { return <Card>Plain text</Card>; }",
        },
      ],
      [component('Card', '/project/Card.tsx')],
    );

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ parent: 'Card', candidate: '<text>', reason: 'text-only-child' }),
    ]);
  });

  it('retains a declared relationship without a render site as rejected evidence', () => {
    const result = collectSourceCallSiteEvidence(
      [{ path: '/project/Card.tsx', content: 'export function Card() { return null; }' }],
      [
        {
          ...component('Card', '/project/Card.tsx'),
          slots: [{ name: 'children', isDefault: true, allowedComponents: ['Button'] }],
        },
        component('Button', '/project/Button.tsx'),
      ],
    );

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ parent: 'Card', candidate: 'Button', reason: 'no-call-site' }),
    ]);
  });
});
