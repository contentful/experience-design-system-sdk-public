import { crc32, deflateRawSync } from 'node:zlib';

// A small zip writer, for the one thing the CLI zips: a folder of text logs. Every entry is deflated, names are UTF-8, and
// nothing needs the zip64 extension (no entry or archive anywhere near 4 GB, and fewer than 65,535 entries).

export interface ZipEntry {
  /** The path inside the zip, with `/` between folders. */
  name: string;
  data: Buffer;
  modified: Date;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_ARCHIVE = 0x06054b50;
const VERSION = 20;
// The end-of-archive record counts entries in 16 bits, and this writer has no zip64 form for more.
const MAX_ENTRIES = 0xffff;
const UTF8_NAMES = 0x0800;
const DEFLATE = 8;

function dosDateTime(date: Date): { day: number; time: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
  };
}

export function createZip(entries: readonly ZipEntry[]): Buffer {
  if (entries.length > MAX_ENTRIES)
    throw new Error(`a zip made here holds at most ${MAX_ENTRIES} files, not ${entries.length}`);
  const body: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = deflateRawSync(entry.data);
    const checksum = crc32(entry.data);
    const { day, time } = dosDateTime(entry.modified);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(DEFLATE, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    body.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_HEADER, 0);
    central.writeUInt16LE(VERSION, 4);
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(UTF8_NAMES, 8);
    central.writeUInt16LE(DEFLATE, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_ARCHIVE, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...body, directoryBytes, end]);
}
