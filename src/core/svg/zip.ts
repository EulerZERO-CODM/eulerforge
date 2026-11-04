/**
 * A minimal, deterministic ZIP writer.
 *
 * An icon set is several files, and the browser can only hand the user one download per click, so the
 * alternatives were an npm dependency, a directory-shaped single SVG, or this. The dependency is
 * larger than the problem (a zip writer for stored entries is about a hundred lines, the CRC table is
 * the only table, and no compression is needed for SVG which is already text that gzips well in
 * transit), and shipping a real `.zip` means the result opens in every tool the user already has.
 *
 * Two deliberate choices:
 *
 * - **Stored, not deflated.** Compression would need `zlib`, which is a Node module and therefore not
 *   available in the browser bundle this code runs in. Stored entries are valid zip and every
 *   unpacker reads them.
 * - **A fixed timestamp.** Zip records a modification date; using the current time would make two
 *   exports of the same artwork differ byte for byte, and "identical input, identical file" is a
 *   property this platform tests elsewhere. The date is the zip epoch, 1980-01-01.
 */

export type ZipEntry = {
  /** Path inside the archive, with `/` separators. */
  readonly name: string;
  readonly data: Uint8Array;
};

const CRC_TABLE: readonly number[] = (() => {
  const table: number[] = [];
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table.push(value >>> 0);
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    const index = (crc ^ byte) & 0xff;
    crc = ((CRC_TABLE[index] ?? 0) ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Zip's DOS timestamp for 1980-01-01 00:00:00: the earliest value the format can express. */
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;

class ByteWriter {
  private readonly chunks: number[] = [];

  public get length(): number {
    return this.chunks.length;
  }

  public u16(value: number): void {
    this.chunks.push(value & 0xff, (value >>> 8) & 0xff);
  }

  public u32(value: number): void {
    this.chunks.push(
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff,
    );
  }

  public bytes(values: Uint8Array): void {
    for (const byte of values) this.chunks.push(byte);
  }

  public ascii(value: string): void {
    for (const character of value) this.chunks.push(character.charCodeAt(0) & 0xff);
  }

  public toUint8Array(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

function encodeText(value: string): Uint8Array {
  // Names and payloads in an icon set are UTF-8. `TextEncoder` is a global in both Node and the
  // browser, and is not a DOM API, so it is safe inside `src/core/**`.
  return new TextEncoder().encode(value);
}

/**
 * Builds a zip archive from named entries.
 *
 * Entry order is preserved, so the archive is a function of its inputs and nothing else.
 */
export function createZip(entries: readonly ZipEntry[]): Uint8Array {
  const writer = new ByteWriter();
  const central: { name: Uint8Array; crc: number; size: number; offset: number }[] = [];

  for (const entry of entries) {
    const name = encodeText(entry.name);
    const crc = crc32(entry.data);
    const offset = writer.length;

    writer.u32(0x04034b50); // local file header
    writer.u16(20); // version needed to extract: 2.0
    writer.u16(0); // flags: names and payloads are ASCII or UTF-8 without a flag, and sizes are known
    writer.u16(0); // method: stored
    writer.u16(DOS_TIME);
    writer.u16(DOS_DATE);
    writer.u32(crc);
    writer.u32(entry.data.length);
    writer.u32(entry.data.length);
    writer.u16(name.length);
    writer.u16(0); // extra field length
    writer.bytes(name);
    writer.bytes(entry.data);

    central.push({ name, crc, size: entry.data.length, offset });
  }

  const centralOffset = writer.length;
  for (const record of central) {
    writer.u32(0x02014b50); // central directory header
    writer.u16(20); // version made by
    writer.u16(20); // version needed
    writer.u16(0); // flags
    writer.u16(0); // method: stored
    writer.u16(DOS_TIME);
    writer.u16(DOS_DATE);
    writer.u32(record.crc);
    writer.u32(record.size);
    writer.u32(record.size);
    writer.u16(record.name.length);
    writer.u16(0); // extra
    writer.u16(0); // comment
    writer.u16(0); // disk number
    writer.u16(0); // internal attributes
    writer.u32(0); // external attributes
    writer.u32(record.offset);
    writer.bytes(record.name);
  }
  const centralSize = writer.length - centralOffset;

  writer.u32(0x06054b50); // end of central directory
  writer.u16(0); // this disk
  writer.u16(0); // disk with central directory
  writer.u16(central.length);
  writer.u16(central.length);
  writer.u32(centralSize);
  writer.u32(centralOffset);
  writer.u16(0); // comment length

  return writer.toUint8Array();
}

/**
 * Reads the entry names and sizes out of an archive this module wrote.
 *
 * Present so the tests can assert what a download actually contains without unzipping it with another
 * library: the reader and the writer are checked against each other, and a hostile file is not the
 * input to either.
 */
export function readZipEntryNames(bytes: Uint8Array): readonly string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset + 4 <= bytes.length; offset += 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue;
    const count = view.getUint16(offset + 10, true);
    let cursor = view.getUint32(offset + 16, true);
    const names: string[] = [];
    for (let index = 0; index < count; index += 1) {
      if (cursor + 46 > bytes.length) break;
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true);
      const nameBytes = bytes.slice(cursor + 46, cursor + 46 + nameLength);
      names.push(new TextDecoder().decode(nameBytes));
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    return names;
  }
  return [];
}

/** Reads a stored entry back: used by the tests to verify the payload, not by the app. */
export function readZipEntry(bytes: Uint8Array, name: string): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 0;
  while (cursor + 30 <= bytes.length) {
    if (view.getUint32(cursor, true) !== 0x04034b50) return null;
    const size = view.getUint32(cursor + 18, true);
    const nameLength = view.getUint16(cursor + 26, true);
    const extraLength = view.getUint16(cursor + 28, true);
    const entryName = new TextDecoder().decode(bytes.slice(cursor + 30, cursor + 30 + nameLength));
    const dataStart = cursor + 30 + nameLength + extraLength;
    if (entryName === name) return bytes.slice(dataStart, dataStart + size);
    cursor = dataStart + size;
  }
  return null;
}
