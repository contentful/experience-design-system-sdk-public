import type { ClassDeclaration } from 'ts-morph';
import type { RawPropDefinition } from '../../../../types/component.js';
import type { AngularComponentMetadata } from '../types/angular-metadata.js';
import { extractDecoratorInput } from './extract-decorator-input.js';
import { extractSignalInput } from './extract-signal-input.js';
import { parseInputsArrayEntry } from './parse-inputs-array-entry.js';

/**
 * Walk every field on the class and extract props from any of three sources:
 *   1. `@Input()` decorator (classic form, incl. setter form, incl. `{alias,required,transform}`)
 *   2. `input()` / `input.required()` signal initializers
 *   3. `@Component({ inputs: ['foo: alias'] })` legacy array form
 *
 * Dedup rule: later sources don't override earlier ones. In practice no real DS
 * mixes forms on the same prop — but if it ever happens, decorator wins over
 * signal wins over inputs-array.
 */
export function extractProps(cls: ClassDeclaration, meta: AngularComponentMetadata): RawPropDefinition[] {
  const byName = new Map<string, RawPropDefinition>();

  // 1. Decorator inputs (including setter form)
  for (const field of cls.getProperties()) {
    const prop = extractDecoratorInput(field);
    if (prop && !byName.has(prop.name)) byName.set(prop.name, prop);
  }
  for (const setter of cls.getSetAccessors()) {
    const prop = extractDecoratorInput(setter);
    if (prop && !byName.has(prop.name)) byName.set(prop.name, prop);
  }

  // 2. Signal inputs on class fields
  for (const field of cls.getProperties()) {
    const prop = extractSignalInput(field);
    if (prop && !byName.has(prop.name)) byName.set(prop.name, prop);
  }

  // 3. inputs: [...] array on the component decorator (string-only; no type info)
  for (const entry of meta.inputsArray) {
    const parsed = parseInputsArrayEntry(entry);
    if (!parsed) continue;
    const name = parsed.alias ?? parsed.fieldName;
    if (byName.has(name)) continue;
    byName.set(name, { name, type: 'any', required: false });
  }

  return [...byName.values()];
}
