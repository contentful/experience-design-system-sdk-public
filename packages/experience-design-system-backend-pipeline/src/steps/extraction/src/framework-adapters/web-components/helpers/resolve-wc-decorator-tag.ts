import { type ClassDeclaration } from 'ts-morph';
import { readWcDefinitionOptions, type WcDefinitionOptions } from './read-wc-definition-options.js';
import { resolveStaticStringExpression } from './resolve-wc-import.js';

function customElementArguments(classDecl: ClassDeclaration) {
  return classDecl
    .getDecorators()
    .filter((decorator) => decorator.getName() === 'customElement')
    .flatMap((decorator) => decorator.getArguments().slice(0, 1));
}

export function getElementTagNameFromDecorator(classDecl: ClassDeclaration): string | null {
  for (const argument of customElementArguments(classDecl)) {
    const resolved =
      readWcDefinitionOptions(argument, ['name'])?.tagName ??
      resolveStaticStringExpression(argument, classDecl.getSourceFile(), classDecl.getProject());
    if (resolved) return resolved;
  }
  return null;
}

export function readDecoratorDefinitionOptions(classDecl: ClassDeclaration): WcDefinitionOptions[] {
  return customElementArguments(classDecl).flatMap((argument) => readWcDefinitionOptions(argument, ['name']) ?? []);
}
