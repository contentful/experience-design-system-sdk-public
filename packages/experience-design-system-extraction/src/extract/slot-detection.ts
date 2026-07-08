/**
 * Slot detection utilities for ReactNode-typed props.
 *
 * Props whose type resolves to ReactNode/ReactElement/JSX.Element are treated
 * as slots rather than plain props — unless their name is in the content-name
 * exception list (label, title, description, etc.).
 *
 * Array ReactNode types (e.g. ReactNode[]) ALWAYS become slots, even if the
 * prop name is in the exception list.
 */

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

const REACT_NODE_EXACT_PATTERNS = ['ReactNode', 'React.ReactNode', 'ReactElement', 'React.ReactElement', 'JSX.Element'];

/**
 * Checks if a type string represents a ReactNode/ReactElement/JSX.Element type,
 * including unions with null/undefined.
 */
export function isReactNodeType(typeText: string): boolean {
  const normalized = typeText.replace(/\s+/g, ' ').trim();

  // Strip optional markers and union with null/undefined
  const stripped = normalized
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part !== 'null' && part !== 'undefined')
    .join(' | ');

  // Check exact match (after stripping null/undefined union members)
  if (REACT_NODE_EXACT_PATTERNS.includes(stripped)) {
    return true;
  }

  // Check array patterns
  if (isArrayReactNodeType(typeText)) {
    return true;
  }

  return false;
}

/**
 * Checks if a type string represents an array of ReactNode.
 * Examples: ReactNode[], React.ReactNode[], Array<ReactNode>
 */
export function isArrayReactNodeType(typeText: string): boolean {
  const normalized = typeText.replace(/\s+/g, ' ').trim();

  // Strip optional markers and union with null/undefined
  const stripped = normalized
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part !== 'null' && part !== 'undefined')
    .join(' | ');

  // Pattern: ReactNode[] or React.ReactNode[] etc.
  for (const pattern of REACT_NODE_EXACT_PATTERNS) {
    if (stripped === `${pattern}[]`) {
      return true;
    }
  }

  // Pattern: Array<ReactNode> or Array<React.ReactNode> etc.
  for (const pattern of REACT_NODE_EXACT_PATTERNS) {
    if (stripped === `Array<${pattern}>`) {
      return true;
    }
  }

  return false;
}

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
  if (!isReactNodeType(typeText)) {
    return false;
  }

  // Array ReactNode always becomes a slot, even for exception names
  if (isArrayReactNodeType(typeText)) {
    return true;
  }

  // Check exception list
  if (CONTENT_NAME_EXCEPTIONS.has(propName)) {
    return false;
  }

  return true;
}
