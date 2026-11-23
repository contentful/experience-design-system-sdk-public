import { Node, type ClassDeclaration } from 'ts-morph';

function camelToKebab(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

function resolveDecoratorInterpolation(node: Node): string | null {
  if (Node.isIdentifier(node)) {
    const definitions = node.getDefinitions();
    for (const definition of definitions) {
      const declarationNode = definition.getDeclarationNode();
      if (!declarationNode) continue;
      if (Node.isVariableDeclaration(declarationNode)) {
        const initializer = declarationNode.getInitializer();
        if (initializer && Node.isStringLiteral(initializer)) return initializer.getLiteralValue();
      }
    }
    const text = node.getText();
    if (/Prefix$/.test(text)) return camelToKebab(text.replace(/Prefix$/, ''));
  }
  return null;
}

function resolveDecoratorTagArgument(node: Node): string | null {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralValue();
  if (!Node.isTemplateExpression(node)) return null;

  let resolved = node.getHead().getLiteralText();
  for (const span of node.getTemplateSpans()) {
    const interpolation = resolveDecoratorInterpolation(span.getExpression());
    if (!interpolation) return null;
    resolved += interpolation;
    resolved += span.getLiteral().getLiteralText();
  }
  return resolved;
}

export function getElementTagNameFromDecorator(classDecl: ClassDeclaration): string | null {
  for (const decorator of classDecl.getDecorators()) {
    if (decorator.getName() !== 'customElement') continue;
    const firstArg = decorator.getArguments()[0];
    if (!firstArg) continue;
    const resolved = resolveDecoratorTagArgument(firstArg);
    if (resolved) return resolved;
  }
  return null;
}
