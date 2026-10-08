import { randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeBase32(bytes: Uint8Array, length: number): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD[(value >> bits) & 0x1f];
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 0x1f];
  return out.slice(0, length);
}

export function generateUlid(now: number = Date.now()): string {
  const tsBytes = new Uint8Array(6);
  let n = now;
  for (let i = 5; i >= 0; i--) {
    tsBytes[i] = n & 0xff;
    n = Math.floor(n / 256);
  }
  const ts = encodeBase32(tsBytes, 10);
  const rand = encodeBase32(randomBytes(10), 16);
  return (ts + rand).toUpperCase();
}
