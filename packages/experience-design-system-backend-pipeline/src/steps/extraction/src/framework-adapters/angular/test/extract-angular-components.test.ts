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

describe('extractAngularComponents — @Input setter accessor form', () => {
  it('extracts @Input on a setter and reads the parameter type', async () => {
    const tsPath = writeFile(
      'checkbox.ts',
      `
      import { Component, Input } from '@angular/core';

      @Component({ selector: 'app-checkbox', template: '' })
      export class AppCheckbox {
        private _disabled = false;
        @Input() set disabled(value: boolean) { this._disabled = value; }
        get disabled(): boolean { return this._disabled; }
      }
    `,
    );

    const result = await extractAngularComponents([tsPath]);
    const c = result.components[0]!;
    const disabled = c.props.find((p) => p.name === 'disabled')!;
    expect(disabled).toBeDefined();
    expect(disabled.type).toBe('boolean');
    expect(disabled.required).toBe(false);
  });
});

describe('extractAngularComponents — @Input getter accessor form', () => {
  it('extracts @Input on a getter accessor (Material-style aliased getter)', async () => {
    // Mirrors Angular Material's MatButton pattern:
    //   @Input('matButton') get appearance(): ButtonAppearance { return this._appearance; }
    //   set appearance(value) { ... }
    const tsPath = writeFile(
      'button.ts',
      `
      import { Component, Input } from '@angular/core';

      @Component({ selector: 'mat-button', template: '' })
      export class MatButton {
        private _appearance: 'text' | 'filled' | 'outlined' = 'text';
        @Input('matButton') get appearance(): 'text' | 'filled' | 'outlined' { return this._appearance; }
        set appearance(value: 'text' | 'filled' | 'outlined') { this._appearance = value; }
      }
    `,
    );

    const result = await extractAngularComponents([tsPath]);
    const c = result.components[0]!;
    // Alias wins — prop name is 'matButton', not 'appearance'
    const appearance = c.props.find((p) => p.name === 'matButton')!;
    expect(appearance).toBeDefined();
    expect(appearance.type).toBe("'text' | 'filled' | 'outlined'");
    expect(appearance.allowedValues).toEqual(['text', 'filled', 'outlined']);
    expect(appearance.required).toBe(false);
  });

  it('dedups when both @Input get and @Input set exist for the same prop', async () => {
    // Angular treats @Input on either accessor as declaring the same input.
    // The extractor should emit the prop exactly once.
    const tsPath = writeFile(
      'select.ts',
      `
      import { Component, Input } from '@angular/core';

      @Component({ selector: 'mat-select', template: '' })
      export class MatSelect {
        private _value: string | null = null;
        @Input() get value(): string | null { return this._value; }
        set value(v: string | null) { this._value = v; }
      }
    `,
    );

    const result = await extractAngularComponents([tsPath]);
    const c = result.components[0]!;
    const matches = c.props.filter((p) => p.name === 'value');
    expect(matches).toHaveLength(1);
  });
});

describe('extractAngularComponents — legacy inputs: array form', () => {
  it('extracts props declared via @Component({ inputs: [...] })', async () => {
    const tsPath = writeFile(
      'legacy.ts',
      `
      import { Component } from '@angular/core';

      @Component({
        selector: 'app-legacy',
        template: '',
        inputs: ['color', 'size: aliasedSize']
      })
      export class LegacyComponent {}
    `,
    );

    const result = await extractAngularComponents([tsPath]);
    const c = result.components[0]!;
    const propNames = c.props.map((p) => p.name).sort();
    expect(propNames).toContain('color');
    expect(propNames).toContain('aliasedSize'); // alias wins over field name
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
