import type { ClassDeclaration } from 'ts-morph';
import type { RawPropDefinition } from '../../../../types/component.js';
import type { AngularComponentMetadata } from '../../types/angular-metadata.js';
import { extractDecoratorInput } from './extract-decorator-input.js';
import { extractSignalInput } from './extract-signal-input.js';
import { parseInputsArrayEntry } from './parse-inputs-array-entry.js';

export function extractProps(cls: ClassDeclaration, meta: AngularComponentMetadata): RawPropDefinition[] {
  const byName = new Map<string, RawPropDefinition>();

  for (const field of cls.getProperties()) {
    const prop = extractDecoratorInput(field);
    if (prop && !byName.has(prop.name)) byName.set(prop.name, prop);
  }
  for (const setter of cls.getSetAccessors()) {
    const prop = extractDecoratorInput(setter);
    if (prop && !byName.has(prop.name)) byName.set(prop.name, prop);
  }
  for (const getter of cls.getGetAccessors()) {
    const prop = extractDecoratorInput(getter);
    if (prop && !byName.has(prop.name)) byName.set(prop.name, prop);
  }

  for (const field of cls.getProperties()) {
    const prop = extractSignalInput(field);
    if (prop && !byName.has(prop.name)) byName.set(prop.name, prop);
  }

  for (const entry of meta.inputsArray) {
    const parsed = parseInputsArrayEntry(entry);
    if (!parsed) continue;
    const name = parsed.alias ?? parsed.fieldName;
    if (byName.has(name)) continue;
    byName.set(name, { name, type: 'any', required: false });
  }

  return [...byName.values()];
}
