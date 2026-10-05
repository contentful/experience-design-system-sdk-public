import { dirname, join, resolve } from 'node:path';
import { Node, SyntaxKind, type Project, type SourceFile } from 'ts-morph';

export function loadSourceFile(project: Project, filePath: string): SourceFile | null {
  let sourceFile = project.getSourceFile(filePath);
  if (sourceFile) return sourceFile;

  try {
    sourceFile = project.addSourceFileAtPath(filePath);
    return sourceFile;
  } catch {
    return null;
  }
}

export function resolveImportSourcePath(fromFilePath: string, specifier: string): string | null {
  if (specifier.startsWith('.')) {
    const resolvedPath = resolve(dirname(fromFilePath), specifier);
    if (resolvedPath.endsWith('.js')) {
      return `${resolvedPath.slice(0, -3)}.ts`;
    }
    return resolvedPath;
  }

  const spectrumPrefix = '@spectrum-web-components/core/components/';
  if (!specifier.startsWith(spectrumPrefix)) {
    return null;
  }

  const packagesMarker = `${join('2nd-gen', 'packages')}${fromFilePath.includes('\\') ? '\\' : '/'}`;
  const markerIndex = fromFilePath.lastIndexOf(packagesMarker);
  if (markerIndex === -1) {
    return null;
  }

  const packagesRoot = fromFilePath.slice(0, markerIndex + packagesMarker.length - 1);
  const componentPath = specifier.slice(spectrumPrefix.length);
  return join(packagesRoot, 'core', 'components', componentPath, 'index.ts');
}

export function resolveImportSpecifierSource(
  declarationNode: Node,
  sourceFile: SourceFile,
  project: Project,
): { sourceFile: SourceFile; importedName: string } | undefined {
  if (!Node.isImportSpecifier(declarationNode)) return undefined;

  const importDecl = declarationNode.getImportDeclaration();
  const resolvedImportPath = resolveImportSourcePath(sourceFile.getFilePath(), importDecl.getModuleSpecifierValue());
  if (!resolvedImportPath) return undefined;

  const importedFile = loadSourceFile(project, resolvedImportPath);
  if (!importedFile) return undefined;

  return {
    sourceFile: importedFile,
    importedName: declarationNode.getNameNode().getText(),
  };
}

export function resolveStaticStringExpression(
  node: Node | undefined,
  sourceFile: SourceFile,
  project: Project,
): string | null {
  if (!node) return null;

  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralValue();
  }

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
    if (/Prefix$/.test(text)) {
      return camelToKebab(text.replace(/Prefix$/, ''));
    }

    return null;
  }

  if (Node.isPropertyAccessExpression(node)) {
    const target = node.getExpression();
    if (!Node.isIdentifier(target)) return null;

    const propertyName = node.getName();
    for (const definition of target.getDefinitions()) {
      const declarationNode = definition.getDeclarationNode();
      if (!declarationNode) continue;

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

function camelToKebab(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}
