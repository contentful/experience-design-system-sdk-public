import { Node, type Project } from 'ts-morph';
import { loadSourceFile, resolveImportSourcePath } from './resolve-wc-import.js';

export function collectHtmlTaggedTemplates(root: Node): string[] {
  const templates: string[] = [];
  root.forEachDescendant((node) => {
    if (!Node.isTaggedTemplateExpression(node)) return;
    const tag = node.getTag();
    if (tag.getText() !== 'html') return;
    const template = node.getTemplate();
    if (Node.isNoSubstitutionTemplateLiteral(template) || Node.isTemplateExpression(template)) {
      templates.push(template.getText().slice(1, -1));
    }
  });
  return templates;
}

export function resolveTemplateHelperDeclarations(
  callExpression: import('ts-morph').CallExpression,
  project: Project,
): Node[] {
  const expression = callExpression.getExpression();
  if (!Node.isIdentifier(expression)) return [];

  const declarations: Node[] = [];
  for (const definition of expression.getDefinitions()) {
    const declarationNode = definition.getDeclarationNode();
    if (!declarationNode) continue;

    if (Node.isFunctionDeclaration(declarationNode) || Node.isVariableDeclaration(declarationNode)) {
      declarations.push(declarationNode);
      continue;
    }

    if (!Node.isImportSpecifier(declarationNode)) continue;

    const importDecl = declarationNode.getImportDeclaration();
    const resolvedImportPath = resolveImportSourcePath(
      callExpression.getSourceFile().getFilePath(),
      importDecl.getModuleSpecifierValue(),
    );
    if (!resolvedImportPath) continue;

    const importedFile = loadSourceFile(project, resolvedImportPath);
    if (!importedFile) continue;

    const importedName = declarationNode.getNameNode().getText();
    const importedFunction = importedFile.getFunction(importedName);
    if (importedFunction) {
      declarations.push(importedFunction);
      continue;
    }

    const importedVariable = importedFile.getVariableDeclaration(importedName);
    if (importedVariable) declarations.push(importedVariable);
  }

  return declarations;
}

export function collectHtmlTaggedTemplatesWithHelpers(root: Node, project: Project): string[] {
  const templates = [...collectHtmlTaggedTemplates(root)];
  const seenTemplateHelpers = new Set<string>();
  root.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    for (const declaration of resolveTemplateHelperDeclarations(node, project)) {
      const helperKey = `${declaration.getSourceFile().getFilePath()}:${declaration.getStart()}`;
      if (seenTemplateHelpers.has(helperKey)) continue;
      seenTemplateHelpers.add(helperKey);
      templates.push(...collectHtmlTaggedTemplates(declaration));
    }
  });
  return templates;
}
