const REACT_NODE_EXACT_PATTERNS = ['ReactNode', 'React.ReactNode', 'ReactElement', 'React.ReactElement', 'JSX.Element'];

function normalizeReactNodeType(typeText: string): string {
  return typeText
    .replace(/\s+/g, ' ')
    .trim()
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part !== 'null' && part !== 'undefined')
    .join(' | ');
}

export function isArrayReactNodeType(typeText: string): boolean {
  const stripped = normalizeReactNodeType(typeText);
  for (const pattern of REACT_NODE_EXACT_PATTERNS) {
    if (stripped === `${pattern}[]` || stripped === `Array<${pattern}>`) return true;
  }
  return false;
}

export function isReactNodeType(typeText: string): boolean {
  const stripped = normalizeReactNodeType(typeText);
  if (REACT_NODE_EXACT_PATTERNS.includes(stripped)) return true;
  return isArrayReactNodeType(typeText);
}
