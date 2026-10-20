import { describe, expect, it } from 'vitest';
import { bucketComponentProps, preClassifyComponent } from '@contentful/experience-design-system-extraction';
import { buildPrompt } from '../../../src/agents/prompts/build-prompt.js';
import { stripPropProvenance } from '../../../src/agents/prompts/helpers/strip-prop-provenance.js';
import { buildCompilerEvidenceInline } from '../../../src/agents/prompts/helpers/build-compiler-evidence-inline.js';

describe('component classification prompt evidence', () => {
  it('renders bounded source and open-domain guidance in the real selection and generation prompts', async () => {
    const select = await buildPrompt({ skill: 'select', mode: 'autonomous', outDir: '/tmp/out' });
    expect(select).toContain('Source evidence and selection uncertainty');
    expect(select).toContain('A single caller shows an example of use, not the complete contract or all uses');
    expect(select).toContain('They cannot force acceptance or rejection');

    const generation = await buildPrompt({ skill: 'components', mode: 'autonomous', outDir: '/tmp/out' });
    expect(generation).toContain('Source evidence and uncertainty');
    expect(generation).toContain('a union that includes `string` or `number` remains open');
    expect(generation).toContain('including `false`, `0`, and the empty string');
    expect(generation).toContain('A default, one caller, one observed value');
  });

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

  it('renders scoped source candidates and run diagnostics as a separate plain evidence block', async () => {
    const rawComponent = {
      name: 'Card',
      source: 'src/Card.tsx',
      framework: 'react' as const,
      props: [],
      slots: [],
      factSchemaVersion: 3,
      sourceEvidenceReadStatus: 'available' as const,
      sourceCandidates: [
        {
          name: '__proto__',
          keyPath: ['__proto__'],
          evidenceKinds: ['declaration' as const],
          type: 'string',
          declaredRequired: false,
          sourceDefault: null,
          facts: null,
          observations: [],
          projection: { kind: 'excluded' as const, reason: 'candidate-only' },
        },
      ],
    };
    const compilerEvidenceInline = buildCompilerEvidenceInline([rawComponent], {
      readiness: 'ready',
      diagnostics: {
        schemaVersion: 1,
        projects: [],
        modules: [],
        references: [],
        coverage: 'partial',
        limits: { maxRoots: 16 },
        used: { roots: 1 },
      },
    });
    const prompt = await buildPrompt({
      skill: 'components',
      mode: 'autonomous',
      outDir: '/tmp/out',
      compilerEvidenceInline,
    });
    expect(prompt).toContain(
      'Compiler evidence and source candidates (JSON; advisory and separate from authoring props)',
    );
    expect(prompt).toContain('"keyPath":["__proto__"]');
    expect(prompt).toContain('"coverage":"partial"');
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
      rawComponentsInline: JSON.stringify([{ ...component, props: component.props.map(stripPropProvenance) }]),
      propBucketsInline: JSON.stringify(bucketComponentProps(component)),
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
    expect(prompt).toContain(
      'Names, frameworks, known component patterns, inherited shapes and category labels do not establish authorability or exhaustive domains',
    );
    expect(prompt).toContain('title?: string');
    expect(prompt).not.toContain('"domAttribute"');
    expect(prompt).toContain('"domPassthroughPropNames":["className"]');
    expect(component.props[1]?.domAttribute).toBe(true);
  });
});
