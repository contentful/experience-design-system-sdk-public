import { basename } from 'node:path';
import { Node, SyntaxKind, type ClassDeclaration, type Project, type SourceFile } from 'ts-morph';
import { kebabToPascal } from '../../support/tsx-shared.js';
import { resolveStaticStringExpression, loadSourceFile } from './resolve-wc-import.js';

function normalizeComponentName(input: string): string {
  return input.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

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
        if (initializer && Node.isStringLiteral(initializer)) {
          return initializer.getLiteralValue();
        }
      }
    }

    const text = node.getText();
    if (/Prefix$/.test(text)) {
      return camelToKebab(text.replace(/Prefix$/, ''));
    }
  }

  return null;
}

function resolveDecoratorTagArgument(node: Node): string | null {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralValue();
  }

  if (!Node.isTemplateExpression(node)) {
    return null;
  }

  let resolved = node.getHead().getLiteralText();
  for (const span of node.getTemplateSpans()) {
    const interpolation = resolveDecoratorInterpolation(span.getExpression());
    if (!interpolation) {
      return null;
    }

    resolved += interpolation;
    resolved += span.getLiteral().getLiteralText();
  }

  return resolved;
}

function shouldPreferTagName(className: string, tagName: string): boolean {
  const pascalTagName = kebabToPascal(tagName);

  if (className.startsWith('HTML') && className.endsWith('Element')) return true;
  if (className.endsWith('Element')) return true;
  if (normalizeComponentName(className) === normalizeComponentName(pascalTagName)) return false;

  return false;
}

function getFileDerivedComponentName(sourceFile: SourceFile): string {
  const baseName = basename(sourceFile.getFilePath())
    .replace(/\.[^.]+$/, '')
    .replace(/\.component$/, '');
  return kebabToPascal(baseName);
}

export function chooseComponentName(classDecl: ClassDeclaration, className: string, tagName: string | undefined): string {
  if (!tagName) return className;

  const tagDerivedName = kebabToPascal(tagName);
  const fileDerivedName = getFileDerivedComponentName(classDecl.getSourceFile());

  if (normalizeComponentName(className) === normalizeComponentName(tagDerivedName)) {
    return className;
  }

  if (normalizeComponentName(className) === normalizeComponentName(fileDerivedName)) {
    return className;
  }

  if (fileDerivedName && tagDerivedName.endsWith(fileDerivedName)) {
    return fileDerivedName;
  }

  if (shouldPreferTagName(className, tagName)) {
    return tagDerivedName;
  }

  return className;
}

export function getElementTagNameFromJsDoc(classDecl: ClassDeclaration): string | null {
  for (const doc of classDecl.getJsDocs()) {
    for (const tag of doc.getTags()) {
      if (tag.getTagName() !== 'element') continue;
      const comment = tag.getCommentText();
      if (comment) {
        return comment.trim();
      }
    }
  }
  return null;
}

export function getElementTagNameFromDecorator(classDecl: ClassDeclaration): string | null {
  for (const decorator of classDecl.getDecorators()) {
    if (decorator.getName() !== 'customElement') continue;

    const firstArg = decorator.getArguments()[0];
    if (!firstArg) continue;

    const resolved = resolveDecoratorTagArgument(firstArg);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

export function getElementTagNameFromSiblingDefine(classDecl: ClassDeclaration, project: Project): string | null {
  const sourceFilePath = classDecl.getSourceFile().getFilePath();
  if (!sourceFilePath.endsWith('.component.ts')) {
    return null;
  }

  const siblingPath = `${sourceFilePath.slice(0, -'.component.ts'.length)}.ts`;
  let siblingFile = project.getSourceFile(siblingPath);
  if (!siblingFile) {
    try {
      siblingFile = project.addSourceFileAtPath(siblingPath);
    } catch {
      return null;
    }
  }

  const className = classDecl.getName();
  if (!className) return null;

  for (const node of siblingFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = node.getExpression();
    if (!Node.isPropertyAccessExpression(expression)) continue;
    if (expression.getName() !== 'define') continue;
    if (expression.getExpression().getText() !== className) continue;

    const tagArg = node.getArguments()[0];
    if (!tagArg || !Node.isStringLiteral(tagArg)) continue;
    return tagArg.getLiteralValue();
  }

  return null;
}

export function getElementTagNameFromFastDefinition(classDecl: ClassDeclaration, project: Project): string | null {
  const sourceFilePath = classDecl.getSourceFile().getFilePath();
  if (!sourceFilePath.endsWith('.ts') || sourceFilePath.endsWith('.definition.ts')) {
    return null;
  }

  const definitionPath = `${sourceFilePath.slice(0, -'.ts'.length)}.definition.ts`;
  const definitionFile = loadSourceFile(project, definitionPath);
  if (!definitionFile) {
    return null;
  }

  for (const callExpr of definitionFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = callExpr.getExpression();
    if (!Node.isPropertyAccessExpression(expression)) continue;
    if (expression.getName() !== 'compose') continue;

    const options = callExpr.getArguments()[0];
    if (!options || !Node.isObjectLiteralExpression(options)) continue;

    const nameProperty = options
      .getProperties()
      .find(
        (prop): prop is import('ts-morph').PropertyAssignment =>
          Node.isPropertyAssignment(prop) && (prop.getName() === 'name' || prop.getName() === 'baseName'),
      );
    if (!nameProperty) continue;

    const resolved = resolveStaticStringExpression(nameProperty.getInitializer(), definitionFile, project);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

export function buildTagNameMap(sourceFile: SourceFile): Map<string, string> {
  const tagNameMap = new Map<string, string>();

  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;

    const expr = node.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return;
    if (expr.getName() !== 'define') return;

    const obj = expr.getExpression();
    if (obj.getText() !== 'customElements') return;

    const args = node.getArguments();
    if (args.length < 2) return;

    const tagArg = args[0];
    const classArg = args[1];

    if (!Node.isStringLiteral(tagArg)) return;

    const tagName = tagArg.getLiteralValue();
    const className = classArg.getText();
    tagNameMap.set(className, tagName);
  });

  return tagNameMap;
}

export function resolveWcTagName(
  classDecl: ClassDeclaration,
  tagNameMap: Map<string, string>,
  project: Project,
): string | undefined {
  const className = classDecl.getName();
  if (!className) return undefined;

  return (
    tagNameMap.get(className) ??
    getElementTagNameFromSiblingDefine(classDecl, project) ??
    getElementTagNameFromDecorator(classDecl) ??
    getElementTagNameFromJsDoc(classDecl) ??
    getElementTagNameFromFastDefinition(classDecl, project) ??
    undefined
  );
}
