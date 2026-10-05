import { basename } from 'node:path';
import { type ClassDeclaration, type Project, type SourceFile } from 'ts-morph';
import { kebabToPascal } from '../../shared/helpers/tsx-shared.js';
import { getElementTagNameFromDecorator } from './resolve-wc-decorator-tag.js';
import {
  buildTagNameMap,
  getElementTagNameFromSiblingDefine,
  getElementTagNameFromFastDefinition,
} from './resolve-wc-sibling-definition.js';

export { buildTagNameMap, getElementTagNameFromDecorator, getElementTagNameFromSiblingDefine, getElementTagNameFromFastDefinition };

function normalizeComponentName(input: string): string {
  return input.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function shouldPreferTagName(className: string, tagName: string): boolean {
  const pascalTagName = kebabToPascal(tagName);
  if (className.startsWith('HTML') && className.endsWith('Element')) return true;
  if (className.endsWith('Element')) return true;
  if (normalizeComponentName(className) === normalizeComponentName(pascalTagName)) return false;
  return false;
}

function getFileDerivedComponentName(sourceFile: SourceFile): string {
  const baseName = basename(sourceFile.getFilePath()).replace(/\.[^.]+$/, '').replace(/\.component$/, '');
  return kebabToPascal(baseName);
}

export function chooseComponentName(classDecl: ClassDeclaration, className: string, tagName: string | undefined): string {
  if (!tagName) return className;
  const tagDerivedName = kebabToPascal(tagName);
  const fileDerivedName = getFileDerivedComponentName(classDecl.getSourceFile());
  if (normalizeComponentName(className) === normalizeComponentName(tagDerivedName)) return className;
  if (normalizeComponentName(className) === normalizeComponentName(fileDerivedName)) return className;
  if (fileDerivedName && tagDerivedName.endsWith(fileDerivedName)) return fileDerivedName;
  if (shouldPreferTagName(className, tagName)) return tagDerivedName;
  return className;
}

export function getElementTagNameFromJsDoc(classDecl: ClassDeclaration): string | null {
  for (const doc of classDecl.getJsDocs()) {
    for (const tag of doc.getTags()) {
      if (tag.getTagName() !== 'element') continue;
      const comment = tag.getCommentText();
      if (comment) return comment.trim();
    }
  }
  return null;
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
