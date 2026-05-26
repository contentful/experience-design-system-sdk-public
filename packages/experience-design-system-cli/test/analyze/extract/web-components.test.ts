import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractWebComponentDefinitions } from '../../../src/analyze/extract/web-components.js';

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

describe('WebComponentExtractor', () => {
  it('extracts observedAttributes and Shadow DOM slots', async () => {
    const filePath = await writeFixture(
      'my-button.ts',
      `
      class MyButton extends HTMLElement {
        static get observedAttributes() {
          return ['theme', 'size'];
        }

        connectedCallback() {
          this.shadowRoot!.innerHTML = \`
            <slot name="icon"></slot>
            <slot></slot>
          \`;
        }
      }

      customElements.define('my-button', MyButton);
    `,
    );

    const result = await extractWebComponentDefinitions([filePath]);
    expect(result.components).toHaveLength(1);
    const button = result.components[0];
    expect(button.name).toBe('MyButton');
    expect(button.framework).toBe('web-component');

    expect(button.props).toContainEqual(expect.objectContaining({ name: 'theme', type: 'string' }));
    expect(button.props).toContainEqual(expect.objectContaining({ name: 'size', type: 'string' }));

    expect(button.slots).toContainEqual({ name: 'icon', isDefault: false });
    expect(button.slots).toContainEqual({ name: 'default', isDefault: true });
  });

  it('preserves kebab-case names in @attribute JSDoc tags', async () => {
    const filePath = await writeFixture(
      'fancy-badge.ts',
      `
      /**
       * @attribute {string} my-prop - Public attribute description.
       */
      class FancyBadge extends HTMLElement {}

      customElements.define('fancy-badge', FancyBadge);
      `,
    );

    const result = await extractWebComponentDefinitions([filePath]);
    const badge = result.components[0];

    expect(badge.props).toContainEqual(
      expect.objectContaining({
        name: 'my-prop',
        type: 'string',
        description: 'Public attribute description.',
      }),
    );
  });

  it('converts kebab-case tag name to PascalCase', async () => {
    // Class name intentionally differs from tag name to prove kebabToPascal is used
    const filePath = await writeFixture(
      'fancy-card.ts',
      `
      class CardElement extends HTMLElement {}
      customElements.define('fancy-card', CardElement);
    `,
    );

    const result = await extractWebComponentDefinitions([filePath]);
    expect(result.components[0].name).toBe('FancyCard');
  });

  it('extracts slots from Lit render() method', async () => {
    const filePath = await writeFixture(
      'lit-widget.ts',
      `
      class LitWidget extends LitElement {
        render() {
          return html\`<div><slot name="header"></slot><slot></slot></div>\`;
        }
      }
      customElements.define('lit-widget', LitWidget);
    `,
    );

    const result = await extractWebComponentDefinitions([filePath]);
    const widget = result.components[0];
    expect(widget.slots).toContainEqual({ name: 'header', isDefault: false });
    expect(widget.slots).toContainEqual({ name: 'default', isDefault: true });
  });

  it('extracts slots from Lit render() when slot elements have additional attributes', async () => {
    const filePath = await writeFixture(
      'lit-slotted-widget.ts',
      `
      class LitSlottedWidget extends LitElement {
        render() {
          return html\`<div><slot @slotchange=\${this.handleSlotChange}></slot></div>\`;
        }
      }
      customElements.define('lit-slotted-widget', LitSlottedWidget);
    `,
    );

    const result = await extractWebComponentDefinitions([filePath]);
    const widget = result.components[0];
    expect(widget.slots).toContainEqual({ name: 'default', isDefault: true });
  });

  it('extracts slots from imported Lit template helpers', async () => {
    const componentDir = join(tempDir, 'components/empty-state');
    const templateDir = join(componentDir, 'src');
    await mkdir(templateDir, { recursive: true });

    const filePath = join(componentDir, 'empty-state.ts');
    await writeFile(
      filePath,
      `
      import { customElement } from 'lit/decorators.js';
      import { emptyStateTemplate } from './src/empty-state.template.js';

      @customElement('clabs-empty-state')
      export class CLABSEmptyState extends HTMLElement {
        render() {
          return emptyStateTemplate(this);
        }
      }
      `,
    );

    await writeFile(
      join(templateDir, 'empty-state.template.ts'),
      `
      import { html } from 'lit';

      export function emptyStateTemplate(_instance: unknown) {
        return html\`
          <slot name="illustration"></slot>
          <slot name="action"></slot>
          <slot name="link"></slot>
        \`;
      }
      `,
    );

    const result = await extractWebComponentDefinitions([filePath]);
    const component = result.components[0];

    expect(component.slots).toContainEqual({
      name: 'illustration',
      isDefault: false,
    });
    expect(component.slots).toContainEqual({
      name: 'action',
      isDefault: false,
    });
    expect(component.slots).toContainEqual({ name: 'link', isDefault: false });
  });

  it('extracts FAST slots from helper calls embedded in co-located template files', async () => {
    const componentDir = join(tempDir, 'tabs');
    const patternsDir = join(tempDir, 'patterns');
    await mkdir(componentDir, { recursive: true });
    await mkdir(patternsDir, { recursive: true });

    const filePath = join(componentDir, 'tabs.ts');
    await writeFile(
      filePath,
      `
      export class Tabs extends FASTElement {}
      `,
    );

    await writeFile(
      join(componentDir, 'tabs.template.ts'),
      `
      import { html } from '@microsoft/fast-element';
      import { endSlotTemplate, startSlotTemplate } from '../patterns/index.js';

      export function tabsTemplate() {
        return html\`
          \${startSlotTemplate()}
          <slot name="tab"></slot>
          \${endSlotTemplate()}
          <slot name="tabpanel"></slot>
        \`;
      }

      export const template = tabsTemplate();
      `,
    );

    await writeFile(
      join(patternsDir, 'index.ts'),
      `
      import { html } from '@microsoft/fast-element';

      export function startSlotTemplate() {
        return html\`<slot name="start"></slot>\`;
      }

      export function endSlotTemplate() {
        return html\`<slot name="end"></slot>\`;
      }
      `,
    );

    await writeFile(
      join(componentDir, 'tabs.definition.ts'),
      `
      import { Tabs } from './tabs.js';

      export const definition = Tabs.compose({
        name: 'fluent-tabs',
      });
      `,
    );

    const result = await extractWebComponentDefinitions([filePath]);
    const tabs = result.components[0];

    expect(tabs.slots).toContainEqual({ name: 'start', isDefault: false });
    expect(tabs.slots).toContainEqual({ name: 'tab', isDefault: false });
    expect(tabs.slots).toContainEqual({ name: 'end', isDefault: false });
    expect(tabs.slots).toContainEqual({ name: 'tabpanel', isDefault: false });
  });

  it('extracts Lit components documented with @element when they extend imported base classes', async () => {
    const filePath = await writeFixture(
      'badge.ts',
      `
      import { html } from 'lit';
      import { property } from 'lit/decorators.js';

      class BadgeBase {}

      /**
       * @element swc-badge
       */
      export class Badge extends BadgeBase {
        @property({ type: String, reflect: true })
        variant: string = 'informative';

        @property({ type: Boolean, reflect: true })
        subtle: boolean = false;

        render() {
          return html\`<slot name="icon"></slot><slot></slot>\`;
        }
      }
    `,
    );

    const result = await extractWebComponentDefinitions([filePath]);
    expect(result.components).toHaveLength(1);

    const badge = result.components[0];
    expect(badge.name).toBe('Badge');
    expect(badge.props.find((p) => p.name === 'variant')!.defaultValue).toBe('informative');
    expect(badge.props.find((p) => p.name === 'subtle')!.type).toBe('boolean');
    expect(badge.slots).toContainEqual({ name: 'icon', isDefault: false });
    expect(badge.slots).toContainEqual({ name: 'default', isDefault: true });
  });

  it('merges props from resolved Spectrum core base classes', async () => {
    const baseDir = join(tempDir, '2nd-gen/packages/core/components/badge');
    const wrapperDir = join(tempDir, '2nd-gen/packages/swc/components/badge');
    await mkdir(baseDir, { recursive: true });
    await mkdir(wrapperDir, { recursive: true });
    await writeFile(
      join(baseDir, 'Badge.base.ts'),
      `
      import { property } from 'lit/decorators.js';

      /**
       * Shared badge API.
       *
       * @attribute {string} size - The size of the badge.
       *
       * @slot - Badge label content.
       */
      export abstract class BadgeBase {
        @property({ type: String, reflect: true })
        public variant: string = 'informative';

        @property()
        public label = '';

        @property({ reflect: true })
        public get fixed(): string | undefined {
          return this._fixed;
        }

        public set fixed(value: string | undefined) {
          this._fixed = value;
        }

        private _fixed?: string;
      }
      `,
    );
    await writeFile(join(baseDir, 'index.ts'), `export * from './Badge.base.js';`);

    const filePath = join(wrapperDir, 'Badge.ts');
    await writeFile(
      filePath,
      `
      import { html } from 'lit';
      import { property } from 'lit/decorators.js';
      import { BadgeBase } from '@spectrum-web-components/core/components/badge';

      /**
       * @element swc-badge
       */
      export class Badge extends BadgeBase {
        @property({ type: Boolean, reflect: true })
        subtle: boolean = false;

        render() {
          return html\`<slot></slot>\`;
        }
      }
      `,
    );

    const result = await extractWebComponentDefinitions([filePath]);
    expect(result.components).toHaveLength(1);

    const badge = result.components[0];
    expect(badge.props.find((p) => p.name === 'size')!.type).toBe('string');
    expect(badge.props.find((p) => p.name === 'size')!.description).toBe('The size of the badge.');
    expect(badge.props.find((p) => p.name === 'variant')!.defaultValue).toBe('informative');
    expect(badge.props.find((p) => p.name === 'label')!.defaultValue).toBe('');
    expect(badge.props.find((p) => p.name === 'fixed')!.type).toBe('string | undefined');
    expect(badge.props.find((p) => p.name === 'subtle')!.type).toBe('boolean');
    expect(badge.slots).toContainEqual({
      name: 'default',
      isDefault: true,
      description: 'Badge label content.',
    });
  });

  it('extracts Shoelace-style components registered through sibling define() files', async () => {
    const internalDir = join(tempDir, 'internal');
    const componentDir = join(tempDir, 'components/button');
    await mkdir(internalDir, { recursive: true });
    await mkdir(componentDir, { recursive: true });

    await writeFile(
      join(internalDir, 'shoelace-element.ts'),
      `
      export default class ShoelaceElement {
        static define(_tagName: string) {}
      }
      `,
    );

    await writeFile(
      join(componentDir, 'button.component.ts'),
      `
      import { html } from 'lit';
      import { property } from 'lit/decorators.js';
      import ShoelaceElement from '../../internal/shoelace-element.js';

      export default class SlButton extends ShoelaceElement {
        /** The button's label. */
        @property() label = '';

        render() {
          return html\`<slot></slot><slot name="prefix"></slot>\`;
        }
      }
      `,
    );

    const filePath = join(componentDir, 'button.component.ts');
    await writeFile(
      join(componentDir, 'button.ts'),
      `
      import SlButton from './button.component.js';

      export * from './button.component.js';
      export default SlButton;

      SlButton.define('sl-button');
      `,
    );

    const result = await extractWebComponentDefinitions([filePath]);
    expect(result.components).toHaveLength(1);

    const button = result.components[0];
    expect(button.name).toBe('SlButton');
    expect(button.props.find((p) => p.name === 'label')!.defaultValue).toBe('');
    expect(button.slots).toContainEqual({ name: 'default', isDefault: true });
    expect(button.slots).toContainEqual({ name: 'prefix', isDefault: false });
  });

  it('uses Lit @customElement metadata to recover public component identity from the file when class names are misleading', async () => {
    const filePath = await writeFixture(
      'profile-popover.ts',
      `
      import { LitElement } from 'lit';
      import { customElement } from 'lit/decorators.js';

      @customElement('clabs-global-header-profile-popover')
      export class AuthContext extends LitElement {}
      `,
    );

    const result = await extractWebComponentDefinitions([filePath]);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].name).toBe('ProfilePopover');
  });

  it('uses decorator metadata to avoid false duplicate names across files with reused class names', async () => {
    const authContextPath = await writeFixture(
      'AuthContext.ts',
      `
      import { LitElement } from 'lit';
      import { customElement } from 'lit/decorators.js';

      @customElement('clabs-global-header-auth-context')
      export class AuthContext extends LitElement {}
      `,
    );
    const profilePopoverPath = await writeFixture(
      'ProfilePopover.ts',
      `
      import { LitElement } from 'lit';
      import { customElement } from 'lit/decorators.js';

      @customElement('clabs-global-header-profile-popover')
      export class AuthContext extends LitElement {}
      `,
    );

    const result = await extractWebComponentDefinitions([authContextPath, profilePopoverPath]);

    expect(result.components).toHaveLength(2);
    expect(result.components.map((component) => component.name).sort()).toEqual(['AuthContext', 'ProfilePopover']);
  });

  it('extracts Lit decorator tag names from no-substitution templates that include a local prefix constant', async () => {
    const filePath = await writeFixture(
      'user-profile-image.ts',
      `
      import { LitElement } from 'lit';
      import { customElement } from 'lit/decorators.js';

      const clabsPrefix = 'clabs';

      @customElement(\`\${clabsPrefix}-global-header-user-profile-image\`)
      export class SideNavItem extends LitElement {}
      `,
    );

    const result = await extractWebComponentDefinitions([filePath]);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].name).toBe('UserProfileImage');
  });

  it('does not extract undecorated LitElement base classes without public tag metadata', async () => {
    const filePath = await writeFixture(
      'chat-base.ts',
      `
      import { LitElement } from 'lit';

      export default class CLABSChat extends LitElement {
        loading = false;
      }
      `,
    );

    const result = await extractWebComponentDefinitions([filePath]);

    expect(result.components).toHaveLength(0);
  });

  it('extracts FAST components when a sibling definition file composes a public tag name', async () => {
    await writeFixture(
      'fluent-design-system.ts',
      `
      export const FluentDesignSystem = Object.freeze({
        prefix: 'fluent',
      });
      `,
    );
    const filePath = await writeFixture(
      'badge.ts',
      `
      import { attr, FASTElement } from '@microsoft/fast-element';

      export class Badge extends FASTElement {
        @attr
        public appearance: string = 'filled';
      }
      `,
    );
    await writeFixture(
      'badge.definition.ts',
      `
      import { FluentDesignSystem } from './fluent-design-system.js';
      import { Badge } from './badge.js';

      export const definition = Badge.compose({
        name: \`\${FluentDesignSystem.prefix}-badge\`,
      });
      `,
    );

    const result = await extractWebComponentDefinitions([filePath]);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].name).toBe('Badge');
    expect(result.components[0].props.find((prop) => prop.name === 'appearance')?.defaultValue).toBe('filled');
  });

  it('filters local and inherited web-component members documented as internal', async () => {
    await writeFixture(
      'base-element.ts',
      `
      export class BaseElement extends HTMLElement {
        /**
         * @internal
         */
        public elementInternals: ElementInternals = this.attachInternals();

        /**
         * @internal
         */
        public defaultSlot!: HTMLSlotElement;

        public label: string = 'base';
      }
      `,
    );
    const filePath = await writeFixture(
      'public-element.ts',
      `
      import { BaseElement } from './base-element.js';

      class PublicElement extends BaseElement {
        /**
         * @internal
         */
        public slottedItems: HTMLElement[] = [];

        public appearance: string = 'outline';
      }

      customElements.define('public-element', PublicElement);
      `,
    );

    const result = await extractWebComponentDefinitions([filePath]);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].props.map((prop) => prop.name)).toEqual(['appearance', 'label']);
  });

  it('excludes local Lit query and state members while keeping @property props', async () => {
    const filePath = await writeFixture(
      'public-element.ts',
      `
      import { property, query, state } from 'lit/decorators.js';

      class PublicElement extends HTMLElement {
        @property() label = 'visible';

        @query('[part="base"]') base!: HTMLElement;

        @state() private open = false;
      }

      customElements.define('public-element', PublicElement);
      `,
    );

    const result = await extractWebComponentDefinitions([filePath]);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].props.map((prop) => prop.name)).toEqual(['label']);
  });

  it('excludes inherited Shoelace runtime fields while keeping inherited public props', async () => {
    const baseFilePath = await writeFixture(
      'shoelace-like-element.ts',
      `
      import { property } from 'lit/decorators.js';

      export class ShoelaceLikeElement extends HTMLElement {
        // Simulate inherited Shoelace runtime fields that should not surface as public props.
        @property() dir!: string;
        @property() lang!: string;

        initialReflectedProperties: Map<string, unknown> = new Map();

        public label: string = 'base';
      }
      `,
    );
    const filePath = await writeFixture(
      'public-element.ts',
      `
      import { property } from 'lit/decorators.js';
      import { ShoelaceLikeElement } from './shoelace-like-element.js';

      class PublicElement extends ShoelaceLikeElement {
        @property() variant = 'primary';
      }

      customElements.define('public-element', PublicElement);
      `,
    );

    const result = await extractWebComponentDefinitions([baseFilePath, filePath]);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].props.map((prop) => prop.name)).toEqual(['label', 'variant']);
  });

  it('keeps public dir and lang props on non-Shoelace components', async () => {
    const filePath = await writeFixture(
      'public-element.ts',
      `
      import { property } from 'lit/decorators.js';

      class PublicElement extends HTMLElement {
        @property() dir = 'ltr';
        @property() lang = 'en';
        @property() variant = 'primary';
      }

      customElements.define('public-element', PublicElement);
      `,
    );

    const result = await extractWebComponentDefinitions([filePath]);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].props.map((prop) => prop.name)).toEqual(['dir', 'lang', 'variant']);
  });

  it('keeps inherited public dir and lang props when the base class is not Shoelace-like', async () => {
    const baseFilePath = await writeFixture(
      'base-element.ts',
      `
      import { property } from 'lit/decorators.js';

      export class BaseElement extends HTMLElement {
        @property() dir = 'ltr';
        @property() lang = 'en';
        @property() label = 'base';
      }
      `,
    );
    const filePath = await writeFixture(
      'public-element.ts',
      `
      import { property } from 'lit/decorators.js';
      import { BaseElement } from './base-element.js';

      class PublicElement extends BaseElement {
        @property() variant = 'primary';
      }

      customElements.define('public-element', PublicElement);
      `,
    );

    const result = await extractWebComponentDefinitions([baseFilePath, filePath]);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].props.map((prop) => prop.name)).toEqual(['dir', 'label', 'lang', 'variant']);
  });

  it('extracts class property declarations', async () => {
    const filePath = await writeFixture(
      'typed-element.ts',
      `
      class TypedElement extends HTMLElement {
        theme: string = 'light';
        count: number = 0;
      }
      customElements.define('typed-element', TypedElement);
    `,
    );

    const result = await extractWebComponentDefinitions([filePath]);
    const el = result.components[0];
    expect(el.props.find((p) => p.name === 'theme')!.defaultValue).toBe('light');
    expect(el.props.find((p) => p.name === 'count')!.type).toBe('number');
  });

  it('prefers the public-facing name for underscore-backed Lit properties with explicit attributes', async () => {
    const filePath = await writeFixture(
      'public-element.ts',
      `
      import { property, state } from 'lit/decorators.js';

      class PublicElement extends HTMLElement {
        @property({ type: String, attribute: 'input-placeholder' })
        _inputPlaceholder = 'Ask a question';

        @property({ type: Boolean, attribute: 'disable-input' })
        _disableInput = false;

        @state()
        _internalOpen = false;
      }

      customElements.define('public-element', PublicElement);
    `,
    );

    const result = await extractWebComponentDefinitions([filePath]);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].props.map((prop) => prop.name)).toEqual(['disableInput', 'inputPlaceholder']);
  });

  it('excludes Lit context consume and provide members while keeping @property props', async () => {
    const filePath = await writeFixture(
      'public-element.ts',
      `
      import { property } from 'lit/decorators.js';
      import { consume, provide } from '@lit/context';

      const sampleContext = {};

      class PublicElement extends HTMLElement {
        @property() label = 'visible';

        @consume({ context: sampleContext, subscribe: true })
        _consumedContext?: { value: string };

        @provide({ context: sampleContext })
        _providedContext = { value: 'hidden' };
      }

      customElements.define('public-element', PublicElement);
      `,
    );

    const result = await extractWebComponentDefinitions([filePath]);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].props.map((prop) => prop.name)).toEqual(['label']);
  });

  it('extracts slots from Polymer static get template()', async () => {
    const filePath = await writeFixture(
      'polymer-widget.ts',
      `
      class PolymerWidget extends HTMLElement {
        static get template() {
          return html\`<div><slot name="content"></slot><slot></slot></div>\`;
        }
      }
      customElements.define('polymer-widget', PolymerWidget);
    `,
    );

    const result = await extractWebComponentDefinitions([filePath]);
    const widget = result.components[0];
    expect(widget.slots).toContainEqual({ name: 'content', isDefault: false });
    expect(widget.slots).toContainEqual({ name: 'default', isDefault: true });
  });

  it('deduplicates observedAttributes and class properties', async () => {
    const filePath = await writeFixture(
      'dedup-element.ts',
      `
      class DedupElement extends HTMLElement {
        static get observedAttributes() { return ['theme']; }
        theme: string = 'dark';
      }
      customElements.define('dedup-element', DedupElement);
    `,
    );

    const result = await extractWebComponentDefinitions([filePath]);
    const el = result.components[0];
    const themeProps = el.props.filter((p) => p.name === 'theme');
    expect(themeProps).toHaveLength(1);
    expect(themeProps[0].defaultValue).toBe('dark');
  });
});
