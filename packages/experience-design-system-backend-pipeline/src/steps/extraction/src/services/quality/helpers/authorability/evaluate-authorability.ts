import type { RawComponentDefinition, RawPropDefinition, RawSlotDefinition } from '../../../../types/component.js';

interface AuthoringSurfaceCheck {
  skip: boolean;
  reason?: string;
}

/** No extracted inputs is a review observation, not proof that a component cannot be authored. */
export function hasNoPropsAndNoSlots(props: RawPropDefinition[], slots: RawSlotDefinition[]): boolean {
  return props.length === 0 && slots.length === 0;
}

/** Names, type text and file-level calls do not establish the component's authoring behavior. */
export function hasNoAuthoringSurface(component: RawComponentDefinition): AuthoringSurfaceCheck {
  if (hasNoPropsAndNoSlots(component.props, component.slots))
    return { skip: true, reason: 'component has no props and no slots' };
  return { skip: false };
}
