import type { ParameterDeclaration, Type } from 'ts-morph';
import type { RawPropDefinition } from '../../../types/component.js';
import type { SourceCandidateObservation } from '../../../candidates/types.js';
import { observeRawProps, observeTypeProps } from '../../../candidates/source-candidates.js';
import { inferPrimitiveDomPropsFromImplementation } from './collect-react-impl-hints.js';
import { extractDestructuredBindingFallbackProps } from './extract-react-binding-defaults.js';
import type { FunctionLike } from './resolve-component-function.js';

/** Source observations remain independent of the current authoring fallback gates. */
export function collectReactSourceObservations(
  type: Type,
  props: readonly RawPropDefinition[],
  sourcePath: string,
  funcNode: FunctionLike,
  parameter: ParameterDeclaration,
  options: {
    suppressProps: boolean;
    renderPropSlotNames: Set<string>;
    syntheticDomProps: readonly RawPropDefinition[];
    runtimeProps: readonly RawPropDefinition[];
    sourceDefaults: ReadonlyMap<string, string>;
  },
): SourceCandidateObservation[] {
  const declared = new Map(props.map((prop) => [prop.name, prop]));
  for (const property of type.getProperties()) {
    if (declared.has(property.getName())) continue;
    const declaration = property.getValueDeclaration() ?? property.getDeclarations()[0];
    if (!declaration) continue;
    declared.set(property.getName(), {
      name: property.getName(),
      type: property.getTypeAtLocation(declaration).getText(declaration),
      required: !property.isOptional(),
    });
  }
  return [
    ...observeTypeProps(type, [...declared.values()], sourcePath, { sourceDefaults: options.sourceDefaults }),
    ...observeRawProps(options.syntheticDomProps, 'declaration', { origin: 'inherited-dom' }),
    ...observeRawProps(
      options.suppressProps ? [] : inferPrimitiveDomPropsFromImplementation(funcNode, parameter),
      'implementation',
    ),
    ...observeRawProps(
      options.suppressProps
        ? []
        : extractDestructuredBindingFallbackProps(funcNode, parameter, options.renderPropSlotNames),
      'binding',
      { sourceDefaults: options.sourceDefaults },
    ),
    ...observeRawProps(options.runtimeProps, 'runtime-object', { sourceDefaults: options.sourceDefaults }),
  ];
}
