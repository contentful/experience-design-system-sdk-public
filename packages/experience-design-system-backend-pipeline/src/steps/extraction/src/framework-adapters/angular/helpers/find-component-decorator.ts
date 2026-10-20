import { Node, type ClassDeclaration, type ObjectLiteralExpression } from 'ts-morph';

export function findComponentDecorator(cls: ClassDeclaration): ObjectLiteralExpression | null {
  const decorator = cls.getDecorator('Component');
  if (!decorator) return null;
  const [arg] = decorator.getArguments();
  if (!arg || !Node.isObjectLiteralExpression(arg)) return null;
  return arg;
}

export function hasComponentDecorator(cls: ClassDeclaration): boolean {
  return cls.getDecorator('Component') !== undefined;
}
