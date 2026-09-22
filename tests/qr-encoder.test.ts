/**
 * SOT: qr-encoder-assertions, qr-known-answer, qr-mask-assertions
 * WHAT   Plain assertions for the hand-written QR encoder. Run with
 *        `pnpm tsx --conditions=react-server tests/qr-encoder.test.ts` - the condition is
 *        required because the encoder imports `server-only`.
 * WHY    Every one of these codes gets printed on card stock and glued to a table. A wrong
 *        module is not a failing pixel, it is a stack of cards in a bin. The known-answer
 *        matrix below is the whole point of the file: it pins the encoder to one exact symbol
 *        so a "harmless" refactor of the mask, the interleave or the placement order cannot
 *        quietly change what gets printed.
 * HOW    The known answer was derived by encoding the vector with this encoder and then
 *        confirming, byte for byte, that two unrelated third-party encoders produce the same
 *        33x33 symbol for the same string in byte mode at level H: `qrcode` 1.5.4 (Ryan Day)
 *        and `qrcode-generator` 2.0.4 (Kazuhiko Arase). Neither is a dependency of this repo;
 *        they were run once, outside it, purely to corroborate the vector. The symbol was
 *        additionally read back the other way - modules to format information to codewords to
 *        text - and every Reed-Solomon block checked to have zero syndromes at a^0..a^15.
 *        The version information row is checked against the ISO/IEC 18004 table directly.
 * WHERE  services/qr/src/token.ts
 */
import assert from "node:assert/strict";

import { encodeQr, renderQrSvg } from "../services/qr/src/token";

/* ── Fixtures ────────────────────────────────────────────────────────────── */

/** A real token from the real alphabet behind a real host. 33 bytes, so version 4 at level H. */
const KNOWN_URL = "https://foodos.app/q/q_RN2MY3QN2V";

const KNOWN_MATRIX = [
  "111111100001110010101010101111111",
  "100000100101001010001110101000001",
  "101110101010100011111111101011101",
  "101110101100110111010101001011101",
  "101110100011010100110101001011101",
  "100000100001010011011111101000001",
  "111111101010101010101010101111111",
  "000000000000001101100001100000000",
  "000110110110111001111100000001100",
  "111010010110100000110010010110100",
  "010110101100001001111011011101111",
  "010111010101010010111010000111101",
  "010100111000111101100110101011001",
  "110111001011011100011101110101010",
  "000011110110101110101000001001100",
  "011110001001100111110001110011111",
  "101111100011010011101001011110101",
  "110100011111011101110010111011000",
  "110110110001111110010111011011101",
  "111110011110101101100011101001110",
  "001100110001001110001000000101010",
  "101111010011100101010101101111010",
  "101100111010110011100011101010011",
  "101001001101010110011010000100100",
  "111111110010001000111010111111011",
  "000000001010101010001111100011010",
  "111111101110010010101000101011000",
  "100000100111111000111111100011110",
  "101110101001011010010111111110010",
  "101110101001100111100010110101001",
  "101110100100110101111101100010111",
  "100000100011000001110101000000111",
  "111111100111011111001011101011000",
];

/** ISO/IEC 18004 table 7, level H, byte mode: the most bytes each version can carry. */
const CAPACITY_BY_VERSION = [7, 14, 24, 34, 44, 58, 64, 84, 98, 119];

/** The seven rows of a finder pattern, and the ISO/IEC 18004 table 10 string for version 7. */
const FINDER = ["1111111", "1000001", "1011101", "1011101", "1011101", "1000001", "1111111"];
const ALIGNMENT = ["11111", "10001", "10101", "10001", "11111"];
const VERSION_7_INFORMATION = "000111110010010100";

function moduleAt(rows: readonly string[], row: number, col: number): string {
  return (rows[row] ?? "")[col] ?? "";
}

function squareAt(rows: readonly string[], top: number, left: number, size: number): string[] {
  const square: string[] = [];
  for (let row = 0; row < size; row += 1) {
    let line = "";
    for (let col = 0; col < size; col += 1) line += moduleAt(rows, top + row, left + col);
    square.push(line);
  }
  return square;
}

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

function svgNumber(svg: string, pattern: RegExp): number {
  const match = pattern.exec(svg);
  assert.notEqual(match, null, `no match for ${pattern} in the SVG`);
  return Number(match?.[1] ?? Number.NaN);
}

type Check = { name: string; run: () => void };

const checks: Check[] = [
  /* ── Known answer ──────────────────────────────────────────────────────── */
  {
    name: "the known-answer vector encodes to exactly the recorded 33x33 symbol",
    run: () => {
      const symbol = encodeQr(KNOWN_URL);
      assert.equal(symbol.version, 4);
      assert.equal(symbol.size, 33);
      assert.equal(symbol.mask, 6);
      assert.deepEqual([...symbol.rows], KNOWN_MATRIX);
    },
  },
  {
    name: "the symbol is square and holds nothing but modules",
    run: () => {
      const symbol = encodeQr(KNOWN_URL);
      assert.equal(symbol.rows.length, symbol.size);
      for (const row of symbol.rows) {
        assert.equal(row.length, symbol.size);
        assert.match(row, /^[01]+$/);
      }
    },
  },
  {
    name: "the symbol side is always 4 x version + 17",
    run: () => {
      for (let version = 1; version <= 10; version += 1) {
        const capacity = CAPACITY_BY_VERSION[version - 1] ?? 0;
        assert.equal(encodeQr("A".repeat(capacity)).size, version * 4 + 17);
      }
    },
  },

  /* ── Version selection ─────────────────────────────────────────────────── */
  {
    name: "every version carries exactly its table capacity, and one byte more moves up",
    run: () => {
      for (let version = 1; version <= 10; version += 1) {
        const capacity = CAPACITY_BY_VERSION[version - 1] ?? 0;
        assert.equal(encodeQr("A".repeat(capacity)).version, version, `at capacity ${capacity}`);
        if (version === 10) continue;
        assert.equal(
          encodeQr("A".repeat(capacity + 1)).version,
          version + 1,
          `one byte past capacity ${capacity}`,
        );
      }
    },
  },
  {
    name: "the version only ever grows as the payload grows",
    run: () => {
      let previous = 0;
      for (let length = 1; length <= 119; length += 1) {
        const version = encodeQr("A".repeat(length)).version;
        assert.ok(version >= previous, `version fell from ${previous} to ${version} at ${length}`);
        previous = version;
      }
      assert.equal(previous, 10);
    },
  },
  {
    name: "the smallest fitting version is chosen, never a roomier one",
    run: () => {
      // 33 bytes fits version 4 (34) and not version 3 (24), so version 4 is the only answer.
      assert.equal(encodeQr(KNOWN_URL).version, 4);
      assert.equal(encodeQr("q_RN2MY3QN2V").version, 2);
      assert.equal(encodeQr("q_ABCD").version, 1);
    },
  },
  {
    name: "a payload past version 10 is refused, not truncated",
    run: () => {
      const message = refusal(() => encodeQr("A".repeat(120)));
      assert.match(message, /120 bytes/);
      assert.match(message, /version 10/);
      assert.match(message, /119 bytes/);
    },
  },
  {
    name: "the refusal is about the byte length, so a multi-byte payload is measured in bytes",
    run: () => {
      // Every one of these is three UTF-8 bytes, so 40 of them is 120 and must be refused.
      assert.match(
        refusal(() => encodeQr("€".repeat(40))),
        /120 bytes/,
      );
      assert.equal(encodeQr("€".repeat(39)).version, 10);
    },
  },

  /* ── Function patterns ─────────────────────────────────────────────────── */
  {
    name: "a finder pattern sits in all three corners",
    run: () => {
      const symbol = encodeQr(KNOWN_URL);
      const last = symbol.size - 7;
      assert.deepEqual(squareAt(symbol.rows, 0, 0, 7), FINDER, "top left");
      assert.deepEqual(squareAt(symbol.rows, 0, last, 7), FINDER, "top right");
      assert.deepEqual(squareAt(symbol.rows, last, 0, 7), FINDER, "bottom left");
    },
  },
  {
    name: "the fourth corner is data, not a finder pattern",
    run: () => {
      const symbol = encodeQr(KNOWN_URL);
      const last = symbol.size - 7;
      assert.notDeepEqual(squareAt(symbol.rows, last, last, 7), FINDER);
    },
  },
  {
    name: "the separators around every finder pattern are light",
    run: () => {
      const symbol = encodeQr(KNOWN_URL);
      const edge = symbol.size - 1;
      for (let index = 0; index <= 7; index += 1) {
        assert.equal(moduleAt(symbol.rows, 7, index), "0", `top left row at ${index}`);
        assert.equal(moduleAt(symbol.rows, index, 7), "0", `top left column at ${index}`);
        assert.equal(moduleAt(symbol.rows, 7, edge - index), "0", `top right row at ${index}`);
        assert.equal(moduleAt(symbol.rows, edge - index, 7), "0", `bottom left column at ${index}`);
      }
    },
  },
  {
    name: "both timing patterns alternate from dark, over every supported version",
    run: () => {
      for (let version = 1; version <= 10; version += 1) {
        const capacity = CAPACITY_BY_VERSION[version - 1] ?? 0;
        const symbol = encodeQr("A".repeat(capacity));
        for (let index = 8; index < symbol.size - 8; index += 1) {
          const expected = index % 2 === 0 ? "1" : "0";
          assert.equal(moduleAt(symbol.rows, 6, index), expected, `v${version} row 6 at ${index}`);
          assert.equal(moduleAt(symbol.rows, index, 6), expected, `v${version} col 6 at ${index}`);
        }
      }
    },
  },
  {
    name: "the module below the top-left finder pattern is dark in every symbol",
    run: () => {
      for (let version = 1; version <= 10; version += 1) {
        const capacity = CAPACITY_BY_VERSION[version - 1] ?? 0;
        const symbol = encodeQr("A".repeat(capacity));
        assert.equal(moduleAt(symbol.rows, symbol.size - 8, 8), "1", `version ${version}`);
      }
    },
  },
  {
    name: "an alignment pattern sits at every table centre from version 2 up",
    run: () => {
      // ISO/IEC 18004 table E.1, versions 2 to 10. The three centres that would land on a
      // finder pattern are omitted, which is what makes the corners of this loop interesting.
      const centres = [
        [6, 18],
        [6, 22],
        [6, 26],
        [6, 30],
        [6, 34],
        [6, 22, 38],
        [6, 24, 42],
        [6, 26, 46],
        [6, 28, 50],
      ];
      for (let version = 2; version <= 10; version += 1) {
        const symbol = encodeQr("A".repeat(CAPACITY_BY_VERSION[version - 1] ?? 0));
        const table = centres[version - 2] ?? [];
        const last = table.length - 1;
        for (let rowIndex = 0; rowIndex <= last; rowIndex += 1) {
          for (let colIndex = 0; colIndex <= last; colIndex += 1) {
            const onFinder =
              (rowIndex === 0 && colIndex === 0) ||
              (rowIndex === 0 && colIndex === last) ||
              (rowIndex === last && colIndex === 0);
            if (onFinder) continue;
            const top = (table[rowIndex] ?? 0) - 2;
            const left = (table[colIndex] ?? 0) - 2;
            assert.deepEqual(
              squareAt(symbol.rows, top, left, 5),
              ALIGNMENT,
              `v${version} alignment at ${top + 2},${left + 2}`,
            );
          }
        }
      }
    },
  },
  {
    name: "version 1 has no alignment pattern where version 2 puts one",
    run: () => {
      const small = encodeQr("A".repeat(7));
      assert.equal(small.version, 1);
      assert.equal(small.size, 21);
      assert.notDeepEqual(squareAt(small.rows, 16, 16, 5), ALIGNMENT);
    },
  },
  {
    name: "version 7 carries the version information block from the ISO table, in both copies",
    run: () => {
      const symbol = encodeQr("A".repeat(64));
      assert.equal(symbol.version, 7);
      // Bit 0 is the least significant, at (size - 11, 0), running down then right.
      let bottomLeft = "";
      let topRight = "";
      for (let index = 17; index >= 0; index -= 1) {
        const near = symbol.size - 11 + (index % 3);
        const far = Math.floor(index / 3);
        bottomLeft += moduleAt(symbol.rows, near, far);
        topRight += moduleAt(symbol.rows, far, near);
      }
      assert.equal(bottomLeft, VERSION_7_INFORMATION);
      assert.equal(topRight, VERSION_7_INFORMATION);
    },
  },
  {
    name: "versions below 7 carry no version information block",
    run: () => {
      const symbol = encodeQr(KNOWN_URL);
      assert.equal(symbol.version, 4);
      // Where the block would be on a larger symbol is ordinary data on this one, and the
      // two copies of a version information block would be identical. These are not.
      let bottomLeft = "";
      let topRight = "";
      for (let index = 0; index < 18; index += 1) {
        const near = symbol.size - 11 + (index % 3);
        const far = Math.floor(index / 3);
        bottomLeft += moduleAt(symbol.rows, near, far);
        topRight += moduleAt(symbol.rows, far, near);
      }
      assert.notEqual(bottomLeft, topRight);
    },
  },

  /* ── Masking ───────────────────────────────────────────────────────────── */
  {
    name: "the same input always yields the same mask and the same modules",
    run: () => {
      const first = encodeQr(KNOWN_URL);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const again = encodeQr(KNOWN_URL);
        assert.equal(again.mask, first.mask);
        assert.deepEqual([...again.rows], [...first.rows]);
      }
    },
  },
  {
    name: "the mask is one of the eight, and is not the same one every time",
    run: () => {
      const masks = new Set<number>();
      for (let length = 1; length <= 119; length += 1) {
        const mask = encodeQr("A".repeat(length)).mask;
        assert.ok(mask >= 0 && mask <= 7, `mask ${mask} out of range at length ${length}`);
        masks.add(mask);
      }
      assert.ok(masks.size > 1, "every payload chose the same mask, so nothing is being scored");
    },
  },
  {
    name: "the chosen mask is written into both copies of the format information",
    run: () => {
      const symbol = encodeQr(KNOWN_URL);
      const edge = symbol.size - 1;
      let first = "";
      for (const [row, col] of [
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
      ]) {
        first += moduleAt(symbol.rows, row ?? 0, col ?? 0);
      }
      let second = "";
      for (let index = 0; index < 7; index += 1) second += moduleAt(symbol.rows, edge - index, 8);
      for (let index = 0; index < 8; index += 1) {
        second += moduleAt(symbol.rows, 8, symbol.size - 8 + index);
      }
      assert.equal(first, second);
      // Unmasked, the five data bits are the level (H = 10) followed by the mask number.
      const bits = Number.parseInt(first, 2) ^ 0x5412;
      assert.equal((bits >>> 13) & 0b11, 0b10, "error correction level is not H");
      assert.equal((bits >>> 10) & 0b111, symbol.mask, "format mask disagrees with the symbol");
    },
  },

  /* ── SVG ───────────────────────────────────────────────────────────────── */
  {
    name: "the SVG is sized in true millimetres and the viewBox agrees with it",
    run: () => {
      // 30mm of modules, a 4mm quiet zone each side, 10mm of label strip below.
      const svg = renderQrSvg({ url: KNOWN_URL, sizeMm: 30, label: "Table 4" });
      assert.match(svg, /width="38mm" height="48mm" viewBox="0 0 38 48"/);
    },
  },
  {
    name: "the quiet zone is never narrower than four modules, at any printed size",
    run: () => {
      for (const sizeMm of [20, 25, 30, 40, 50, 80, 120]) {
        const svg = renderQrSvg({ url: KNOWN_URL, sizeMm, label: null });
        const outer = svgNumber(svg, /width="([\d.]+)mm"/);
        const quietZone = svgNumber(svg, /translate\(([\d.]+) /);
        const scale = svgNumber(svg, /scale\(([\d.]+)\)/);
        assert.ok(
          quietZone >= scale * 4 - 1e-6,
          `at ${sizeMm}mm the quiet zone is ${quietZone}mm, under four ${scale}mm modules`,
        );
        assert.ok(Math.abs(outer - (sizeMm + quietZone * 2)) < 1e-6, `outer width at ${sizeMm}mm`);
        assert.ok(Math.abs(scale * 33 - sizeMm) < 0.01, `module size at ${sizeMm}mm`);
      }
    },
  },
  {
    name: "the SVG holds one path segment per dark module and nothing outside the square",
    run: () => {
      const symbol = encodeQr(KNOWN_URL);
      const dark = symbol.rows
        .join("")
        .split("")
        .filter((module) => module === "1").length;
      const svg = renderQrSvg({ url: KNOWN_URL, sizeMm: 30, label: null });
      assert.equal(svg.match(/M\d+ \d+h1v1h-1z/g)?.length, dark);
      // The URL itself must not be printed: it used to sit where the modules now are.
      assert.equal(svg.includes(KNOWN_URL), false);
    },
  },
  {
    name: "the label prints below the quiet zone and is XML-escaped",
    run: () => {
      const svg = renderQrSvg({ url: KNOWN_URL, sizeMm: 30, label: 'Ram & Co "Table 4"' });
      assert.match(svg, /<text x="19" y="44" font-size="4" text-anchor="middle" fill="#000">/);
      assert.match(svg, /Ram &amp; Co &quot;Table 4&quot;<\/text>/);
    },
  },
  {
    name: "no label means no text element at all",
    run: () => {
      const svg = renderQrSvg({ url: KNOWN_URL, sizeMm: 30, label: null });
      assert.equal(svg.includes("<text"), false);
    },
  },
  {
    name: "the renderer refuses a URL it cannot encode rather than printing a broken square",
    run: () =>
      assert.match(
        refusal(() =>
          renderQrSvg({ url: `https://foodos.app/q/${"A".repeat(120)}`, sizeMm: 30, label: null }),
        ),
        /does not fit/,
      ),
  },
];

let failures = 0;
for (const check of checks) {
  try {
    check.run();
    console.log(`PASS  ${check.name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${check.name}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`\n${checks.length - failures}/${checks.length} passed`);
if (failures > 0) process.exit(1);
