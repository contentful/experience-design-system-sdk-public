import type { ClassDeclaration } from 'ts-morph';
import type { RawPropDefinition } from '../../../../types/component.js';
import type { AngularComponentMetadata } from '../../types/angular-metadata.js';
import { extractDecoratorInput } from './extract-decorator-input.js';
import { extractSignalInput } from './extract-signal-input.js';
import { parseInputsArrayEntry } from './parse-inputs-array-entry.js';

const MAX_BASE_CHAIN = 10;

function collectClassChain(cls: ClassDeclaration): ClassDeclaration[] {
  const chain: ClassDeclaration[] = [cls];
  const seen = new Set<ClassDeclaration>([cls]);
  let current = cls;
  for (let i = 0; i < MAX_BASE_CHAIN; i++) {
    let base: ClassDeclaration | undefined;
    try {
      base = current.getBaseClass();
    } catch {
      break;
    }
    if (!base || seen.has(base)) break;
    chain.push(base);
    seen.add(base);
    current = base;
  }
  return chain;
}

export function extractProps(cls: ClassDeclaration, meta: AngularComponentMetadata): RawPropDefinition[] {
  const byName = new Map<string, RawPropDefinition>();
  const chain = collectClassChain(cls);

  for (const klass of chain) {
    for (const field of klass.getProperties()) {
      const prop = extractDecoratorInput(field);
      if (prop && !byName.has(prop.name)) byName.set(prop.name, prop);
    }
    for (const setter of klass.getSetAccessors()) {
      const prop = extractDecoratorInput(setter);
      if (prop && !byName.has(prop.name)) byName.set(prop.name, prop);
    }
    for (const getter of klass.getGetAccessors()) {
      const prop = extractDecoratorInput(getter);
      if (prop && !byName.has(prop.name)) byName.set(prop.name, prop);
    }
    for (const field of klass.getProperties()) {
      const prop = extractSignalInput(field);
      if (prop && !byName.has(prop.name)) byName.set(prop.name, prop);
    }
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
