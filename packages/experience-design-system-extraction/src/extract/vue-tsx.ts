import { Node, SyntaxKind, type SourceFile } from 'ts-morph';
import { loadTsMorphSourceFiles } from '../parse/project-factory.js';
import type {
  RawComponentDefinition,
  RawPropDefinition,
  RawSlotDefinition,
  ComponentExtractionResult,
} from '../types.js';
import {
  extractAllowedValues,
  getTypeReferenceName,
  getTypeTargetDeclarations,
  getValueTargetDeclarations,
} from './tsx-shared.js';

export async function extractVueTsxComponents(filePaths: string[]): Promise<ComponentExtractionResult> {
  const componentFiles = filePaths.filter((f) => f.endsWith('.tsx'));
  if (componentFiles.length === 0) {
    return { components: [], warnings: [] };
  }

  const projectFiles = filePaths.filter((f) => /\.[jt]sx?$/.test(f) && !f.endsWith('.d.ts'));
  const { project } = loadTsMorphSourceFiles(projectFiles);

  const warnings: string[] = [];
  const components: RawComponentDefinition[] = [];

  for (const filePath of componentFiles) {
    try {
      const sourceFile = project.getSourceFile(filePath);
      if (!sourceFile) continue;
      components.push(...extractFromSourceFile(sourceFile));
    } catch (e) {
      warnings.push(`Failed to extract from ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    components: components.sort((a, b) => a.name.localeCompare(b.name)),
    warnings,
  };
}

function extractFromSourceFile(sourceFile: SourceFile): RawComponentDefinition[] {
  const components: RawComponentDefinition[] = [];
  const exported = sourceFile.getExportedDeclarations();

  for (const [exportKey, declarations] of exported) {
    let name = exportKey;

    if (exportKey === 'default') {
      const decl = declarations[0];
      const declName = Node.isFunctionDeclaration(decl) ? decl.getName() : undefined;
      if (!declName || !/^[A-Z]/.test(declName)) continue;
      if (exported.has(declName)) continue;
      name = declName;
    }

    if (!/^[A-Z]/.test(name)) continue;
    if (name.startsWith('use')) continue;

    const component = extractVueTsxComponent(declarations, name, sourceFile);
    if (component) {
      components.push(component);
    }
  }

  return components;
}

function extractVueTsxComponent(
  declarations: Node[],
  exportName: string,
  sourceFile: SourceFile,
): RawComponentDefinition | undefined {
  for (const declaration of declarations) {
    if (!Node.isVariableDeclaration(declaration)) continue;
    if (declaration.getSourceFile().getFilePath() !== sourceFile.getFilePath()) continue;

    const resolved = resolveVueComponentOptions(declaration.getInitializer());
    if (!resolved) continue;

    const name = extractVueGenericComponentName(resolved.options) ?? exportName;
    const props = extractVueGenericComponentProps(resolved.options);
    const slots = extractVueGenericComponentSlots(resolved.options, resolved.slotsTypeNode);

    return {
      name,
      source: sourceFile.getFilePath(),
      framework: 'vue',
      props,
      slots,
    };
  }

  return undefined;
}

function resolveVueComponentOptions(node: Node | undefined):
  | {
      options: import('ts-morph').ObjectLiteralExpression;
      slotsTypeNode?: Node;
    }
  | undefined {
  if (!node || !Node.isCallExpression(node)) return undefined;

  const directExpressionText = node.getExpression().getText();
  if (/(^|\.)defineComponent$/.test(directExpressionText)) {
    const optionsArg = node.getArguments()[0];
    if (!optionsArg || !Node.isObjectLiteralExpression(optionsArg)) return undefined;
    return { options: optionsArg };
  }

  if (!Node.isCallExpression(node.getExpression())) return undefined;

  const outerArgs = node.getArguments();
  if (outerArgs.length !== 1) return undefined;
  const optionsArg = outerArgs[0];
  if (!Node.isObjectLiteralExpression(optionsArg)) return undefined;

  const innerCall = node.getExpression();
  if (!Node.isCallExpression(innerCall)) return undefined;
  const innerExpressionText = innerCall.getExpression().getText();
  if (!/(^|\.)genericComponent$/.test(innerExpressionText)) return undefined;

  return {
    options: optionsArg,
    slotsTypeNode: innerCall.getTypeArguments()[0],
  };
}

function extractVueGenericComponentName(options: import('ts-morph').ObjectLiteralExpression): string | undefined {
  const nameProp = options.getProperty('name');
  if (!nameProp || !Node.isPropertyAssignment(nameProp)) return undefined;

  const initializer = nameProp.getInitializer();
  if (!initializer || !Node.isStringLiteral(initializer)) return undefined;
  return initializer.getLiteralText();
}

function extractVueGenericComponentProps(options: import('ts-morph').ObjectLiteralExpression): RawPropDefinition[] {
  const propsProp = options.getProperty('props');
  if (!propsProp || !Node.isPropertyAssignment(propsProp)) return [];

  const initializer = propsProp.getInitializer();
  if (!initializer) return [];

  return extractVuePropsFromExpression(initializer, new Set<Node>()).sort((a, b) => a.name.localeCompare(b.name));
}

function resolveVuePropsObjectLiteral(node: Node): import('ts-morph').ObjectLiteralExpression | undefined {
  if (Node.isObjectLiteralExpression(node)) return node;

  if (!Node.isCallExpression(node)) return undefined;

  const returnedObject = resolveReturnedObjectLiteralFromCallExpression(node, new Set<Node>());
  if (returnedObject) return returnedObject;

  const expression = node.getExpression();
  if (Node.isIdentifier(expression)) {
    for (const declaration of getValueTargetDeclarations(expression)) {
      if (!Node.isVariableDeclaration(declaration)) continue;

      const initializer = declaration.getInitializer();
      if (!initializer || !Node.isCallExpression(initializer)) continue;
      if (!/(^|\.)propsFactory$/.test(initializer.getExpression().getText())) continue;

      const propsArg = initializer.getArguments()[0];
      if (propsArg && Node.isObjectLiteralExpression(propsArg)) {
        return propsArg;
      }
    }
  }

  return undefined;
}

function extractVuePropsFromExpression(node: Node, seen: Set<Node>): RawPropDefinition[] {
  if (seen.has(node)) return [];
  seen.add(node);

  if (Node.isObjectLiteralExpression(node)) {
    return extractVuePropsFromObjectLiteral(node, seen);
  }

  if (Node.isCallExpression(node)) {
    const expressionName = getExpressionTerminalName(node.getExpression());
    if (expressionName === 'pick' || expressionName === 'omit') {
      const sourceArg = node.getArguments()[0];
      const keyArg = node.getArguments()[1];
      if (!sourceArg || !keyArg) return [];

      const keys = extractStringLiteralArrayValues(keyArg);
      if (!keys) return [];

      const sourceProps = extractVuePropsFromExpression(sourceArg, seen);
      const keySet = new Set(keys);
      return sourceProps.filter((prop) => (expressionName === 'pick' ? keySet.has(prop.name) : !keySet.has(prop.name)));
    }

    const propsObject = resolveVuePropsObjectLiteral(node);
    if (propsObject) return extractVuePropsFromObjectLiteral(propsObject, seen);
  }

  if (Node.isIdentifier(node)) {
    for (const declaration of getValueTargetDeclarations(node)) {
      const resolved = resolveReturnedObjectLiteral(declaration, seen);
      if (resolved) {
        return extractVuePropsFromObjectLiteral(resolved, seen);
      }
    }
  }

  return [];
}

function extractVuePropsFromObjectLiteral(
  objectLiteral: import('ts-morph').ObjectLiteralExpression,
  seen: Set<Node>,
): RawPropDefinition[] {
  const propsByName = new Map<string, RawPropDefinition>();

  for (const property of objectLiteral.getProperties()) {
    if (Node.isPropertyAssignment(property)) {
      const propName = getVueObjectPropertyName(property);
      if (!propName) continue;
      const definition = extractVuePropDefinition(propName, property.getInitializer());
      if (definition) {
        propsByName.set(definition.name, definition);
      }
      continue;
    }

    if (Node.isSpreadAssignment(property)) {
      for (const definition of extractVuePropsFromExpression(property.getExpression(), seen)) {
        propsByName.set(definition.name, definition);
      }
    }
  }

  return [...propsByName.values()];
}

function getVueObjectPropertyName(property: import('ts-morph').PropertyAssignment): string | undefined {
  const nameNode = property.getNameNode();
  if (Node.isIdentifier(nameNode) || Node.isPrivateIdentifier(nameNode)) {
    return nameNode.getText();
  }

  if (Node.isStringLiteral(nameNode) || Node.isNoSubstitutionTemplateLiteral(nameNode)) {
    return nameNode.getLiteralText();
  }

  if (Node.isComputedPropertyName(nameNode)) {
    const expression = nameNode.getExpression();
    if (Node.isStringLiteral(expression) || Node.isNoSubstitutionTemplateLiteral(expression)) {
      return expression.getLiteralText();
    }
  }

  return property.getName();
}

function extractVuePropDefinition(propName: string, initializer: Node | undefined): RawPropDefinition | undefined {
  if (!initializer) return undefined;

  if (Node.isObjectLiteralExpression(initializer)) {
    return extractVueObjectPropDefinition(propName, initializer);
  }

  return {
    name: propName,
    type: getVuePropTypeText(initializer),
    required: false,
  };
}

function extractVueObjectPropDefinition(
  propName: string,
  initializer: import('ts-morph').ObjectLiteralExpression,
): RawPropDefinition {
  let type = 'any';
  let required = false;
  let defaultValue: string | undefined;
  let allowedValues: string[] | undefined;

  for (const property of initializer.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;

    const name = property.getName();
    const value = property.getInitializer();
    if (!value) continue;

    if (name === 'type') {
      type = getVuePropTypeText(value);
      allowedValues = extractAllowedValues(value.getType());
    } else if (name === 'required') {
      required = value.getText() === 'true';
    } else if (name === 'default') {
      defaultValue = value.getText();
    }
  }

  return {
    name: propName,
    type,
    required,
    ...(defaultValue !== undefined && { defaultValue }),
    ...(allowedValues && { allowedValues }),
  };
}

function getVuePropTypeText(node: Node): string {
  if (Node.isAsExpression(node) || Node.isTypeAssertion(node)) {
    const typeNode = node.getTypeNode();
    const propTypeType = extractPropTypeTypeArgumentText(typeNode);
    if (propTypeType) return propTypeType;
    return getVuePropTypeText(node.getExpression());
  }

  if (Node.isParenthesizedExpression(node)) {
    return getVuePropTypeText(node.getExpression());
  }

  if (Node.isArrayLiteralExpression(node)) {
    const memberTypes = node.getElements().flatMap((element) => {
      const memberType = getVuePropTypeText(element);
      return memberType === 'any' ? [] : [memberType];
    });

    return memberTypes.length > 0 ? [...new Set(memberTypes)].sort().join(' | ') : 'any';
  }

  if (Node.isIdentifier(node)) {
    return VUE_PROP_VALUE_TYPE_MAP[node.getText()] ?? node.getText();
  }

  if (Node.isNullLiteral(node)) return 'any';

  return node.getType().getText(node);
}

const VUE_PROP_VALUE_TYPE_MAP: Record<string, string> = {
  String: 'string',
  Number: 'number',
  Boolean: 'boolean',
  Array: 'any[]',
  Object: 'object',
  Function: 'function',
};

function extractPropTypeTypeArgumentText(typeNode: Node | undefined): string | undefined {
  if (!typeNode || !Node.isTypeReference(typeNode)) return undefined;
  if (getTypeReferenceName(typeNode) !== 'PropType') return undefined;
  return typeNode.getTypeArguments()[0]?.getText();
}

function extractVueGenericComponentSlots(
  options: import('ts-morph').ObjectLiteralExpression,
  slotsTypeNode: Node | undefined,
): RawSlotDefinition[] {
  const slotsByName = new Map<string, RawSlotDefinition>();

  if (slotsTypeNode) {
    for (const slot of extractVueSlotsFromTypeNode(slotsTypeNode, new Set<Node>())) {
      slotsByName.set(slot.name, slot);
    }
  }

  for (const slot of extractVueSlotsFromSetup(options)) {
    if (!slotsByName.has(slot.name)) {
      slotsByName.set(slot.name, slot);
    }
  }

  return [...slotsByName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function resolveReturnedObjectLiteral(
  node: Node,
  seen: Set<Node>,
): import('ts-morph').ObjectLiteralExpression | undefined {
  if (seen.has(node)) return undefined;
  seen.add(node);

  if (Node.isObjectLiteralExpression(node)) return node;

  if (Node.isParenthesizedExpression(node)) {
    return resolveReturnedObjectLiteral(node.getExpression(), seen);
  }

  if (Node.isVariableDeclaration(node)) {
    const initializer = node.getInitializer();
    if (!initializer) return undefined;
    return resolveReturnedObjectLiteral(initializer, seen);
  }

  if (Node.isArrowFunction(node)) {
    const body = node.getBody();
    if (Node.isObjectLiteralExpression(body)) return body;
    const block = body.asKind(SyntaxKind.Block);
    if (block) return resolveReturnedObjectLiteralFromStatements(block.getStatements(), seen);
    return resolveReturnedObjectLiteral(body, seen);
  }

  if (Node.isFunctionDeclaration(node) || Node.isFunctionExpression(node)) {
    const body = node.getBody();
    if (!body) return undefined;
    const block = body.asKind(SyntaxKind.Block);
    if (!block) return undefined;
    return resolveReturnedObjectLiteralFromStatements(block.getStatements(), seen);
  }

  if (Node.isCallExpression(node)) {
    return resolveReturnedObjectLiteralFromCallExpression(node, seen);
  }

  if (Node.isIdentifier(node)) {
    for (const declaration of getValueTargetDeclarations(node)) {
      const resolved = resolveReturnedObjectLiteral(declaration, seen);
      if (resolved) return resolved;
    }
  }

  return undefined;
}

function resolveReturnedObjectLiteralFromStatements(
  statements: import('ts-morph').Statement[],
  seen: Set<Node>,
): import('ts-morph').ObjectLiteralExpression | undefined {
  for (const statement of statements) {
    if (!Node.isReturnStatement(statement)) continue;

    const expression = statement.getExpression();
    if (!expression) continue;

    const resolved = resolveReturnedObjectLiteral(expression, seen);
    if (resolved) return resolved;
  }

  return undefined;
}

function resolveReturnedObjectLiteralFromCallExpression(
  callExpression: import('ts-morph').CallExpression,
  seen: Set<Node>,
): import('ts-morph').ObjectLiteralExpression | undefined {
  const expression = callExpression.getExpression();
  if (!Node.isIdentifier(expression)) return undefined;

  for (const declaration of getValueTargetDeclarations(expression)) {
    const resolved = resolveReturnedObjectLiteral(declaration, seen);
    if (resolved) return resolved;
  }

  return undefined;
}

function getExpressionTerminalName(node: Node): string | undefined {
  if (Node.isIdentifier(node)) return node.getText();
  if (Node.isPropertyAccessExpression(node)) return node.getName();
  return undefined;
}

function extractStringLiteralArrayValues(node: Node): string[] | undefined {
  if (!Node.isArrayLiteralExpression(node)) return undefined;

  const keys: string[] = [];
  for (const element of node.getElements()) {
    if (!Node.isStringLiteral(element) && !Node.isNoSubstitutionTemplateLiteral(element)) {
      return undefined;
    }
    keys.push(element.getLiteralText());
  }

  return keys;
}

function extractVueSlotsFromTypeNode(typeNode: Node | undefined, seen: Set<Node>): RawSlotDefinition[] {
  if (!typeNode || seen.has(typeNode)) return [];
  seen.add(typeNode);

  if (Node.isTypeLiteral(typeNode)) {
    return typeNode
      .getMembers()
      .flatMap((member) => {
        if (!Node.isPropertySignature(member)) return [];
        const slotName = member.getName();
        return [{ name: slotName, isDefault: slotName === 'default' }];
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  if (Node.isTypeReference(typeNode)) {
    for (const declaration of getTypeTargetDeclarations(typeNode.getTypeName(), false)) {
      if (Node.isTypeAliasDeclaration(declaration)) {
        return extractVueSlotsFromTypeNode(declaration.getTypeNode(), seen);
      }
      if (Node.isInterfaceDeclaration(declaration)) {
        return declaration
          .getMembers()
          .flatMap((member) => {
            if (!Node.isPropertySignature(member) && !Node.isMethodSignature(member)) return [];
            const slotName = member.getName();
            return [{ name: slotName, isDefault: slotName === 'default' }];
          })
          .sort((a, b) => a.name.localeCompare(b.name));
      }
    }
  }

  return [];
}

function extractVueSlotsFromSetup(options: import('ts-morph').ObjectLiteralExpression): RawSlotDefinition[] {
  const setupProp = options.getProperty('setup');
  if (!setupProp) return [];

  const setupFunction = Node.isMethodDeclaration(setupProp)
    ? setupProp
    : Node.isPropertyAssignment(setupProp)
      ? setupProp.getInitializer()
      : undefined;
  if (!setupFunction) return [];
  if (
    !Node.isMethodDeclaration(setupFunction) &&
    !Node.isArrowFunction(setupFunction) &&
    !Node.isFunctionExpression(setupFunction)
  ) {
    return [];
  }

  const params = setupFunction.getParameters();
  if (params.length < 2) return [];

  const contextParam = params[1];
  const nameNode = contextParam.getNameNode();
  if (!Node.isObjectBindingPattern(nameNode)) return [];

  const slotsBinding = nameNode
    .getElements()
    .find((element) => element.getPropertyNameNode()?.getText() === 'slots' || element.getName() === 'slots');
  if (!slotsBinding) return [];

  const slotsName = slotsBinding.getName();
  const body = setupFunction.getBody();
  if (!body) return [];

  const slotsByName = new Map<string, RawSlotDefinition>();
  for (const access of body.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    if (access.getExpression().getText() !== slotsName) continue;

    const slotName = access.getName();
    if (!slotsByName.has(slotName)) {
      slotsByName.set(slotName, {
        name: slotName,
        isDefault: slotName === 'default',
      });
    }
  }

  return [...slotsByName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
