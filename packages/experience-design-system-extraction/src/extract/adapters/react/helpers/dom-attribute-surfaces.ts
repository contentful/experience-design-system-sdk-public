import { Node } from 'ts-morph';
import type { RawPropDefinition } from '../../../model/component.js';

export const EXPANDABLE_DOM_ATTRIBUTE_TYPE_NAMES = new Set([
  'HTMLProps',
  'HTMLAttributes',
  'ImgHTMLAttributes',
  'LiHTMLAttributes',
  'AnchorHTMLAttributes',
  'ButtonHTMLAttributes',
  'InputHTMLAttributes',
  'FieldsetHTMLAttributes',
  'LabelHTMLAttributes',
  'SelectHTMLAttributes',
  'SVGAttributes',
  'SVGProps',
  'TextareaHTMLAttributes',
  'TdHTMLAttributes',
]);

export type ExpandableDomAttributeWrapperName = (typeof EXPANDABLE_DOM_ATTRIBUTE_TYPE_NAMES extends Set<infer T>
  ? T
  : never) &
  string;

export type ExpandableDomAttributeWrapperContext = {
  name: ExpandableDomAttributeWrapperName;
  excludedProps: Set<string>;
};

function createTextControlSurface(onChangeType: string, specificProps: RawPropDefinition[]): RawPropDefinition[] {
  return [
    { name: 'autoComplete', type: 'string', required: false },
    ...specificProps,
    { name: 'disabled', type: 'boolean', required: false },
    { name: 'name', type: 'string', required: false },
    { name: 'onChange', type: onChangeType, required: false },
    { name: 'placeholder', type: 'string', required: false },
    { name: 'readOnly', type: 'boolean', required: false },
    { name: 'required', type: 'boolean', required: false },
    { name: 'value', type: 'string | number | readonly string[]', required: false },
  ];
}

export const DOM_ATTRIBUTE_PROP_SURFACES: Record<ExpandableDomAttributeWrapperName, RawPropDefinition[]> = {
  HTMLProps: [],
  HTMLAttributes: [
    { name: 'className', type: 'string', required: false },
    { name: 'hidden', type: 'boolean', required: false },
    { name: 'id', type: 'string', required: false },
    { name: 'onClick', type: 'MouseEventHandler<HTMLElement>', required: false },
    { name: 'style', type: 'CSSProperties', required: false },
    { name: 'tabIndex', type: 'number', required: false },
    { name: 'title', type: 'string', required: false },
  ],
  ImgHTMLAttributes: [
    { name: 'alt', type: 'string', required: false },
    { name: 'crossOrigin', type: 'string', required: false },
    { name: 'height', type: 'number | string', required: false },
    { name: 'loading', type: 'string', required: false, allowedValues: ['eager', 'lazy'] },
    { name: 'sizes', type: 'string', required: false },
    { name: 'src', type: 'string', required: false },
    { name: 'srcSet', type: 'string', required: false },
    { name: 'width', type: 'number | string', required: false },
  ],
  LiHTMLAttributes: [],
  AnchorHTMLAttributes: [
    { name: 'download', type: 'boolean | string', required: false },
    { name: 'href', type: 'string', required: false },
    { name: 'hrefLang', type: 'string', required: false },
    { name: 'referrerPolicy', type: 'string', required: false },
    { name: 'rel', type: 'string', required: false },
    { name: 'target', type: 'string', required: false, allowedValues: ['_blank', '_parent', '_self', '_top'] },
  ],
  ButtonHTMLAttributes: [
    { name: 'autoFocus', type: 'boolean', required: false },
    { name: 'disabled', type: 'boolean', required: false },
    { name: 'form', type: 'string', required: false },
    { name: 'formAction', type: 'string', required: false },
    { name: 'formMethod', type: 'string', required: false },
    { name: 'formNoValidate', type: 'boolean', required: false },
    { name: 'formTarget', type: 'string', required: false },
    { name: 'name', type: 'string', required: false },
    { name: 'type', type: 'string', required: false, allowedValues: ['button', 'reset', 'submit'] },
    { name: 'value', type: 'string | number | readonly string[]', required: false },
  ],
  InputHTMLAttributes: createTextControlSurface('ChangeEventHandler<HTMLInputElement>', [
    { name: 'checked', type: 'boolean', required: false },
    { name: 'max', type: 'number | string', required: false },
    { name: 'maxLength', type: 'number', required: false },
    { name: 'min', type: 'number | string', required: false },
    { name: 'minLength', type: 'number', required: false },
    { name: 'type', type: 'string', required: false },
  ]),
  FieldsetHTMLAttributes: [
    { name: 'disabled', type: 'boolean', required: false },
    { name: 'form', type: 'string', required: false },
    { name: 'name', type: 'string', required: false },
  ],
  LabelHTMLAttributes: [
    { name: 'form', type: 'string', required: false },
    { name: 'htmlFor', type: 'string', required: false },
  ],
  SelectHTMLAttributes: [
    { name: 'autoComplete', type: 'string', required: false },
    { name: 'disabled', type: 'boolean', required: false },
    { name: 'form', type: 'string', required: false },
    { name: 'multiple', type: 'boolean', required: false },
    { name: 'name', type: 'string', required: false },
    { name: 'onChange', type: 'ChangeEventHandler<HTMLSelectElement>', required: false },
    { name: 'required', type: 'boolean', required: false },
    { name: 'size', type: 'number', required: false },
    { name: 'value', type: 'string | number | readonly string[]', required: false },
  ],
  SVGAttributes: [
    { name: 'focusable', type: 'boolean | "auto"', required: false, allowedValues: ['auto'] },
    { name: 'height', type: 'number | string', required: false },
    { name: 'viewBox', type: 'string', required: false },
    { name: 'width', type: 'number | string', required: false },
  ],
  SVGProps: [],
  TextareaHTMLAttributes: createTextControlSurface('ChangeEventHandler<HTMLTextAreaElement>', [
    { name: 'cols', type: 'number', required: false },
    { name: 'rows', type: 'number', required: false },
    { name: 'wrap', type: 'string', required: false },
  ]),
  TdHTMLAttributes: [
    { name: 'align', type: 'string', required: false, allowedValues: ['center', 'char', 'justify', 'left', 'right'] },
    { name: 'colSpan', type: 'number', required: false },
    { name: 'headers', type: 'string', required: false },
    { name: 'rowSpan', type: 'number', required: false },
    { name: 'scope', type: 'string', required: false },
  ],
};

export const DOM_ATTRIBUTE_WRAPPER_PARENTS: Partial<
  Record<ExpandableDomAttributeWrapperName, ExpandableDomAttributeWrapperName[]>
> = {
  HTMLProps: ['HTMLAttributes'],
  AnchorHTMLAttributes: ['HTMLAttributes'],
  ButtonHTMLAttributes: ['HTMLAttributes'],
  ImgHTMLAttributes: ['HTMLAttributes'],
  InputHTMLAttributes: ['HTMLAttributes'],
  FieldsetHTMLAttributes: ['HTMLAttributes'],
  LabelHTMLAttributes: ['HTMLAttributes'],
  LiHTMLAttributes: ['HTMLAttributes'],
  SelectHTMLAttributes: ['HTMLAttributes'],
  SVGAttributes: ['HTMLAttributes'],
  SVGProps: ['SVGAttributes'],
  TdHTMLAttributes: ['HTMLAttributes'],
  TextareaHTMLAttributes: ['HTMLAttributes'],
};

export const DOM_ATTRIBUTE_WRAPPERS_WITH_SYNTHETIC_CHILDREN = new Set<ExpandableDomAttributeWrapperName>([
  'LabelHTMLAttributes',
]);

export const JSX_PRIMITIVE_DOM_ATTRIBUTE_SURFACES: Partial<Record<string, ExpandableDomAttributeWrapperName>> = {
  'Primitive.button': 'ButtonHTMLAttributes',
  'Primitive.input': 'InputHTMLAttributes',
  'Primitive.label': 'LabelHTMLAttributes',
};

export function isExpandableDomAttributeWrapperName(typeName: string): typeName is ExpandableDomAttributeWrapperName {
  return EXPANDABLE_DOM_ATTRIBUTE_TYPE_NAMES.has(typeName as ExpandableDomAttributeWrapperName);
}

export function getDomAttributeSurface(
  name: ExpandableDomAttributeWrapperName,
  seen = new Set<ExpandableDomAttributeWrapperName>(),
): RawPropDefinition[] {
  if (seen.has(name)) return [];
  seen.add(name);

  const propsByName = new Map<string, RawPropDefinition>();
  for (const parentName of DOM_ATTRIBUTE_WRAPPER_PARENTS[name] ?? []) {
    for (const prop of getDomAttributeSurface(parentName, seen)) {
      propsByName.set(prop.name, prop);
    }
  }
  for (const prop of DOM_ATTRIBUTE_PROP_SURFACES[name]) {
    propsByName.set(prop.name, prop);
  }

  return [...propsByName.values()].map((prop) => ({ ...prop, domAttribute: true }));
}

export function getBoundedImportedJsxDomSurface(tagNameNode: Node): ExpandableDomAttributeWrapperName | undefined {
  if (!Node.isIdentifier(tagNameNode)) return undefined;

  const localName = tagNameNode.getText();
  if (!/label/i.test(localName)) return undefined;

  const declarations = tagNameNode.getSymbol()?.getDeclarations() ?? [];
  for (const declaration of declarations) {
    if (!Node.isImportSpecifier(declaration)) continue;

    const importDeclaration = declaration.getImportDeclaration();
    const moduleSpecifier = importDeclaration.getModuleSpecifierValue();
    const importedName = declaration.getNameNode().getText();
    const aliasName = declaration.getAliasNode()?.getText();

    if (
      /label/i.test(moduleSpecifier) ||
      /label/i.test(importedName) ||
      (aliasName !== undefined && /label/i.test(aliasName))
    ) {
      return 'LabelHTMLAttributes';
    }
  }

  return undefined;
}
