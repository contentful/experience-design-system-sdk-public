import { parse, parseFragment, type DefaultTreeAdapterMap } from 'parse5';

/** A parser roundtrip reads child survival without a private HTML element policy. */
export function readIntrinsicChildGrammar(name: string): 'consumed' | 'discarded' | 'unavailable' {
  if (!/^[a-z][a-z0-9:._-]*$/i.test(name) || name.length > 256) return 'unavailable';
  const marker = 'source-child-witness';
  const source = `<${name}><template>${marker}</template></${name}>`;
  type Node = DefaultTreeAdapterMap['node'];
  const contains = (node: Node): boolean =>
    ('value' in node && node.value.includes(marker)) ||
    ('childNodes' in node && node.childNodes.some(contains)) ||
    ('content' in node && contains(node.content));
  const find = (node: Node): Node | undefined => {
    if ('tagName' in node && node.tagName === name.toLowerCase()) return node;
    if ('childNodes' in node)
      for (const child of node.childNodes) {
        const match = find(child);
        if (match) return match;
      }
    return undefined;
  };
  const element = find(parseFragment(source)) ?? find(parse(source));
  return element ? (contains(element) ? 'consumed' : 'discarded') : 'unavailable';
}
