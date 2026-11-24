import { Node, type TypeNode } from 'ts-morph';

export interface ResolvedPropType {
  text: string;

  allowedValues: string[] | null;
}

export function resolvePropType(typeNode: TypeNode | undefined): ResolvedPropType {
  if (!typeNode) {
    return { text: 'any', allowedValues: null };
  }
  const text = typeNode.getText();
  const members = extractStringLiteralUnion(typeNode);
  return {
    text,
    allowedValues: members.length > 0 ? members : null,
  };
}

function extractStringLiteralUnion(typeNode: TypeNode): string[] {
  if (Node.isLiteralTypeNode(typeNode)) {
    const lit = typeNode.getLiteral();
    if (Node.isStringLiteral(lit) || Node.isNoSubstitutionTemplateLiteral(lit)) {
      return [lit.getLiteralText()];
    }
    return [];
  }
  if (Node.isUnionTypeNode(typeNode)) {
    const out: string[] = [];
    for (const member of typeNode.getTypeNodes()) {
      const sub = extractStringLiteralUnion(member);
      if (sub.length === 0 && !isNullOrUndefinedLiteral(member)) {
        return [];
      }
      out.push(...sub);
    }
    return out;
  }
  return [];
}

function isNullOrUndefinedLiteral(typeNode: TypeNode): boolean {
  if (Node.isLiteralTypeNode(typeNode)) {
    const lit = typeNode.getLiteral();
    if (Node.isNullLiteral(lit)) return true;
  }
  const t = typeNode.getText();
  return t === 'null' || t === 'undefined';
}
