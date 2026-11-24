import { Node, SyntaxKind, type CallExpression, type SourceFile } from 'ts-morph';
import type { WebComponentClass } from './read-wc-syntax.js';
import { readWcDefinitionOptions } from './read-wc-definition-options.js';
import { resolveStaticClassString, resolveStaticStringExpression } from './resolve-wc-import.js';
import { wcDeclarations } from './read-wc-values.js';

export type WcRegistration = { tagName: string; templates: Node[] };
export type WcRegistrations = ReadonlyMap<WebComponentClass, WcRegistration>;
type Registration = { target: WebComponentClass; tagName: string | null; templates: Node[] };

function classFrom(declaration: Node | undefined): WebComponentClass | undefined {
  if (!declaration) return undefined;
  if (Node.isClassDeclaration(declaration)) return declaration;
  const initializer = Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
  return initializer && Node.isClassExpression(initializer) ? initializer : undefined;
}

function registeredClass(node: Node | undefined): WebComponentClass | undefined {
  if (!node) return undefined;
  if (Node.isClassExpression(node)) return node;
  if (!Node.isIdentifier(node)) return undefined;
  const sourceFile = node.getSourceFile();
  const name = node.getText();
  return (
    classFrom(sourceFile.getClass(name)) ??
    classFrom(sourceFile.getVariableDeclaration(name)) ??
    wcDeclarations(node).map(classFrom).find(Boolean)
  );
}

function derivedClass(node: Node | undefined): WebComponentClass | undefined {
  const target = registeredClass(node);
  return target?.getExtends() ? target : undefined;
}

function staticString(node: Node | undefined): string | null {
  return node ? resolveStaticStringExpression(node, node.getSourceFile(), node.getProject()) : null;
}

function definition(target: WebComponentClass, argument: Node | undefined, nameKeys: readonly string[]) {
  const options = argument ? readWcDefinitionOptions(argument, nameKeys) : undefined;
  if (options) return { target, ...options };
  return { target, tagName: staticString(argument), templates: [] };
}

function readRegistration(call: CallExpression): Registration | undefined {
  const callee = call.getExpression();
  const [first, second] = call.getArguments();
  if (Node.isIdentifier(callee)) {
    if (callee.getText() === 'defineElement') {
      const target = registeredClass(second);
      return target && { target, tagName: staticString(first), templates: [] };
    }
    if (callee.getText() === 'defineCustomElement') {
      const target = registeredClass(first);
      return target && { target, tagName: resolveStaticClassString(target, 'is', call.getProject()), templates: [] };
    }
    return undefined;
  }
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  if (callee.getName() === 'compose') {
    const owner = derivedClass(callee.getExpression());
    return owner && definition(owner, first, ['baseName', 'name']);
  }
  if (callee.getName() !== 'define') return undefined;
  const registered = registeredClass(second);
  if (registered) return { target: registered, tagName: staticString(first), templates: [] };
  const fastTarget = derivedClass(first);
  if (fastTarget) return definition(fastTarget, second, ['name']);
  const owner = derivedClass(callee.getExpression());
  if (!owner || call.getArguments().length !== 1) return undefined;
  const registration = definition(owner, first, ['name']);
  if (!Node.isObjectLiteralExpression(first) && !registration.tagName?.includes('-')) return undefined;
  return registration;
}

export function collectWcRegistrations(sourceFiles: readonly SourceFile[]): WcRegistrations {
  const registrations = new Map<WebComponentClass, WcRegistration>();
  for (const sourceFile of sourceFiles)
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const registration = readRegistration(call);
      if (registration?.tagName)
        registrations.set(registration.target, { tagName: registration.tagName, templates: registration.templates });
    }
  return registrations;
}
