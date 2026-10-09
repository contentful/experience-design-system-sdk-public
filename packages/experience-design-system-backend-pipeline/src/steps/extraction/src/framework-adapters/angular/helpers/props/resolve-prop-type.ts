import { Node, type TypeNode } from 'ts-morph';

export interface ResolvedPropType {
  /** Human-readable type source text (`'sm' | 'md' | 'lg'`, `string`, `boolean`). */
  text: string;
  /** Literal union members when the type is a short string-literal union; else `null`. */
  allowedValues: string[] | null;
  /** True when the type is or includes `TemplateRef<...>` (signals slot, not prop). */
  isTemplateRef: boolean;
}

/**
 * Collapse a TS type node into the shape the pipeline wants.
 * Handles the three cases that matter for the real-world DS corpus:
 *   - string-literal unions → list the members
 *   - `TemplateRef<...>` (anywhere in a union) → mark as slot candidate
 *   - everything else → source text, no allowed-values
 *
 * One-hop alias resolution is not implemented in v1; `type: FooBar` just emits
 * `FooBar` as the type text. Verified against the real DS corpus: 0/5 of the
 * sampled components used computed selectors / spread inputs, so this covers
 * the dominant idioms.
 */
export function resolvePropType(typeNode: TypeNode | undefined): ResolvedPropType {
  if (!typeNode) {
    return { text: 'any', allowedValues: null, isTemplateRef: false };
  }
  const text = typeNode.getText();
  const members = extractStringLiteralUnion(typeNode);
  const isTemplateRef = containsTemplateRef(typeNode);
  return {
    text,
    allowedValues: members.length > 0 ? members : null,
    isTemplateRef,
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
        // mixed union (string | number, string | SomeType) — abandon
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

function containsTemplateRef(typeNode: TypeNode): boolean {
  const text = typeNode.getText();
  // Cheap text match — Angular's TemplateRef is a well-known import name.
  // Covers `TemplateRef<void>`, `TemplateRef<Ctx>`, and union members
  // like `string | TemplateRef<...>` without a full type-walk.
  return /\bTemplateRef\b/.test(text);
}
