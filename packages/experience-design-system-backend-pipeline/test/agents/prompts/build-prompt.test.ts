import { describe, expect, it } from 'vitest';
import { preClassifyComponent } from '@contentful/experience-design-system-extraction';
import { buildPrompt } from '../../../src/agents/prompts/build-prompt.js';

describe('component classification prompt evidence', () => {
  it('includes prop buckets as advisory evidence when supplied and omits them otherwise', async () => {
    const options = { skill: 'components' as const, mode: 'autonomous' as const, outDir: '/tmp/out' };
    const prompt = await buildPrompt({
      ...options,
      propBucketsInline: '{"component":"Card","customPropNames":["label"]}',
    });
    expect(prompt).toContain(
      'Deterministic prop buckets (advisory evidence only; verify against source and do not treat as inclusion or category decisions)',
    );
    expect(prompt).toContain('"customPropNames":["label"]');
    expect(await buildPrompt(options)).not.toContain('Deterministic prop buckets (advisory evidence only');
  });

  it('passes retained DOM props and their source declarations to downstream reasoning', async () => {
    const component = preClassifyComponent({
      name: 'Card',
      source: 'src/Card.tsx',
      framework: 'react',
      props: [
        { name: 'title', type: 'string', required: false },
        { name: 'className', type: 'string', required: false, domAttribute: true },
      ],
      slots: [],
    });
    const prompt = await buildPrompt({
      skill: 'components',
      mode: 'autonomous',
      rawComponentsInline: JSON.stringify([component]),
      componentSourceRefs: [
        {
          component: 'Card',
          sourcePath: 'src/Card.tsx',
          content: `interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
}
export function Card({ title, ...props }: CardProps) {
  return <div {...props}>{title}</div>;
}`,
        },
      ],
      outDir: '/tmp/out',
      componentName: 'Card',
    });

    expect(prompt).toContain('"name":"className"');
    expect(prompt).toContain('interface CardProps extends React.HTMLAttributes<HTMLDivElement>');
    expect(prompt).toContain('a component that redeclares one of these with its own type or JSDoc');
    expect(prompt).toContain('title?: string');
    expect(prompt).not.toContain('"domAttribute"');
  });
});
