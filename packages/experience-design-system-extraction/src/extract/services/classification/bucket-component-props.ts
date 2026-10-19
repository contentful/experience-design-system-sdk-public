import type { RawComponentDefinition } from '../../types/component.js';
import type { PropBucketAssignment } from '../../types/classification.js';

export function bucketComponentProps(component: RawComponentDefinition): PropBucketAssignment {
  const customPropNames: string[] = [];
  const domPassthroughPropNames: string[] = [];
  const otherPropNames: string[] = [];

  for (const prop of component.props) {
    if (!prop.type.trim()) {
      otherPropNames.push(prop.name);
    } else if (prop.domAttribute === true) {
      domPassthroughPropNames.push(prop.name);
    } else {
      customPropNames.push(prop.name);
    }
  }

  const sortNames = (names: string[]): string[] => names.toSorted((left, right) => left.localeCompare(right));

  return {
    component: component.name,
    source: component.source,
    customPropNames: sortNames(customPropNames),
    domPassthroughPropNames: sortNames(domPassthroughPropNames),
    otherPropNames: sortNames(otherPropNames),
  };
}

export function bucketComponentsProps(components: readonly RawComponentDefinition[]): PropBucketAssignment[] {
  return components
    .map(bucketComponentProps)
    .toSorted((left, right) =>
      `${left.component}\u0000${left.source}`.localeCompare(`${right.component}\u0000${right.source}`),
    );
}
