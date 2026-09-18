import type { Node } from 'ts-morph';
import type { RawPropDefinition } from '../types.js';

type LineAwareNode = Node & {
  getStartLineNumber?: () => number;
  getEndLineNumber?: () => number;
};

export function getSourceLineMetadata(
  declaration: Node | undefined,
): Pick<RawPropDefinition, 'sourceStartLine' | 'sourceEndLine'> {
  if (!declaration) return {};

  const lineAwareDeclaration = declaration as LineAwareNode;
  if (
    typeof lineAwareDeclaration.getStartLineNumber !== 'function' ||
    typeof lineAwareDeclaration.getEndLineNumber !== 'function'
  ) {
    return {};
  }

  return {
    sourceStartLine: lineAwareDeclaration.getStartLineNumber(),
    sourceEndLine: lineAwareDeclaration.getEndLineNumber(),
  };
}
