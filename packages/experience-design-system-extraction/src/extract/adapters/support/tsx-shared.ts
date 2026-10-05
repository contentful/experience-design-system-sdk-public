import { Node, Project, SyntaxKind, type SourceFile, type Type } from 'ts-morph';
import type { ExtractionExclusion } from '../../model/component.js';
import { resolveWorkspaceImportSpecifierDeclarations } from './helpers/resolve-tsx-workspace-imports.js';

function createTsxProject(filePaths: string[]): Project {
  const project = new Project({
    compilerOptions: {
      jsx: 1,
      target: 99,
      module: 99,
      moduleResolution: 100,
      skipLibCheck: true,
      allowJs: true,
    },
    skipAddingFilesFromTsConfig: true,
  });

  for (const filePath of filePaths) {
    project.addSourceFileAtPath(filePath);
  }

  return project;
}

function getTsxProjectFiles(filePaths: string[]): string[] {
  return filePaths.filter((filePath) => /\.[jt]sx?$/.test(filePath) && !filePath.endsWith('.d.ts'));
}

export function getTsxExtractionContext(
  filePaths: string[],
  componentFilePattern: RegExp,
): { componentFiles: string[]; project: Project } | undefined {
  const componentFiles = filePaths.filter((filePath) => componentFilePattern.test(filePath));
  if (componentFiles.length === 0) return undefined;

  return {
    componentFiles,
    project: createTsxProject(getTsxProjectFiles(filePaths)),
  };
}

export function extractTsxComponents<T>(
  filePaths: string[],
  componentFilePattern: RegExp,
  extract: (sourceFile: SourceFile, exclusions: ExtractionExclusion[]) => T[],
): { components: T[]; warnings: string[]; exclusions: ExtractionExclusion[]; project?: Project } {
  const extractionContext = getTsxExtractionContext(filePaths, componentFilePattern);
  if (!extractionContext) {
    return { components: [], warnings: [], exclusions: [] };
  }

  const { componentFiles, project } = extractionContext;
  const components: T[] = [];
  const warnings: string[] = [];
  const exclusions: ExtractionExclusion[] = [];

  for (const filePath of componentFiles) {
    try {
      const sourceFile = project.getSourceFile(filePath);
      if (!sourceFile) continue;
      components.push(...extract(sourceFile, exclusions));
    } catch (e) {
      warnings.push(`Failed to extract from ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { components, warnings, exclusions, project };
}

export function resolveDefaultExportName(
  declarations: Node[],
  exported: { has(name: string): boolean },
  allowVariableDeclaration = false,
): string | undefined {
  const declaration = declarations[0];
  const name = Node.isFunctionDeclaration(declaration)
    ? declaration.getName()
    : allowVariableDeclaration && Node.isVariableDeclaration(declaration)
      ? declaration.getName()
      : undefined;

  if (!name || !/^[A-Z]/.test(name) || exported.has(name)) return undefined;
  return name;
}

export function getRenderableExports(
  sourceFile: SourceFile,
  exclusions: ExtractionExclusion[],
  options: { allowVariableDeclaration?: boolean; hookReason: string },
): Array<{ name: string; declarations: Node[] }> {
  const renderable: Array<{ name: string; declarations: Node[] }> = [];
  const exported = sourceFile.getExportedDeclarations();

  for (const [exportKey, declarations] of exported) {
    const name =
      exportKey === 'default'
        ? resolveDefaultExportName(declarations, exported, options.allowVariableDeclaration)
        : exportKey;
    if (!name || !/^[A-Z]/.test(name)) continue;
    if (name.startsWith('use')) {
      exclusions.push({
        itemType: 'component',
        name,
        source: sourceFile.getFilePath(),
        reason: options.hookReason,
        stage: 'component-filter',
      });
      continue;
    }
    renderable.push({ name, declarations });
  }

  return renderable;
}

export function kebabToPascal(input: string): string {
  return input
    .split('-')
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

export function extractAllowedValues(type: Type): string[] | undefined {
  if (!type.isUnion()) return undefined;

  const literals = type
    .getUnionTypes()
    .filter((t) => t.isStringLiteral())
    .map((t) => t.getLiteralValueOrThrow() as string);

  return literals.length >= 2 ? literals.sort() : undefined;
}

/**
 * Custom elements include a hyphen. Lowercase, unqualified tags are therefore
 * the conservative syntactic form for intrinsic JSX elements.
 */
export function isIntrinsicJsxElement(tagName: string): boolean {
  return /^[a-z][A-Za-z0-9]*$/.test(tagName);
}

/** The tag name of the JSX element that owns an attribute or spread. */
export function getJsxTagNameNode(node: Node): Node | undefined {
  const openingElement = node.getFirstAncestorByKind(SyntaxKind.JsxOpeningElement);
  const selfClosingElement = node.getFirstAncestorByKind(SyntaxKind.JsxSelfClosingElement);
  return openingElement?.getTagNameNode() ?? selfClosingElement?.getTagNameNode();
}

export function getNodeDefinitions(node: Node): { getDeclarationNode(): Node | undefined }[] {
  const anyNode = node as unknown as {
    getDefinitions?: () => { getDeclarationNode(): Node | undefined }[];
  };
  return anyNode.getDefinitions?.() ?? [];
}

export function getTypeTargetDeclarations(targetNode: Node, allowWorkspaceImportFallback = false): Node[] {
  return getNodeDefinitions(targetNode).flatMap((definition) => {
    const declaration = definition.getDeclarationNode();
    if (!declaration) return [];

    if (!allowWorkspaceImportFallback || !Node.isImportSpecifier(declaration)) {
      return [declaration];
    }

    const resolvedDeclarations = resolveWorkspaceImportSpecifierDeclarations(declaration, targetNode);
    return resolvedDeclarations.length > 0 ? resolvedDeclarations : [declaration];
  });
}

export function getValueTargetDeclarations(targetNode: Node): Node[] {
  return getNodeDefinitions(targetNode).flatMap((definition) => {
    const declaration = definition.getDeclarationNode();
    if (!declaration) return [];

    if (!Node.isImportSpecifier(declaration)) {
      return [declaration];
    }

    const resolvedDeclarations = resolveWorkspaceImportSpecifierDeclarations(declaration, targetNode);
    return resolvedDeclarations.length > 0 ? resolvedDeclarations : [declaration];
  });
}

export function getTypeReferenceName(typeNode: Node): string | undefined {
  if (Node.isTypeReference(typeNode)) {
    return typeNode.getTypeName().getText().split('.').pop();
  }

  if (Node.isExpressionWithTypeArguments(typeNode)) {
    return typeNode.getExpression().getText().split('.').pop();
  }

  return undefined;
}

