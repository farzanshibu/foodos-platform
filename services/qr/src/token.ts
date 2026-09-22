/**
 * SOT: qr-token, token-generation, token-alphabet, qr-render, qr-encoder, reed-solomon
 * WHAT   How a public QR token is made, and how that token becomes a printed square a phone
 *        can actually read: a byte-mode QR encoder written out in full, and the SVG around it.
 * WHY    The token is the whole security model of the QR: it is the only thing in the code,
 *        so it has to be unguessable and it must reveal nothing. No id, no counter, no
 *        timestamp - just randomness from a CSPRNG.
 *        The encoder is hand-written rather than pulled in because the only thing this
 *        product ever encodes is one short ASCII URL. A general library carries numeric,
 *        alphanumeric and kanji modes, forty versions and four error-correction levels, none
 *        of which this ever reaches; what is here is the one path that URL takes, which is
 *        small enough to read in a sitting and has no supply chain.
 * HOW    Token: an unambiguous alphabet. A printed code gets read back by a human when the
 *        camera fails, and 0/O and 1/I/l are where that goes wrong.
 *        Encoder: byte mode only, error correction level H, versions 1 to 10, smallest
 *        version that fits. That is a hard ceiling of 119 bytes - see MAX_PAYLOAD_BYTES -
 *        and anything longer is refused rather than truncated.
 *        H recovers 30% of a damaged symbol against Q's 25%, and at the size this product
 *        actually prints it costs nothing: `https://foodos.app/q/q_XXXXXXXXXX` is 33 bytes,
 *        which lands on version 4 at either level, so Q would trade away five percent of the
 *        recovery for a symbol of exactly the same size. These live on restaurant tables -
 *        grease, scratches, spilled drinks, a torn corner - so the recovery is the half worth
 *        buying. L is not an option for print at all.
 *        Version 10-H holds 119 bytes, well past what that URL needs even behind a long
 *        custom domain, so stopping at 10 costs nothing and keeps the tables short.
 *        Mask: all eight are built and scored with the four penalty rules of ISO/IEC 18004,
 *        lowest total wins, ties broken by the lower mask number. Nothing is hardcoded, so
 *        the choice is a pure function of the payload and is stable across runs.
 * WHERE  services/qr/src/qr.handlers.ts, services/qr/src/card.handlers.ts, tests/qr-encoder.test.ts
 */
import "server-only";

import { randomInt } from "node:crypto";

/** No 0/O, no 1/I/L. Somebody will type this off a table tent. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const TOKEN_LENGTH = 10;

export function generateToken(): string {
  let token = "";
  for (let index = 0; index < TOKEN_LENGTH; index += 1) {
    token += ALPHABET[randomInt(ALPHABET.length)] ?? "A";
  }
  return `q_${token}`;
}

/* ── Version table ─────────────────────────────────────────────────────────── */

type BlockGroup = { readonly count: number; readonly dataCodewords: number };

type VersionSpec = {
  /** Data plus error correction codewords the symbol holds in total. */
  readonly totalCodewords: number;
  /** Error correction codewords per block. Constant within a version at a given level. */
  readonly eccPerBlock: number;
  /** Blocks the data is split into. Two groups at most, the second one codeword longer. */
  readonly groups: readonly BlockGroup[];
  /** Row/column centres of the alignment patterns. Empty for version 1. */
  readonly alignmentCentres: readonly number[];
};

/**
 * ISO/IEC 18004 tables 9 and E.1, level H only, versions 1 to 10. Level is fixed, so the
 * three columns this file never reads are not written down and cannot drift.
 */
const VERSION_SPECS = [
  {
    totalCodewords: 26,
    eccPerBlock: 17,
    groups: [{ count: 1, dataCodewords: 9 }],
    alignmentCentres: [],
  },
  {
    totalCodewords: 44,
    eccPerBlock: 28,
    groups: [{ count: 1, dataCodewords: 16 }],
    alignmentCentres: [6, 18],
  },
  {
    totalCodewords: 70,
    eccPerBlock: 22,
    groups: [{ count: 2, dataCodewords: 13 }],
    alignmentCentres: [6, 22],
  },
  {
    totalCodewords: 100,
    eccPerBlock: 16,
    groups: [{ count: 4, dataCodewords: 9 }],
    alignmentCentres: [6, 26],
  },
  {
    totalCodewords: 134,
    eccPerBlock: 22,
    groups: [
      { count: 2, dataCodewords: 11 },
      { count: 2, dataCodewords: 12 },
    ],
    alignmentCentres: [6, 30],
  },
  {
    totalCodewords: 172,
    eccPerBlock: 28,
    groups: [{ count: 4, dataCodewords: 15 }],
    alignmentCentres: [6, 34],
  },
  {
    totalCodewords: 196,
    eccPerBlock: 26,
    groups: [
      { count: 4, dataCodewords: 13 },
      { count: 1, dataCodewords: 14 },
    ],
    alignmentCentres: [6, 22, 38],
  },
  {
    totalCodewords: 242,
    eccPerBlock: 26,
    groups: [
      { count: 4, dataCodewords: 14 },
      { count: 2, dataCodewords: 15 },
    ],
    alignmentCentres: [6, 24, 42],
  },
  {
    totalCodewords: 292,
    eccPerBlock: 24,
    groups: [
      { count: 4, dataCodewords: 12 },
      { count: 4, dataCodewords: 13 },
    ],
    alignmentCentres: [6, 26, 46],
  },
  {
    totalCodewords: 346,
    eccPerBlock: 28,
    groups: [
      { count: 6, dataCodewords: 15 },
      { count: 2, dataCodewords: 16 },
    ],
    alignmentCentres: [6, 28, 50],
  },
] as const satisfies readonly VersionSpec[];

const MIN_VERSION = 1;
const MAX_VERSION = VERSION_SPECS.length;

/** Byte mode. The only mode this encoder speaks. */
const MODE_BYTE = 0b0100;
/** Level H, as it appears in the format information. L=01, M=00, Q=11, H=10. */
const ECC_LEVEL_H = 0b10;
const PAD_CODEWORDS = [0xec, 0x11] as const;

function versionSpec(version: number): VersionSpec {
  const spec = VERSION_SPECS[version - MIN_VERSION];
  if (spec === undefined) {
    throw new Error(
      `QR version ${version} is outside the supported range ${MIN_VERSION}-${MAX_VERSION}.`,
    );
  }
  return spec;
}

function dataCodewordCount(spec: VersionSpec): number {
  let total = 0;
  for (const group of spec.groups) total += group.count * group.dataCodewords;
  return total;
}

/** Byte mode uses an 8-bit character count up to version 9 and 16 bits from version 10. */
function characterCountBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

function byteCapacity(version: number): number {
  const usable = dataCodewordCount(versionSpec(version)) * 8 - 4 - characterCountBits(version);
  return Math.floor(usable / 8);
}

/** 119 bytes at version 10-H. The ceiling this encoder refuses to go past. */
const MAX_PAYLOAD_BYTES = byteCapacity(MAX_VERSION);

function chooseVersion(byteLength: number): number {
  for (let version = MIN_VERSION; version <= MAX_VERSION; version += 1) {
    if (byteLength <= byteCapacity(version)) return version;
  }
  throw new Error(
    `A QR payload of ${byteLength} bytes does not fit: this encoder stops at version ${MAX_VERSION} ` +
      `at error correction level H, which holds ${MAX_PAYLOAD_BYTES} bytes.`,
  );
}

/* ── GF(256) and Reed-Solomon ──────────────────────────────────────────────── */

/**
 * The QR field: x^8 + x^4 + x^3 + x^2 + 1, generator 2. `exp` is doubled in length so a
 * product of two logs can be looked up without a modulo.
 */
function buildGaloisTables(): { readonly exp: Uint8Array; readonly log: Uint8Array } {
  const exp = new Uint8Array(512);
  const log = new Uint8Array(256);
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    exp[index] = value;
    log[value] = index;
    value <<= 1;
    if (value >= 256) value ^= 0x11d;
  }
  for (let index = 255; index < 512; index += 1) exp[index] = exp[index - 255] ?? 0;
  return { exp, log };
}

const GALOIS = buildGaloisTables();

function gfMul(left: number, right: number): number {
  if (left === 0 || right === 0) return 0;
  return GALOIS.exp[(GALOIS.log[left] ?? 0) + (GALOIS.log[right] ?? 0)] ?? 0;
}

/** (x - a^0)(x - a^1)...(x - a^(degree-1)), coefficients highest power first. */
function reedSolomonGenerator(degree: number): Uint8Array {
  let poly = Uint8Array.from([1]);
  for (let index = 0; index < degree; index += 1) {
    const root = GALOIS.exp[index] ?? 0;
    const next = new Uint8Array(poly.length + 1);
    for (let position = 0; position < poly.length; position += 1) {
      const coefficient = poly[position] ?? 0;
      next[position] = (next[position] ?? 0) ^ coefficient;
      next[position + 1] = (next[position + 1] ?? 0) ^ gfMul(coefficient, root);
    }
    poly = next;
  }
  return poly;
}

/** The remainder of data*x^degree divided by the generator: the error correction codewords. */
function reedSolomonRemainder(data: Uint8Array, degree: number): Uint8Array {
  const generator = reedSolomonGenerator(degree);
  const remainder = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ (remainder[0] ?? 0);
    remainder.copyWithin(0, 1);
    remainder[degree - 1] = 0;
    for (let position = 0; position < degree; position += 1) {
      remainder[position] =
        (remainder[position] ?? 0) ^ gfMul(generator[position + 1] ?? 0, factor);
    }
  }
  return remainder;
}

/* ── Data encoding ─────────────────────────────────────────────────────────── */

function pushBits(bits: number[], value: number, length: number): void {
  for (let position = length - 1; position >= 0; position -= 1) bits.push((value >>> position) & 1);
}

function encodeDataCodewords(payload: Uint8Array, version: number): Uint8Array {
  const capacity = dataCodewordCount(versionSpec(version));
  const bits: number[] = [];
  pushBits(bits, MODE_BYTE, 4);
  pushBits(bits, payload.length, characterCountBits(version));
  for (const byte of payload) pushBits(bits, byte, 8);
  /** Terminator, then zeros up to the codeword boundary. Both are truncated if there is no room. */
  pushBits(bits, 0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = new Uint8Array(capacity);
  const written = bits.length / 8;
  for (let index = 0; index < written; index += 1) {
    let byte = 0;
    for (let offset = 0; offset < 8; offset += 1)
      byte = (byte << 1) | (bits[index * 8 + offset] ?? 0);
    codewords[index] = byte;
  }
  for (let index = written; index < capacity; index += 1) {
    codewords[index] = PAD_CODEWORDS[(index - written) % 2] ?? 0;
  }
  return codewords;
}

/**
 * Blocks are written out one codeword at a time, round-robin, so a scratch that destroys a
 * run of the printed symbol is spread across every block instead of wiping one out.
 */
function interleaveBlocks(dataCodewords: Uint8Array, version: number): Uint8Array {
  const spec = versionSpec(version);
  const dataBlocks: Uint8Array[] = [];
  const eccBlocks: Uint8Array[] = [];
  let offset = 0;
  for (const group of spec.groups) {
    for (let index = 0; index < group.count; index += 1) {
      const block = dataCodewords.subarray(offset, offset + group.dataCodewords);
      offset += group.dataCodewords;
      dataBlocks.push(block);
      eccBlocks.push(reedSolomonRemainder(block, spec.eccPerBlock));
    }
  }

  const stream = new Uint8Array(spec.totalCodewords);
  let cursor = 0;
  let longest = 0;
  for (const block of dataBlocks) longest = Math.max(longest, block.length);
  for (let position = 0; position < longest; position += 1) {
    for (const block of dataBlocks) {
      const value = block[position];
      if (value === undefined) continue;
      stream[cursor] = value;
      cursor += 1;
    }
  }
  for (let position = 0; position < spec.eccPerBlock; position += 1) {
    for (const block of eccBlocks) {
      stream[cursor] = block[position] ?? 0;
      cursor += 1;
    }
  }
  return stream;
}

/* ── The module grid ───────────────────────────────────────────────────────── */

type Grid = { readonly size: number; readonly cells: Uint8Array };

function makeGrid(size: number): Grid {
  return { size, cells: new Uint8Array(size * size) };
}

function gridGet(grid: Grid, row: number, col: number): number {
  return grid.cells[row * grid.size + col] ?? 0;
}

function gridSet(grid: Grid, row: number, col: number, value: number): void {
  grid.cells[row * grid.size + col] = value;
}

function inside(grid: Grid, row: number, col: number): boolean {
  return row >= 0 && col >= 0 && row < grid.size && col < grid.size;
}

/** Modules and the map of which of them are function patterns and so never masked. */
type Canvas = { readonly modules: Grid; readonly reserved: Grid };

function chebyshev(row: number, col: number): number {
  return Math.max(Math.abs(row), Math.abs(col));
}

/** The 7x7 eye plus its one-module separator, clipped at the edges of the symbol. */
function drawFinder(canvas: Canvas, centreRow: number, centreCol: number): void {
  for (let row = -4; row <= 4; row += 1) {
    for (let col = -4; col <= 4; col += 1) {
      const distance = chebyshev(row, col);
      if (distance > 4) continue;
      const target = { row: centreRow + row, col: centreCol + col };
      if (!inside(canvas.modules, target.row, target.col)) continue;
      gridSet(canvas.modules, target.row, target.col, distance !== 2 && distance <= 3 ? 1 : 0);
      gridSet(canvas.reserved, target.row, target.col, 1);
    }
  }
}

function drawAlignment(canvas: Canvas, centreRow: number, centreCol: number): void {
  for (let row = -2; row <= 2; row += 1) {
    for (let col = -2; col <= 2; col += 1) {
      gridSet(canvas.modules, centreRow + row, centreCol + col, chebyshev(row, col) === 1 ? 0 : 1);
      gridSet(canvas.reserved, centreRow + row, centreCol + col, 1);
    }
  }
}

function drawAlignmentPatterns(canvas: Canvas, spec: VersionSpec): void {
  const centres = spec.alignmentCentres;
  const last = centres.length - 1;
  for (let rowIndex = 0; rowIndex <= last; rowIndex += 1) {
    for (let colIndex = 0; colIndex <= last; colIndex += 1) {
      /** The three that would sit on a finder pattern are omitted. */
      const onFinder =
        (rowIndex === 0 && colIndex === 0) ||
        (rowIndex === 0 && colIndex === last) ||
        (rowIndex === last && colIndex === 0);
      if (onFinder) continue;
      const centreRow = centres[rowIndex];
      const centreCol = centres[colIndex];
      if (centreRow === undefined || centreCol === undefined) continue;
      drawAlignment(canvas, centreRow, centreCol);
    }
  }
}

function drawTiming(canvas: Canvas): void {
  const size = canvas.modules.size;
  for (let index = 8; index < size - 8; index += 1) {
    const value = index % 2 === 0 ? 1 : 0;
    gridSet(canvas.modules, 6, index, value);
    gridSet(canvas.reserved, 6, index, 1);
    gridSet(canvas.modules, index, 6, value);
    gridSet(canvas.reserved, index, 6, 1);
  }
}

/** Where the fifteen format bits go, most significant first. The second copy is computed. */
const FORMAT_POSITIONS = [
  [8, 0],
  [8, 1],
  [8, 2],
  [8, 3],
  [8, 4],
  [8, 5],
  [8, 7],
  [8, 8],
  [7, 8],
  [5, 8],
  [4, 8],
  [3, 8],
  [2, 8],
  [1, 8],
  [0, 8],
] as const;

function reserveFormatArea(canvas: Canvas): void {
  const size = canvas.modules.size;
  for (const position of FORMAT_POSITIONS) {
    gridSet(canvas.reserved, position[0], position[1], 1);
  }
  for (let index = 0; index < 8; index += 1) gridSet(canvas.reserved, 8, size - 8 + index, 1);
  for (let index = 0; index < 7; index += 1) gridSet(canvas.reserved, size - 7 + index, 8, 1);
  /** The one module that is dark in every symbol ever printed. */
  gridSet(canvas.modules, size - 8, 8, 1);
  gridSet(canvas.reserved, size - 8, 8, 1);
}

/** BCH(15,5) over the five data bits, then the mask 0x5412 so an all-zero format is impossible. */
function formatInformationBits(mask: number): number {
  const data = (ECC_LEVEL_H << 3) | mask;
  let remainder = data;
  for (let index = 0; index < 10; index += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  }
  return ((data << 10) | remainder) ^ 0x5412;
}

function drawFormatInformation(canvas: Canvas, mask: number): void {
  const size = canvas.modules.size;
  const bits = formatInformationBits(mask);
  for (let index = 0; index < 15; index += 1) {
    const bit = (bits >>> (14 - index)) & 1;
    const position = FORMAT_POSITIONS[index];
    if (position === undefined) continue;
    gridSet(canvas.modules, position[0], position[1], bit);
  }
  /**
   * Second copy: bits 14 down to 8 climb column 8 from the bottom edge, then bits 7 down to 0
   * run left to right along row 8 from the right edge.
   */
  for (let index = 0; index < 7; index += 1) {
    gridSet(canvas.modules, size - 1 - index, 8, (bits >>> (14 - index)) & 1);
  }
  for (let index = 0; index < 8; index += 1) {
    gridSet(canvas.modules, 8, size - 8 + index, (bits >>> (7 - index)) & 1);
  }
}

/** BCH(18,6). Only versions 7 and up carry it. */
function versionInformationBits(version: number): number {
  let remainder = version;
  for (let index = 0; index < 12; index += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  }
  return (version << 12) | remainder;
}

function drawVersionInformation(canvas: Canvas, version: number): void {
  if (version < 7) return;
  const size = canvas.modules.size;
  const bits = versionInformationBits(version);
  for (let index = 0; index < 18; index += 1) {
    const bit = (bits >>> index) & 1;
    const near = size - 11 + (index % 3);
    const far = Math.floor(index / 3);
    gridSet(canvas.modules, near, far, bit);
    gridSet(canvas.reserved, near, far, 1);
    gridSet(canvas.modules, far, near, bit);
    gridSet(canvas.reserved, far, near, 1);
  }
}

function drawFunctionPatterns(canvas: Canvas, version: number): void {
  const size = canvas.modules.size;
  drawFinder(canvas, 3, 3);
  drawFinder(canvas, 3, size - 4);
  drawFinder(canvas, size - 4, 3);
  drawTiming(canvas);
  drawAlignmentPatterns(canvas, versionSpec(version));
  drawVersionInformation(canvas, version);
  reserveFormatArea(canvas);
}

/**
 * The zigzag: column pairs right to left, alternating up and down, right module before left,
 * skipping column 6 because the vertical timing pattern lives there. Positions left over once
 * the stream runs out stay light, which is what the remainder bits are defined to be.
 */
function placeCodewords(canvas: Canvas, stream: Uint8Array): void {
  const size = canvas.modules.size;
  let bitIndex = 0;
  let upward = true;
  let right = size - 1;
  while (right >= 1) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (let offset = 0; offset < 2; offset += 1) {
        const col = right - offset;
        if (gridGet(canvas.reserved, row, col) === 1) continue;
        const byte = stream[bitIndex >>> 3];
        if (byte === undefined) continue;
        gridSet(canvas.modules, row, col, (byte >>> (7 - (bitIndex & 7))) & 1);
        bitIndex += 1;
      }
    }
    upward = !upward;
    right -= 2;
  }
}

/* ── Masking ───────────────────────────────────────────────────────────────── */

const MASK_COUNT = 8;

function maskApplies(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

function applyMask(canvas: Canvas, mask: number): void {
  const size = canvas.modules.size;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (gridGet(canvas.reserved, row, col) === 1) continue;
      if (!maskApplies(mask, row, col)) continue;
      gridSet(canvas.modules, row, col, gridGet(canvas.modules, row, col) ^ 1);
    }
  }
}

/* ── Penalty rules ─────────────────────────────────────────────────────────── */

/** Rule 1: five or more of the same colour in a line, three points plus one per extra module. */
function runLengthPenalty(grid: Grid): number {
  let penalty = 0;
  for (let line = 0; line < grid.size; line += 1) {
    penalty += runLengthPenaltyForLine(grid, line, true);
    penalty += runLengthPenaltyForLine(grid, line, false);
  }
  return penalty;
}

function runLengthPenaltyForLine(grid: Grid, line: number, horizontal: boolean): number {
  let penalty = 0;
  let previous = -1;
  let run = 0;
  for (let index = 0; index < grid.size; index += 1) {
    const value = horizontal ? gridGet(grid, line, index) : gridGet(grid, index, line);
    if (value === previous) {
      run += 1;
      continue;
    }
    if (run >= 5) penalty += 3 + (run - 5);
    previous = value;
    run = 1;
  }
  return run >= 5 ? penalty + 3 + (run - 5) : penalty;
}

/** Rule 2: every 2x2 block of one colour costs three. */
function blockPenalty(grid: Grid): number {
  let blocks = 0;
  for (let row = 0; row + 1 < grid.size; row += 1) {
    for (let col = 0; col + 1 < grid.size; col += 1) {
      const sum =
        gridGet(grid, row, col) +
        gridGet(grid, row, col + 1) +
        gridGet(grid, row + 1, col) +
        gridGet(grid, row + 1, col + 1);
      if (sum === 0 || sum === 4) blocks += 1;
    }
  }
  return blocks * 3;
}

/**
 * Rule 3: forty points for anything a scanner could mistake for a finder pattern - the
 * 1:1:3:1:1 run with four light modules on one side, in either direction. The spec leaves it
 * open whether the light run may fall off the edge of the symbol; this reads the eleven
 * modules literally and so only counts patterns wholly inside it.
 */
function finderLikePenalty(grid: Grid): number {
  const patterns = [0b10111010000, 0b00001011101];
  let penalty = 0;
  for (let line = 0; line < grid.size; line += 1) {
    let across = 0;
    let down = 0;
    for (let index = 0; index < grid.size; index += 1) {
      across = ((across << 1) & 0x7ff) | gridGet(grid, line, index);
      down = ((down << 1) & 0x7ff) | gridGet(grid, index, line);
      if (index < 10) continue;
      if (patterns.includes(across)) penalty += 40;
      if (patterns.includes(down)) penalty += 40;
    }
  }
  return penalty;
}

/**
 * Rule 4: ten points for every five percent the dark proportion strays from half. Written as
 * integer arithmetic so it cannot drift on a floating point rounding.
 */
function balancePenalty(grid: Grid): number {
  let dark = 0;
  for (const cell of grid.cells) dark += cell;
  const total = grid.size * grid.size;
  const steps = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  return Math.max(0, steps) * 10;
}

function penaltyScore(grid: Grid): number {
  return (
    runLengthPenalty(grid) + blockPenalty(grid) + finderLikePenalty(grid) + balancePenalty(grid)
  );
}

/* ── Putting a symbol together ─────────────────────────────────────────────── */

export type QrSymbol = {
  readonly version: number;
  readonly mask: number;
  readonly size: number;
  /** One string per row, top row first, "1" dark and "0" light. */
  readonly rows: readonly string[];
};

function buildCanvas(stream: Uint8Array, version: number, mask: number): Canvas {
  const size = version * 4 + 17;
  const canvas: Canvas = { modules: makeGrid(size), reserved: makeGrid(size) };
  drawFunctionPatterns(canvas, version);
  placeCodewords(canvas, stream);
  applyMask(canvas, mask);
  drawFormatInformation(canvas, mask);
  return canvas;
}

function toRows(grid: Grid): string[] {
  const rows: string[] = [];
  for (let row = 0; row < grid.size; row += 1) {
    let line = "";
    for (let col = 0; col < grid.size; col += 1) line += gridGet(grid, row, col) === 1 ? "1" : "0";
    rows.push(line);
  }
  return rows;
}

/**
 * Encode one ASCII payload as a QR symbol: byte mode, level H, smallest version from 1 to 10
 * that holds it. Throws rather than truncating if it does not fit.
 */
export function encodeQr(text: string): QrSymbol {
  const payload = new TextEncoder().encode(text);
  const version = chooseVersion(payload.length);
  const stream = interleaveBlocks(encodeDataCodewords(payload, version), version);

  let best: Canvas | null = null;
  let bestMask = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < MASK_COUNT; mask += 1) {
    const candidate = buildCanvas(stream, version, mask);
    const score = penaltyScore(candidate.modules);
    if (score >= bestScore) continue;
    best = candidate;
    bestMask = mask;
    bestScore = score;
  }
  if (best === null) throw new Error("QR mask selection produced no candidate.");

  return { version, mask: bestMask, size: best.modules.size, rows: toRows(best.modules) };
}

/* ── SVG ───────────────────────────────────────────────────────────────────── */

/**
 * Everything printed is rounded to this many decimal places of a millimetre - a tenth of a
 * micron, well past what any printer resolves - and the geometry is then computed from the
 * rounded numbers rather than the exact ones, so what the file says is what the file means.
 */
const MM_PRECISION = 4;

/** Trailing zeros in an SVG number are pure file size, and printers do not care. */
function mm(value: number): string {
  return Number(value.toFixed(MM_PRECISION)).toString();
}

function mmRound(value: number): number {
  return Number(value.toFixed(MM_PRECISION));
}

/** Rounded away from zero, so a rounded quiet zone is never narrower than the one asked for. */
function mmCeil(value: number): number {
  const step = 10 ** MM_PRECISION;
  return Math.ceil(value * step) / step;
}

function modulePath(rows: readonly string[]): string {
  const segments: string[] = [];
  for (let row = 0; row < rows.length; row += 1) {
    const line = rows[row] ?? "";
    for (let col = 0; col < line.length; col += 1) {
      if (line[col] !== "1") continue;
      segments.push(`M${col} ${row}h1v1h-1z`);
    }
  }
  return segments.join("");
}

/**
 * A QR as an SVG, at a true printed size.
 *
 * The square itself is `sizeMm` on a side and sits inside a quiet zone that is never narrower
 * than four modules - the margin the standard requires a scanner to find the symbol at all -
 * and never narrower than the ten percent this has always printed at. The label sits below the
 * quiet zone, outside it, where it cannot be read as part of the code. The modules go in as a
 * single path in module coordinates under one scale, so the geometry is exact integers and the
 * file stays small no matter how dense the symbol gets.
 */
export function renderQrSvg(args: { url: string; sizeMm: number; label: string | null }): string {
  const symbol = encodeQr(args.url);
  const moduleMm = mmRound(args.sizeMm / symbol.size);
  const quietZoneMm = mmCeil(Math.max(4, args.sizeMm * 0.1, moduleMm * 4));
  const outerMm = args.sizeMm + quietZoneMm * 2;
  const heightMm = outerMm + 10;
  const label =
    args.label === null
      ? ""
      : `<text x="${mm(outerMm / 2)}" y="${mm(outerMm + 6)}" font-size="4" text-anchor="middle" fill="#000">${escapeXml(args.label)}</text>`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${mm(outerMm)}mm" height="${mm(heightMm)}mm" viewBox="0 0 ${mm(outerMm)} ${mm(heightMm)}">`,
    `<rect width="${mm(outerMm)}" height="${mm(heightMm)}" fill="#fff"/>`,
    `<g transform="translate(${mm(quietZoneMm)} ${mm(quietZoneMm)}) scale(${mm(moduleMm)})">`,
    `<path d="${modulePath(symbol.rows)}" fill="#000"/>`,
    "</g>",
    label,
    "</svg>",
  ].join("");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
