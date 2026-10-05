import { Node, SyntaxKind } from 'ts-morph';
import type { RawSlotDefinition } from '../../../types/component.js';
import { getTypeTargetDeclarations } from '../../shared/helpers/tsx-shared.js';

function extractTypeMemberSlots(members: Node[], allowMethods: boolean): RawSlotDefinition[] {
  return members
    .flatMap((member) => {
      if (!Node.isPropertySignature(member) && (!allowMethods || !Node.isMethodSignature(member))) return [];
      const slotName = member.getName();
      return [{ name: slotName, isDefault: slotName === 'default' }];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function extractSlotsFromTypeNode(typeNode: Node | undefined, seen: Set<Node>): RawSlotDefinition[] {
  if (!typeNode || seen.has(typeNode)) return [];
  seen.add(typeNode);

  if (Node.isTypeLiteral(typeNode)) {
    return extractTypeMemberSlots(typeNode.getMembers(), false);
  }

  if (Node.isTypeReference(typeNode)) {
    for (const declaration of getTypeTargetDeclarations(typeNode.getTypeName(), false)) {
      if (Node.isTypeAliasDeclaration(declaration)) {
        return extractSlotsFromTypeNode(declaration.getTypeNode(), seen);
      }
      if (Node.isInterfaceDeclaration(declaration)) {
        return extractTypeMemberSlots(declaration.getMembers(), true);
      }
    }
  }

  return [];
}

function extractSlotsFromSetupFunction(options: import('ts-morph').ObjectLiteralExpression): RawSlotDefinition[] {
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
    .find((el) => el.getPropertyNameNode()?.getText() === 'slots' || el.getName() === 'slots');
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

/** Extracts slots from a `defineComponent` options object, preferring type-level declarations over setup access. */
export function extractVueTsxComponentSlots(
  options: import('ts-morph').ObjectLiteralExpression,
  slotsTypeNode: Node | undefined,
): RawSlotDefinition[] {
  const slotsByName = new Map<string, RawSlotDefinition>();

  if (slotsTypeNode) {
    for (const slot of extractSlotsFromTypeNode(slotsTypeNode, new Set<Node>())) {
      slotsByName.set(slot.name, slot);
    }
  }

  for (const slot of extractSlotsFromSetupFunction(options)) {
    if (!slotsByName.has(slot.name)) slotsByName.set(slot.name, slot);
  }

  return [...slotsByName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
