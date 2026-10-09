import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractAngularComponents } from '../extract-angular-components.js';

/**
 * Three fixtures drawn from the real-world DS corpus (shapes mirror the
 * actual source of Angular Material card, NG-ZORRO button, Spartan hlm-card)
 * without copying licensed code verbatim.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ng-ext-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeFile(filename: string, body: string): string {
  const p = join(dir, filename);
  writeFileSync(p, body);
  return p;
}

describe('extractAngularComponents — classic @Input + external template', () => {
  it('extracts Material-style card with external templateUrl + named slots', async () => {
    const html = `
      <div class="card">
        <ng-content select="mat-card-title"></ng-content>
        <ng-content select="mat-card-content"></ng-content>
        <ng-content></ng-content>
      </div>
    `;
    writeFile('card.component.html', html);
    const tsPath = writeFile(
      'card.component.ts',
      `
      import { Component, Input } from '@angular/core';

      @Component({
        selector: 'mat-card',
        templateUrl: './card.component.html',
      })
      export class MatCardComponent {
        @Input() appearance: 'outlined' | 'raised' | 'filled' = 'raised';
        @Input({ required: true }) ariaLabel!: string;
      }
    `,
    );

    const result = await extractAngularComponents([tsPath]);
    expect(result.components).toHaveLength(1);
    const c = result.components[0]!;
    expect(c.framework).toBe('angular');
    expect(c.name).toBe('MatCardComponent');

    const appearance = c.props.find((p) => p.name === 'appearance')!;
    expect(appearance.type).toBe("'outlined' | 'raised' | 'filled'");
    expect(appearance.allowedValues).toEqual(['outlined', 'raised', 'filled']);
    expect(appearance.defaultValue).toBe("'raised'");
    expect(appearance.required).toBe(false);

    const aria = c.props.find((p) => p.name === 'ariaLabel')!;
    expect(aria.required).toBe(true);

    const slotNames = c.slots.map((s) => s.name).sort();
    expect(slotNames).toEqual(['children', 'content', 'title']);
    expect(c.slots.find((s) => s.name === 'children')?.isDefault).toBe(true);
  });
});

describe('extractAngularComponents — inline template + booleanAttribute + alias', () => {
  it('extracts NG-ZORRO-style button with string-literal union + boolean transforms', async () => {
    const tsPath = writeFile(
      'button.component.ts',
      `
      import { Component, Input, booleanAttribute } from '@angular/core';

      @Component({
        selector: 'nz-button',
        template: '<button><ng-content /></button>',
      })
      export class NzButtonComponent {
        @Input('nz-type') type: 'primary' | 'default' | 'dashed' | null = null;
        @Input({ transform: booleanAttribute }) nzDanger = false;
      }
    `,
    );

    const result = await extractAngularComponents([tsPath]);
    expect(result.components).toHaveLength(1);
    const c = result.components[0]!;
    const typeProp = c.props.find((p) => p.name === 'nz-type')!;
    expect(typeProp).toBeDefined();
    expect(typeProp.allowedValues).toEqual(['primary', 'default', 'dashed']);

    const danger = c.props.find((p) => p.name === 'nzDanger')!;
    expect(danger.type).toBe('boolean');
    expect(danger.allowedValues).toBeUndefined();
    expect(danger.defaultValue).toBe('false');

    expect(c.slots).toEqual([{ name: 'children', isDefault: true }]);
  });
});

describe('extractAngularComponents — signal inputs', () => {
  it('extracts Spartan-style component with input() and input.required()', async () => {
    const tsPath = writeFile(
      'hlm-card.ts',
      `
      import { Component, input } from '@angular/core';

      @Component({
        selector: '[hlmCard],hlm-card',
        template: '<ng-content/>',
      })
      export class HlmCard {
        public readonly size = input<'default' | 'compact'>('default');
        public readonly title = input.required<string>({ alias: 'cardTitle' });
      }
    `,
    );

    const result = await extractAngularComponents([tsPath]);
    const c = result.components[0]!;
    expect(c.name).toBe('HlmCard');

    const size = c.props.find((p) => p.name === 'size')!;
    expect(size.allowedValues).toEqual(['default', 'compact']);
    expect(size.defaultValue).toBe("'default'");
    expect(size.required).toBe(false);

    const title = c.props.find((p) => p.name === 'cardTitle')!; // alias wins
    expect(title.required).toBe(true);
    expect(title.defaultValue).toBeUndefined();
  });
});

describe('extractAngularComponents — TemplateRef inputs become slots', () => {
  it('promotes pure TemplateRef inputs to slots and keeps union TemplateRef as both', async () => {
    const tsPath = writeFile(
      'card-with-templates.ts',
      `
      import { Component, Input, TemplateRef } from '@angular/core';

      @Component({
        selector: 'nz-card',
        template: '<ng-content/>',
      })
      export class NzCardComponent {
        @Input() nzTitle?: TemplateRef<void>;
        @Input() nzExtra: string | TemplateRef<void> | null = null;
      }
    `,
    );

    const result = await extractAngularComponents([tsPath]);
    const c = result.components[0]!;
    const propNames = c.props.map((p) => p.name).sort();
    const slotNames = c.slots.map((s) => s.name).sort();

    // nzTitle is pure TemplateRef → slot only, prop removed
    expect(propNames).not.toContain('nzTitle');
    // nzExtra is string | TemplateRef → kept as prop AND emitted as slot
    expect(propNames).toContain('nzExtra');
    expect(slotNames).toContain('nzTitle');
    expect(slotNames).toContain('nzExtra');
  });
});

describe('extractAngularComponents — contentChild queries', () => {
  it('emits a slot per contentChild / contentChildren with allowedComponents', async () => {
    const tsPath = writeFile(
      'card-with-queries.ts',
      `
      import { Component, contentChild, contentChildren } from '@angular/core';

      class HeaderComponent {}
      class ItemComponent {}

      @Component({
        selector: 'app-card',
        template: '<ng-content/>',
      })
      export class AppCard {
        header = contentChild(HeaderComponent);
        items = contentChildren(ItemComponent);
      }
    `,
    );

    const result = await extractAngularComponents([tsPath]);
    // Three classes but only AppCard has @Component
    const c = result.components.find((comp) => comp.name === 'AppCard')!;
    const header = c.slots.find((s) => s.name === 'header')!;
    expect(header.allowedComponents).toEqual(['HeaderComponent']);
    const items = c.slots.find((s) => s.name === 'items')!;
    expect(items.allowedComponents).toEqual(['ItemComponent']);
  });
});

describe('extractAngularComponents — not-a-component files', () => {
  it('skips classes without @Component and files without any', async () => {
    const tsPath = writeFile(
      'service.ts',
      `
      import { Injectable } from '@angular/core';
      @Injectable() export class LoggerService {}
      export class Plain {}
    `,
    );
    const result = await extractAngularComponents([tsPath]);
    expect(result.components).toEqual([]);
  });
});
