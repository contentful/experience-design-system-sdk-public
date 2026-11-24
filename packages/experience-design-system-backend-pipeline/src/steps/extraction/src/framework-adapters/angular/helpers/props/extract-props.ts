import type { ClassDeclaration, Node } from 'ts-morph';
import type { RawPropDefinition } from '../../../../types/component.js';
import type { AngularComponentMetadata } from '../../types/angular-metadata.js';
import type { ExtractedInput } from '../../types/extracted-input.js';
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

export function extractProps(
  cls: ClassDeclaration,
  meta: AngularComponentMetadata,
  warnings: string[],
): RawPropDefinition[] {
  const byName = new Map<string, RawPropDefinition>();
  const chain = collectClassChain(cls);

  const retain = (input: ExtractedInput | null, declaration: Node): void => {
    if (!input || byName.has(input.prop.name)) return;
    byName.set(input.prop.name, input.prop);
    if (input.transform !== undefined) {
      warnings.push(
        `${declaration.getSourceFile().getFilePath()}: input ${input.prop.name} uses unresolved transform ${input.transform}; source type retained.`,
      );
    }
  };

  for (const klass of chain) {
    for (const field of klass.getProperties()) retain(extractDecoratorInput(field), field);
    for (const setter of klass.getSetAccessors()) retain(extractDecoratorInput(setter), setter);
    for (const getter of klass.getGetAccessors()) retain(extractDecoratorInput(getter), getter);
    for (const field of klass.getProperties()) retain(extractSignalInput(field), field);
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
