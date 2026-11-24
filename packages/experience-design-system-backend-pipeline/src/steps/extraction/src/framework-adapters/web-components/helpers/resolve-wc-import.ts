import { Node, SyntaxKind, type ClassDeclaration, type ClassExpression, type Project, type SourceFile } from 'ts-morph';
import { loadSourceFile, resolveImportSourcePath, resolveImportSpecifierSource } from './resolve-wc-import-source.js';

export { loadSourceFile, resolveImportSourcePath };

export function resolveStaticStringExpression(
  node: Node | undefined,
  sourceFile: SourceFile,
  project: Project,
): string | null {
  if (!node) return null;

  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralValue();

  if (Node.isTemplateExpression(node)) {
    let resolved = node.getHead().getLiteralText();
    for (const span of node.getTemplateSpans()) {
      const interpolation = resolveStaticStringExpression(span.getExpression(), sourceFile, project);
      if (!interpolation) return null;
      resolved += interpolation;
      resolved += span.getLiteral().getLiteralText();
    }
    return resolved;
  }

  if (Node.isIdentifier(node)) {
    for (const definition of node.getDefinitions()) {
      const declarationNode = definition.getDeclarationNode();
      if (!declarationNode) continue;
      if (Node.isVariableDeclaration(declarationNode)) {
        const resolved = resolveStaticStringExpression(
          declarationNode.getInitializer(),
          declarationNode.getSourceFile(),
          project,
        );
        if (resolved) return resolved;
      }
      if (Node.isImportSpecifier(declarationNode)) {
        const importedSource = resolveImportSpecifierSource(declarationNode, sourceFile, project);
        if (!importedSource) continue;
        const importedDeclaration = importedSource.sourceFile.getVariableDeclaration(importedSource.importedName);
        if (!importedDeclaration) continue;
        const resolved = resolveStaticStringExpression(
          importedDeclaration.getInitializer(),
          importedSource.sourceFile,
          project,
        );
        if (resolved) return resolved;
      }
    }
    const text = node.getText();
    if (/Prefix$/.test(text)) return camelToKebab(text.replace(/Prefix$/, ''));
    return null;
  }

  if (Node.isPropertyAccessExpression(node)) {
    const target = node.getExpression();
    if (!Node.isIdentifier(target)) return null;
    const propertyName = node.getName();
    for (const definition of target.getDefinitions()) {
      const declarationNode = definition.getDeclarationNode();
      if (!declarationNode) continue;
      if (Node.isClassDeclaration(declarationNode)) {
        const resolved = resolveStaticClassString(declarationNode, propertyName, project);
        if (resolved) return resolved;
        continue;
      }
      let variableDeclaration;
      if (Node.isVariableDeclaration(declarationNode)) {
        variableDeclaration = declarationNode;
      } else if (Node.isImportSpecifier(declarationNode)) {
        const importedSource = resolveImportSpecifierSource(declarationNode, sourceFile, project);
        if (!importedSource) continue;
        variableDeclaration = importedSource.sourceFile.getVariableDeclaration(importedSource.importedName);
      }
      if (!variableDeclaration) continue;
      let objectLiteral = variableDeclaration.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
      const initializer = variableDeclaration.getInitializer();
      if (
        !objectLiteral &&
        initializer &&
        Node.isCallExpression(initializer) &&
        initializer.getExpression().getText() === 'Object.freeze'
      ) {
        objectLiteral = initializer.getArguments()[0]?.asKind(SyntaxKind.ObjectLiteralExpression) ?? undefined;
      }
      const property = objectLiteral
        ?.getProperties()
        .find(
          (prop): prop is import('ts-morph').PropertyAssignment =>
            Node.isPropertyAssignment(prop) && prop.getName() === propertyName,
        );
      if (!property) continue;
      const resolved = resolveStaticStringExpression(
        property.getInitializer(),
        variableDeclaration.getSourceFile(),
        project,
      );
      if (resolved) return resolved;
    }
  }

  return null;
}

export function resolveStaticClassString(
  classNode: ClassDeclaration | ClassExpression,
  memberName: string,
  project: Project,
): string | null {
  const member = classNode.getStaticMember(memberName);
  let value: Node | undefined;
  if (member && Node.isPropertyDeclaration(member)) value = member.getInitializer();
  if (member && Node.isGetAccessorDeclaration(member)) {
    const statements = member.getBody()?.asKind(SyntaxKind.Block)?.getStatements() ?? [];
    const onlyStatement = statements.length === 1 ? statements[0] : undefined;
    if (onlyStatement && Node.isReturnStatement(onlyStatement)) value = onlyStatement.getExpression();
  }
  return resolveStaticStringExpression(value, classNode.getSourceFile(), project);
}

function camelToKebab(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}
