/**
 * A small QR Code encoder (ISO/IEC 18004) — byte mode, error correction level M, versions 1–20 (up to
 * 666 bytes) — for the two-factor setup screen's otpauth:// link, without adding a dependency. Pure: text
 * in, a square boolean matrix out (true = dark); <QrCode> (shared-components) renders it as SVG.
 *
 * Steps: data bits (mode 0100, length, bytes, terminator, pad bytes) → split into blocks per the
 * version's level-M table → Reed–Solomon error correction per block (GF(256), polynomial 0x11D) →
 * interleave → place in the zig-zag around the function patterns (finders, timing, alignment,
 * format / version info) → try the 8 masks and keep the one with the lowest penalty.
 */

/** Level M per version: error-correction codewords per block, then [blocks, data codewords] groups. */
const LEVEL_M: readonly [number, [number, number][]][] = [
  [10, [[1, 16]]], [16, [[1, 28]]], [26, [[1, 44]]], [18, [[2, 32]]], [24, [[2, 43]]],
  [16, [[4, 27]]], [18, [[4, 31]]], [22, [[2, 38], [2, 39]]], [22, [[3, 36], [2, 37]]], [26, [[4, 43], [1, 44]]],
  [30, [[1, 50], [4, 51]]], [22, [[6, 36], [2, 37]]], [22, [[8, 37], [1, 38]]], [24, [[4, 40], [5, 41]]], [24, [[5, 41], [5, 42]]],
  [28, [[7, 45], [3, 46]]], [28, [[10, 46], [1, 47]]], [26, [[9, 43], [4, 44]]], [26, [[3, 44], [11, 45]]], [26, [[3, 41], [13, 42]]],
];
const MAX_VERSION = LEVEL_M.length;
/** Level M's 2 format bits. */
const FORMAT_LEVEL_M = 0;

// ── GF(256) and Reed–Solomon ────────────────────────────────────────────────────────────────────

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j]!, root);
      if (j + 1 < degree) result[j]! ^= result[j + 1]!;
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    divisor.forEach((coef, i) => { result[i]! ^= gfMul(coef, factor); });
  }
  return result;
}

// ── Data codewords ──────────────────────────────────────────────────────────────────────────────

const dataCapacity = (version: number) => LEVEL_M[version - 1]![1].reduce((t, [n, d]) => t + n * d, 0);
const countBits = (version: number) => (version <= 9 ? 8 : 16);

function pickVersion(byteLen: number): number {
  for (let v = 1; v <= MAX_VERSION; v++) if (4 + countBits(v) + byteLen * 8 <= dataCapacity(v) * 8) return v;
  throw new Error(`Too long for a QR code (${byteLen} bytes; at most ${dataCapacity(MAX_VERSION) - 3}).`);
}

function dataCodewords(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const put = (value: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, countBits(version));
  bytes.forEach((b) => put(b, 8));
  const capBits = dataCapacity(version) * 8;
  put(0, Math.min(4, capBits - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; out.length < capBits / 8; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

function withErrorCorrection(data: number[], version: number): number[] {
  const [ecLen, groups] = LEVEL_M[version - 1]!;
  const divisor = rsDivisor(ecLen);
  const blocks: { data: number[]; ec: number[] }[] = [];
  let k = 0;
  for (const [count, len] of groups) {
    for (let i = 0; i < count; i++) {
      const d = data.slice(k, k + len);
      k += len;
      blocks.push({ data: d, ec: rsRemainder(d, divisor) });
    }
  }
  const out: number[] = [];
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i]!);
  for (let i = 0; i < ecLen; i++) for (const b of blocks) out.push(b.ec[i]!);
  return out;
}

// ── The matrix ──────────────────────────────────────────────────────────────────────────────────

class Grid {
  readonly size: number;
  readonly dark: boolean[][];
  readonly fn: boolean[][];
  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.dark = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.fn = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }
  /** A function-pattern module at column x, row y. */
  set(x: number, y: number, dark: boolean): void { this.dark[y]![x] = dark; this.fn[y]![x] = true; }
}

function alignmentPositions(version: number, size: number): number[] {
  if (version === 1) return [];
  const n = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

function drawFormatBits(g: Grid, mask: number): void {
  const data = (FORMAT_LEVEL_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) !== 0;
  for (let i = 0; i <= 5; i++) g.set(8, i, bit(i));
  g.set(8, 7, bit(6));
  g.set(8, 8, bit(7));
  g.set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) g.set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) g.set(g.size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) g.set(8, g.size - 15 + i, bit(i));
  g.set(8, g.size - 8, true); // the dark module
}

function drawFunctionPatterns(g: Grid): void {
  for (let i = 0; i < g.size; i++) { g.set(6, i, i % 2 === 0); g.set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [g.size - 4, 3], [3, g.size - 4]] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < g.size && y >= 0 && y < g.size) g.set(x, y, dist !== 2 && dist !== 4);
      }
    }
  }
  const pos = alignmentPositions(g.version, g.size);
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) g.set(pos[i]! + dx, pos[j]! + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  drawFormatBits(g, 0); // reserves the areas; the real mask is drawn later
  if (g.version >= 7) {
    let rem = g.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (g.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = g.size - 11 + (i % 3), b = Math.floor(i / 3);
      g.set(a, b, dark);
      g.set(b, a, dark);
    }
  }
}

function placeCodewords(g: Grid, codewords: number[]): void {
  let i = 0;
  const totalBits = codewords.length * 8;
  for (let right = g.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < g.size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? g.size - 1 - vert : vert;
        if (!g.fn[y]![x] && i < totalBits) {
          g.dark[y]![x] = ((codewords[i >>> 3]! >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(g: Grid, mask: number): void {
  const f = MASKS[mask]!;
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) if (!g.fn[y]![x] && f(x, y)) g.dark[y]![x] = !g.dark[y]![x];
}

/** The standard's mask penalty (runs, 2×2 blocks, finder look-alikes, dark balance). */
function penalty(m: boolean[][]): number {
  const n = m.length;
  let score = 0;
  const line = (get: (i: number, j: number) => boolean) => {
    for (let i = 0; i < n; i++) {
      let run = 1;
      for (let j = 1; j <= n; j++) {
        if (j < n && get(i, j) === get(i, j - 1)) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      for (let j = 0; j + 10 < n; j++) {
        const s = Array.from({ length: 11 }, (_, k) => (get(i, j + k) ? 1 : 0)).join('');
        if (s === '10111010000' || s === '00001011101') score += 40;
      }
    }
  };
  line((i, j) => m[i]![j]!);
  line((i, j) => m[j]![i]!);
  for (let y = 0; y + 1 < n; y++) {
    for (let x = 0; x + 1 < n; x++) {
      const c = m[y]![x];
      if (c === m[y]![x + 1] && c === m[y + 1]![x] && c === m[y + 1]![x + 1]) score += 3;
    }
  }
  const dark = m.reduce((t, row) => t + row.filter(Boolean).length, 0);
  score += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
  return score;
}

/** `text` as a QR code matrix (true = dark), smallest version that fits, level M. */
export function qrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const version = pickVersion(bytes.length);
  const codewords = withErrorCorrection(dataCodewords(bytes, version), version);
  let best: { grid: Grid; score: number } | null = null;
  for (let mask = 0; mask < 8; mask++) {
    const g = new Grid(version);
    drawFunctionPatterns(g);
    placeCodewords(g, codewords);
    applyMask(g, mask);
    drawFormatBits(g, mask);
    const score = penalty(g.dark);
    if (!best || score < best.score) best = { grid: g, score };
  }
  return best!.grid.dark;
}
