import { Node, Project, SyntaxKind, type SourceFile } from 'ts-morph';
import type { RawComponentDefinition } from '../../types.js';

export type SourceCallSiteEvidence = {
  parent: string;
  child: string;
  sourcePath: string;
  startLine: number;
  endLine: number;
  excerpt: string;
  kind: 'jsx-render';
};

export type SourceCallSiteRejection = {
  parent: string;
  candidate: string;
  sourcePath: string;
  startLine: number;
  endLine: number;
  excerpt: string;
  reason: 'unknown-component' | 'unbound-component';
};

export type SourceCallSiteEvidenceResult = {
  accepted: SourceCallSiteEvidence[];
  rejected: SourceCallSiteRejection[];
};

type SourceFileInput = { path: string; content: string };

export function collectSourceCallSiteEvidence(
  files: readonly SourceFileInput[],
  components: readonly RawComponentDefinition[],
): SourceCallSiteEvidenceResult {
  const componentNames = new Set(components.map((component) => component.name));
  const componentsBySource = new Map<string, RawComponentDefinition[]>();
  for (const component of components) {
    const sourcePath = component.sourcePath ?? component.source;
    const siblings = componentsBySource.get(sourcePath) ?? [];
    siblings.push(component);
    componentsBySource.set(sourcePath, siblings);
  }

  const project = new Project({
    compilerOptions: { jsx: 1, target: 99, module: 99, moduleResolution: 100, skipLibCheck: true, allowJs: true },
    skipAddingFilesFromTsConfig: true,
  });
  const sourceFiles = new Map(
    files.map((file) => [file.path, project.createSourceFile(file.path, file.content, { overwrite: true })]),
  );
  const accepted: SourceCallSiteEvidence[] = [];
  const rejected: SourceCallSiteRejection[] = [];

  for (const [sourcePath, parents] of componentsBySource) {
    const sourceFile = sourceFiles.get(sourcePath);
    if (!sourceFile) continue;
    const boundNames = collectBoundNames(sourceFile);

    for (const parent of parents) {
      for (const jsxElement of [
        ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
        ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxElement),
      ]) {
        const tagName = Node.isJsxSelfClosingElement(jsxElement)
          ? jsxElement.getTagNameNode().getText()
          : jsxElement.getOpeningElement().getTagNameNode().getText();
        const candidate = tagName.split('.').at(-1) ?? tagName;
        if (candidate === parent.name || isIntrinsicTag(candidate)) continue;

        const lines = sourceExcerpt(sourceFile, jsxElement);
        if (!componentNames.has(candidate)) {
          rejected.push({ parent: parent.name, candidate, ...lines, reason: 'unknown-component' });
          continue;
        }
        if (!boundNames.has(tagName) && !boundNames.has(candidate)) {
          rejected.push({ parent: parent.name, candidate, ...lines, reason: 'unbound-component' });
          continue;
        }

        accepted.push({ parent: parent.name, child: candidate, ...lines, kind: 'jsx-render' });
      }
    }
  }

  return {
    accepted: dedupeEvidence(accepted),
    rejected: dedupeRejections(rejected),
  };
}

function collectBoundNames(sourceFile: SourceFile): Set<string> {
  const names = new Set<string>();
  for (const declaration of sourceFile.getImportDeclarations()) {
    const defaultImport = declaration.getDefaultImport();
    if (defaultImport) names.add(defaultImport.getText());
    const namespaceImport = declaration.getNamespaceImport();
    if (namespaceImport) names.add(namespaceImport.getText());
    for (const namedImport of declaration.getNamedImports()) {
      names.add((namedImport.getAliasNode() ?? namedImport.getNameNode()).getText());
    }
  }
  for (const declaration of sourceFile.getVariableDeclarations()) names.add(declaration.getName());
  for (const declaration of sourceFile.getFunctions()) {
    if (declaration.getName()) names.add(declaration.getName()!);
  }
  for (const declaration of sourceFile.getClasses()) {
    if (declaration.getName()) names.add(declaration.getName()!);
  }
  return names;
}

function sourceExcerpt(
  sourceFile: SourceFile,
  node: Node,
): {
  sourcePath: string;
  startLine: number;
  endLine: number;
  excerpt: string;
} {
  const startLine = node.getStartLineNumber();
  const endLine = node.getEndLineNumber();
  const lines = sourceFile.getFullText().split('\n');
  return {
    sourcePath: sourceFile.getFilePath(),
    startLine,
    endLine,
    excerpt: lines
      .slice(startLine - 1, endLine)
      .join('\n')
      .trim(),
  };
}

function isIntrinsicTag(tagName: string): boolean {
  return /^[a-z]/.test(tagName) || tagName.includes('-');
}

function dedupeEvidence(evidence: SourceCallSiteEvidence[]): SourceCallSiteEvidence[] {
  const seen = new Set<string>();
  return evidence
    .filter((item) => {
      const key = `${item.parent}\u0000${item.child}\u0000${item.sourcePath}\u0000${item.startLine}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) =>
      `${left.parent}\u0000${left.child}\u0000${left.sourcePath}\u0000${left.startLine}`.localeCompare(
        `${right.parent}\u0000${right.child}\u0000${right.sourcePath}\u0000${right.startLine}`,
      ),
    );
}

function dedupeRejections(rejections: SourceCallSiteRejection[]): SourceCallSiteRejection[] {
  const seen = new Set<string>();
  return rejections.filter((item) => {
    const key = `${item.parent}\u0000${item.candidate}\u0000${item.sourcePath}\u0000${item.startLine}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
