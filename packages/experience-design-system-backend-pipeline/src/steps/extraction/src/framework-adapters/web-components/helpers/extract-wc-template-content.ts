import { Node, type ClassDeclaration, type Project } from 'ts-morph';
import type { RawSlotDefinition } from '../../../types/component.js';
import { loadSourceFile } from './resolve-wc-import.js';
import { extractSlotsFromTemplate } from './extract-wc-slots.js';
import { collectHtmlTaggedTemplatesWithHelpers } from './collect-wc-html-templates.js';

export function extractTemplateContent(classDecl: ClassDeclaration, project: Project): string {
  const templates: string[] = [];

  classDecl.forEachDescendant((node) => {
    if (!Node.isBinaryExpression(node)) return;
    const leftText = node.getLeft().getText();
    if (!leftText.includes('.innerHTML')) return;
    const right = node.getRight();
    if (Node.isTemplateExpression(right) || Node.isNoSubstitutionTemplateLiteral(right)) {
      templates.push(right.getText().slice(1, -1));
    }
  });

  const renderMethod = classDecl.getMethod('render');
  if (renderMethod && !renderMethod.isStatic()) {
    templates.push(...collectHtmlTaggedTemplatesWithHelpers(renderMethod, project));
  }

  const templateGetter = classDecl.getGetAccessor('template');
  if (templateGetter?.isStatic()) {
    templateGetter.forEachDescendant((node) => {
      if (Node.isTaggedTemplateExpression(node)) {
        const tag = node.getTag();
        if (tag.getText() === 'html') {
          const template = node.getTemplate();
          if (Node.isNoSubstitutionTemplateLiteral(template) || Node.isTemplateExpression(template)) {
            templates.push(template.getText().slice(1, -1));
          }
        }
      }
    });
  }

  return templates.join('\n');
}

export function extractFastTemplateSlots(classDecl: ClassDeclaration, project: Project): RawSlotDefinition[] {
  const sourceFilePath = classDecl.getSourceFile().getFilePath();
  if (!sourceFilePath.endsWith('.ts') || sourceFilePath.endsWith('.template.ts')) return [];

  const templatePath = `${sourceFilePath.slice(0, -'.ts'.length)}.template.ts`;
  const templateFile = loadSourceFile(project, templatePath);
  if (!templateFile) return [];

  const fragments: string[] = [];
  fragments.push(...collectHtmlTaggedTemplatesWithHelpers(templateFile, project));
  return extractSlotsFromTemplate(fragments.join('\n'));
}
