import { describe, it, expect } from 'vitest';
import {
  extractReactComponents,
  type ComponentExtractionResult,
} from '@contentful/experience-design-system-extraction';
import { useFixtureDir } from './fixture-dir.js';

const { writeFixture } = useFixtureDir('structural-evidence-test-');

function tabListFixture(childReference: string, imports = '', includeTabDefinition = false): string {
  return `
      import { isValidElement, type ReactNode } from 'react';
      ${imports}

      ${
        includeTabDefinition
          ? `
      export interface TabProps { label: string }
      export function Tab({ label }: TabProps) {
        return <div>{label}</div>;
      }
      `
          : ''
      }

      export interface TabListProps { children?: ReactNode }
      export function TabList({ children }: TabListProps) {
        const items = Array.isArray(children) ? children : [children];
        const valid = items.filter((child) => isValidElement(child) && child.type === ${childReference});
        return <div>{valid}</div>;
      }
      `;
}

function expectTabListStructuralEvidence(result: ComponentExtractionResult): void {
  const tabList = result.components.find((component) => component.name === 'TabList');
  const childrenSlot = tabList!.slots.find((slot) => slot.name === 'children');
  expect(childrenSlot!.allowedComponents ?? []).toEqual([]);
  expect(childrenSlot!.structuralAllowedComponents).toEqual(['Tab']);
}

describe('structural slot evidence — signal B (runtime `.type ===` identity check)', () => {
  it('finds the child component without a type-predicate function', async () => {
    const filePath = await writeFixture('runtime-check.tsx', tabListFixture('Tab', '', true));

    const result = await extractReactComponents([filePath]);
    expectTabListStructuralEvidence(result);
  });

  it('resolves a qualified identifier (namespace-import.Component) on the right-hand side of the check', async () => {
    const tabPath = await writeFixture(
      'tab.tsx',
      `
      export interface TabProps { label: string }
      export function Tab({ label }: TabProps) {
        return <div>{label}</div>;
      }
      `,
    );
    const filePath = await writeFixture(
      'qualified-runtime-check.tsx',
      tabListFixture('Tabs.Tab', "import * as Tabs from './tab';"),
    );

    const result = await extractReactComponents([tabPath, filePath]);
    expectTabListStructuralEvidence(result);
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
