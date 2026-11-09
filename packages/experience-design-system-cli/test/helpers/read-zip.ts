import { expect } from 'vitest';
import { crc32, inflateRawSync } from 'node:zlib';

/**
 * Reads a zip the way an unzip tool does: from the directory at the end of the file, checking each entry's size and
 * checksum. A zip that only the code that wrote it can read would be no use to the person it is sent to.
 */
export function readZip(zip: Buffer): Array<{ name: string; data: Buffer }> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThanOrEqual(0);
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);

  const entries: Array<{ name: string; data: Buffer }> = [];
  for (let i = 0; i < count; i += 1) {
    expect(zip.readUInt32LE(offset)).toBe(0x02014b50);
    const checksum = zip.readUInt32LE(offset + 16);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');

    expect(zip.readUInt32LE(localOffset)).toBe(0x04034b50);
    const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const data = inflateRawSync(zip.subarray(start, start + compressedSize));
    expect(data.length).toBe(size);
    expect(crc32(data)).toBe(checksum);

    entries.push({ name, data });
    offset += 46 + nameLength;
  }
  return entries;
}
