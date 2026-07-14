import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONTENT_NAME_EXCEPTIONS,
  isReactNodeType,
  isArrayReactNodeType,
  shouldBeSlot,
} from '../../../src/analyze/extract/slot-detection.js';
import { extractReactComponents } from '../../../src/analyze/extract/react.js';

describe('slot-detection module', () => {
  describe('CONTENT_NAME_EXCEPTIONS', () => {
    it('contains expected exception names', () => {
      const expected = [
        'label',
        'title',
        'description',
        'text',
        'caption',
        'message',
        'placeholder',
        'tooltip',
        'heading',
        'subheading',
        'body',
        'summary',
        'excerpt',
      ];
      for (const name of expected) {
        expect(CONTENT_NAME_EXCEPTIONS.has(name)).toBe(true);
      }
    });

    it('does not contain non-exception names', () => {
      expect(CONTENT_NAME_EXCEPTIONS.has('icon')).toBe(false);
      expect(CONTENT_NAME_EXCEPTIONS.has('footer')).toBe(false);
      expect(CONTENT_NAME_EXCEPTIONS.has('content')).toBe(false);
      expect(CONTENT_NAME_EXCEPTIONS.has('header')).toBe(false);
    });
  });

  describe('isReactNodeType', () => {
    it('matches exact ReactNode patterns', () => {
      expect(isReactNodeType('ReactNode')).toBe(true);
      expect(isReactNodeType('React.ReactNode')).toBe(true);
      expect(isReactNodeType('ReactElement')).toBe(true);
      expect(isReactNodeType('React.ReactElement')).toBe(true);
      expect(isReactNodeType('JSX.Element')).toBe(true);
    });

    it('matches unions with null/undefined', () => {
      expect(isReactNodeType('ReactNode | undefined')).toBe(true);
      expect(isReactNodeType('ReactNode | null')).toBe(true);
      expect(isReactNodeType('React.ReactNode | null | undefined')).toBe(true);
      expect(isReactNodeType('ReactElement | undefined')).toBe(true);
    });

    it('matches array patterns', () => {
      expect(isReactNodeType('ReactNode[]')).toBe(true);
      expect(isReactNodeType('React.ReactNode[]')).toBe(true);
      expect(isReactNodeType('Array<ReactNode>')).toBe(true);
      expect(isReactNodeType('Array<React.ReactNode>')).toBe(true);
    });

    it('does not match non-ReactNode types', () => {
      expect(isReactNodeType('string')).toBe(false);
      expect(isReactNodeType('number')).toBe(false);
      expect(isReactNodeType('boolean')).toBe(false);
      expect(isReactNodeType('() => ReactNode')).toBe(false);
      expect(isReactNodeType('string | number')).toBe(false);
    });
  });

  describe('isArrayReactNodeType', () => {
    it('matches array bracket syntax', () => {
      expect(isArrayReactNodeType('ReactNode[]')).toBe(true);
      expect(isArrayReactNodeType('React.ReactNode[]')).toBe(true);
      expect(isArrayReactNodeType('ReactElement[]')).toBe(true);
    });

    it('matches Array generic syntax', () => {
      expect(isArrayReactNodeType('Array<ReactNode>')).toBe(true);
      expect(isArrayReactNodeType('Array<React.ReactNode>')).toBe(true);
      expect(isArrayReactNodeType('Array<ReactElement>')).toBe(true);
    });

    it('matches array with null/undefined union', () => {
      expect(isArrayReactNodeType('ReactNode[] | undefined')).toBe(true);
      expect(isArrayReactNodeType('ReactNode[] | null')).toBe(true);
    });

    it('does not match non-array ReactNode types', () => {
      expect(isArrayReactNodeType('ReactNode')).toBe(false);
      expect(isArrayReactNodeType('React.ReactNode')).toBe(false);
      expect(isArrayReactNodeType('ReactElement')).toBe(false);
    });
  });

  describe('shouldBeSlot', () => {
    it('returns true for ReactNode props not in exception list', () => {
      expect(shouldBeSlot('icon', 'ReactNode')).toBe(true);
      expect(shouldBeSlot('footer', 'ReactNode')).toBe(true);
      expect(shouldBeSlot('content', 'ReactNode')).toBe(true);
      expect(shouldBeSlot('header', 'React.ReactNode')).toBe(true);
      expect(shouldBeSlot('sidebar', 'JSX.Element')).toBe(true);
    });

    it('returns false for exception names with scalar ReactNode', () => {
      expect(shouldBeSlot('description', 'ReactNode')).toBe(false);
      expect(shouldBeSlot('title', 'ReactNode')).toBe(false);
      expect(shouldBeSlot('label', 'ReactNode')).toBe(false);
      expect(shouldBeSlot('text', 'React.ReactNode')).toBe(false);
      expect(shouldBeSlot('caption', 'ReactNode | undefined')).toBe(false);
      expect(shouldBeSlot('message', 'ReactElement')).toBe(false);
      expect(shouldBeSlot('placeholder', 'JSX.Element')).toBe(false);
      expect(shouldBeSlot('tooltip', 'ReactNode')).toBe(false);
      expect(shouldBeSlot('heading', 'ReactNode')).toBe(false);
      expect(shouldBeSlot('subheading', 'ReactNode')).toBe(false);
      expect(shouldBeSlot('body', 'ReactNode')).toBe(false);
      expect(shouldBeSlot('summary', 'ReactNode')).toBe(false);
      expect(shouldBeSlot('excerpt', 'ReactNode')).toBe(false);
    });

    it('returns true for array ReactNode even if name is in exception list', () => {
      expect(shouldBeSlot('description', 'ReactNode[]')).toBe(true);
      expect(shouldBeSlot('title', 'React.ReactNode[]')).toBe(true);
      expect(shouldBeSlot('label', 'Array<ReactNode>')).toBe(true);
    });

    it('returns true for array ReactNode with regular names', () => {
      expect(shouldBeSlot('items', 'React.ReactNode[]')).toBe(true);
      expect(shouldBeSlot('tabs', 'ReactNode[]')).toBe(true);
      expect(shouldBeSlot('actions', 'Array<ReactNode>')).toBe(true);
    });

    it('returns false for non-ReactNode types', () => {
      expect(shouldBeSlot('icon', 'string')).toBe(false);
      expect(shouldBeSlot('content', 'number')).toBe(false);
      expect(shouldBeSlot('items', 'string[]')).toBe(false);
    });

    it('handles optional ReactNode unions', () => {
      expect(shouldBeSlot('footer', 'ReactNode | undefined')).toBe(true);
      expect(shouldBeSlot('icon', 'ReactNode | null')).toBe(true);
      expect(shouldBeSlot('title', 'ReactNode | null')).toBe(false);
    });
  });
});

describe('slot expansion integration', () => {
  let tempDir: string;

  async function writeFixture(filename: string, content: string): Promise<string> {
    const filePath = join(tempDir, filename);
    await mkdir(join(filePath, '..'), { recursive: true });
    await writeFile(filePath, content);
    return filePath;
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'slot-expansion-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('converts ReactNode props to slots', async () => {
    const filePath = await writeFixture(
      'Card.tsx',
      `
      import React, { ReactNode } from 'react';

      interface CardProps {
        icon: ReactNode;
        footer?: ReactNode;
        variant?: string;
      }

      export function Card({ icon, footer, variant }: CardProps) {
        return <div>{icon}{footer}</div>;
      }
    `,
    );

    const result = await extractReactComponents([filePath]);
    const card = result.components[0];

    expect(card.slots.find((s) => s.name === 'icon')).toBeDefined();
    expect(card.slots.find((s) => s.name === 'footer')).toBeDefined();

    expect(card.props.find((p) => p.name === 'icon')).toBeUndefined();
    expect(card.props.find((p) => p.name === 'footer')).toBeUndefined();

    expect(card.props.find((p) => p.name === 'variant')).toBeDefined();
  });

  it('keeps content-name exceptions as props', async () => {
    const filePath = await writeFixture(
      'Alert.tsx',
      `
      import React, { ReactNode } from 'react';

      interface AlertProps {
        title: ReactNode;
        description?: ReactNode;
        label?: ReactNode;
        icon: ReactNode;
      }

      export function Alert({ title, description, label, icon }: AlertProps) {
        return <div>{title}{description}{label}{icon}</div>;
      }
    `,
    );

    const result = await extractReactComponents([filePath]);
    const alert = result.components[0];

    expect(alert.props.find((p) => p.name === 'title')).toBeDefined();
    expect(alert.props.find((p) => p.name === 'description')).toBeDefined();
    expect(alert.props.find((p) => p.name === 'label')).toBeDefined();

    expect(alert.slots.find((s) => s.name === 'icon')).toBeDefined();
    expect(alert.props.find((p) => p.name === 'icon')).toBeUndefined();
  });

  it('converts array ReactNode to slot even if name is in exception list', async () => {
    const filePath = await writeFixture(
      'List.tsx',
      `
      import React from 'react';

      interface ListProps {
        items?: React.ReactNode[];
        description?: React.ReactNode[];
        title: string;
      }

      export function List({ items, description, title }: ListProps) {
        return <div>{title}{items}{description}</div>;
      }
    `,
    );

    const result = await extractReactComponents([filePath]);
    const list = result.components[0];

    expect(list.slots.find((s) => s.name === 'items')).toBeDefined();
    expect(list.props.find((p) => p.name === 'items')).toBeUndefined();

    expect(list.slots.find((s) => s.name === 'description')).toBeDefined();
    expect(list.props.find((p) => p.name === 'description')).toBeUndefined();

    expect(list.props.find((p) => p.name === 'title')).toBeDefined();
  });

  it('does not duplicate existing children slot', async () => {
    const filePath = await writeFixture(
      'Container.tsx',
      `
      import React, { ReactNode } from 'react';

      interface ContainerProps {
        children: ReactNode;
        header: ReactNode;
      }

      export function Container({ children, header }: ContainerProps) {
        return <div>{header}{children}</div>;
      }
    `,
    );

    const result = await extractReactComponents([filePath]);
    const container = result.components[0];

    const defaultSlots = container.slots.filter((s) => s.isDefault);
    expect(defaultSlots).toHaveLength(1);

    expect(container.slots.find((s) => s.name === 'header' && !s.isDefault)).toBeDefined();
  });

  it('does not interfere with render-prop slots', async () => {
    const filePath = await writeFixture(
      'Modal.tsx',
      `
      import React, { ReactNode } from 'react';

      interface ModalProps {
        renderHeader: () => ReactNode;
        icon: ReactNode;
      }

      export function Modal({ renderHeader, icon }: ModalProps) {
        return <div>{renderHeader()}{icon}</div>;
      }
    `,
    );

    const result = await extractReactComponents([filePath]);
    const modal = result.components[0];

    expect(modal.slots.find((s) => s.name === 'header')).toBeDefined();

    expect(modal.slots.find((s) => s.name === 'icon')).toBeDefined();
  });

  it('populates allowedComponents from ReactElement<XProps> slot type (Card)', async () => {
    const p = join(process.cwd(), 'test/analyze/extract/fixtures/nested-card.tsx');
    const result = await extractReactComponents([p]);
    const card = result.components.find((c) => c.name === 'Card');
    expect(card).toBeDefined();
    const header = card!.slots.find((s) => s.name === 'header');
    expect(header).toBeDefined();
    expect(header!.allowedComponents).toEqual(['Heading']);
  });

  it('populates allowedComponents for each typed slot (Layout)', async () => {
    const p = join(process.cwd(), 'test/analyze/extract/fixtures/nested-layout.tsx');
    const result = await extractReactComponents([p]);
    const layout = result.components.find((c) => c.name === 'Layout');
    expect(layout).toBeDefined();
    expect(layout!.slots.find((s) => s.name === 'header')?.allowedComponents).toEqual(['Header']);
    expect(layout!.slots.find((s) => s.name === 'sidebar')?.allowedComponents).toEqual(['Sidebar']);
    expect(layout!.slots.find((s) => s.name === 'footer')?.allowedComponents).toEqual(['Footer']);
  });

  it('populates allowedComponents from a union of ReactElement<XProps> (Wrapper)', async () => {
    const p = join(process.cwd(), 'test/analyze/extract/fixtures/nested-union.tsx');
    const result = await extractReactComponents([p]);
    const wrapper = result.components.find((c) => c.name === 'Wrapper');
    expect(wrapper).toBeDefined();
    const content = wrapper!.slots.find((s) => s.name === 'content');
    expect(content).toBeDefined();
    expect(content!.allowedComponents).toEqual(['A', 'B']);
  });
});
