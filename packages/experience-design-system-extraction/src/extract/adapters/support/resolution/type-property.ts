import type { Node, Type } from 'ts-morph';

type TypeProperty = {
  getName(): string;
  getValueDeclaration(): Node | undefined;
  getDeclarations(): Node[];
  getTypeAtLocation(node: Node): Type;
  isOptional(): boolean;
};

export type ResolvedTypeProperty = {
  name: string;
  declaration: Node;
  typeText: string;
  required: boolean;
};

export function resolveTypeProperty(property: TypeProperty): ResolvedTypeProperty | null {
  const declaration = property.getValueDeclaration() ?? property.getDeclarations()[0];
  if (!declaration) return null;

  return {
    name: property.getName(),
    declaration,
    typeText: property.getTypeAtLocation(declaration).getText(declaration),
    required: !property.isOptional(),
  };
}
