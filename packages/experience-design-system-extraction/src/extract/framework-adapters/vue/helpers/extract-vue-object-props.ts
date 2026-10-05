import { Node } from 'ts-morph';
import type { RawPropDefinition } from '../../../types/component.js';

const VUE_TYPE_MAP: Record<string, string> = {
  String: 'string',
  Number: 'number',
  Boolean: 'boolean',
  Array: 'any[]',
  Object: 'object',
  Function: 'function',
  Date: 'Date',
  Symbol: 'symbol',
};

export function isPublicVuePropName(name: string): boolean {
  return !/^[_$]/.test(name);
}

export function parseVueObjectProps(obj: import('ts-morph').ObjectLiteralExpression): RawPropDefinition[] {
  if (!Node.isObjectLiteralExpression(obj)) return [];
  const result: RawPropDefinition[] = [];

  for (const prop of obj.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue;
    const name = prop.getName();
    if (!isPublicVuePropName(name)) continue;
    const init = prop.getInitializer();

    if (!init || !Node.isObjectLiteralExpression(init)) {
      result.push({
        name,
        type: VUE_TYPE_MAP[init?.getText() ?? ''] ?? 'any',
        required: false,
        sourceStartLine: prop.getStartLineNumber(),
        sourceEndLine: prop.getEndLineNumber(),
      });
      continue;
    }

    const typeProp = init.getProperty('type');
    const requiredProp = init.getProperty('required');
    const defaultProp = init.getProperty('default');

    let type = 'any';
    if (typeProp && Node.isPropertyAssignment(typeProp)) {
      const typeInit = typeProp.getInitializer();
      if (typeInit) type = VUE_TYPE_MAP[typeInit.getText()] ?? 'any';
    }

    let required = false;
    if (requiredProp && Node.isPropertyAssignment(requiredProp)) {
      const reqInit = requiredProp.getInitializer();
      if (reqInit) required = reqInit.getText() === 'true';
    }

    let defaultValue: string | undefined;
    if (defaultProp && Node.isPropertyAssignment(defaultProp)) {
      const defInit = defaultProp.getInitializer();
      if (defInit) defaultValue = defInit.getText().replace(/^['"]|['"]$/g, '');
    }

    result.push({
      name,
      type,
      required,
      ...(defaultValue !== undefined && { defaultValue }),
      sourceStartLine: prop.getStartLineNumber(),
      sourceEndLine: prop.getEndLineNumber(),
    });
  }

  return result;
}
