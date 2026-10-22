import { Node, type ClassDeclaration } from 'ts-morph';
import type { RawPropDefinition } from '../../../types/component.js';

export function extractObservedAttributes(classDecl: ClassDeclaration): RawPropDefinition[] {
  const props: RawPropDefinition[] = [];

  const getter = classDecl.getGetAccessor('observedAttributes');
  if (!getter || !getter.isStatic()) return props;

  const body = getter.getBody();
  if (!body) return props;

  body.forEachDescendant((node) => {
    if (!Node.isReturnStatement(node)) return;

    const expression = node.getExpression();
    if (!expression || !Node.isArrayLiteralExpression(expression)) return;

    for (const element of expression.getElements()) {
      if (Node.isStringLiteral(element)) {
        props.push({
          name: element.getLiteralValue(),
          type: 'string',
          required: false,
        });
      }
    }
  });

  return props;
}
