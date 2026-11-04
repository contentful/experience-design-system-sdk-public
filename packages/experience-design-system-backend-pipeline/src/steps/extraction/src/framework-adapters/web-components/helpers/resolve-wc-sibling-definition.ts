import { Node, SyntaxKind, type ClassDeclaration, type Project, type SourceFile } from 'ts-morph';
import { resolveStaticStringExpression, loadSourceFile } from './resolve-wc-import.js';

export function buildTagNameMap(sourceFile: SourceFile): Map<string, string> {
  const tagNameMap = new Map<string, string>();
  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();
    if (!Node.isPropertyAccessExpression(expr) || expr.getName() !== 'define') return;
    if (expr.getExpression().getText() !== 'customElements') return;
    const args = node.getArguments();
    if (args.length < 2) return;
    const tagArg = args[0];
    const classArg = args[1];
    if (!Node.isStringLiteral(tagArg)) return;
    tagNameMap.set(classArg.getText(), tagArg.getLiteralValue());
  });
  return tagNameMap;
}

export function getElementTagNameFromSiblingDefine(classDecl: ClassDeclaration, project: Project): string | null {
  const sourceFilePath = classDecl.getSourceFile().getFilePath();
  if (!sourceFilePath.endsWith('.component.ts')) return null;

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
    if (!Node.isPropertyAccessExpression(expression) || expression.getName() !== 'define') continue;
    if (expression.getExpression().getText() !== className) continue;
    const tagArg = node.getArguments()[0];
    if (!tagArg || !Node.isStringLiteral(tagArg)) continue;
    return tagArg.getLiteralValue();
  }
  return null;
}

export function getElementTagNameFromFastDefinition(classDecl: ClassDeclaration, project: Project): string | null {
  const sourceFilePath = classDecl.getSourceFile().getFilePath();
  if (!sourceFilePath.endsWith('.ts') || sourceFilePath.endsWith('.definition.ts')) return null;

  const definitionPath = `${sourceFilePath.slice(0, -'.ts'.length)}.definition.ts`;
  const definitionFile = loadSourceFile(project, definitionPath);
  if (!definitionFile) return null;

  for (const callExpr of definitionFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = callExpr.getExpression();
    if (!Node.isPropertyAccessExpression(expression) || expression.getName() !== 'compose') continue;
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
    if (resolved) return resolved;
  }
  return null;
}
