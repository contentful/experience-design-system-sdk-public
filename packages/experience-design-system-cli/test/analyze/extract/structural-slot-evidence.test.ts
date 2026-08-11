import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractReactComponents } from '@contentful/experience-design-system-extraction';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'structural-evidence-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function writeFixture(filename: string, content: string): Promise<string> {
  const filePath = join(tempDir, filename);
  await mkdir(join(filePath, '..'), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
}

describe('structural slot evidence — signal B (runtime `.type ===` identity check)', () => {
  it('finds the child component without a type-predicate function', async () => {
    const filePath = await writeFixture(
      'runtime-check.tsx',
      `
      import { isValidElement, type ReactNode } from 'react';

      export interface TabProps { label: string }
      export function Tab({ label }: TabProps) {
        return <div>{label}</div>;
      }

      export interface TabListProps { children?: ReactNode }
      export function TabList({ children }: TabListProps) {
        const items = Array.isArray(children) ? children : [children];
        const valid = items.filter((child) => isValidElement(child) && child.type === Tab);
        return <div>{valid}</div>;
      }
      `,
    );

    const result = await extractReactComponents([filePath]);
    const tabList = result.components.find((c) => c.name === 'TabList');
    const childrenSlot = tabList!.slots.find((s) => s.name === 'children');
    expect(childrenSlot!.allowedComponents ?? []).toEqual([]);
    expect(childrenSlot!.structuralAllowedComponents).toEqual(['Tab']);
  });
});

describe('structural slot evidence — signal C (direct JSX render)', () => {
  it('finds a component instantiated directly in another component render body', async () => {
    const filePath = await writeFixture(
      'direct-render.tsx',
      `
      import type { ReactNode } from 'react';

      export interface BadgeProps { count: number }
      export function Badge({ count }: BadgeProps) {
        return <span>{count}</span>;
      }

      export interface CardProps { title: string; extra?: ReactNode }
      export function Card({ title, extra }: CardProps) {
        return (
          <div>
            <h4>{title}</h4>
            <Badge count={1} />
            {extra}
          </div>
        );
      }
      `,
    );

    const result = await extractReactComponents([filePath]);
    const card = result.components.find((c) => c.name === 'Card');
    const extraSlot = card!.slots.find((s) => s.name === 'extra');
    expect(extraSlot!.allowedComponents ?? []).toEqual([]);
    expect(extraSlot!.structuralAllowedComponents).toEqual(['Badge']);
  });
});

describe('structural slot evidence — declared contract precedence', () => {
  it('does not attach structural evidence to a slot that already has a declared ReactElement<XProps> contract', async () => {
    const filePath = await writeFixture(
      'declared-contract.tsx',
      `
      import { isValidElement, type ReactElement, type ReactNode } from 'react';

      export interface ItemProps { label: string }
      export function Item({ label }: ItemProps) {
        return <li>{label}</li>;
      }

      function isItemElement(child: ReactNode): child is ReactElement<ItemProps> {
        return isValidElement(child) && child.type === Item;
      }

      export interface ListProps { item: ReactElement<ItemProps> }
      export function List({ item }: ListProps) {
        return isItemElement(item) ? <ul>{item}</ul> : null;
      }
      `,
    );

    const result = await extractReactComponents([filePath]);
    const list = result.components.find((c) => c.name === 'List');
    const itemSlot = list!.slots.find((s) => s.name === 'item');
    // Declared generic already resolved this — structural evidence for the
    // same file exists (the type predicate) but must not be attached since
    // the slot isn't empty.
    expect(itemSlot!.allowedComponents).toEqual(['Item']);
    expect(itemSlot!.structuralAllowedComponents).toBeUndefined();
  });
});
