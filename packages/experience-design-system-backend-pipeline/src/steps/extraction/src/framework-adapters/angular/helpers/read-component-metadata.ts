import { dirname, resolve } from 'node:path';
import type { ClassDeclaration } from 'ts-morph';
import { findComponentDecorator } from './find-component-decorator.js';
import { normalizeComponentName } from './resolution/normalize-component-name.js';
import { readDecoratorString, readDecoratorStringArray } from './read-decorator-string.js';
import type { AngularComponentMetadata } from '../types/angular-metadata.js';

export function readComponentMetadata(cls: ClassDeclaration, sourceFilePath: string): AngularComponentMetadata | null {
  const obj = findComponentDecorator(cls);
  if (!obj) return null;

  const className = cls.getName();
  if (!className) return null;

  const rawSelector = readDecoratorString(obj, 'selector');
  const inlineTemplate = readDecoratorString(obj, 'template');
  const templateUrlRel = readDecoratorString(obj, 'templateUrl');
  const inputsArray = readDecoratorStringArray(obj, 'inputs');

  const templatePath = templateUrlRel ? resolve(dirname(sourceFilePath), templateUrlRel) : null;

  const decorator = cls.getDecorator('Component');
  const decoratorLine = decorator?.getStartLineNumber() ?? cls.getStartLineNumber();

  return {
    className,
    normalizedName: normalizeComponentName(className),
    rawSelector,
    inlineTemplate,
    templatePath,
    inputsArray,
    decoratorLine,
  };
}
