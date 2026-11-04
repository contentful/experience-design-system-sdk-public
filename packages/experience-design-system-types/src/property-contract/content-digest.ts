import { jsonValueIssue } from './json-value.js';

/** Stable SHA-256 identity for plain source/plan data in Node and browser runtimes. */
export function contentDigest(value: unknown): string {
  const issue = jsonValueIssue(value);
  if (issue) throw new Error(issue.message);
  const canonical = (input: unknown): string => {
    if (Array.isArray(input)) return '[' + input.map(canonical).join(',') + ']';
    if (input && typeof input === 'object')
      return (
        '{' +
        Object.keys(input)
          .sort()
          .map((key) => JSON.stringify(key) + ':' + canonical((input as Record<string, unknown>)[key]))
          .join(',') +
        '}'
      );
    return JSON.stringify(input);
  };
  const bytes = new TextEncoder().encode(canonical(value));
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 128;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000));
  view.setUint32(padded.length - 4, bytes.length * 8);
  const primes: number[] = [];
  for (let candidate = 2; primes.length < 64; candidate++)
    if (!primes.some((prime) => prime * prime <= candidate && candidate % prime === 0)) primes.push(candidate);
  const initial = primes.slice(0, 8).map((prime) => ((Math.sqrt(prime) % 1) * 0x100000000) >>> 0);
  const constants = primes.map((prime) => ((Math.cbrt(prime) % 1) * 0x100000000) >>> 0);
  const rotate = (word: number, bits: number) => (word >>> bits) | (word << (32 - bits));
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = new Uint32Array(64);
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = words[i - 15]!,
        y = words[i - 2]!;
      words[i] =
        (words[i - 16]! +
          (rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3)) +
          words[i - 7]! +
          (rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10))) >>>
        0;
    }
    let [a, b, c, d, e, f, g, h] = initial;
    for (let i = 0; i < 64; i++) {
      const first =
        (h! +
          (rotate(e!, 6) ^ rotate(e!, 11) ^ rotate(e!, 25)) +
          ((e! & f!) ^ (~e! & g!)) +
          constants[i]! +
          words[i]!) >>>
        0;
      const second = ((rotate(a!, 2) ^ rotate(a!, 13) ^ rotate(a!, 22)) + ((a! & b!) ^ (a! & c!) ^ (b! & c!))) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d! + first) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (first + second) >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((word, i) => {
      initial[i] = (initial[i]! + word!) >>> 0;
    });
  }
  return initial.map((word) => word.toString(16).padStart(8, '0')).join('');
}
