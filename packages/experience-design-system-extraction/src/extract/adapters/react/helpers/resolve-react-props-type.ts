import { Node, type ParameterDeclaration, type VariableDeclaration } from 'ts-morph';
import { getTypeReferenceName } from '../../support/tsx-shared.js';
import { isPureExpandableDomAttributeWrapperType } from './detect-dom-type-patterns.js';

const PROP_WRAPPER_TYPE_NAMES = new Set(['ExpandProps']);
const CHILD_WRAPPER_TYPE_NAMES = new Set(['PropsWithChildren']);
const FC_TYPE_NAMES = new Set(['FC', 'FunctionComponent', 'VFC', 'VoidFunctionComponent']);

export function normalizePropsTypeNode(typeNode: Node): {
  typeNode: Node;
  hasWrappedChildren: boolean;
  suppressProps: boolean;
} {
  if (!Node.isTypeReference(typeNode)) {
    return { typeNode, hasWrappedChildren: false, suppressProps: false };
  }

  const typeName = getTypeReferenceName(typeNode);
  if (!typeName) {
    return { typeNode, hasWrappedChildren: false, suppressProps: false };
  }

  if (PROP_WRAPPER_TYPE_NAMES.has(typeName)) {
    const firstTypeArg = typeNode.getTypeArguments()[0];
    if (!firstTypeArg) return { typeNode, hasWrappedChildren: false, suppressProps: false };
    return normalizePropsTypeNode(firstTypeArg);
  }

  if (CHILD_WRAPPER_TYPE_NAMES.has(typeName)) {
    const firstTypeArg = typeNode.getTypeArguments()[0];
    if (!firstTypeArg) return { typeNode, hasWrappedChildren: true, suppressProps: false };

    if (isPureExpandableDomAttributeWrapperType(firstTypeArg)) {
      return { typeNode: firstTypeArg, hasWrappedChildren: true, suppressProps: true };
    }

    const normalized = normalizePropsTypeNode(firstTypeArg);
    return { ...normalized, hasWrappedChildren: true };
  }

  return { typeNode, hasWrappedChildren: false, suppressProps: false };
}

export function resolveForwardRefGenericPropsTypeNode(param: ParameterDeclaration): Node | undefined {
  const parent = param.getParent();
  if (!Node.isArrowFunction(parent) && !Node.isFunctionExpression(parent)) return undefined;

  const callExpression = parent.getParent();
  if (!Node.isCallExpression(callExpression)) return undefined;

  const expressionText = callExpression.getExpression().getText();
  if (!/(^|\.)forwardRef$/.test(expressionText)) return undefined;

  const [, propsTypeNode] = callExpression.getTypeArguments();
  return propsTypeNode;
}

export function resolveFCGenericPropsTypeNode(param: ParameterDeclaration): Node | undefined {
  const funcNode = param.getParent();
  if (!Node.isArrowFunction(funcNode) && !Node.isFunctionExpression(funcNode)) return undefined;

  const varDecl = funcNode.getParent();
  if (!Node.isVariableDeclaration(varDecl)) return undefined;

  const typeNode = (varDecl as VariableDeclaration).getTypeNode();
  if (!typeNode || !Node.isTypeReference(typeNode)) return undefined;

  const typeName = typeNode.getTypeName().getText().split('.').pop();
  if (!typeName || !FC_TYPE_NAMES.has(typeName)) return undefined;

  const typeArgs = typeNode.getTypeArguments();
  return typeArgs[0];
}

export function resolvePropsType(param: ParameterDeclaration): {
  type: import('ts-morph').Type;
  typeNode: Node;
  hasWrappedChildren: boolean;
  suppressProps: boolean;
} {
  const typeNode = param.getTypeNode();
  const fcGenericPropsTypeNode = resolveFCGenericPropsTypeNode(param);
  const fallbackTypeNode = resolveForwardRefGenericPropsTypeNode(param) ?? fcGenericPropsTypeNode;
  const effectiveTypeNode = typeNode ?? fallbackTypeNode;
  if (!effectiveTypeNode) {
    return {
      type: param.getType(),
      typeNode: param.getTypeNode() ?? param,
      hasWrappedChildren: false,
      suppressProps: false,
    };
  }

  const normalized = normalizePropsTypeNode(effectiveTypeNode);
  return {
    type: normalized.typeNode.getType(),
    typeNode: normalized.typeNode,
    hasWrappedChildren: normalized.hasWrappedChildren || fcGenericPropsTypeNode !== undefined,
    suppressProps: normalized.suppressProps,
  };
}
