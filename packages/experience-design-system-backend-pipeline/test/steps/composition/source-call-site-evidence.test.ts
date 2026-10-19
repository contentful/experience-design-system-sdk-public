import { describe, expect, it } from 'vitest';
import * as pipeline from '../../../src/index.js';
import type { RawComponentDefinition } from '../../../src/steps/extraction/src/types/component.js';
import { resolveMapping } from '../../../src/steps/composition/src/helpers/edges/resolve-mapping.js';

function component(name: string, sourcePath: string): RawComponentDefinition {
  return { name, source: sourcePath, sourcePath, framework: 'react', props: [], slots: [] };
}

const button = { path: '/project/Button.tsx', content: 'export function Button() { return null; }' };

describe('source call-site observations', () => {
  it('captures a compiler-resolved cross-file JSX reference with exact source lines', () => {
    const result = pipeline.collectSourceCallSiteEvidence(
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
        button,
      ],
      [component('Card', '/project/Card.tsx'), component('Button', button.path)],
    );
    expect(result.accepted).toEqual([
      {
        parent: 'Card',
        child: 'Button',
        sourcePath: '/project/Card.tsx',
        startLine: 4,
        endLine: 4,
        excerpt: 'return <Button>Continue</Button>;',
        kind: 'jsx-render',
        execution: 'lexical-reference',
      },
    ]);
    expect(result.rejected).toEqual([]);
  });

  it.each([
    "import { Button as Action } from './Button'; export const Card = () => <Action />;",
    "import * as Controls from './Button'; export function Card() { return <Controls.Button />; }",
    "import { Button } from './Button'; const Action = Button; export function Card() { return <Action />; }",
    "import { Button } from './barrel'; export function Card() { return <Button />; }",
  ])('resolves aliases and namespace references by declaration identity: %s', (content) => {
    const result = pipeline.collectSourceCallSiteEvidence(
      [
        { path: '/project/Card.tsx', content },
        button,
        { path: '/project/barrel.ts', content: "export { Button } from './Button';" },
      ],
      [component('Card', '/project/Card.tsx'), component('Button', button.path)],
    );
    expect(result.accepted.map(({ parent, child }) => [parent, child])).toEqual([['Card', 'Button']]);
    expect(result.rejected).toEqual([]);
  });

  it('attributes references only to the enclosing component, including nested functions and callbacks', () => {
    const result = pipeline.collectSourceCallSiteEvidence(
      [
        {
          path: '/project/Cards.tsx',
          content: [
            "import { Button } from './Button';",
            'export function First() { return <Button />; }',
            'export const Second = () => <div />;',
            'const unrelated = () => <Button />;',
            'export function Third() {',
            '  const dormant = () => <Button />;',
            '  return [1].map(() => <Button />);',
            '}',
          ].join('\n'),
        },
        button,
      ],
      ['First', 'Second', 'Third']
        .map((name) => component(name, '/project/Cards.tsx'))
        .concat(component('Button', button.path)),
    );
    expect(result.accepted.map(({ parent, startLine, execution }) => [parent, startLine, execution])).toEqual([
      ['First', 2, 'lexical-reference'],
      ['Third', 6, 'lexical-reference'],
      ['Third', 7, 'lexical-reference'],
    ]);
  });

  it('does not confuse a shadowed parameter or same-named foreign declaration with a known child', () => {
    const result = pipeline.collectSourceCallSiteEvidence(
      [
        {
          path: '/project/Card.tsx',
          content: "import { Button } from './Other'; export function Card() { return <Button />; }",
        },
        {
          path: '/project/Shadow.tsx',
          content: "import { Button } from './Button'; export function Shadow(Button: any) { return <Button />; }",
        },
        { path: '/project/Other.tsx', content: 'export function Button() { return null; }' },
        button,
      ],
      [
        component('Card', '/project/Card.tsx'),
        component('Shadow', '/project/Shadow.tsx'),
        component('Button', button.path),
      ],
    );
    expect(result.accepted).toEqual([]);
    expect(result.rejected.map(({ parent, candidate, reason }) => [parent, candidate, reason])).toEqual([
      ['Card', 'Button', 'unbound-component'],
      ['Shadow', 'Button', 'unbound-component'],
    ]);
  });

  it.each(['let', 'var'])('does not resolve a mutable %s alias from its initializer alone', (declarationKind) => {
    const result = pipeline.collectSourceCallSiteEvidence(
      [
        {
          path: '/project/Card.tsx',
          content: `import { Button } from './Button'; ${declarationKind} Action = Button; Action = () => null; export function Card() { return <Action />; }`,
        },
        button,
      ],
      [component('Card', '/project/Card.tsx'), component('Button', button.path)],
    );
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([expect.objectContaining({ parent: 'Card', candidate: 'Action' })]);
  });

  it('retains unknown and unbound references without treating intrinsic tags as component relationships', () => {
    const result = pipeline.collectSourceCallSiteEvidence(
      [
        {
          path: '/project/Card.tsx',
          content: 'export function Card() { return <div><Ghost /><Button /><my-element /></div>; }',
        },
        button,
      ],
      [component('Card', '/project/Card.tsx'), component('Button', button.path)],
    );
    expect(result.accepted).toEqual([]);
    expect(result.rejected.map(({ candidate, reason }) => [candidate, reason])).toEqual([
      ['Button', 'unbound-component'],
      ['Ghost', 'unknown-component'],
    ]);
  });

  it('handles missing sources, recursive references and cyclic aliases without inventing edges', () => {
    const result = pipeline.collectSourceCallSiteEvidence(
      [
        {
          path: '/project/Card.tsx',
          content: 'const A = B; const B = A; export function Card() { return <><Card /><A /></>; }',
        },
      ],
      [component('Card', '/project/Card.tsx'), component('Missing', '/project/Missing.tsx')],
    );
    expect(result.accepted).toEqual([]);
    expect(result.rejected.map(({ candidate }) => candidate)).toEqual(['A']);
  });

  it.each([
    'export default () => <Button />;',
    'export default function() { return <Button />; }',
    'export default class { render() { return <Button />; } }',
  ])('finds a sole anonymous default component without a name heuristic: %s', (content) => {
    const result = pipeline.collectSourceCallSiteEvidence(
      [{ path: '/project/Card.tsx', content: "import { Button } from './Button'; " + content }, button],
      [component('Card', '/project/Card.tsx'), component('Button', button.path)],
    );
    expect(result.accepted.map(({ parent, child }) => [parent, child])).toEqual([['Card', 'Button']]);
  });

  it('preserves distinct references on the same source line and produces stable order', () => {
    const files = [
      {
        path: '/project/Card.tsx',
        content: "import { Button } from './Button'; export function Card() { return <><Button /><Button /></>; }",
      },
      button,
    ];
    const components = [component('Card', '/project/Card.tsx'), component('Button', button.path)];
    const result = pipeline.collectSourceCallSiteEvidence(files, components);
    expect(result.accepted).toHaveLength(2);
    expect(pipeline.collectSourceCallSiteEvidence([...files].reverse(), [...components].reverse())).toEqual(result);
  });
});

describe('mapping evidence contract', () => {
  const evidence = {
    parent: 'Card',
    child: 'Button',
    sourcePath: '/project/Card.tsx',
    startLine: 4,
    endLine: 4,
    excerpt: 'return <Button />;',
    kind: 'jsx-render' as const,
    execution: 'lexical-reference' as const,
  };
  const rejection = { ...evidence, candidate: 'Ghost', reason: 'unknown-component' as const };

  it.each([false, true])('retains evidence and appends it to the prompt (custom builder=%s)', async (custom) => {
    const prompts: string[] = [];
    const sourceCallSiteEvidence = [evidence];
    const sourceCallSiteRejections = [rejection];
    const result = await resolveMapping({
      components: [component('Card', '/project/Card.tsx'), component('Button', button.path)],
      files: [{ path: '/project/Card.tsx', content: 'candidate source' }],
      sourceCallSiteEvidence,
      sourceCallSiteRejections,
      promptOverride: 'custom instruction',
      ...(custom ? { buildPrompt: () => 'custom builder' } : {}),
      runAgentFn: async ({ prompt }) => {
        prompts.push(prompt);
        return '';
      },
    });
    expect(result.sourceCallSiteEvidence).toEqual([evidence]);
    expect(result.sourceCallSiteEvidence).not.toBe(sourceCallSiteEvidence);
    expect(result.sourceCallSiteRejections).toEqual([rejection]);
    expect(result.sourceCallSiteRejections).not.toBe(sourceCallSiteRejections);
    expect(prompts[0]).toContain(JSON.stringify([evidence]));
    expect(prompts[0]).toContain('untrusted data');
    expect(prompts[0]).toContain('not proof of execution or an exclusive slot contract');
    expect(prompts[0]).toContain(custom ? 'custom builder' : 'custom instruction');
    expect(result.edges).toEqual([]);
    expect(result.components.every(({ slots }) => slots.length === 0)).toBe(true);
  });

  it('retains evidence even when deterministic edges suppress the agent', async () => {
    const result = await resolveMapping({
      components: [component('Card', '/project/Card.tsx')],
      files: [],
      sourceCallSiteEvidence: [evidence],
      sourceCallSiteRejections: [rejection],
      runAgentFn: async () => {
        throw new Error('agent must not run');
      },
    });
    expect(result.sourceCallSiteEvidence).toEqual([evidence]);
    expect(result.sourceCallSiteRejections).toEqual([rejection]);
    expect(result.edges).toEqual([]);
  });

  it('defaults evidence arrays to empty and preserves the existing prompt and mapping', async () => {
    const prompts: string[] = [];
    const result = await resolveMapping({
      components: [component('Card', '/project/Card.tsx')],
      files: [{ path: '/project/Card.tsx', content: 'candidate source' }],
      runAgentFn: async ({ prompt }) => {
        prompts.push(prompt);
        return '';
      },
    });
    expect(result.sourceCallSiteEvidence).toEqual([]);
    expect(result.sourceCallSiteRejections).toEqual([]);
    expect(prompts[0]).not.toContain('Source call-site observations');
    expect(prompts[0]).toContain('candidate source');
    expect(result.warnings).toEqual([]);
  });
});
