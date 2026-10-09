import { Node, type ClassDeclaration, type ObjectLiteralExpression } from 'ts-morph';

/**
 * Return the `ObjectLiteralExpression` argument of `@Component({...})` on the
 * class, or `null` when there is no decorator or the arg isn't an object literal.
 *
 * Only accepts decorators whose expression name is `Component`. The adapter's
 * fileFilter already filtered to files that import from `@angular/core`.
 */
export function findComponentDecorator(cls: ClassDeclaration): ObjectLiteralExpression | null {
  const decorator = cls.getDecorator('Component');
  if (!decorator) return null;
  const [arg] = decorator.getArguments();
  if (!arg || !Node.isObjectLiteralExpression(arg)) return null;
  return arg;
}

/** True when a class has a `@Component` decorator (regardless of arg shape). */
export function hasComponentDecorator(cls: ClassDeclaration): boolean {
  return cls.getDecorator('Component') !== undefined;
}
