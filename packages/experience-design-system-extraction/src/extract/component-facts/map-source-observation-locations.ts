import type { SourceFactLocation } from '../candidates/types.js';
import type {
  ComponentSourceObservationCollection,
  SourceInputAccessPath,
  SourceSymbolEvidence,
  SourceCallableSignature,
} from '../types/component-source-observations.js';

/** Visit every location in the plain observation contract, including external origins. */
export function mapSourceObservationLocations(
  collection: ComponentSourceObservationCollection,
  map: (location: SourceFactLocation) => SourceFactLocation,
): ComponentSourceObservationCollection {
  const nullable = (location: SourceFactLocation | null) => (location ? map(location) : null);
  const path = (value: SourceInputAccessPath | null): SourceInputAccessPath | null =>
    value ? { ...value, rootDeclaration: map(value.rootDeclaration) } : null;
  const symbol = (value: SourceSymbolEvidence | null): SourceSymbolEvidence | null =>
    value
      ? {
          ...value,
          aliases: value.aliases.map((alias) => ({ ...alias, location: map(alias.location) })),
          declarations: value.declarations.map((declaration) => ({
            ...declaration,
            location: map(declaration.location),
            origin: {
              ...declaration.origin,
              package: declaration.origin.package
                ? { ...declaration.origin.package, manifest: map(declaration.origin.package.manifest) }
                : null,
            },
          })),
        }
      : null;
  const signature = (value: SourceCallableSignature): SourceCallableSignature => ({
    ...value,
    declaration: nullable(value.declaration),
    parameters: value.parameters.map((parameter) => ({ ...parameter, location: nullable(parameter.location) })),
  });
  return {
    ...collection,
    observations: collection.observations.map((observation) => ({
      ...observation,
      location: map(observation.location),
      subject: symbol(observation.subject),
      ...(observation.inputPath !== undefined ? { inputPath: path(observation.inputPath) } : {}),
      context: {
        ...observation.context,
        lexicalDeclaration: nullable(observation.context.lexicalDeclaration),
        conditions: observation.context.conditions.map((condition) => ({
          ...condition,
          location: map(condition.location),
        })),
      },
      ...(observation.type
        ? {
            type: {
              ...observation.type,
              signatures: observation.type.signatures.map(signature),
              ...(observation.type.resolvedSignature !== undefined
                ? {
                    resolvedSignature: observation.type.resolvedSignature
                      ? signature(observation.type.resolvedSignature)
                      : null,
                  }
                : {}),
            },
          }
        : {}),
      ...(observation.operands
        ? {
            operands: observation.operands.map((operand) => ({
              ...operand,
              location: map(operand.location),
              symbol: symbol(operand.symbol),
              inputPath: path(operand.inputPath),
            })),
          }
        : {}),
      ...(observation.resultUse
        ? { resultUse: { ...observation.resultUse, location: map(observation.resultUse.location) } }
        : {}),
    })),
    omissions: collection.omissions.map((omission) => ({ ...omission, location: nullable(omission.location) })),
  };
}
