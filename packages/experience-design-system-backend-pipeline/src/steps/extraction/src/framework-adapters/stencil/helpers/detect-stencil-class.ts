import { Node, type SourceFile, type ClassDeclaration } from 'ts-morph';

export function isStencilFile(sourceFile: SourceFile): boolean {
  return sourceFile.getImportDeclarations().some((imp) => imp.getModuleSpecifierValue() === '@stencil/core');
}

export function readComponentTag(classDecl: ClassDeclaration): string | undefined {
  for (const decorator of classDecl.getDecorators()) {
    if (decorator.getName() !== 'Component') continue;

    const args = decorator.getArguments();
    if (args.length === 0) continue;

    const arg = args[0];
    if (!Node.isObjectLiteralExpression(arg)) continue;

    const tagProp = arg.getProperty('tag');
    if (!tagProp || !Node.isPropertyAssignment(tagProp)) continue;

    const initializer = tagProp.getInitializer();
    if (!initializer || !Node.isStringLiteral(initializer)) continue;

    return initializer.getLiteralValue();
  }

  return undefined;
}

export function hasPropertyDecorator(node: Node, decoratorName: string): boolean {
  if (!Node.isPropertyDeclaration(node)) return false;
  return node.getDecorators().some((d) => d.getName() === decoratorName);
}
