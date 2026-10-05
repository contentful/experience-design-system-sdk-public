import { type ClassDeclaration, type Project } from 'ts-morph';
import type { RawPropDefinition, RawSlotDefinition } from '../../../model/component.js';
import {
  extractAccessorProperties,
  extractClassProperties,
  extractJsDocAttributeProps,
  hasShoelaceRuntimeBookkeepingField,
  mergePropLists,
} from '../merge-wc-prop-lists.js';
import { mergeSlotLists, extractJsDocSlots } from './extract-wc-slots.js';
import { getImportedBaseClass } from './resolve-wc-base-class.js';

export function extractInheritedClassProperties(
  classDecl: ClassDeclaration,
  project: Project,
  visitedFiles: Set<string> = new Set(),
  applyRuntimeFieldDenylist = false,
): RawPropDefinition[] {
  const baseClass = getImportedBaseClass(classDecl, project, visitedFiles);
  if (!baseClass) return [];

  const nextApplyRuntimeFieldDenylist = applyRuntimeFieldDenylist || hasShoelaceRuntimeBookkeepingField(baseClass);
  return mergePropLists(
    extractInheritedClassProperties(baseClass, project, visitedFiles, nextApplyRuntimeFieldDenylist),
    extractJsDocAttributeProps(baseClass),
    extractAccessorProperties(baseClass, nextApplyRuntimeFieldDenylist),
    extractClassProperties(baseClass, nextApplyRuntimeFieldDenylist),
  );
}

export function extractInheritedSlots(
  classDecl: ClassDeclaration,
  project: Project,
  visitedFiles: Set<string> = new Set(),
): RawSlotDefinition[] {
  const baseClass = getImportedBaseClass(classDecl, project, visitedFiles);
  if (!baseClass) return [];

  return mergeSlotLists(extractInheritedSlots(baseClass, project, visitedFiles), extractJsDocSlots(baseClass));
}
