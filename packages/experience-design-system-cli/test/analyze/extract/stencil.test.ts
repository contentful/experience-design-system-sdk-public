import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractStencilComponents } from '../../../src/analyze/extract/stencil.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'extract-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function writeFixture(filename: string, content: string): Promise<string> {
  const filePath = join(tempDir, filename);
  await writeFile(filePath, content);
  return filePath;
}

describe('StencilComponentExtractor', () => {
  it('extracts props from @Prop() decorators with defaults', async () => {
    const filePath = await writeFixture(
      'button.tsx',
      `
      import { Component, Prop, h } from '@stencil/core';

      @Component({ tag: 'p-button', shadow: true })
      export class Button {
        @Prop() public label!: string;
        @Prop() public variant?: string = 'primary';
        @Prop() public disabled?: boolean = false;

        render() { return <button>{this.label}</button>; }
      }
    `,
    );

    const result = await extractStencilComponents([filePath]);

    expect(result.components).toHaveLength(1);
    const button = result.components[0];
    expect(button.name).toBe('PButton');
    expect(button.framework).toBe('stencil');
    expect(button.source).toBe(filePath);

    const labelProp = button.props.find((p) => p.name === 'label');
    expect(labelProp).toBeDefined();
    expect(labelProp!.type).toBe('string');
    expect(labelProp!.required).toBe(true);

    const variantProp = button.props.find((p) => p.name === 'variant');
    expect(variantProp).toBeDefined();
    expect(variantProp!.type).toBe('string');
    expect(variantProp!.required).toBe(false);
    expect(variantProp!.defaultValue).toBe('primary');

    const disabledProp = button.props.find((p) => p.name === 'disabled');
    expect(disabledProp).toBeDefined();
    expect(disabledProp!.type).toBe('boolean');
    expect(disabledProp!.defaultValue).toBe('false');
  });

  it('handles @Prop options (reflect, mutable) without breaking', async () => {
    const filePath = await writeFixture(
      'input.tsx',
      `
      import { Component, Prop, h } from '@stencil/core';

      @Component({ tag: 'p-text-field', shadow: true })
      export class TextField {
        @Prop({ reflect: true }) public name?: string;
        @Prop({ mutable: true }) public value?: string = '';
        @Prop({ reflect: true, mutable: true }) public open?: boolean;
      }
    `,
    );

    const result = await extractStencilComponents([filePath]);
    expect(result.components).toHaveLength(1);

    const tf = result.components[0];
    expect(tf.name).toBe('PTextField');

    const nameProp = tf.props.find((p) => p.name === 'name');
    expect(nameProp!.required).toBe(false);
    expect(nameProp!.type).toBe('string');

    const valueProp = tf.props.find((p) => p.name === 'value');
    expect(valueProp!.defaultValue).toBe('');
    expect(valueProp!.required).toBe(false);

    const openProp = tf.props.find((p) => p.name === 'open');
    expect(openProp!.type).toBe('boolean');
    expect(openProp!.required).toBe(false);
  });

  it('skips non-Stencil .tsx files', async () => {
    const filePath = await writeFixture(
      'ReactButton.tsx',
      `
      import React from 'react';
      export function ReactButton({ label }: { label: string }) {
        return <button>{label}</button>;
      }
    `,
    );

    const result = await extractStencilComponents([filePath]);
    expect(result.components).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('extracts nothing from utility files with stencil imports but no @Component', async () => {
    const filePath = await writeFixture(
      'utils.tsx',
      `
      import { h } from '@stencil/core';

      export function renderIcon(name: string) {
        return <span class={'icon-' + name}></span>;
      }
    `,
    );

    const result = await extractStencilComponents([filePath]);
    expect(result.components).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('extracts slots from @slot JSDoc tags', async () => {
    const filePath = await writeFixture(
      'modal.tsx',
      `
      import { Component, h } from '@stencil/core';

      /**
       * @slot {"name": "default", "description": "Default slot for modal content."}
       * @slot {"name": "header", "description": "Renders a header section."}
       * @slot {"name": "footer", "description": "Shows a sticky footer."}
       */
      @Component({ tag: 'p-modal', shadow: true })
      export class Modal {
        render() { return <div><slot /><slot name="header" /><slot name="footer" /></div>; }
      }
    `,
    );

    const result = await extractStencilComponents([filePath]);
    const modal = result.components[0];

    expect(modal.slots).toHaveLength(3);
    expect(modal.slots).toContainEqual({
      name: 'default',
      isDefault: true,
      description: 'Default slot for modal content.',
    });
    expect(modal.slots).toContainEqual({
      name: 'header',
      isDefault: false,
      description: 'Renders a header section.',
    });
    expect(modal.slots).toContainEqual({
      name: 'footer',
      isDefault: false,
      description: 'Shows a sticky footer.',
    });
  });

  it('extracts slots from standard @slot JSDoc tags', async () => {
    const filePath = await writeFixture(
      'accordion.tsx',
      `
      import { Component, h } from '@stencil/core';

      /**
       * @slot header - Content is placed at the top and is used to expand or collapse the accordion item.
       * @slot content - Content is placed below the header and is shown or hidden based on expanded state.
       */
      @Component({ tag: 'ion-accordion', shadow: true })
      export class Accordion {
        render() { return <Host />; }
      }
    `,
    );

    const result = await extractStencilComponents([filePath]);
    const accordion = result.components[0];

    expect(accordion.slots).toHaveLength(2);
    expect(accordion.slots).toContainEqual({
      name: 'header',
      isDefault: false,
      description: 'Content is placed at the top and is used to expand or collapse the accordion item.',
    });
    expect(accordion.slots).toContainEqual({
      name: 'content',
      isDefault: false,
      description: 'Content is placed below the header and is shown or hidden based on expanded state.',
    });
  });

  it('extracts slots from Stencil render JSX', async () => {
    const filePath = await writeFixture(
      'avatar.tsx',
      `
      import { Component, Host, h } from '@stencil/core';

      @Component({ tag: 'ion-avatar', shadow: true })
      export class Avatar {
        render() {
          return (
            <Host>
              <slot></slot>
              <slot name="fallback"></slot>
            </Host>
          );
        }
      }
    `,
    );

    const result = await extractStencilComponents([filePath]);
    const avatar = result.components[0];

    expect(avatar.slots).toHaveLength(2);
    expect(avatar.slots).toContainEqual({ name: 'default', isDefault: true });
    expect(avatar.slots).toContainEqual({ name: 'fallback', isDefault: false });
  });

  it('extracts slots from helper methods used by render', async () => {
    const filePath = await writeFixture(
      'card.tsx',
      `
      import { Component, Host, h } from '@stencil/core';

      @Component({ tag: 'ion-card', shadow: true })
      export class Card {
        private renderCard() {
          return (
            <div>
              <slot></slot>
            </div>
          );
        }

        render() {
          return <Host>{this.renderCard()}</Host>;
        }
      }
    `,
    );

    const result = await extractStencilComponents([filePath]);
    const card = result.components[0];

    expect(card.slots).toContainEqual({ name: 'default', isDefault: true });
  });

  it('marks deprecated props and slots with [DEPRECATED] prefix', async () => {
    const filePath = await writeFixture(
      'tabs.tsx',
      `
      import { Component, Prop, h } from '@stencil/core';

      /**
       * @slot {"name": "nav", "description": "Navigation items.", "isDeprecated": true}
       */
      @Component({ tag: 'p-tabs', shadow: true })
      export class Tabs {
        /** The active tab index. */
        @Prop() public activeTab?: number = 0;

        /** @deprecated Use size instead. */
        @Prop() public weight?: string;

        render() { return <div />; }
      }
    `,
    );

    const result = await extractStencilComponents([filePath]);
    const tabs = result.components[0];

    const weightProp = tabs.props.find((p) => p.name === 'weight');
    expect(weightProp!.description).toBe('[DEPRECATED] Use size instead.');

    const activeTabProp = tabs.props.find((p) => p.name === 'activeTab');
    expect(activeTabProp!.description).toBe('The active tab index.');

    expect(tabs.slots).toContainEqual({
      name: 'nav',
      isDefault: false,
      description: '[DEPRECATED] Navigation items.',
    });
  });

  it('extracts allowedValues from inline string literal unions', async () => {
    const filePath = await writeFixture(
      'badge.tsx',
      `
      import { Component, Prop, h } from '@stencil/core';

      @Component({ tag: 'p-badge', shadow: true })
      export class Badge {
        @Prop() public color?: 'primary' | 'notification' | 'default' = 'default';
        @Prop() public label!: string;
      }
    `,
    );

    const result = await extractStencilComponents([filePath]);
    const badge = result.components[0];

    const colorProp = badge.props.find((p) => p.name === 'color');
    expect(colorProp!.allowedValues).toEqual(['default', 'notification', 'primary']);
    expect(colorProp!.defaultValue).toBe('default');

    const labelProp = badge.props.find((p) => p.name === 'label');
    expect(labelProp!.allowedValues).toBeUndefined();
  });

  it('warns about uncaptured @Event() decorators', async () => {
    const filePath = await writeFixture(
      'input.tsx',
      `
      import { Component, Prop, Event, type EventEmitter, h } from '@stencil/core';

      @Component({ tag: 'p-input', shadow: true })
      export class Input {
        @Prop() public value?: string = '';

        @Event({ bubbles: true }) public change!: EventEmitter<string>;
        @Event() public focus!: EventEmitter<void>;

        render() { return <input />; }
      }
    `,
    );

    const result = await extractStencilComponents([filePath]);
    expect(result.components).toHaveLength(1);
    expect(result.components[0].props).toHaveLength(1);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toBe('Component PInput has 2 events not captured: change, focus');
  });

  it('warns about exported FunctionalComponent declarations', async () => {
    const filePath = await writeFixture(
      'loading-message.tsx',
      `
      import { type FunctionalComponent, h } from '@stencil/core';

      type LoadingMessageProps = { loading: boolean; initialLoading: boolean };

      export const LoadingMessage: FunctionalComponent<LoadingMessageProps> = ({ loading, initialLoading }) => {
        return <span>{loading ? 'Loading' : initialLoading ? 'Done' : ''}</span>;
      };
    `,
    );

    const result = await extractStencilComponents([filePath]);
    expect(result.components).toHaveLength(0);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Stencil FunctionalComponent detected but not extracted: LoadingMessage');
  });

  it('captures sourcePath and per-prop source line ranges (Feature 1)', async () => {
    const filePath = await writeFixture(
      'card-loc.tsx',
      `
      import { Component, Prop, h } from '@stencil/core';

      @Component({ tag: 'p-card-loc', shadow: true })
      export class CardLoc {
        @Prop() public title!: string;
        @Prop() public subtitle?: string;
        render() { return <section />; }
      }
    `,
    );
    const result = await extractStencilComponents([filePath]);
    const card = result.components[0];
    expect(card.sourcePath).toBe(filePath);
    const titleProp = card.props.find((p) => p.name === 'title');
    const subtitleProp = card.props.find((p) => p.name === 'subtitle');
    expect(titleProp?.sourceStartLine).toBeGreaterThan(0);
    expect(subtitleProp?.sourceStartLine).toBeGreaterThan(titleProp!.sourceStartLine!);
  });
});
