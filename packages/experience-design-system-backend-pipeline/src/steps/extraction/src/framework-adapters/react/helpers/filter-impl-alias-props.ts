import { Node } from 'ts-morph';
import type { RawPropDefinition } from '../../../types/component.js';
import type { FunctionLike } from './resolve-component-function.js';

export function isImplementationOnlyAliasProp(func: FunctionLike, propName: string): boolean {
  if (!propName.startsWith('_')) return false;

  const allowedJsxAttributes = new Set([
    'id',
    'htmlFor',
    'aria-activedescendant',
    'aria-controls',
    'aria-describedby',
    'aria-labelledby',
    'aria-owns',
  ]);

  let sawRuntimeUsage = false;

  for (const node of func.getDescendants()) {
    if (!Node.isIdentifier(node) || node.getText() !== propName) continue;

    const bindingElement = node.getFirstAncestor((ancestor) => Node.isBindingElement(ancestor));
    if (bindingElement?.getNameNode() === node) continue;

    const jsxAttribute = node.getFirstAncestor((ancestor) => Node.isJsxAttribute(ancestor));
    if (jsxAttribute) {
      const attributeName = jsxAttribute.getNameNode().getText();
      if (allowedJsxAttributes.has(attributeName)) {
        sawRuntimeUsage = true;
        continue;
      }
      return false;
    }

    const propertyAssignment = node.getFirstAncestor((ancestor) => Node.isPropertyAssignment(ancestor));
    if (propertyAssignment) {
      const propertyName = propertyAssignment.getName();
      if (propertyName === propName) {
        sawRuntimeUsage = true;
        continue;
      }
      return false;
    }

    return false;
  }

  return sawRuntimeUsage;
}

export function filterImplementationOnlyAliasProps(
  props: RawPropDefinition[],
  func: FunctionLike,
): RawPropDefinition[] {
  const publicPropNames = new Set(props.filter((prop) => !prop.name.startsWith('_')).map((prop) => prop.name));

  return props.filter((prop) => {
    if (/^__scope[A-Z]/.test(prop.name)) return false;
    if (prop.name.startsWith('_') && publicPropNames.has(prop.name.slice(1))) return false;
    return !isImplementationOnlyAliasProp(func, prop.name);
  });
}
