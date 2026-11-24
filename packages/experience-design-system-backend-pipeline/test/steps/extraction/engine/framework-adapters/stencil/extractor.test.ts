import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractStencilComponents } from '../../../../../../src/steps/extraction/src/framework-adapters/stencil/extractor.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stencil-ext-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeFile(filename: string, body: string): string {
  const path = join(dir, filename);
  writeFileSync(path, body);
  return path;
}

const BUTTON_SOURCE = `import { Component, Prop, Event, EventEmitter, h, FunctionalComponent } from '@stencil/core';

/**
 * @slot icon - Leading icon
 * @slot {"name":"footer","description":"Footer area","isDeprecated":true}
 */
@Component({ tag: 'my-fancy-button' })
export class MyFancyButton {
  /** Visible label */
  @Prop() label!: string;

  /** Visual variant */
  @Prop() variant: 'primary' | 'secondary' = 'primary';

  /**
   * Old size
   * @deprecated use variant
   */
  @Prop() size?: string;

  /** @deprecated */
  @Prop() legacy?: boolean;

  @Prop() count: number = 3;

  @Prop() disabled?: boolean;

  @Event() clicked!: EventEmitter<void>;

  @Event() focused!: EventEmitter<void>;

  render() {
    return (
      <button disabled={this.disabled}>
        <slot />
        <slot name="suffix" />
        <span slot="badge">x</span>
      </button>
    );
  }
}

export const Helper: FunctionalComponent = () => <div />;
`;

describe('extractStencilComponents', () => {
  it('names the component from its @Component tag in PascalCase', async () => {
    const file = writeFile('my-fancy-button.tsx', BUTTON_SOURCE);
    const result = await extractStencilComponents([file]);
    expect(result.components).toHaveLength(1);
    expect(result.components[0]).toMatchObject({
      name: 'MyFancyButton',
      source: file,
      sourcePath: file,
      framework: 'stencil',
    });
  });

  it('extracts @Prop types, requiredness, defaults, descriptions and allowed values', async () => {
    const file = writeFile('my-fancy-button.tsx', BUTTON_SOURCE);
    const result = await extractStencilComponents([file]);
    expect(result.components[0].props).toEqual([
      { name: 'count', type: 'number', required: false, defaultValue: '3', sourceStartLine: 24, sourceEndLine: 24 },
      {
        name: 'disabled',
        type: 'boolean',
        required: false,
        domAttribute: true,
        sourceStartLine: 26,
        sourceEndLine: 26,
      },
      {
        name: 'label',
        type: 'string',
        required: true,
        description: 'Visible label',
        sourceStartLine: 10,
        sourceEndLine: 10,
      },
      {
        name: 'legacy',
        type: 'boolean',
        required: false,
        description: '[DEPRECATED]',
        sourceStartLine: 22,
        sourceEndLine: 22,
      },
      {
        name: 'size',
        type: 'string',
        required: false,
        description: '[DEPRECATED] Old size',
        sourceStartLine: 19,
        sourceEndLine: 19,
      },
      {
        name: 'variant',
        type: "'primary' | 'secondary'",
        required: false,
        defaultValue: 'primary',
        description: 'Visual variant',
        allowedValues: ['primary', 'secondary'],
        sourceStartLine: 13,
        sourceEndLine: 13,
      },
    ]);
  });

  it('collects slots from @slot JSDoc and template <slot> elements', async () => {
    const file = writeFile('my-fancy-button.tsx', BUTTON_SOURCE);
    const result = await extractStencilComponents([file]);
    expect(result.components[0].slots).toEqual([
      { name: 'badge', isDefault: false },
      { name: 'default', isDefault: true },
      { name: 'footer', isDefault: false, description: '[DEPRECATED] Footer area' },
      { name: 'icon', isDefault: false, description: 'Leading icon' },
      { name: 'suffix', isDefault: false },
    ]);
  });

  it('warns about uncaptured events and FunctionalComponent exports', async () => {
    const file = writeFile('my-fancy-button.tsx', BUTTON_SOURCE);
    const result = await extractStencilComponents([file]);
    expect(result.warnings).toEqual([
      'Component MyFancyButton has 2 events not captured: clicked, focused',
      `Stencil FunctionalComponent detected but not extracted: Helper in ${file}`,
    ]);
  });

  it('ignores files that do not import @stencil/core', async () => {
    const file = writeFile(
      'plain.tsx',
      `@Component({ tag: 'plain-thing' })\nexport class PlainThing {\n  @Prop() label: string;\n}\n`,
    );
    const result = await extractStencilComponents([file]);
    expect(result).toEqual({ components: [], warnings: [] });
  });
});
