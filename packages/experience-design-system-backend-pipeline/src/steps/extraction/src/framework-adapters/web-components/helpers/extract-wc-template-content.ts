import { type ClassDeclaration, type Project } from 'ts-morph';
import type { RawSlotDefinition } from '../../../types/component.js';
import { loadSourceFile } from './resolve-wc-import.js';
import { extractSlotsFromTemplate } from './extract-wc-slots.js';
import { collectHtmlTaggedTemplatesWithHelpers } from './collect-wc-html-templates.js';

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
