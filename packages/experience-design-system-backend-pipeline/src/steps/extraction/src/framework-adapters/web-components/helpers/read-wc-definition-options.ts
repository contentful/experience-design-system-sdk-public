import { Node, SyntaxKind, type ObjectLiteralExpression } from 'ts-morph';
import { resolveStaticStringExpression } from './resolve-wc-import.js';
import { wcDeclarations, wcKey } from './read-wc-values.js';

export type WcDefinitionOptions = { tagName: string | null; templates: Node[] };

function optionsLiteral(node: Node): ObjectLiteralExpression | undefined {
  if (Node.isObjectLiteralExpression(node)) return node;
  if (!Node.isIdentifier(node)) return undefined;
  for (const declaration of wcDeclarations(node)) {
    const initializer = Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
    if (initializer && Node.isObjectLiteralExpression(initializer)) return initializer;
  }
  return undefined;
}

function optionProperty(options: ObjectLiteralExpression, keys: readonly string[]) {
  for (const property of options.getProperties().reverse()) {
    if (Node.isPropertyAssignment(property) && keys.includes(wcKey(property.getNameNode()) ?? '')) return property;
    if (Node.isShorthandPropertyAssignment(property) && keys.includes(property.getName())) return property;
  }
  return undefined;
}

function shorthandValues(property: Node): Node[] {
  if (!Node.isShorthandPropertyAssignment(property)) return [];
  return (property.getValueSymbol()?.getDeclarations() ?? []).filter(Node.isVariableDeclaration);
}

function resolveTagName(options: ObjectLiteralExpression, nameKeys: readonly string[]): string | null {
  const property = optionProperty(options, nameKeys);
  if (!property) return null;
  const values = Node.isPropertyAssignment(property)
    ? [property.getInitializer()]
    : shorthandValues(property).map((declaration) =>
        declaration.asKind(SyntaxKind.VariableDeclaration)?.getInitializer(),
      );
  for (const value of values) {
    if (!value) continue;
    const resolved = resolveStaticStringExpression(value, value.getSourceFile(), value.getProject());
    if (resolved) return resolved;
  }
  return null;
}

function templateRoots(options: ObjectLiteralExpression): Node[] {
  const property = optionProperty(options, ['template']);
  if (!property) return [];
  if (!Node.isPropertyAssignment(property)) return shorthandValues(property);
  const initializer = property.getInitializer();
  if (initializer && Node.isIdentifier(initializer))
    return wcDeclarations(initializer).filter(Node.isVariableDeclaration);
  return [property];
}

export function readWcDefinitionOptions(node: Node, nameKeys: readonly string[]): WcDefinitionOptions | undefined {
  const options = optionsLiteral(node);
  if (!options) return undefined;
  return { tagName: resolveTagName(options, nameKeys), templates: templateRoots(options) };
}
