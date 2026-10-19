import {
  ModuleKind,
  ModuleResolutionKind,
  Node,
  Project,
  ScriptTarget,
  SyntaxKind,
  VariableDeclarationKind,
  ts,
} from 'ts-morph';
import type { RawComponentDefinition } from '../../../../extraction/src/types/component.js';

export type SourceCallSiteEvidence = {
  parent: string;
  child: string;
  sourcePath: string;
  startLine: number;
  endLine: number;
  excerpt: string;
  kind: 'jsx-render';
  execution: 'lexical-reference';
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

/** Collect lexical observations; neither execution nor an editable slot contract is implied. */
export function collectSourceCallSiteEvidence(
  files: readonly { path: string; content: string }[],
  components: readonly RawComponentDefinition[],
): SourceCallSiteEvidenceResult {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      jsx: ts.JsxEmit.Preserve,
      target: ScriptTarget.ESNext,
      module: ModuleKind.ESNext,
      moduleResolution: ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      allowJs: true,
    },
  });
  for (const file of files) project.createSourceFile(file.path, file.content, { overwrite: true });

  const componentNames = new Set(components.map(({ name }) => name));
  const sourceCounts = new Map<string, number>();
  for (const component of components) {
    const path = component.sourcePath ?? component.source;
    sourceCounts.set(path, (sourceCounts.get(path) ?? 0) + 1);
  }
  const byDeclaration = new Map<Node, RawComponentDefinition[]>();
  for (const component of components) {
    const source = project.getSourceFile(component.sourcePath ?? component.source);
    if (!source) continue;
    const exported = source.getExportedDeclarations();
    const local = [...source.getFunctions(), ...source.getClasses(), ...source.getVariableDeclarations()].filter(
      (declaration) => declaration.getName() === component.name,
    );
    const declarations = exported.get(component.name) ?? local;
    const anonymousDefault = exported
      .get('default')
      ?.filter(
        (declaration) =>
          Node.isArrowFunction(declaration) ||
          ((Node.isFunctionDeclaration(declaration) ||
            Node.isFunctionExpression(declaration) ||
            Node.isClassDeclaration(declaration)) &&
            !declaration.getName()),
      );
    const roots =
      declarations.length > 0
        ? declarations
        : sourceCounts.get(component.sourcePath ?? component.source) === 1
          ? (anonymousDefault ?? [])
          : [];
    for (const declaration of roots) {
      const owners = byDeclaration.get(declaration) ?? [];
      owners.push(component);
      byDeclaration.set(declaration, owners);
    }
  }

  const accepted: SourceCallSiteEvidence[] = [];
  const rejected: SourceCallSiteRejection[] = [];
  for (const source of project.getSourceFiles()) {
    const lines = source.getFullText().split('\n');
    const references = [
      ...source.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
      ...source.getDescendantsOfKind(SyntaxKind.JsxElement),
    ].sort((left, right) => left.getStart() - right.getStart());
    for (const reference of references) {
      const owner = reference.getAncestors().find((ancestor) => byDeclaration.has(ancestor));
      if (!owner) continue;
      const tag = Node.isJsxSelfClosingElement(reference)
        ? reference.getTagNameNode()
        : reference.getOpeningElement().getTagNameNode();
      const expression = tag.getText();
      if (/^[a-z]/.test(expression) && !expression.includes('.')) continue;
      const candidate = expression.split('.').at(-1)!;
      const children = resolveDeclarations(tag).flatMap((declaration) => byDeclaration.get(declaration) ?? []);
      const startLine = reference.getStartLineNumber();
      const endLine = reference.getEndLineNumber();
      const location = {
        sourcePath: source.getFilePath(),
        startLine,
        endLine,
        excerpt: lines
          .slice(startLine - 1, endLine)
          .join('\n')
          .trim(),
      };
      for (const parent of byDeclaration.get(owner)!) {
        if (children.length === 0) {
          rejected.push({
            parent: parent.name,
            candidate,
            ...location,
            reason: componentNames.has(candidate) ? 'unbound-component' : 'unknown-component',
          });
          continue;
        }
        for (const child of new Set(children)) {
          if (byDeclaration.get(owner)!.includes(child)) continue;
          accepted.push({
            parent: parent.name,
            child: child.name,
            ...location,
            kind: 'jsx-render',
            execution: 'lexical-reference',
          });
        }
      }
    }
  }

  const key = (item: SourceCallSiteEvidence | SourceCallSiteRejection): string =>
    JSON.stringify([
      item.parent,
      'child' in item ? item.child : item.candidate,
      item.sourcePath,
      item.startLine,
      item.endLine,
    ]);
  accepted.sort((left, right) => key(left).localeCompare(key(right)));
  rejected.sort((left, right) => key(left).localeCompare(key(right)));
  return { accepted, rejected };
}

function resolveDeclarations(reference: Node, seen = new Set<Node>()): Node[] {
  if (seen.has(reference)) return [];
  seen.add(reference);
  const symbol = reference.getSymbol();
  const declarations = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? [];
  return declarations.flatMap((declaration) => {
    if (Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      if (
        declaration.getVariableStatement()?.getDeclarationKind() === VariableDeclarationKind.Const &&
        initializer &&
        (Node.isIdentifier(initializer) || Node.isPropertyAccessExpression(initializer))
      ) {
        return resolveDeclarations(initializer, seen);
      }
    }
    return [declaration];
  });
}
