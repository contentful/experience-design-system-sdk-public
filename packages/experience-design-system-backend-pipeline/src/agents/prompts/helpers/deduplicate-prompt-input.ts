import { createHash } from 'node:crypto';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
interface Fingerprint {
  key: string;
  characters: number;
}

export interface DeduplicatedPromptInput {
  json: string;
  referenceKey?: string;
  referenceCount: number;
  originalCharacters: number;
  compactCharacters: number;
}

/** Replace repeated JSON values with local aliases, retaining every distinct value and its owning path. */
export function deduplicatePromptInput(json: string): DeduplicatedPromptInput {
  const root = JSON.parse(json) as JsonValue;
  const fingerprints = new WeakMap<object, Fingerprint>();
  const strings = new Map<string, Fingerprint>();
  const fieldNames = new Set<string>();
  // Small values stay inline; this is an encoding tradeoff, not an evidence or prompt limit.
  const minimumCharacters = 128;
  const hash = (text: string): string => createHash('sha256').update(text).digest('hex');

  const fingerprint = (value: JsonValue): Fingerprint => {
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'string') {
        const saved = strings.get(value);
        if (saved) return saved;
      }
      const text = JSON.stringify(value);
      const result = { key: text.length < minimumCharacters ? text : `string:${hash(text)}`, characters: text.length };
      if (typeof value === 'string' && result.characters >= minimumCharacters) strings.set(value, result);
      return result;
    }
    const array = Array.isArray(value);
    const entries = array ? value.map((item, index) => [String(index), item] as const) : Object.entries(value);
    const signature: Array<[string, string]> = [];
    let characters = 2;
    for (const [key, item] of entries) {
      fieldNames.add(key);
      const child = fingerprint(item);
      signature.push([key, child.key]);
      characters += child.characters + (array ? 0 : JSON.stringify(key).length + 1);
    }
    characters += Math.max(0, entries.length - 1);
    const result = { key: `${array ? 'array' : 'object'}:${hash(JSON.stringify(signature))}`, characters };
    if (characters >= minimumCharacters) fingerprints.set(value, result);
    return result;
  };
  fingerprint(root);

  let referenceKey = '$promptRef';
  while (fieldNames.has(referenceKey)) referenceKey += '_';
  const infoFor = (value: JsonValue): Fingerprint | undefined =>
    typeof value === 'string'
      ? strings.get(value)
      : value && typeof value === 'object'
        ? fingerprints.get(value)
        : undefined;
  const occurrences = new Map<string, number>();
  const count = (value: JsonValue): void => {
    const info = infoFor(value);
    if (info) {
      const previous = occurrences.get(info.key) ?? 0;
      occurrences.set(info.key, previous + 1);
      // A shared parent carries its children once; do not manufacture duplicate child definitions.
      if (previous) return;
    }
    if (value !== null && typeof value === 'object') for (const item of Object.values(value)) count(item);
  };
  count(root);

  const sharedEvidence: Record<string, JsonValue> = Object.create(null);
  const sharedIds = new Map<string, string>();
  let referenceCount = 0;
  const contents = (value: JsonValue): JsonValue => {
    if (Array.isArray(value)) return value.map(compact);
    if (value !== null && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compact(item)]));
    return value;
  };
  const compact = (value: JsonValue): JsonValue => {
    const info = infoFor(value);
    if (info && (occurrences.get(info.key) ?? 0) > 1) {
      let id = sharedIds.get(info.key);
      if (id === undefined) {
        id = `e${sharedIds.size}`;
        sharedIds.set(info.key, id);
        sharedEvidence[id] = contents(value);
      }
      referenceCount++;
      return { [referenceKey]: `#/sharedEvidence/${id}` };
    }
    return contents(value);
  };
  const data = compact(root);
  const output = JSON.stringify(referenceCount ? { data, sharedEvidence } : data);
  return {
    json: output,
    ...(referenceCount ? { referenceKey } : {}),
    referenceCount,
    originalCharacters: json.length,
    compactCharacters: output.length,
  };
}

export function promptReferenceInstructions(referenceKey: string): string {
  return `Input data uses a lossless shared-evidence encoding. Original stage input fields are under data; sharedEvidence stores repeated values once. An object whose only key is ${JSON.stringify(referenceKey)} stands for the exact value at its JSON Pointer in this same Input data document (for example #/sharedEvidence/e0). Resolve aliases before interpreting evidence, including aliases nested inside their targets. Every target is retained in this document; no evidence was omitted. These aliases only avoid repeated text: they do not merge owners, declarations, source inputs, domains, requiredness or coverage, and are not source type references or output fields. Return normal stage output without transport aliases or the input encoding wrapper.`;
}
