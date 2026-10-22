import { Node, type ClassDeclaration, type Expression, type ObjectLiteralExpression } from 'ts-morph';

function resolveToObjectLiteral(expr: Expression | undefined, depth = 0): ObjectLiteralExpression | null {
  if (!expr || depth > 3) return null;
  if (Node.isObjectLiteralExpression(expr)) return expr;
  if (Node.isIdentifier(expr)) {
    const defs = expr.getDefinitions();
    for (const def of defs) {
      const node = def.getDeclarationNode();
      if (node && Node.isVariableDeclaration(node)) {
        const init = node.getInitializer();
        const resolved = resolveToObjectLiteral(init, depth + 1);
        if (resolved) return resolved;
      }
    }
  }
  return null;
}

export function findComponentDecorator(cls: ClassDeclaration): ObjectLiteralExpression | null {
  const decorator = cls.getDecorator('Component');
  if (!decorator) return null;
  const [arg] = decorator.getArguments();
  return resolveToObjectLiteral(arg as Expression | undefined);
}

export function hasComponentDecorator(cls: ClassDeclaration): boolean {
  return cls.getDecorator('Component') !== undefined;
}
