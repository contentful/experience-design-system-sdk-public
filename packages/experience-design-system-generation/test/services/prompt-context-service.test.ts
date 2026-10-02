import { describe, expect, it } from 'vitest';
import { inferFenceLang, renderPromptContext } from '../../src/generate/services/prompt-context-service.js';

describe('prompt context service', () => {
  it('maps supported source extensions and falls back to text', () => {
    expect(inferFenceLang('Card.tsx')).toBe('tsx');
    expect(inferFenceLang('tokens.json5')).toBe('json');
    expect(inferFenceLang('unknown.lock')).toBe('text');
    expect(inferFenceLang(undefined)).toBe('json');
  });

  it('preserves the input section order and source evidence', () => {
    const context = renderPromptContext({
      skill: 'components',
      mode: 'autonomous',
      outDir: '/unused',
      existingComponentsInline: '{"existing":true}',
      rawComponentsInline: '{"raw":true}',
      rawTokensInline: '--color: red;',
      rawTokensFilename: 'tokens.css',
      tokensInline: '{"tokens":true}',
      tokenMapInline: '{"--color":"colors.red"}',
      componentSourceRefs: [
        {
          component: 'Card',
          sourcePath: 'src/Card.tsx',
          content: 'export const Card = () => null;',
          siblingFiles: [{ path: 'src/Card.styles.ts', content: 'export const styles = {};' }],
        },
      ],
    });

    expect(context.indexOf('Existing components')).toBeLessThan(context.indexOf('Raw component data'));
    expect(context.indexOf('Raw component data')).toBeLessThan(context.indexOf('Raw token source'));
    expect(context).toContain('```css');
    expect(context).toContain('### Component source references');
    expect(context).toContain('src/Card.styles.ts');
  });
});
