export { isReactNodeType, isArrayReactNodeType } from './ast/detect-react-node-types.js';
import { isReactNodeType, isArrayReactNodeType } from './ast/detect-react-node-types.js';

/**
 * Prop names that should remain as props even when typed as ReactNode.
 * These are typically text-content names, not composable slots.
 */
export const CONTENT_NAME_EXCEPTIONS = new Set([
  'label',
  'title',
  'description',
  'text',
  'caption',
  'message',
  'placeholder',
  'tooltip',
  'heading',
  'subheading',
  'body',
  'summary',
  'excerpt',
]);

/**
 * Determines whether a prop should be converted to a slot based on its name and type.
 *
 * Rules:
 * 1. If the type is not a ReactNode type → false
 * 2. If the type is an array ReactNode → true (overrides exception list)
 * 3. If the name is in the content-name exception list → false
 * 4. Otherwise → true
 */
export function shouldBeSlot(propName: string, typeText: string): boolean {
  if (!isReactNodeType(typeText)) return false;
  if (isArrayReactNodeType(typeText)) return true;
  if (CONTENT_NAME_EXCEPTIONS.has(propName)) return false;
  return true;
}
