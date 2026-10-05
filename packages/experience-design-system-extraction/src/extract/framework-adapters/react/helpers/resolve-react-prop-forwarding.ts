import type { RawComponentDefinition } from '../../../types/component.js';
import type { PropForwardingEdge } from './collect-prop-dataflow.js';

type ComponentWithIdentity = RawComponentDefinition & {
  _componentIdentity?: string;
  _propForwardingEdges?: PropForwardingEdge[];
};

export function resolveReactPropForwarding(components: ComponentWithIdentity[]): void {
  const componentsByIdentity = new Map(
    components.filter((c) => c._componentIdentity).map((c) => [c._componentIdentity!, c]),
  );

  let changed = true;
  while (changed) {
    changed = false;
    for (const component of components) {
      for (const edge of component._propForwardingEdges ?? []) {
        const target = componentsByIdentity.get(edge.targetComponentIdentity);
        const targetProp = target?.props.find((prop) => prop.name === edge.targetProp);
        const sourceProp = component.props.find((prop) => prop.name === edge.sourceProp);
        if (targetProp?.domAttribute && sourceProp && !sourceProp.domAttribute) {
          sourceProp.domAttribute = true;
          changed = true;
        }
      }
    }
  }

  for (const component of components) {
    delete component._componentIdentity;
    delete component._propForwardingEdges;
  }
}
