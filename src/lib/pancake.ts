/**
 * Cayley-style graph visualizations.
 *
 * The pancake, star, permutohedron, cyclic-adjacent, transposition, and
 * reversal graphs have every permutation of {1,…,n} as a vertex. The
 * hypercube and Feistel graphs have every n-bit string as a vertex. They
 * differ by the generator set used for edges.
 *
 * The simplex (Kₙ₊₁) and complete (Kₙ) graphs are tiny by comparison: their
 * vertices are single values placed on a regular polygon, joined by every
 * possible chord.
 *
 * The sliding-puzzle graph is the state graph of the 15-puzzle and its
 * generalizations: vertices are arrangements of 0,…,N-1 (0 = the blank) on a
 * 2 × n grid (N = 2n cells), and edges slide a tile into the blank. Unlike the
 * Cayley graphs above it is not regular (the blank in a corner has 2 moves, on
 * an edge 3), so its generators have fixed points and its edge count is not
 * generators × vertices / 2.
 *
 * Permutations are stored as `Uint8Array` (1 byte per element) for
 * memory efficiency — at n = 10 we hold 10! = 3,628,800 of them.
 */

import { permutahedronCompressionOrder } from "./permutahedron-compression";
import {
  asymmetricTreeCycleOrder,
  asymmetricTreeEdges,
} from "./asymmetric-tree-cycle";

export { permutahedronCompressionFactor } from "./permutahedron-compression";
export { asymmetricTreeCompressionFactor } from "./asymmetric-tree-cycle";

export type Perm = Uint8Array<ArrayBuffer>;

/** Rows of the sliding-puzzle grid; the n parameter is the number of columns. */
const SLIDING_PUZZLE_ROWS = 2;

export function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

/** A short, unique string key for a permutation — fast Set lookups. */
export function key(p: Perm): string {
  let s = "";
  for (let i = 0; i < p.length; i++) s += String.fromCharCode(p[i] + 48);
  return s;
}

type Vec4 = [number, number, number, number];

function dot4(a: Vec4, b: Vec4): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

function norm4(a: Vec4): number {
  return Math.sqrt(dot4(a, a));
}

function normalize4(a: Vec4): Vec4 {
  const n = norm4(a) || 1;
  return [a[0] / n, a[1] / n, a[2] / n, a[3] / n];
}

function subScaled4(v: Vec4, a: Vec4, scale: number): Vec4 {
  return [
    v[0] - scale * a[0],
    v[1] - scale * a[1],
    v[2] - scale * a[2],
    v[3] - scale * a[3],
  ];
}

function reflect4(v: Vec4, root: Vec4): Vec4 {
  return subScaled4(v, root, 2 * dot4(v, root));
}

function vecKey(v: Vec4): string {
  return v.map((x) => Math.round(x * 1e10) / 1e10).join(",");
}

function choleskyRows4(g: number[][]): Vec4[] {
  const l = Array.from({ length: 4 }, () => new Array<number>(4).fill(0));
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = g[i][j];
      for (let k = 0; k < j; k++) sum -= l[i][k] * l[j][k];
      l[i][j] = i === j ? Math.sqrt(Math.max(0, sum)) : sum / l[j][j];
    }
  }
  return l.map((row) => [row[0], row[1], row[2], row[3]] as Vec4);
}

function h4SimpleRoots(): Vec4[] {
  const phiOver2 = (1 + Math.sqrt(5)) / 4; // cos(pi/5)
  const g = [
    [1, -phiOver2, 0, 0],
    [-phiOver2, 1, -0.5, 0],
    [0, -0.5, 1, -0.5],
    [0, 0, -0.5, 1],
  ];
  return choleskyRows4(g).map(normalize4);
}

function applyCoxeterElement(v: Vec4, roots: Vec4[]): Vec4 {
  let out = v;
  for (const root of roots) out = reflect4(out, root);
  return out;
}

function h4RootSystem(simpleRoots: Vec4[]): Vec4[] {
  const roots: Vec4[] = [...simpleRoots];
  const seen = new Set(roots.map(vecKey));
  for (let i = 0; i < roots.length; i++) {
    for (const root of simpleRoots) {
      const next = normalize4(reflect4(roots[i], root));
      const k = vecKey(next);
      if (!seen.has(k)) {
        seen.add(k);
        roots.push(next);
      }
    }
  }
  return roots;
}

function h4CoxeterPlane(simpleRoots: Vec4[]): [Vec4, Vec4] {
  const h = 30;
  const theta = (2 * Math.PI) / h;
  let v: Vec4 = [1, 0.37, -0.23, 0.61];
  let a: Vec4 = [0, 0, 0, 0];
  let b: Vec4 = [0, 0, 0, 0];
  for (let k = 0; k < h; k++) {
    const c = Math.cos(k * theta);
    const s = Math.sin(k * theta);
    a = [a[0] + c * v[0], a[1] + c * v[1], a[2] + c * v[2], a[3] + c * v[3]];
    b = [b[0] + s * v[0], b[1] + s * v[1], b[2] + s * v[2], b[3] + s * v[3]];
    v = applyCoxeterElement(v, simpleRoots);
  }
  const e1 = normalize4(a);
  const bOrth = subScaled4(b, e1, dot4(b, e1));
  return [e1, normalize4(bOrth)];
}

type Vec = number[];
type CoxeterFamilyPreset = "coxeter-a" | "coxeter-b" | "coxeter-d";

function dot(a: Vec, b: Vec): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function norm(a: Vec): number {
  return Math.sqrt(dot(a, a));
}

function normalize(a: Vec): Vec {
  const n = norm(a) || 1;
  return a.map((x) => x / n);
}

function subScaled(v: Vec, a: Vec, scale: number): Vec {
  return v.map((x, i) => x - scale * a[i]);
}

function reflect(v: Vec, root: Vec): Vec {
  return subScaled(v, root, (2 * dot(v, root)) / dot(root, root));
}

function applyCoxeterElementGeneric(v: Vec, roots: Vec[]): Vec {
  let out = v;
  for (const root of roots) out = reflect(out, root);
  return out;
}

function coxeterPlane(simpleRoots: Vec[], coxeterNumber: number): [Vec, Vec] {
  const dim = simpleRoots[0].length;
  const theta = (2 * Math.PI) / coxeterNumber;
  let v = Array.from({ length: dim }, (_, i) => (i === 0 ? 1 : (37 * (i + 1)) % 101 / 101));
  const a = new Array<number>(dim).fill(0);
  const b = new Array<number>(dim).fill(0);
  for (let k = 0; k < coxeterNumber; k++) {
    const c = Math.cos(k * theta);
    const s = Math.sin(k * theta);
    for (let i = 0; i < dim; i++) {
      a[i] += c * v[i];
      b[i] += s * v[i];
    }
    v = applyCoxeterElementGeneric(v, simpleRoots);
  }
  const e1 = normalize(a);
  return [e1, normalize(subScaled(b, e1, dot(b, e1)))];
}

function basis(dim: number, i: number): Vec {
  const v = new Array<number>(dim).fill(0);
  v[i] = 1;
  return v;
}

function rootDataForCoxeterFamily(
  n: number,
  preset: CoxeterFamilyPreset
): { simpleRoots: Vec[]; coxeterNumber: number } {
  if (preset === "coxeter-a") {
    const dim = n + 1;
    const simpleRoots = Array.from({ length: n }, (_, i) =>
      basis(dim, i).map((x, k) => x - (k === i + 1 ? 1 : 0))
    );
    return { simpleRoots, coxeterNumber: n + 1 };
  }

  const dim = n;
  const simpleRoots: Vec[] = [];
  for (let i = 0; i < dim - 1; i++) {
    const r = new Array<number>(dim).fill(0);
    r[i] = 1;
    r[i + 1] = -1;
    simpleRoots.push(r);
  }
  if (preset === "coxeter-b") {
    simpleRoots.push(basis(dim, dim - 1));
    return { simpleRoots, coxeterNumber: 2 * n };
  }

  const last = new Array<number>(dim).fill(0);
  last[dim - 2] = 1;
  last[dim - 1] = 1;
  simpleRoots.push(last);
  return { simpleRoots, coxeterNumber: 2 * (n - 1) };
}

function forEachCoxeterRoot(
  n: number,
  preset: CoxeterFamilyPreset,
  visit: (root: Vec) => void
): void {
  if (preset === "coxeter-a") {
    const dim = n + 1;
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        if (i === j) continue;
        const r = new Array<number>(dim).fill(0);
        r[i] = 1;
        r[j] = -1;
        visit(r);
      }
    }
    return;
  }

  if (preset === "coxeter-b") {
    for (let i = 0; i < n; i++) {
      const p = basis(n, i);
      visit(p);
      visit(p.map((x) => -x));
    }
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (const si of [-1, 1]) {
        for (const sj of [-1, 1]) {
          const r = new Array<number>(n).fill(0);
          r[i] = si;
          r[j] = sj;
          visit(r);
        }
      }
    }
  }
}

function forEachCoxeterRootProjection(
  n: number,
  preset: CoxeterFamilyPreset,
  e1: Vec,
  e2: Vec,
  visit: (x: number, y: number) => void
): void {
  if (preset === "coxeter-a") {
    const dim = n + 1;
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        if (i !== j) visit(e1[i] - e1[j], e2[i] - e2[j]);
      }
    }
    return;
  }

  if (preset === "coxeter-b") {
    for (let i = 0; i < n; i++) {
      visit(e1[i], e2[i]);
      visit(-e1[i], -e2[i]);
    }
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (const si of [-1, 1]) {
        for (const sj of [-1, 1]) {
          visit(si * e1[i] + sj * e1[j], si * e2[i] + sj * e2[j]);
        }
      }
    }
  }
}

/**
 * Reverse the last k elements of p (the Zaks 1984 suffix reversal), returning
 * a new Uint8Array. A suffix reversal of length k < n leaves the leading n-k
 * symbols fixed, which is why the recursive block decomposition groups by the
 * first symbols.
 */
export function flip(p: Perm, k: number): Perm {
  const q = new Uint8Array(p);
  for (let i = q.length - k, j = q.length - 1; i < j; i++, j--) {
    const t = q[i];
    q[i] = q[j];
    q[j] = t;
  }
  return q;
}

/** Swap two positions of p, returning a new Uint8Array. */
export function swap(p: Perm, i: number, j: number): Perm {
  const q = new Uint8Array(p);
  const t = q[i];
  q[i] = q[j];
  q[j] = t;
  return q;
}

/** Reverse an arbitrary contiguous block of p, returning a new Uint8Array. */
export function reverseBlock(p: Perm, start: number, end: number): Perm {
  const q = new Uint8Array(p);
  for (let i = start, j = end; i < j; i++, j--) {
    const t = q[i];
    q[i] = q[j];
    q[j] = t;
  }
  return q;
}

export type PancakeOrder = "zaks" | "williams";
export type GraphPreset =
  | "pancake-zaks"
  | "pancake-zaks-recursive"
  | "pancake-williams"
  | "coxeter-a"
  | "coxeter-b"
  | "coxeter-d"
  | "random-cyclic"
  | "random-dihedral"
  | "wedge-clipped-dihedral"
  | "kaleidoscope"
  | "aes-powers"
  | "star"
  | "permutohedron"
  | "permutahedron-compressed"
  | "cyclic-adjacent"
  | "transposition"
  | "asymmetric-tree"
  | "reversal"
  | "reversal-greedy"
  | "reversal-graycode"
  | "lexicographic"
  | "hyperoctahedral"
  | "hypercube"
  | "feistel"
  | "sliding-puzzle"
  | "simplex"
  | "complete"
  | "cayley-complete"
  | "sierpinski"
  | "coxeter-h4-600-cell";
export type GraphKind =
  | "pancake"
  | "coxeter-a"
  | "coxeter-b"
  | "coxeter-d"
  | "random-cyclic"
  | "random-dihedral"
  | "wedge-clipped-dihedral"
  | "kaleidoscope"
  | "aes-powers"
  | "star"
  | "permutohedron"
  | "permutahedron-compressed"
  | "cyclic-adjacent"
  | "transposition"
  | "asymmetric-tree"
  | "reversal"
  | "lexicographic"
  | "hyperoctahedral"
  | "hypercube"
  | "feistel"
  | "sliding-puzzle"
  | "simplex"
  | "complete"
  | "cayley-complete"
  | "sierpinski"
  | "coxeter-h4-600-cell";

/** Number of symbols of the Sierpiński graph S(n, k); 3 = the triangle gasket. */
const SIERPINSKI_K = 3;
const COXETER_EDGE_MATERIALIZE_LIMIT = 5_000;

const AES_MIN_N = 3;
const AES_MAX_N = 20;
const AES_POLYNOMIALS: Record<number, number> = {
  3: 0b1011,
  4: 0b10011,
  5: 0b100101,
  6: 0b1000011,
  7: 0b10000011,
  8: 0x11d,
  9: 0x211,
  10: 0x409,
  11: 0x805,
  12: 0x1053,
  13: 0x201b,
  14: 0x402b,
  15: 0x8003,
  16: 0x1002d,
  17: 0x20009,
  18: 0x40027,
  19: 0x80027,
  20: 0x100009,
};

export interface PancakeCycle {
  order: PancakeOrder;
  /** The visited permutations, in cycle order (length = n!). */
  path: Perm[];
  /** flips[s] is the suffix size used to go from path[s] to path[s+1].
   *  The final entry closes the cycle (path[n!-1] → path[0]). */
  flips: number[];
}

/**
 * Walk the pancake graph greedily, taking either the smallest (Zaks) or
 * largest (Williams) available suffix reversal that leads somewhere new.
 * The smallest-first variant is exactly Zaks' original 1984 ordering.
 *
 * Yields control back to the event loop every `chunk` iterations so
 * the UI stays responsive even for large n.
 */
export async function suffixReversalCycle(
  n: number,
  order: PancakeOrder,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
  chunk = 50_000
): Promise<PancakeCycle> {
  throwIfAborted(signal);
  const total = factorial(n);
  const start = new Uint8Array(n);
  for (let i = 0; i < n; i++) start[i] = i + 1;

  const minFlip = order === "zaks";
  const seen = new Set<string>();
  seen.add(key(start));
  const path: Perm[] = [start];
  const flips: number[] = [];

  let p = start;
  for (let s = 0; s < total - 1; s++) {
    let moved = false;
    for (
      let k = minFlip ? 2 : n;
      minFlip ? k <= n : k >= 2;
      minFlip ? k++ : k--
    ) {
      const q = flip(p, k);
      const qk = key(q);
      if (!seen.has(qk)) {
        flips.push(k);
        p = q;
        seen.add(qk);
        path.push(p);
        moved = true;
        break;
      }
    }
    if (!moved) {
      throw new Error(`${orderLabel(order)} walk got stuck — should be impossible.`);
    }
    if ((s + 1) % chunk === 0) {
      onProgress?.(s + 1, total);
      await yieldToEventLoop();
      throwIfAborted(signal);
    }
  }

  const startKey = key(start);
  for (let k = 2; k <= n; k++) {
    if (key(flip(p, k)) === startKey) {
      flips.push(k);
      break;
    }
  }

  onProgress?.(total, total);
  return { order, path, flips };
}

export function orderLabel(order: PancakeOrder): string {
  return order === "zaks" ? "Zaks" : "Williams";
}

export async function zaksCycle(
  n: number,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
  chunk = 50_000
): Promise<PancakeCycle> {
  return suffixReversalCycle(n, "zaks", onProgress, signal, chunk);
}

export async function williamsCycle(
  n: number,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
  chunk = 50_000
): Promise<PancakeCycle> {
  return suffixReversalCycle(n, "williams", onProgress, signal, chunk);
}

/**
 * Zaks' explicit recursive Hamiltonian cycle (1984), an alternative to the
 * greedy smallest-flip walk in `suffixReversalCycle`. The flip sequence is
 * built directly from the recurrence (rₖ = suffix reversal of length k):
 *
 *   path₃   = r₃ r₂ r₃ r₂ r₃
 *   pathₙ   = (pathₙ₋₁ rₙ)^(n−1) pathₙ₋₁
 *   cycleₙ  = pathₙ rₙ
 *
 * `pathₙ` is a Hamiltonian path through all n! permutations; the closing flip
 * returns to the identity (rₙ for n ≥ 4, r₂ for the n = 3 base — we detect it
 * by searching rather than hard-coding, which also covers n = 2).
 *
 * The flip sizes never exceed n, so the whole sequence fits in a `Uint8Array`
 * of n!−1 bytes — far cheaper than the greedy walk's `seen` set.
 */
function zaksRecursiveFlips(n: number): Uint8Array {
  const len = factorial(n) - 1;
  const seq = new Uint8Array(Math.max(len, 0));
  let idx = 0;
  const emit = (level: number): void => {
    if (level <= 2) {
      seq[idx++] = 2;
      return;
    }
    if (level === 3) {
      seq[idx++] = 3;
      seq[idx++] = 2;
      seq[idx++] = 3;
      seq[idx++] = 2;
      seq[idx++] = 3;
      return;
    }
    for (let i = 0; i < level - 1; i++) {
      emit(level - 1);
      seq[idx++] = level;
    }
    emit(level - 1);
  };
  if (len > 0) emit(n);
  return seq;
}

export async function zaksRecursiveCycle(
  n: number,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
  chunk = 50_000
): Promise<PancakeCycle> {
  throwIfAborted(signal);
  const total = factorial(n);
  const start = new Uint8Array(n);
  for (let i = 0; i < n; i++) start[i] = i + 1;

  const flipSeq = zaksRecursiveFlips(n);
  const seen = new Set<string>([key(start)]);
  const path: Perm[] = [start];
  const flips: number[] = [];

  let p = start;
  for (let s = 0; s < flipSeq.length; s++) {
    const k = flipSeq[s];
    p = flip(p, k);
    const pk = key(p);
    if (seen.has(pk)) {
      throw new Error("Zaks recursive construction revisited a permutation — should be impossible.");
    }
    seen.add(pk);
    flips.push(k);
    path.push(p);
    if ((s + 1) % chunk === 0) {
      onProgress?.(s + 1, total);
      await yieldToEventLoop();
      throwIfAborted(signal);
    }
  }

  const startKey = key(start);
  for (let k = 2; k <= n; k++) {
    if (key(flip(p, k)) === startKey) {
      flips.push(k);
      break;
    }
  }

  onProgress?.(total, total);
  return { order: "zaks", path, flips };
}

export interface PancakeGraph {
  n: number;
  preset: GraphPreset;
  kind: GraphKind;
  order?: PancakeOrder;
  /** The selected ordering of all vertices. */
  path: Perm[];
  /** Sequence of generator ids along the displayed permutation order. */
  flips: number[];
  /**
   * All Cayley edges, deduplicated, encoded as flat triples for memory:
   * for edge t, src=edges[3t], dst=edges[3t+1], generatorId=edges[3t+2].
   */
  edges: Uint32Array;
  /** Indices (along the selected cycle) of edges that are full-reversal rₙ flips. */
  rn: Uint32Array;
  /**
   * Parity per vertex (0 = even, 1 = odd).
   * Permutation parity (number of inversions mod 2) for permutation graphs;
   * Hamming-weight parity for the hypercube.
   */
  vertexParity: Uint8Array;
  /** Edges connecting same-parity endpoints (parity-preserving generators). */
  evenEdgeCount: number;
  /** Edges connecting opposite-parity endpoints (parity-changing generators). */
  oddEdgeCount: number;
  /** Per-generator metadata, sorted by id. */
  generators: GeneratorInfo[];
  /**
   * Optional explicit 2-D vertex positions, one [x, y] pair per vertex in
   * `path` order, normalized so the layout fits inside the unit disk (|p| ≤ 1).
   * When present the renderers place vertex i at this point instead of on the
   * circle — used by the Sierpiński graph to draw the recognizable triangle
   * gasket. Absent (undefined) for the default circular layouts.
   */
  coords?: Float64Array;
}

/**
 * A coarsened ("quotient") view of a permutation graph.
 *
 * Every permutation is collapsed into the block of permutations sharing its
 * first `depth` symbols — the coset of the subgroup fixing those leading
 * positions. With Zaks suffix-reversal semantics this is the recursive
 * decomposition Pₙ = (blocks, each an isomorphic copy of Pₙ₋d): the short
 * suffix reversals r₂…rₙ₋d fix the prefix and stay inside a block (intra-block
 * / self weight), while the longer reversals change a leading symbol and cross
 * between blocks (inter-block super-edges).
 *
 * Collapsing millions of chords into a few hundred weighted super-edges turns
 * the saturated "black disk" into a readable diagram of the block structure.
 */
export interface QuotientGraph {
  n: number;
  preset: GraphPreset;
  /** Number of leading symbols held fixed within a block (1 ≤ depth ≤ n-1). */
  depth: number;
  /** Number of blocks = n·(n-1)···(n-depth+1). */
  blockCount: number;
  /**
   * Leading-symbol tuple per block, row-major in display order: for block b,
   * the symbols at positions [0, …, depth-1] are blockKey[b*depth … b*depth+depth-1].
   * The first entry of each row is the leading symbol (the primary clustering key).
   */
  blockKey: Uint8Array;
  /**
   * Inter-block edges, sorted ascending by weight so heavy edges paint last.
   * Flat triples [blockA, blockB, weight] with blockA < blockB.
   */
  superEdges: Float64Array;
  /** Intra-block (self-loop) edge weight per block, in display order. */
  selfWeight: Float64Array;
  maxSuperWeight: number;
  maxSelfWeight: number;
  /** Number of inter-block super-edges (superEdges.length / 3). */
  totalSuperEdges: number;
}

/**
 * Presets whose vertices are full permutations of 1..n and therefore admit a
 * leading-symbol coset quotient. Excludes the hypercube (bit strings), sliding
 * puzzle, and the single-value polygon graphs (simplex / complete).
 */
export function supportsQuotient(preset: GraphPreset): boolean {
  return (
    preset === "pancake-zaks" ||
    preset === "pancake-zaks-recursive" ||
    preset === "pancake-williams" ||
    preset === "star" ||
    preset === "permutohedron" ||
    preset === "permutahedron-compressed" ||
    preset === "cyclic-adjacent" ||
    preset === "transposition" ||
    preset === "asymmetric-tree" ||
    isReversalPreset(preset) ||
    preset === "lexicographic" ||
    preset === "cayley-complete"
  );
}

/**
 * Quotient depths available for a graph: 1 … n-2. Depth n-1 is degenerate —
 * the first n-1 symbols determine the whole permutation, so every block would
 * hold a single vertex and the quotient would just be the original graph.
 * Deep levels on large n produce very many blocks and render slowly.
 */
export function quotientDepthOptions(n: number, preset: GraphPreset): number[] {
  if (!supportsQuotient(preset)) return [];
  const opts: number[] = [];
  for (let d = 1; d <= n - 2; d++) opts.push(d);
  return opts;
}

/**
 * Build the leading-symbol coset quotient of a permutation graph at the given
 * depth: blocks group permutations sharing their first `depth` symbols.
 *
 * Pancake presets deliberately use the FULL suffix-reversal set r₂…rₙ here,
 * even when `buildPancakeGraph` materializes a sparse large-n subset: the
 * shorter reversals are precisely the intra-block edges that reveal the
 * recursion, and the quotient only needs per-block counts, so it never stores
 * n! edges.
 */
export async function buildQuotientGraph(
  graph: PancakeGraph,
  depth: number,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<QuotientGraph> {
  throwIfAborted(signal);
  const { n, preset, path } = graph;
  if (!supportsQuotient(preset)) {
    throw new Error(`Quotient view is not available for ${graphPresetLabel(preset)}.`);
  }
  if (depth < 1 || depth > n - 1) {
    throw new Error(`Quotient depth must be between 1 and ${n - 1}.`);
  }

  const radix = n + 1;
  // Encode a leading-symbol tuple (position order s₀…s_{depth-1}) as an integer.
  const codeOf = (vals: ArrayLike<number>): number => {
    let c = 0;
    for (let t = 0; t < depth; t++) c = c * radix + vals[t];
    return c;
  };

  // Enumerate every injective depth-tuple, then order blocks so that the
  // leading symbol is the most significant key — this lays blocks sharing a
  // first symbol (one Pₙ₋₁ copy) on a contiguous arc, exposing the recursion.
  const tuples: number[][] = [];
  const cur = new Array<number>(depth);
  const used = new Uint8Array(n + 1);
  const enumerate = (pos: number): void => {
    if (pos === depth) {
      tuples.push(cur.slice());
      return;
    }
    for (let v = 1; v <= n; v++) {
      if (used[v]) continue;
      used[v] = 1;
      cur[pos] = v;
      enumerate(pos + 1);
      used[v] = 0;
    }
  };
  enumerate(0);
  tuples.sort((a, b) => {
    for (let t = 0; t < depth; t++) {
      if (a[t] !== b[t]) return a[t] - b[t];
    }
    return 0;
  });

  const blockCount = tuples.length;
  const blockKey = new Uint8Array(blockCount * depth);
  const codeToIndex = new Map<number, number>();
  for (let b = 0; b < blockCount; b++) {
    const tup = tuples[b];
    for (let t = 0; t < depth; t++) blockKey[b * depth + t] = tup[t];
    codeToIndex.set(codeOf(tup), b);
  }

  const selfOrdered = new Float64Array(blockCount);
  const superMap = new Map<number, number>();

  const total = path.length;
  const isPancake =
    preset === "pancake-zaks" ||
    preset === "pancake-zaks-recursive" ||
    preset === "pancake-williams";
  const genApplies = isPancake
    ? []
    : graphGenerators(n, preset).map((g) => g.apply);
  const keyVals = new Array<number>(depth);

  const accumulate = (vIndex: number, nIndex: number): void => {
    if (nIndex === vIndex) {
      selfOrdered[vIndex] += 1;
      return;
    }
    const a = vIndex < nIndex ? vIndex : nIndex;
    const b = vIndex < nIndex ? nIndex : vIndex;
    const k = a * blockCount + b;
    superMap.set(k, (superMap.get(k) ?? 0) + 1);
  };

  onProgress?.(0, total);
  for (let i = 0; i < total; i++) {
    const p = path[i];
    for (let t = 0; t < depth; t++) keyVals[t] = p[t];
    const vIndex = codeToIndex.get(codeOf(keyVals))!;

    if (isPancake) {
      // Neighbor under the suffix reversal r_k = flip(p, k), which reverses the
      // last k entries. A leading position pos is unchanged when it sits before
      // the reversed suffix (pos < n-k); inside it, pos maps to p[2n-k-1-pos].
      for (let kk = 2; kk <= n; kk++) {
        const lo = n - kk;
        for (let t = 0; t < depth; t++) {
          keyVals[t] = t < lo ? p[t] : p[2 * n - kk - 1 - t];
        }
        accumulate(vIndex, codeToIndex.get(codeOf(keyVals))!);
      }
    } else {
      for (const apply of genApplies) {
        const q = apply(p);
        for (let t = 0; t < depth; t++) keyVals[t] = q[t];
        accumulate(vIndex, codeToIndex.get(codeOf(keyVals))!);
      }
    }

    if ((i + 1) % 50_000 === 0) {
      onProgress?.(i + 1, total);
      await yieldToEventLoop();
      throwIfAborted(signal);
    }
  }
  onProgress?.(total, total);

  // Every undirected edge is counted twice (once from each endpoint, since the
  // connection set is closed under inverse), so halve the ordered tallies.
  const selfWeight = new Float64Array(blockCount);
  let maxSelfWeight = 0;
  for (let b = 0; b < blockCount; b++) {
    const w = selfOrdered[b] / 2;
    selfWeight[b] = w;
    if (w > maxSelfWeight) maxSelfWeight = w;
  }

  const entries: Array<[number, number, number]> = [];
  let maxSuperWeight = 0;
  for (const [k, ordered] of superMap) {
    const w = ordered / 2;
    entries.push([Math.floor(k / blockCount), k % blockCount, w]);
    if (w > maxSuperWeight) maxSuperWeight = w;
  }
  entries.sort((x, y) => x[2] - y[2]);
  const superEdges = new Float64Array(entries.length * 3);
  for (let e = 0; e < entries.length; e++) {
    superEdges[e * 3] = entries[e][0];
    superEdges[e * 3 + 1] = entries[e][1];
    superEdges[e * 3 + 2] = entries[e][2];
  }

  return {
    n,
    preset,
    depth,
    blockCount,
    blockKey,
    superEdges,
    selfWeight,
    maxSuperWeight,
    maxSelfWeight,
    totalSuperEdges: entries.length,
  };
}

export const EDGE_DISTANCE_BIN_DEGREES = 10;
const EDGE_DISTANCE_BIN_COUNT = 180 / EDGE_DISTANCE_BIN_DEGREES;

export interface EdgeDistanceBin {
  minDegrees: number;
  maxDegrees: number;
  count: number;
}

/** Display + parity info for a single Cayley generator. */
export interface GeneratorInfo {
  /** Stable id matching the third entry of each edge triple. */
  id: number;
  /** Parity of the generator as a permutation (or bit-flip for hypercube). */
  parity: 0 | 1;
  /** Short, preset-specific label suitable for chips/buttons. */
  label: string;
  /**
   * Average angular distance (in degrees, 0..180) between the two endpoints of
   * this generator's edges, measured along the circle on which vertices are
   * placed in `path` order. Undefined when the generator has no edges.
   */
  avgArcDegrees?: number;
  /** Histogram of edge distances for this generator, bucketed in degrees. */
  distanceBins?: EdgeDistanceBin[];
}

interface Generator {
  id: number;
  apply: (p: Perm) => Perm;
}

/**
 * Build the full graph payload — vertices, edges, and rₙ markers.
 * Memory dominates here for dense permutation graphs.
 */
export async function buildPancakeGraph(
  n: number,
  preset: GraphPreset = "pancake-zaks",
  onProgress?: (phase: string, done: number, total: number) => void,
  signal?: AbortSignal
): Promise<PancakeGraph> {
  const maxN = graphMaxN(preset);
  const minN =
    preset === "aes-powers"
      ? AES_MIN_N
      : preset === "coxeter-h4-600-cell"
        ? 4
        : 2;
  if (n < minN || n > maxN) {
    throw new Error(`n must be between ${minN} and ${maxN} for ${graphPresetLabel(preset)}, got ${n}`);
  }
  throwIfAborted(signal);

  if (preset === "coxeter-h4-600-cell") {
    return buildH4CoxeterPlaneGraph(onProgress, signal);
  }
  if (
    preset === "coxeter-a" ||
    preset === "coxeter-b" ||
    preset === "coxeter-d"
  ) {
    return buildCoxeterFamilyGraph(n, preset, onProgress, signal);
  }

  const kind = graphKind(preset);
  const order = preset === "pancake-williams" ? "williams" : preset === "pancake-zaks" ? "zaks" : undefined;
  onProgress?.("cycle", 0, graphVertexCount(n, preset));
  const { path, flips } =
    preset === "hypercube"
      ? await hypercubeGrayOrder(n, (done, total) => onProgress?.("cycle", done, total), signal)
      : preset === "feistel"
      ? await feistelOrder(n, (done, total) => onProgress?.("cycle", done, total), signal)
      : preset === "hyperoctahedral"
      ? await hyperoctahedralOrder(n, (done, total) => onProgress?.("cycle", done, total), signal)
      : preset === "aes-powers"
      ? await aesPowerCycleOrder(n, (done, total) => onProgress?.("cycle", done, total), signal)
      : preset === "sliding-puzzle"
      ? await slidingPuzzleOrder(n, (done, total) => onProgress?.("cycle", done, total), signal)
      : preset === "simplex"
      ? await simplexOrder(n, (done, total) => onProgress?.("cycle", done, total), signal)
      : preset === "complete"
      ? await completeOrder(n, (done, total) => onProgress?.("cycle", done, total))
      : preset === "pancake-zaks-recursive"
      ? await zaksRecursiveCycle(
          n,
          (done, total) => onProgress?.("cycle", done, total),
          signal
        )
      : preset === "permutahedron-compressed"
      ? await permutahedronCompressionOrder(
          n,
          (done, total) => onProgress?.("cycle", done, total),
          signal
        )
      : preset === "asymmetric-tree"
      ? await asymmetricTreeCycleOrder(
          n,
          (done, total) => onProgress?.("cycle", done, total),
          signal
        )
      : preset === "star"
      ? await ehrlichStarOrder(
          n,
          (done, total) => onProgress?.("cycle", done, total),
          signal
        )
      : preset === "sierpinski"
      ? await sierpinskiHamiltonianOrder(
          n,
          (done, total) => onProgress?.("cycle", done, total),
          signal
        )
      : preset === "reversal-greedy"
      ? await reversalGreedyCycle(
          n,
          (done, total) => onProgress?.("cycle", done, total),
          signal
        )
      : preset === "reversal-graycode"
      ? await johnsonTrotterOrder(
          n,
          (done, total) => onProgress?.("cycle", done, total),
          signal
        )
      : order === undefined
        ? preset === "permutohedron" || preset === "cyclic-adjacent" || preset === "transposition"
        ? await johnsonTrotterOrder(n, (done, total) => onProgress?.("cycle", done, total), signal)
        : await lexicographicOrder(n, (done, total) => onProgress?.("cycle", done, total), signal)
        : await suffixReversalCycle(
          n,
          order,
          (done, total) => onProgress?.("cycle", done, total),
          signal
        );
  const total = path.length;

  onProgress?.("index", 0, total);
  const index = new Map<string, number>();
  for (let i = 0; i < total; i++) index.set(key(path[i]), i);
  throwIfAborted(signal);

  onProgress?.("parity", 0, total);
  const parityMode: VertexParityMode =
    preset === "hypercube" || preset === "feistel" || preset === "aes-powers"
      ? "bitstring"
      : preset === "hyperoctahedral"
      ? "signed"
      : "permutation";
  const vertexParity = await computeVertexParity(
    path,
    parityMode,
    (done, totalSteps) => onProgress?.("parity", done, totalSteps),
    signal
  );
  throwIfAborted(signal);

  const generators = graphGenerators(n, preset);
  const generatorInfos = computeGeneratorInfos(n, preset, generators);
  if (preset === "aes-powers") {
    const edges = new Uint32Array(total * 3);
    const coords = new Float64Array(total * 2);
    let evenEdgeCount = 0;
    let oddEdgeCount = 0;
    const bins = new Uint32Array(EDGE_DISTANCE_BIN_COUNT);
    let arcStepSum = 0;
    const degreesPerStep = 360 / total;
    const totalValues = 2 ** n - 1;

    onProgress?.("edges", 0, total);
    for (let i = 0; i < total; i++) {
      const j = (i + 1) % total;
      edges[i * 3] = i;
      edges[i * 3 + 1] = j;
      edges[i * 3 + 2] = 1;
      const value = aesBitsToValue(path[i]);
      const angle = (2 * Math.PI * (value - 1)) / totalValues;
      coords[2 * i] = 0.98 * Math.cos(angle);
      coords[2 * i + 1] = 0.98 * Math.sin(angle);

      const rawSteps = Math.abs(j - i);
      const arcSteps = Math.min(rawSteps, total - rawSteps);
      const arcDegrees = arcSteps * degreesPerStep;
      const binIndex = Math.min(
        EDGE_DISTANCE_BIN_COUNT - 1,
        Math.floor(arcDegrees / EDGE_DISTANCE_BIN_DEGREES)
      );
      bins[binIndex]++;
      arcStepSum += arcSteps;
      if ((vertexParity[i] ^ vertexParity[j]) === 0) {
        evenEdgeCount++;
      } else {
        oddEdgeCount++;
      }
      if ((i + 1) % 50_000 === 0) {
        onProgress?.("edges", i + 1, total);
        await yieldToEventLoop();
        throwIfAborted(signal);
      }
    }
    onProgress?.("edges", total, total);

    if (generatorInfos[0]) {
      generatorInfos[0].avgArcDegrees = (arcStepSum / total) * degreesPerStep;
      generatorInfos[0].distanceBins = Array.from(bins, (binCount, index) => ({
        minDegrees: index * EDGE_DISTANCE_BIN_DEGREES,
        maxDegrees:
          index === EDGE_DISTANCE_BIN_COUNT - 1
            ? 180
            : (index + 1) * EDGE_DISTANCE_BIN_DEGREES,
        count: binCount,
      })).filter((bin) => bin.count > 0);
    }

    return {
      n,
      preset,
      kind,
      order,
      path,
      flips,
      edges,
      rn: new Uint32Array(0),
      vertexParity,
      evenEdgeCount,
      oddEdgeCount,
      generators: generatorInfos,
      coords,
    };
  }
  // Upper bound on undirected edges. Round up: for non-regular graphs whose
  // generators have fixed points (e.g. the Sierpiński graph) generators × total
  // can be odd, and the tail is trimmed below anyway.
  const edgeCount = Math.ceil((generators.length * total) / 2);
  const edges = new Uint32Array(edgeCount * 3);
  let edgeWriteIdx = 0;
  let evenEdgeCount = 0;
  let oddEdgeCount = 0;
  // Per-generator accumulation of angular distance between connected vertices,
  // measured as the shortest arc along the display circle (in index steps).
  const arcStepSum = new Map<number, number>();
  const arcCount = new Map<number, number>();
  const arcBinCounts = new Map<number, Uint32Array>();
  const degreesPerStep = 360 / total;

  onProgress?.("edges", 0, total);
  for (let i = 0; i < total; i++) {
    for (const generator of generators) {
      const j = index.get(key(generator.apply(path[i])))!;
      if (i < j) {
        edges[edgeWriteIdx++] = i;
        edges[edgeWriteIdx++] = j;
        edges[edgeWriteIdx++] = generator.id;
        const rawSteps = j - i;
        const arcSteps = Math.min(rawSteps, total - rawSteps);
        const arcDegrees = arcSteps * degreesPerStep;
        const binIndex = Math.min(
          EDGE_DISTANCE_BIN_COUNT - 1,
          Math.floor(arcDegrees / EDGE_DISTANCE_BIN_DEGREES)
        );
        let bins = arcBinCounts.get(generator.id);
        if (!bins) {
          bins = new Uint32Array(EDGE_DISTANCE_BIN_COUNT);
          arcBinCounts.set(generator.id, bins);
        }
        bins[binIndex]++;
        arcStepSum.set(generator.id, (arcStepSum.get(generator.id) ?? 0) + arcSteps);
        arcCount.set(generator.id, (arcCount.get(generator.id) ?? 0) + 1);
        if ((vertexParity[i] ^ vertexParity[j]) === 0) {
          evenEdgeCount++;
        } else {
          oddEdgeCount++;
        }
      }
    }
    if ((i + 1) % 50_000 === 0) {
      onProgress?.("edges", i + 1, total);
      await yieldToEventLoop();
      throwIfAborted(signal);
    }
  }
  onProgress?.("edges", total, total);

  for (const info of generatorInfos) {
    const count = arcCount.get(info.id) ?? 0;
    if (count > 0) {
      info.avgArcDegrees = (arcStepSum.get(info.id)! / count) * degreesPerStep;
      const bins = arcBinCounts.get(info.id);
      if (bins) {
        info.distanceBins = Array.from(bins, (binCount, index) => ({
          minDegrees: index * EDGE_DISTANCE_BIN_DEGREES,
          maxDegrees:
            index === EDGE_DISTANCE_BIN_COUNT - 1
              ? 180
              : (index + 1) * EDGE_DISTANCE_BIN_DEGREES,
          count: binCount,
        })).filter((bin) => bin.count > 0);
      }
    }
  }

  const rnIndices: number[] = [];
  if (kind === "pancake") {
    for (let s = 0; s < flips.length; s++) {
      if (flips[s] === n) rnIndices.push(s);
    }
  }
  const rn = new Uint32Array(rnIndices);

  // Non-regular graphs (e.g. the sliding puzzle, whose generators have fixed
  // points when the blank is on a border) write fewer edges than the
  // generators × vertices / 2 upper bound used for allocation. Trim the tail
  // so consumers never see phantom (0,0,0) edges.
  const trimmedEdges =
    edgeWriteIdx === edges.length ? edges : edges.slice(0, edgeWriteIdx);

  const coords =
    preset === "sierpinski" ? sierpinskiGasketCoords(path, n) : undefined;

  return {
    n,
    preset,
    kind,
    order,
    path,
    flips,
    edges: trimmedEdges,
    rn,
    vertexParity,
    evenEdgeCount,
    oddEdgeCount,
    generators: generatorInfos,
    coords,
  };
}

function buildH4CoxeterPlaneGraph(
  onProgress?: (phase: string, done: number, total: number) => void,
  signal?: AbortSignal
): PancakeGraph {
  const n = 4;
  const preset: GraphPreset = "coxeter-h4-600-cell";
  const kind = graphKind(preset);
  const simpleRoots = h4SimpleRoots();
  const roots = h4RootSystem(simpleRoots);
  const total = roots.length;
  onProgress?.("cycle", total, total);
  throwIfAborted(signal);

  const path = Array.from({ length: total }, (_, i) => new Uint8Array([i + 1]) as Perm);
  const flips: number[] = [];
  const vertexParity = new Uint8Array(total);
  const [e1, e2] = h4CoxeterPlane(simpleRoots);
  const coords = new Float64Array(total * 2);
  let maxRadius = 0;
  for (let i = 0; i < total; i++) {
    const x = dot4(roots[i], e1);
    const y = dot4(roots[i], e2);
    coords[2 * i] = x;
    coords[2 * i + 1] = y;
    maxRadius = Math.max(maxRadius, Math.hypot(x, y));
  }
  const scale = maxRadius > 0 ? 0.98 / maxRadius : 1;
  for (let i = 0; i < coords.length; i++) coords[i] *= scale;

  onProgress?.("edges", 0, total);
  let minDist = Infinity;
  const dist2 = (a: Vec4, b: Vec4): number => {
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const d = a[k] - b[k];
      sum += d * d;
    }
    return sum;
  };
  for (let i = 0; i < total; i++) {
    for (let j = i + 1; j < total; j++) {
      const d = dist2(roots[i], roots[j]);
      if (d > 1e-8 && d < minDist) minDist = d;
    }
  }
  const edgeTriples: number[] = [];
  const eps = Math.max(1e-7, minDist * 1e-5);
  for (let i = 0; i < total; i++) {
    for (let j = i + 1; j < total; j++) {
      if (Math.abs(dist2(roots[i], roots[j]) - minDist) <= eps) {
        edgeTriples.push(i, j, 1);
      }
    }
  }
  onProgress?.("edges", total, total);
  const edgeCount = edgeTriples.length / 3;

  return {
    n,
    preset,
    kind,
    path,
    flips,
    edges: Uint32Array.from(edgeTriples),
    rn: new Uint32Array(0),
    vertexParity,
    evenEdgeCount: edgeCount,
    oddEdgeCount: 0,
    generators: [
      {
        id: 1,
        parity: 0,
        label: "edge",
      },
    ],
    coords,
  };
}

function buildCoxeterFamilyGraph(
  n: number,
  preset: CoxeterFamilyPreset,
  onProgress?: (phase: string, done: number, total: number) => void,
  signal?: AbortSignal
): PancakeGraph {
  const kind = graphKind(preset);
  const { simpleRoots, coxeterNumber } = rootDataForCoxeterFamily(n, preset);
  const total = graphVertexCount(n, preset);
  onProgress?.("cycle", total, total);
  throwIfAborted(signal);

  const emptyPerm = new Uint8Array(0) as Perm;
  const path = new Array(total).fill(emptyPerm) as Perm[];
  const flips: number[] = [];
  const vertexParity = new Uint8Array(total);
  const [e1, e2] = coxeterPlane(simpleRoots, coxeterNumber);
  const coords = new Float64Array(total * 2);
  const smallRoots: Vec[] | null =
    total <= COXETER_EDGE_MATERIALIZE_LIMIT ? [] : null;
  let maxRadius = 0;
  const writePoint = (x: number, y: number, root?: Vec) => {
    coords[2 * write] = x;
    coords[2 * write + 1] = y;
    maxRadius = Math.max(maxRadius, Math.hypot(x, y));
    if (root) smallRoots?.push(root);
    write++;
  };
  let write = 0;
  if (smallRoots) {
    forEachCoxeterRoot(n, preset, (root) => writePoint(dot(root, e1), dot(root, e2), root));
  } else {
    forEachCoxeterRootProjection(n, preset, e1, e2, writePoint);
  }
  const scale = maxRadius > 0 ? 0.98 / maxRadius : 1;
  for (let i = 0; i < coords.length; i++) coords[i] *= scale;

  if (!smallRoots) {
    onProgress?.("edges", total, total);
    return {
      n,
      preset,
      kind,
      path,
      flips,
      edges: new Uint32Array(0),
      rn: new Uint32Array(0),
      vertexParity,
      evenEdgeCount: 0,
      oddEdgeCount: 0,
      generators: [{ id: 1, parity: 0, label: "edge" }],
      coords,
    };
  }

  onProgress?.("edges", 0, total);
  let minDist = Infinity;
  const dist2 = (a: Vec, b: Vec): number => {
    let sum = 0;
    for (let k = 0; k < a.length; k++) {
      const d = a[k] - b[k];
      sum += d * d;
    }
    return sum;
  };
  for (let i = 0; i < total; i++) {
    for (let j = i + 1; j < total; j++) {
      const d = dist2(smallRoots[i], smallRoots[j]);
      if (d > 1e-8 && d < minDist) minDist = d;
    }
  }
  const edgeTriples: number[] = [];
  const eps = Math.max(1e-7, minDist * 1e-5);
  for (let i = 0; i < total; i++) {
    for (let j = i + 1; j < total; j++) {
      if (Math.abs(dist2(smallRoots[i], smallRoots[j]) - minDist) <= eps) {
        edgeTriples.push(i, j, 1);
      }
    }
  }
  onProgress?.("edges", total, total);
  const edgeCount = edgeTriples.length / 3;

  return {
    n,
    preset,
    kind,
    path,
    flips,
    edges: Uint32Array.from(edgeTriples),
    rn: new Uint32Array(0),
    vertexParity,
    evenEdgeCount: edgeCount,
    oddEdgeCount: 0,
    generators: [{ id: 1, parity: 0, label: "edge" }],
    coords,
  };
}

/**
 * 2-D positions of the Sierpiński gasket: the word d₁…dₙ maps to the IFS
 * address Σₖ 2⁻ᵏ·V(dₖ) over the three triangle corners V(0), V(1), V(2), so the
 * three constant words land near the corners and each leading symbol selects a
 * sub-triangle. Re-centered and scaled to fill the unit disk.
 */
function sierpinskiGasketCoords(path: Perm[], n: number): Float64Array {
  // Equilateral triangle, apex up (screen y grows downward).
  const V: ReadonlyArray<readonly [number, number]> = [
    [0, -1],
    [-0.8660254037844386, 0.5],
    [0.8660254037844386, 0.5],
  ];
  const total = path.length;
  const xs = new Float64Array(total);
  const ys = new Float64Array(total);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < total; i++) {
    const w = path[i];
    let x = 0;
    let y = 0;
    let s = 1;
    for (let kk = 0; kk < n; kk++) {
      s *= 0.5;
      const v = V[w[kk]];
      x += s * v[0];
      y += s * v[1];
    }
    xs[i] = x;
    ys[i] = y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  let maxDist = 1e-9;
  for (let i = 0; i < total; i++) {
    const d = Math.hypot(xs[i] - cx, ys[i] - cy);
    if (d > maxDist) maxDist = d;
  }
  const scale = 0.98 / maxDist;
  const out = new Float64Array(total * 2);
  for (let i = 0; i < total; i++) {
    out[2 * i] = (xs[i] - cx) * scale;
    out[2 * i + 1] = (ys[i] - cy) * scale;
  }
  return out;
}

/* ----------------------- zaks rotational symmetry ----------------------- */

/**
 * One representative edge of the Zaks pancake layout's fundamental angular
 * sector (block 0), produced directly from the recursive / rotational
 * structure instead of scanning the full O(n!) edge set.
 */
export interface ZaksFundamentalEdge {
  /** Block-0 endpoint, 0 ≤ i < (n-1)! — the orbit's canonical representative. */
  i: number;
  /** Partner endpoint along the full circle, 0 ≤ j < n!. */
  j: number;
  /** Generator id = suffix-reversal length. */
  gen: number;
  /** Antipodal "diameter" chord (orbit size n/2) vs a generic orbit (size n). */
  half: boolean;
  /** Parity difference (0 = same parity, 1 = opposite) of the two endpoints. */
  parityXor: 0 | 1;
}

function pancakeGeneratorIds(n: number): number[] {
  // Zaks symmetry payloads mirror the sparse Zaks graph: only rₙ past n = 6.
  const first = n > 6 ? n : 2;
  const ids: number[] = [];
  for (let k = first; k <= n; k++) ids.push(k);
  return ids;
}

function permParity(p: Perm): 0 | 1 {
  let par = 0;
  const len = p.length;
  for (let a = 0; a < len; a++) {
    const va = p[a];
    for (let b = a + 1; b < len; b++) if (va > p[b]) par ^= 1;
  }
  return par as 0 | 1;
}

/**
 * The first block of the Zaks ordering: the (n-1)! permutations reachable from
 * the identity without ever using the full reversal rₙ (so all share the
 * leading symbol 1). This is the greedy smallest-flip walk restricted to
 * reversals of length < n, which is exactly the first (n-1)! entries of the
 * full pancake-zaks path — O((n-1)!) time and memory, never the full n!.
 */
export function zaksBlock0(n: number): Perm[] {
  const B = factorial(n - 1);
  const start = new Uint8Array(n);
  for (let i = 0; i < n; i++) start[i] = i + 1;
  const block: Perm[] = [start];
  const seen = new Set<string>([key(start)]);
  let p = start;
  while (block.length < B) {
    let next: Perm | null = null;
    for (let k = 2; k <= n - 1; k++) {
      const q = flip(p, k);
      if (!seen.has(key(q))) {
        next = q;
        break;
      }
    }
    if (!next) break; // block 0 exhausted
    seen.add(key(next));
    block.push(next);
    p = next;
  }
  return block;
}

/**
 * Enumerate the fundamental-domain edges of the pancake-zaks layout straight
 * from the recursion, without building the full graph. The cyclic relabeling
 * φ: s ↦ (s mod n)+1 realizes a 360/n rotation (index shift by B = (n-1)!), so
 * every edge orbit has a single representative incident to block 0; we locate
 * each rₙ partner via φ in O(1) using only a block-0 position map.
 *
 * Edges are yielded in the same order (block-0 index, then ascending generator
 * id) as the full edge array, so consumers reproduce the scan-based output
 * exactly. Total work is O((n-1)!) — an n-fold reduction over a full scan.
 */
export function forEachZaksFundamentalEdge(
  n: number,
  visit: (edge: ZaksFundamentalEdge) => void
): void {
  const B = factorial(n - 1);
  const block0 = zaksBlock0(n);
  const pos = new Map<string, number>();
  for (let o = 0; o < block0.length; o++) pos.set(key(block0[o]), o);
  const par0 = block0.map(permParity);
  const ids = pancakeGeneratorIds(n);
  const even = n % 2 === 0;

  // φ⁻¹ on symbol values: s ↦ ((s-2) mod n)+1.
  const phiInvOnce = (q: Perm): Perm => {
    const r = new Uint8Array(q.length);
    for (let t = 0; t < q.length; t++) r[t] = ((q[t] - 2 + n) % n) + 1;
    return r;
  };

  for (let i = 0; i < B; i++) {
    const p = block0[i];
    for (const k of ids) {
      let j: number;
      let pj: 0 | 1;
      if (k < n) {
        // Short reversal: stays inside block 0, so its index is its offset.
        const o = pos.get(key(flip(p, k)))!;
        j = o;
        pj = par0[o];
      } else {
        // Full reversal rₙ: crosses into block b, whose leading symbol is
        // φᵇ(1) = 1+b, hence b = q[0]-1. Undo b rotations to land back in
        // block 0 and read the offset there.
        const q = flip(p, n);
        const b = q[0] - 1;
        let back = q;
        for (let t = 0; t < b; t++) back = phiInvOnce(back);
        const o = pos.get(key(back))!;
        j = b * B + o;
        pj = permParity(q);
      }
      if (!(i < j)) continue;
      const parityXor = (par0[i] ^ pj) as 0 | 1;
      if (j < B) {
        visit({ i, j, gen: k, half: false, parityXor });
      } else {
        const v = j % B;
        if (i < v) visit({ i, j, gen: k, half: false, parityXor });
        else if (i === v && even) visit({ i, j, gen: k, half: true, parityXor });
      }
    }
  }
}

/**
 * A lightweight pancake-zaks payload for the rotational symmetry renderer. It
 * carries only what the UI panels and the SVG need — analytic counts and
 * per-generator metadata derived from the fundamental sector — and omits the
 * O(n!) path/edge arrays entirely. Time and memory are O((n-1)!).
 *
 * `path`/`edges`/`vertexParity` are intentionally empty: the symmetry SVG is
 * generated from the recursion (see toZaksSymmetrySVG), and consumers that need
 * the full arrays (canvas/density/flat-SVG/PNG) trigger a full rebuild.
 */
export function buildZaksSymmetryGraph(n: number): PancakeGraph {
  const preset: GraphPreset = "pancake-zaks";
  const total = factorial(n);
  const generators = graphGenerators(n, preset);
  const generatorInfos = computeGeneratorInfos(n, preset, generators);
  const degreesPerStep = 360 / total;
  const binsById = new Map<number, Float64Array>();
  const arcStepSum = new Map<number, number>();
  const arcCount = new Map<number, number>();
  let evenEdgeCount = 0;
  let oddEdgeCount = 0;

  forEachZaksFundamentalEdge(n, (e) => {
    // Each representative stands for its whole rotation orbit (n, or n/2 for
    // antipodal "diameter" chords), so we weight every tally by the orbit size.
    const orbit = e.half ? n / 2 : n;
    if (e.parityXor === 0) evenEdgeCount += orbit;
    else oddEdgeCount += orbit;
    const raw = e.j - e.i;
    const arcSteps = Math.min(raw, total - raw);
    const degrees = arcSteps * degreesPerStep;
    const binIndex = Math.min(
      EDGE_DISTANCE_BIN_COUNT - 1,
      Math.floor(degrees / EDGE_DISTANCE_BIN_DEGREES)
    );
    let bins = binsById.get(e.gen);
    if (!bins) {
      bins = new Float64Array(EDGE_DISTANCE_BIN_COUNT);
      binsById.set(e.gen, bins);
    }
    bins[binIndex] += orbit;
    arcStepSum.set(e.gen, (arcStepSum.get(e.gen) ?? 0) + arcSteps * orbit);
    arcCount.set(e.gen, (arcCount.get(e.gen) ?? 0) + orbit);
  });

  for (const info of generatorInfos) {
    const count = arcCount.get(info.id) ?? 0;
    if (count > 0) {
      info.avgArcDegrees = (arcStepSum.get(info.id)! / count) * degreesPerStep;
      const bins = binsById.get(info.id);
      if (bins) {
        info.distanceBins = Array.from(bins, (binCount, index) => ({
          minDegrees: index * EDGE_DISTANCE_BIN_DEGREES,
          maxDegrees:
            index === EDGE_DISTANCE_BIN_COUNT - 1
              ? 180
              : (index + 1) * EDGE_DISTANCE_BIN_DEGREES,
          count: binCount,
        })).filter((bin) => bin.count > 0);
      }
    }
  }

  const empty = new Uint32Array(0);
  return {
    n,
    preset,
    kind: "pancake",
    order: "zaks",
    path: [],
    flips: [],
    edges: empty,
    rn: empty,
    vertexParity: new Uint8Array(0),
    evenEdgeCount,
    oddEdgeCount,
    generators: generatorInfos,
  };
}

/**
 * The permutation at global position `i` (0 ≤ i < n!) of the greedy Zaks
 * suffix-reversal Hamiltonian cycle, computed analytically in O(n²) without
 * building the cycle.
 *
 * It uses the layout's defining invariant (see forEachZaksFundamentalEdge):
 * shifting the cycle index by B = (n-1)! equals applying φ: s ↦ (s mod n)+1 to
 * every symbol, and block 0 (leading symbol 1) is an isomorphic copy of the
 * (n-1)-symbol Zaks cycle on the suffix. Hence
 *   perm[i] = φ^⌊i/B⌋( [1] ++ (zaksUnrank(n-1, i mod B) + 1) ).
 * Verified to match `suffixReversalCycle(n, "zaks")` exactly for n ≤ 8.
 *
 * This is what lets the density-field renderer reach n far beyond what the n!
 * cycle could ever be enumerated: it can rank/unrank single positions on demand.
 */
export function zaksUnrank(n: number, i: number): Perm {
  const out = new Uint8Array(n) as Perm;
  fillZaksUnrank(n, i, out);
  return out;
}

function fillZaksUnrank(m: number, i: number, out: Uint8Array): void {
  if (m === 1) {
    out[0] = 1;
    return;
  }
  const B = factorial(m - 1);
  const b = Math.floor(i / B);
  const o = i - b * B;
  // Fill out[0..m-2] with the suffix's Zaks permutation of {1..m-1}.
  fillZaksUnrank(m - 1, o, out);
  // Make room for the fixed leading symbol 1 and lift the suffix into {2..m}.
  for (let t = m - 1; t >= 1; t--) out[t] = out[t - 1] + 1;
  out[0] = 1;
  // Rotate every symbol by b under φ: s ↦ ((s-1+b) mod m)+1.
  for (let t = 0; t < m; t++) out[t] = ((out[t] - 1 + b) % m) + 1;
}

/**
 * Inverse of {@link zaksUnrank}: the global cycle position (0 ≤ i < n!) of a
 * permutation `q` of {1..n} in the greedy Zaks order, in O(n²).
 */
export function zaksRank(n: number, q: Perm): number {
  return computeZaksRank(n, q);
}

function computeZaksRank(m: number, q: ArrayLike<number>): number {
  if (m === 1) return 0;
  const B = factorial(m - 1);
  // q = φ^b(u) with u[0] = 1, so q[0] = (b mod m)+1 ⇒ b = q[0]-1.
  const b = q[0] - 1;
  // Undo φ^b and drop the leading symbol: the suffix maps to a permutation of
  // {1..m-1} via s ↦ ((s-1-b) mod m) (the leading 1 maps to 0 and is removed).
  const inner = new Uint8Array(m - 1);
  for (let t = 1; t < m; t++) {
    inner[t - 1] = (((q[t] - 1 - b) % m) + m) % m;
  }
  return b * B + computeZaksRank(m - 1, inner);
}

/**
 * σₙ = rank ∘ reverse ∘ unrank: the global cycle position (0 ≤ σ < n!) of the
 * rₙ-neighbor of the permutation living at position `i` in the greedy Zaks
 * order. Here "reverse" is the full pancake flip rₙ (whole-word reversal), so
 * σₙ maps each vertex index to the index its long rₙ chord lands on.
 *
 * This is the map driving the `rₙ` caustics of the Zaks layout (see
 * docs/pancake-aretes-longues.md): the chord joins angles 2π·i/n! and
 * 2π·σₙ(i)/n!. Computed in O(n²) without ever materializing the n! cycle.
 */
export function zaksSigma(n: number, i: number): number {
  const p = zaksUnrank(n, i);
  // rₙ = full reversal of p.
  const q = new Uint8Array(n) as Perm;
  for (let t = 0; t < n; t++) q[t] = p[n - 1 - t];
  return zaksRank(n, q);
}

/**
 * A lightweight pancake-zaks payload for the density-field renderer at large n,
 * where neither the n! cycle nor the (n-1)! fundamental sector can be
 * enumerated. It carries only generator metadata and analytic edge tallies; the
 * renderer samples chords via {@link zaksUnrank}/{@link zaksRank} instead of any
 * stored array. Time and memory are O(n²).
 *
 * For n > 6 the only generator is the full reversal rₙ, which connects p with
 * its reverse; that reversal has fixed parity (⌊n/2⌋ transpositions), so every
 * edge falls in a single parity class — counted here without a scan.
 */
export function buildZaksSamplingGraph(n: number): PancakeGraph {
  const preset: GraphPreset = "pancake-zaks";
  const generators = graphGenerators(n, preset);
  const generatorInfos = computeGeneratorInfos(n, preset, generators);
  const totalEdges = factorial(n) / 2;
  // Parity of the full reversal of n symbols = ⌊n/2⌋ transpositions.
  const reversalParity = Math.floor(n / 2) % 2;
  const evenEdgeCount = reversalParity === 0 ? totalEdges : 0;
  const oddEdgeCount = reversalParity === 0 ? 0 : totalEdges;
  const empty = new Uint32Array(0);
  return {
    n,
    preset,
    kind: "pancake",
    order: "zaks",
    path: [],
    flips: [],
    edges: empty,
    rn: empty,
    vertexParity: new Uint8Array(0),
    evenEdgeCount,
    oddEdgeCount,
    generators: generatorInfos,
  };
}

/** Lightweight payload for the analytic random symmetry matching renderers. */
function buildSymmetricRandomSamplingGraph(
  n: number,
  preset: "random-cyclic" | "random-dihedral" | "wedge-clipped-dihedral"
): PancakeGraph {
  const generatorInfos = computeGeneratorInfos(n, preset, graphGenerators(n, preset));
  const totalEdges = factorial(n) / 2;
  if (generatorInfos[0]) {
    generatorInfos[0].avgArcDegrees = 90;
    generatorInfos[0].distanceBins = Array.from(
      { length: EDGE_DISTANCE_BIN_COUNT },
      (_, index) => ({
        minDegrees: index * EDGE_DISTANCE_BIN_DEGREES,
        maxDegrees:
          index === EDGE_DISTANCE_BIN_COUNT - 1
            ? 180
            : (index + 1) * EDGE_DISTANCE_BIN_DEGREES,
        count: totalEdges / EDGE_DISTANCE_BIN_COUNT,
      })
    );
  }
  const empty = new Uint32Array(0);
  return {
    n,
    preset,
    kind: preset,
    order: undefined,
    path: [],
    flips: [],
    edges: empty,
    rn: empty,
    vertexParity: new Uint8Array(0),
    evenEdgeCount: 0,
    oddEdgeCount: totalEdges,
    generators: generatorInfos,
  };
}

export function buildRandomCyclicSamplingGraph(n: number): PancakeGraph {
  return buildSymmetricRandomSamplingGraph(n, "random-cyclic");
}

export function buildRandomDihedralSamplingGraph(n: number): PancakeGraph {
  return buildSymmetricRandomSamplingGraph(n, "random-dihedral");
}

export function buildWedgeClippedDihedralSamplingGraph(n: number): PancakeGraph {
  return buildSymmetricRandomSamplingGraph(n, "wedge-clipped-dihedral");
}

export const KALEIDOSCOPE_STROKES_MIN = 4;
export const KALEIDOSCOPE_STROKES_MAX = 80;
export const KALEIDOSCOPE_STROKES_DEFAULT = 20;
const KALEIDOSCOPE_BEAD_LEN = 0.07;
const KALEIDOSCOPE_RIBBON_OFFSET = 0.006;

function kaleidoscopeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Clip a unit-disk segment to the fundamental wedge [0, π/n]. */
function clipSegmentToWedge(
  n: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): [number, number, number, number] | null {
  const wedge = Math.PI / n;
  const sin = Math.sin(wedge);
  const cos = Math.cos(wedge);
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const clip = (h0: number, dh: number): boolean => {
    if (Math.abs(dh) < 1e-15) return h0 >= 0;
    const t = -h0 / dh;
    if (dh > 0) {
      if (t > t0) t0 = t;
    } else if (t < t1) {
      t1 = t;
    }
    return t0 < t1;
  };
  if (!clip(y1, dy)) return null;
  if (!clip(sin * x1 - cos * y1, sin * dx - cos * dy)) return null;
  return [x1 + dx * t0, y1 + dy * t0, x1 + dx * t1, y1 + dy * t1];
}

/** A raw kaleidoscope segment in the wedge frame, with a relative intensity. */
export interface KaleidoscopeShard {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 0..1 intensity, used as colour/weight by the density field. */
  w: number;
}

/**
 * Geometry of the kaleidoscope, defined once and shared by the vector graph
 * (SVG / Canvas) and the density field (Yankelovich). Returns raw segments in
 * the fundamental wedge frame [0, π/n]; each caller clips them to the wedge and
 * tiles the 2n dihedral copies.
 *
 * The composition has three layers so the mirrors weave a designed rosette
 * instead of random dust: a central bloom of radial petals anchored at the apex
 * (so the centre has a heart, not a hole), curved ribbons — chains of connected
 * beads — spread across the radius with a light centre bias that fold into
 * petals under reflection, and a few outer crystals for rim sparkle. Per-shard
 * intensities give the density field varied hues under a colour map.
 *
 * `strokes` is the number of base ribbons in the wedge (the bloom and crystals
 * scale with it); the seed is the "twist" of the tube.
 */
export function kaleidoscopeShards(
  n: number,
  seed = 1,
  strokes = KALEIDOSCOPE_STROKES_DEFAULT
): KaleidoscopeShard[] {
  const rng = kaleidoscopeRng(seed);
  const wedge = Math.PI / n;
  const ribbons = Math.max(1, Math.round(strokes));
  const petals = Math.min(8, Math.max(2, Math.round(ribbons * 0.25)));
  const crystals = Math.min(24, Math.max(0, Math.round(ribbons * 0.35)));
  const out: KaleidoscopeShard[] = [];
  const push = (x1: number, y1: number, x2: number, y2: number, w: number) =>
    out.push({ x1, y1, x2, y2, w });

  // 1. Central bloom: short radial petals anchored near the apex.
  for (let i = 0; i < petals; i++) {
    const a = (wedge * (i + 0.5 + 0.3 * (rng() - 0.5))) / petals;
    const r0 = 0.03 + 0.04 * rng();
    const r1 = r0 + 0.12 + 0.1 * rng();
    const w = 0.55 + 0.45 * rng();
    push(r0 * Math.cos(a), r0 * Math.sin(a), r1 * Math.cos(a), r1 * Math.sin(a), w);
  }

  // 2. Curved ribbons: chains of beads spread across the radius (centre-biased).
  for (let g = 0; g < ribbons; g++) {
    const baseR = 0.05 + 0.85 * Math.pow(rng(), 1.15);
    const baseA = rng() * wedge;
    const beads = 3 + Math.floor(rng() * 4);
    const len = KALEIDOSCOPE_BEAD_LEN * (0.6 + 0.8 * rng());
    const w = 0.3 + 0.7 * rng();
    let px = baseR * Math.cos(baseA);
    let py = baseR * Math.sin(baseA);
    let dir = rng() * 2 * Math.PI;
    const curl = (rng() - 0.5) * 1.4;
    for (let b = 0; b < beads; b++) {
      const nx = px + Math.cos(dir) * len;
      const ny = py + Math.sin(dir) * len;
      push(px, py, nx, ny, w);
      px = nx;
      py = ny;
      dir += curl;
    }
  }

  // 3. Outer crystals: short bright slivers near the rim.
  for (let c = 0; c < crystals; c++) {
    const r = 0.6 + 0.32 * rng();
    const a = rng() * wedge;
    const cx = r * Math.cos(a);
    const cy = r * Math.sin(a);
    const half = 0.03 + 0.05 * rng();
    const dir = rng() * Math.PI;
    const hx = Math.cos(dir) * half;
    const hy = Math.sin(dir) * half;
    push(cx - hx, cy - hy, cx + hx, cy + hy, 0.5 + 0.5 * rng());
  }

  return out;
}

/**
 * Kaleidoscope: the {@link kaleidoscopeShards} composition clipped to one Dₙ
 * fundamental chamber (π/n) so reflections meet continuously at the mirrors,
 * then materialized as the 2n dihedral copies of every shard. Unlike the
 * random-matching controls this is a concrete vector graph (coords + edge
 * segments), so it renders in SVG / Canvas as well as the density field. The
 * seed is the "twist" of the tube.
 */
export function buildKaleidoscopeSamplingGraph(
  n: number,
  seed = 1,
  strokes = KALEIDOSCOPE_STROKES_DEFAULT
): PancakeGraph {
  const coordsArr: number[] = [];
  const edgesArr: number[] = [];
  let v = 0;
  // A couple of parallel offset copies give every shard a little body, so the
  // mirrored petals read as panes of glass rather than hairlines.
  const ribbon = [-KALEIDOSCOPE_RIBBON_OFFSET, 0, KALEIDOSCOPE_RIBBON_OFFSET];
  const emit = (seg: [number, number, number, number]) => {
    for (let k = 0; k < n; k++) {
      const ang = (2 * Math.PI * k) / n;
      const rc = Math.cos(ang);
      const rs = Math.sin(ang);
      for (let m = 0; m < 2; m++) {
        const tp = (x: number, y: number): [number, number] => {
          const Y = m === 1 ? -y : y;
          return [x * rc - Y * rs, x * rs + Y * rc];
        };
        const [px, py] = tp(seg[0], seg[1]);
        const [qx, qy] = tp(seg[2], seg[3]);
        coordsArr.push(px, py, qx, qy);
        edgesArr.push(v, v + 1, 1);
        v += 2;
      }
    }
  };
  for (const shard of kaleidoscopeShards(n, seed, strokes)) {
    const dx = shard.x2 - shard.x1;
    const dy = shard.y2 - shard.y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (const off of ribbon) {
      const seg = clipSegmentToWedge(
        n,
        shard.x1 + nx * off,
        shard.y1 + ny * off,
        shard.x2 + nx * off,
        shard.y2 + ny * off
      );
      if (seg) emit(seg);
    }
  }

  const emptyPerm = new Uint8Array(0);
  return {
    n,
    preset: "kaleidoscope",
    kind: "kaleidoscope",
    order: undefined,
    path: new Array(v).fill(emptyPerm) as Perm[],
    flips: [],
    edges: Uint32Array.from(edgesArr),
    rn: new Uint32Array(0),
    vertexParity: new Uint8Array(v),
    evenEdgeCount: 0,
    oddEdgeCount: edgesArr.length / 3,
    generators: [{ id: 1, parity: 1, label: "shard" }],
    coords: Float64Array.from(coordsArr),
  };
}

export function buildSimplexSamplingGraph(n: number): PancakeGraph {
  const edgeCount = factorial(n) * (factorial(n) - 1) / 2;
  return {
    n,
    preset: "simplex",
    kind: "simplex",
    order: undefined,
    path: [],
    flips: [],
    edges: new Uint32Array(0),
    rn: new Uint32Array(0),
    vertexParity: new Uint8Array(0),
    evenEdgeCount: edgeCount,
    oddEdgeCount: 0,
    generators: [{ id: 1, parity: 0, label: "edges", avgArcDegrees: 90 }],
  };
}

function computeGeneratorInfos(
  n: number,
  preset: GraphPreset,
  generators: Generator[]
): GeneratorInfo[] {
  if (
    preset === "random-cyclic" ||
    preset === "random-dihedral" ||
    preset === "wedge-clipped-dihedral" ||
    preset === "kaleidoscope"
  ) {
    return [{ id: 1, parity: 1, label: "random matching" }];
  }

  if (preset === "sliding-puzzle") {
    // Every move swaps the blank with a neighbor — a transposition, hence
    // odd. The identity-application trick below would not find a blank, so we
    // assign parity directly.
    const infos = generators.map((gen) => ({
      id: gen.id,
      parity: 1 as 0 | 1,
      label: generatorLabel(gen.id, preset, n),
    }));
    infos.sort((a, b) => a.id - b.id);
    return infos;
  }

  if (preset === "sierpinski") {
    // Vertices are words over {0,1,2}, not the permutation identity, so build a
    // representative vertex on which each generator is active and read its
    // inversion-parity delta. The graph is non-bipartite, so this parity is a
    // per-generator approximation used only for the chip coloring.
    const infos = generators.map((gen) => {
      const base = new Uint8Array(n);
      if (gen.id <= n - 1) base[gen.id - 1] = 1;
      const parity = (permParity(base) ^ permParity(gen.apply(base))) as 0 | 1;
      return { id: gen.id, parity, label: generatorLabel(gen.id, preset, n) };
    });
    infos.sort((a, b) => a.id - b.id);
    return infos;
  }

  if (preset === "aes-powers") {
    return generators
      .map((gen) => ({
        id: gen.id,
        parity: 1 as 0 | 1,
        label: generatorLabel(gen.id, preset, n),
      }))
      .sort((a, b) => a.id - b.id);
  }

  if (preset === "hyperoctahedral") {
    // Every Coxeter generator is a reflection (odd), so the graph is bipartite.
    // Read the Coxeter sign of each generator applied to the identity.
    const identity = new Uint8Array(n) as Perm;
    for (let i = 0; i < n; i++) identity[i] = i + 1;
    const infos = generators.map((gen) => ({
      id: gen.id,
      parity: signedParity(gen.apply(identity)),
      label: generatorLabel(gen.id, preset, n),
    }));
    infos.sort((a, b) => a.id - b.id);
    return infos;
  }

  const isBitString = preset === "hypercube" || preset === "feistel";
  const identity = new Uint8Array(n);
  if (!isBitString) {
    for (let i = 0; i < n; i++) identity[i] = i + 1;
  }

  const infos = generators.map((gen) => {
    const result = gen.apply(identity);
    let parity: 0 | 1 = 0;
    if (isBitString) {
      let s = 0;
      for (let i = 0; i < n; i++) s ^= result[i];
      parity = (s & 1) as 0 | 1;
    } else {
      let par = 0;
      for (let a = 0; a < n; a++) {
        const va = result[a];
        for (let b = a + 1; b < n; b++) {
          if (va > result[b]) par ^= 1;
        }
      }
      parity = par as 0 | 1;
    }
    return {
      id: gen.id,
      parity,
      label: generatorLabel(gen.id, preset, n, result),
    };
  });
  infos.sort((a, b) => a.id - b.id);
  return infos;
}

function generatorLabel(
  id: number,
  preset: GraphPreset,
  n: number,
  result?: Perm
): string {
  if (preset === "lexicographic" || preset === "cayley-complete") {
    return result ? permString(result) : String(id);
  }
  if (preset === "pancake-zaks" || preset === "pancake-williams") {
    return String(id);
  }
  if (preset === "hypercube") {
    return `b${id}`;
  }
  if (preset === "hyperoctahedral") {
    return id <= n - 1 ? `s${id}` : `±${id - n + 1}`;
  }
  if (preset === "feistel") {
    const round = Math.floor((id + 1) / 2);
    return id % 2 === 1 ? `L${round}` : `R${round}`;
  }
  if (preset === "aes-powers") {
    return id === 1 ? "×02" : "÷02";
  }
  if (preset === "star") {
    return String(id);
  }
  if (preset === "sliding-puzzle") {
    return id === 1 ? "↑" : id === 2 ? "↓" : id === 3 ? "←" : "→";
  }
  if (preset === "permutohedron") {
    return `s${id}`;
  }
  if (preset === "cyclic-adjacent") {
    return id === n ? `s${n}` : `s${id}`;
  }
  if (preset === "transposition" || preset === "asymmetric-tree") {
    const i = Math.floor(id / 100);
    const j = id % 100;
    return `${i},${j}`;
  }
  if (isReversalPreset(preset)) {
    const i = Math.floor(id / 100);
    const j = id % 100;
    return `${i}–${j}`;
  }
  if (preset === "sierpinski") {
    // ids 1..n-1 are the bridge levels h; ids n..n+k-2 the last-symbol clique.
    return id <= n - 1 ? `h${id}` : `+${id - (n - 1)}`;
  }
  return String(id);
}

type VertexParityMode = "permutation" | "bitstring" | "signed";

async function computeVertexParity(
  path: Perm[],
  mode: VertexParityMode,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
  chunk = 100_000
): Promise<Uint8Array> {
  throwIfAborted(signal);
  const total = path.length;
  const parity = new Uint8Array(total);

  if (mode === "bitstring") {
    for (let i = 0; i < total; i++) {
      const v = path[i];
      let s = 0;
      for (let b = 0; b < v.length; b++) s ^= v[b];
      parity[i] = s & 1;
      if ((i + 1) % chunk === 0) {
        onProgress?.(i + 1, total);
        await yieldToEventLoop();
        throwIfAborted(signal);
      }
    }
  } else if (mode === "signed") {
    // Signed permutation: byte v ≤ n means +v, v > n means -(v-n). The Coxeter
    // sign of Bₙ (every simple reflection ↦ −1) is the inversion parity of the
    // magnitudes XOR the parity of the negative-sign count.
    for (let i = 0; i < total; i++) {
      parity[i] = signedParity(path[i]);
      if ((i + 1) % chunk === 0) {
        onProgress?.(i + 1, total);
        await yieldToEventLoop();
        throwIfAborted(signal);
      }
    }
  } else {
    for (let i = 0; i < total; i++) {
      const v = path[i];
      const len = v.length;
      let par = 0;
      for (let a = 0; a < len; a++) {
        const va = v[a];
        for (let b = a + 1; b < len; b++) {
          if (va > v[b]) par ^= 1;
        }
      }
      parity[i] = par;
      if ((i + 1) % chunk === 0) {
        onProgress?.(i + 1, total);
        await yieldToEventLoop();
        throwIfAborted(signal);
      }
    }
  }

  onProgress?.(total, total);
  return parity;
}

export function graphPresetLabel(preset: GraphPreset): string {
  switch (preset) {
    case "pancake-zaks":
      return "Pancake graph — Zaks";
    case "pancake-zaks-recursive":
      return "Pancake graph — Zaks (recursive)";
    case "pancake-williams":
      return "Pancake graph — Williams";
    case "random-cyclic":
      return "Random graph — Cₙ symmetry";
    case "random-dihedral":
      return "Random graph — Dₙ symmetry";
    case "wedge-clipped-dihedral":
      return "Wedge-clipped Dₙ density";
    case "coxeter-a":
      return "Coxeter plane — Aₙ";
    case "coxeter-b":
      return "Coxeter plane — Bₙ";
    case "coxeter-d":
      return "Coxeter plane — Dₙ";
    case "kaleidoscope":
      return "Kaleidoscope";
    case "aes-powers":
      return "AES powers of two";
    case "star":
      return "Star graph";
    case "permutohedron":
      return "Permutohedron graph — Steinhaus–Johnson–Trotter";
    case "permutahedron-compressed":
      return "Permutahedron — Gregor–Merino–Mütze compression";
    case "cyclic-adjacent":
      return "Cyclic adjacent graph";
    case "transposition":
      return "Transposition graph";
    case "asymmetric-tree":
      return "Asymmetric tree Cayley graph";
    case "reversal":
      return "Reversal graph (Rₙ)";
    case "reversal-greedy":
      return "Reversal graph — greedy (Warnsdorff)";
    case "reversal-graycode":
      return "Reversal graph — plain changes";
    case "lexicographic":
      return "Lexicographic graph";
    case "hyperoctahedral":
      return "Hyperoctahedral group (Bₙ)";
    case "hypercube":
      return "Hypercube — binary reflected Gray code";
    case "feistel":
      return "Feistel cipher";
    case "sliding-puzzle":
      return "Sliding puzzle (15-puzzle)";
    case "simplex":
      return "Simplex (Petrie polygon)";
    case "complete":
      return "Complete graph Kₙ";
    case "cayley-complete":
      return "Complete Cayley graph of Sₙ";
    case "sierpinski":
      return "Sierpiński graph S(n, 3)";
    case "coxeter-h4-600-cell":
      return "600-cell — Coxeter plane";
  }
}

export function graphPresetDescription(preset: GraphPreset): string {
  switch (preset) {
    case "pancake-zaks":
      return "Suffix reversals, minimum new flip (Zaks 1984)";
    case "pancake-zaks-recursive":
      return "Suffix reversals, Zaks' explicit recursion pathₙ = (pathₙ₋₁ rₙ)ⁿ⁻¹ pathₙ₋₁";
    case "pancake-williams":
      return "Suffix reversals, maximum new flip";
    case "random-cyclic":
      return "Random matching with Cₙ symmetry on n! vertices";
    case "random-dihedral":
      return "Random matching with Dₙ symmetry on n! vertices";
    case "wedge-clipped-dihedral":
      return "Random matching clipped to a Dₙ fundamental wedge";
    case "coxeter-a":
      return "Aₙ root polytope projected to the Coxeter plane";
    case "coxeter-b":
      return "Bₙ root polytope projected to the Coxeter plane";
    case "coxeter-d":
      return "Dₙ root polytope projected to the Coxeter plane";
    case "kaleidoscope":
      return "Glass strokes in one wedge, mirrored by the Dₙ kaleidoscope";
    case "aes-powers":
      return "Repeated AES xtime multiplication in GF(2ⁿ)";
    case "star":
      return "Swap the first position with any other";
    case "permutohedron":
      return "Adjacent transpositions s_i = (i, i+1)";
    case "permutahedron-compressed":
      return "Adjacent transpositions, laid out along a maximally rotationally symmetric Hamilton cycle (Gregor–Merino–Mütze 2024)";
    case "cyclic-adjacent":
      return "Adjacent transpositions on a ring, including (n, 1)";
    case "transposition":
      return "All transpositions (i, j)";
    case "asymmetric-tree":
      return "Transpositions of a rigid (identity) tree — Aut = Sₙ (Feng's minimum)";
    case "reversal":
      return "Reverse any contiguous block";
    case "reversal-greedy":
      return "Reverse any block, Hamiltonian path by Warnsdorff greedy (naive Zaks/Williams greedy dead-ends here)";
    case "reversal-graycode":
      return "Reverse any block, Hamiltonian cycle via plain changes (length-2 reversals, Steinhaus–Johnson–Trotter)";
    case "lexicographic":
      return "Lexicographic-successor generators Aₙ = {pᵢ⁻¹·pᵢ₊₁}";
    case "hyperoctahedral":
      return "Signed permutations of the n-cube symmetry group Bₙ: adjacent swaps and per-coordinate sign flips, ordered by SJT × binary-Gray product";
    case "hypercube":
      return "Generators b1…bn flip bits from LSB to MSB, ordered by binary reflected Gray code";
    case "feistel":
      return "Toy Feistel round mixers on n-bit blocks";
    case "sliding-puzzle":
      return "Slide a tile into the blank on a 2 × n grid";
    case "simplex":
      return "Complete graph Kₙ₊₁ — n-simplex projected onto a regular (n+1)-gon with all diagonals";
    case "complete":
      return "Complete graph Kₙ — n vertices on a regular n-gon with every pair joined";
    case "cayley-complete":
      return "Cayley graph of Sₙ with every non-identity permutation as a generator — the complete graph K_{n!}";
    case "sierpinski":
      return "The triangle gasket on words over {0,1,2}, laid out on a Hamiltonian cycle";
    case "coxeter-h4-600-cell":
      return "The H₄ root system ({3,3,5}) projected to the Coxeter plane";
  }
}

export function graphVertexCount(n: number, preset: GraphPreset): number {
  if (preset === "coxeter-a") return n * (n + 1);
  if (preset === "coxeter-b") return 2 * n * n;
  if (preset === "coxeter-d") return 2 * n * (n - 1);
  if (preset === "coxeter-h4-600-cell") return 120;
  if (preset === "aes-powers") return aesPowerCycleLength(n);
  if (preset === "sliding-puzzle") return factorial(SLIDING_PUZZLE_ROWS * n);
  if (preset === "simplex") return n + 1;
  if (preset === "complete") return n;
  if (preset === "sierpinski") return SIERPINSKI_K ** n;
  if (preset === "hyperoctahedral") return 2 ** n * factorial(n);
  return preset === "hypercube" || preset === "feistel" ? 2 ** n : factorial(n);
}

export function graphEdgeCount(n: number, preset: GraphPreset): number {
  if (
    preset === "coxeter-a" ||
    preset === "coxeter-b" ||
    preset === "coxeter-d"
  ) {
    // Exact values are computed when the root graph is materialized; this
    // formula is only used for UI estimates and slider recommendations.
    return 2 * graphVertexCount(n, preset);
  }
  if (preset === "coxeter-h4-600-cell") return 720;
  if (preset === "aes-powers") return aesPowerCycleLength(n);
  if (
    preset === "random-cyclic" ||
    preset === "random-dihedral" ||
    preset === "wedge-clipped-dihedral" ||
    preset === "kaleidoscope"
  ) {
    return factorial(n) / 2;
  }
  if (preset === "simplex") return (n * (n + 1)) / 2;
  if (preset === "complete") return (n * (n - 1)) / 2;
  if (preset === "cayley-complete") {
    const v = factorial(n);
    return (v * (v - 1)) / 2;
  }
  if (preset === "hyperoctahedral") return ((2 * n - 1) * 2 ** n * factorial(n)) / 2;
  if (preset === "hypercube") return n * 2 ** (n - 1);
  if (preset === "feistel") return 2 * feistelRoundCount(n) * 2 ** (n - 1);
  // S(n, k) has k(kⁿ − 1)/2 edges (each of levels 1..n contributes kʰ(k−1)/2).
  if (preset === "sierpinski") {
    const k = SIERPINSKI_K;
    return (k * (k ** n - 1)) / 2;
  }
  if (preset === "sliding-puzzle") {
    // One state-graph edge per grid adjacency per blank placement on it:
    // (grid edges) × (N - 1)!, with N = 2n cells and 3n - 2 grid edges.
    const N = SLIDING_PUZZLE_ROWS * n;
    return (3 * n - 2) * factorial(N - 1);
  }
  if (
    isReversalPreset(preset) ||
    preset === "transposition" ||
    preset === "lexicographic"
  ) {
    return ((n * (n - 1)) / 2 * factorial(n)) / 2;
  }
  if (
    preset === "pancake-zaks" ||
    preset === "pancake-zaks-recursive" ||
    preset === "pancake-williams"
  ) {
    const generatorCount = materializedPancakeGeneratorIds(n, preset).length;
    return (generatorCount * factorial(n)) / 2;
  }
  if (preset === "cyclic-adjacent") return (n * factorial(n)) / 2;
  return ((n - 1) * factorial(n)) / 2;
}

export function graphEdgesPerVertex(n: number, preset: GraphPreset): number | null {
  if (preset === "sliding-puzzle" || preset === "sierpinski") return null;
  return (2 * graphEdgeCount(n, preset)) / graphVertexCount(n, preset);
}

export function graphMaxN(preset: GraphPreset): number {
  if (
    preset === "coxeter-a" ||
    preset === "coxeter-b" ||
    preset === "coxeter-d"
  )
    return 317;
  if (preset === "coxeter-h4-600-cell") return 4;
  if (preset === "aes-powers") return AES_MAX_N;
  // The puzzle has (2n)! states, so it hits the 10! ceiling already at n = 5
  // (a 2 × 5 grid). The true 15-puzzle (4 × 4, 16!/2 ≈ 10¹³ states) is far
  // beyond what can be enumerated here.
  if (preset === "sliding-puzzle") return 5;
  // K_{n+1} has only n+1 vertices and n(n+1)/2 edges, but we keep this range
  // aligned with the analysis simplex controls.
  if (preset === "simplex") return 22;
  if (preset === "complete") return 40;
  // Materialized views are intentionally not used for this preset; Yankelovich
  // samples it analytically up to n = 40.
  if (
    preset === "random-cyclic" ||
    preset === "random-dihedral" ||
    preset === "wedge-clipped-dihedral" ||
    preset === "kaleidoscope"
  )
    return 8;
  // K_{n!} explodes fast: the generator set is S_n \ {id}, so edge-building
  // is O((n!)²). n = 6 already gives 720 vertices, 719 generators, and
  // ~259k edges; n = 7 would be 5040 vertices and ~12.7M edges, so cap here.
  if (preset === "cayley-complete") return 6;
  // The symmetric Hamilton-cycle layout is built for small orders only (the
  // quotient search is meant for n ≤ 8); beyond that the cycle is not computed.
  if (preset === "asymmetric-tree") return 8;
  // S(n, 3) has 3ⁿ vertices: 3¹⁰ ≈ 59k stays comfortable, 3¹¹ ≈ 177k is heavy.
  if (preset === "sierpinski") return 10;
  // |Bₙ| = 2ⁿ·n!: n = 7 is 645,120 vertices / ~2.26M edges (comfortable),
  // n = 8 would be 10.3M vertices, beyond the materialized-graph ceiling.
  if (preset === "hyperoctahedral") return 7;
  // Q₁₅ has 32,768 vertices and 245,760 edges, still comfortable to materialize.
  if (preset === "hypercube") return 15;
  if (preset === "feistel") return 16;
  if (
    preset === "pancake-zaks" ||
    preset === "pancake-zaks-recursive" ||
    preset === "pancake-williams"
  )
    return 11;
  // The Warnsdorff greedy walk over all reversals is O(n!·(n²)²) per step, so
  // it stays snappy through n = 8 (~40k vertices) but is too slow at n = 9.
  if (preset === "reversal-greedy") return 8;
  return isReversalPreset(preset) ||
    preset === "transposition" ||
    preset === "lexicographic"
    ? 9
    : 10;
}

/**
 * The reversal-graph family: the same Cayley graph (Sₙ generated by every
 * contiguous block reversal) under different display orderings.
 */
function isReversalPreset(preset: GraphPreset): boolean {
  return (
    preset === "reversal" ||
    preset === "reversal-greedy" ||
    preset === "reversal-graycode"
  );
}

function graphKind(preset: GraphPreset): GraphKind {
  if (isReversalPreset(preset)) return "reversal";
  if (
    preset === "star" ||
    preset === "aes-powers" ||
    preset === "permutohedron" ||
    preset === "permutahedron-compressed" ||
    preset === "cyclic-adjacent" ||
    preset === "transposition" ||
    preset === "asymmetric-tree" ||
    preset === "lexicographic" ||
    preset === "coxeter-a" ||
    preset === "coxeter-b" ||
    preset === "coxeter-d" ||
    preset === "hyperoctahedral" ||
    preset === "hypercube" ||
    preset === "feistel" ||
    preset === "sliding-puzzle" ||
    preset === "simplex" ||
    preset === "complete" ||
    preset === "cayley-complete" ||
    preset === "random-cyclic" ||
    preset === "random-dihedral" ||
    preset === "wedge-clipped-dihedral" ||
    preset === "kaleidoscope" ||
    preset === "sierpinski" ||
    preset === "coxeter-h4-600-cell"
  ) {
    return preset;
  }
  return "pancake";
}

function materializedPancakeGeneratorIds(
  n: number,
  preset: GraphPreset
): number[] {
  if (preset === "pancake-williams") {
    const ids: number[] = [];
    for (let k = 2; k <= n; k++) ids.push(k);
    return ids;
  }
  const first = n > 6 ? n : 2;
  const ids: number[] = [];
  for (let k = first; k <= n; k++) ids.push(k);
  return ids;
}

function graphGenerators(n: number, preset: GraphPreset): Generator[] {
  if (
    preset === "random-cyclic" ||
    preset === "random-dihedral" ||
    preset === "wedge-clipped-dihedral" ||
    preset === "kaleidoscope"
  ) {
    return [{ id: 1, apply: (p) => p }];
  }
  if (preset.startsWith("pancake")) {
    return materializedPancakeGeneratorIds(n, preset).map((k) => ({
      id: k,
      apply: (p) => flip(p, k),
    }));
  }
  if (preset === "star") {
    const generators: Generator[] = [];
    for (let j = 1; j < n; j++) generators.push({ id: j + 1, apply: (p) => swap(p, 0, j) });
    return generators;
  }
  if (preset === "hypercube") {
    const generators: Generator[] = [];
    for (let i = 0; i < n; i++) {
      generators.push({
        id: n - i,
        apply: (p) => {
          const q = new Uint8Array(p);
          q[i] = q[i] === 0 ? 1 : 0;
          return q;
        },
      });
    }
    return generators;
  }
  if (preset === "hyperoctahedral") {
    // "Signed permutation" generators of Bₙ: n-1 adjacent transpositions sᵢ
    // (ids 1..n-1) swap positions (i, i+1), and n sign flips tₚ (ids n..2n-1)
    // negate the value at one coordinate. All are involutions with no fixed
    // points; together they generate Bₙ. This larger set (degree 2n-1) is what
    // makes the SJT × binary-Gray product a Hamiltonian cycle of single steps.
    const generators: Generator[] = [];
    for (let i = 0; i < n - 1; i++) {
      generators.push({ id: i + 1, apply: (p) => swap(p, i, i + 1) });
    }
    for (let pos = 0; pos < n; pos++) {
      generators.push({
        id: n + pos,
        apply: (p) => {
          const q = new Uint8Array(p) as Perm;
          q[pos] = q[pos] > n ? q[pos] - n : q[pos] + n;
          return q;
        },
      });
    }
    return generators;
  }
  if (preset === "feistel") {
    const generators: Generator[] = [];
    const rounds = feistelRoundCount(n);
    for (let round = 0; round < rounds; round++) {
      generators.push({
        id: round * 2 + 1,
        apply: (p) => feistelMix(p, n, round, "left"),
      });
      generators.push({
        id: round * 2 + 2,
        apply: (p) => feistelMix(p, n, round, "right"),
      });
    }
    return generators;
  }
  if (preset === "aes-powers") {
    return [
      { id: 1, apply: (p) => aesValueToBits(aesXtime(aesBitsToValue(p), n), n) },
    ];
  }
  if (
    preset === "permutohedron" ||
    preset === "permutahedron-compressed" ||
    preset === "cyclic-adjacent"
  ) {
    const generators: Generator[] = [];
    for (let i = 0; i < n - 1; i++) {
      generators.push({ id: i + 1, apply: (p) => swap(p, i, i + 1) });
    }
    if (preset === "cyclic-adjacent") {
      generators.push({ id: n, apply: (p) => swap(p, n - 1, 0) });
    }
    return generators;
  }
  if (preset === "transposition") {
    const generators: Generator[] = [];
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        generators.push({
          id: (i + 1) * 100 + (j + 1),
          apply: (p) => swap(p, i, j),
        });
      }
    }
    return generators;
  }
  if (preset === "asymmetric-tree") {
    // A *transposition tree*: a spanning tree on the n positions whose edges
    // are the generating transpositions. By Feng's theorem the automorphism
    // group of the Cayley graph is R(Sₙ) ⋊ Aut(tree); a rigid (identity) tree
    // gives the minimum group Sₙ. We use a 3-leg "spider": the path
    // 1–2–…–(n-1) with a leaf n attached to vertex 3, so the legs have lengths
    // {2, 1, n-4}. Distinct leg lengths ⇒ trivial automorphism group, which
    // holds for every n ≥ 7 (n = 7 reproduces legs {1,2,3}, the smallest
    // asymmetric tree). For n ≤ 6 no asymmetric tree exists; the same
    // construction still yields a valid spanning tree of transpositions.
    return asymmetricTreeEdges(n).map(([a, b]) => ({
      id: a * 100 + b,
      apply: (p) => swap(p, a - 1, b - 1),
    }));
  }
  if (isReversalPreset(preset)) {
    const generators: Generator[] = [];
    for (let start = 0; start < n - 1; start++) {
      for (let end = start + 1; end < n; end++) {
        generators.push({
          id: (start + 1) * 100 + (end + 1),
          apply: (p) => reverseBlock(p, start, end),
        });
      }
    }
    return generators;
  }
  if (preset === "lexicographic") {
    // Right-multiply by each distinct lexicographic-successor generator:
    // (p·g)(k) = p(g(k)). The connection set Aₙ is closed under inverse,
    // so the undirected edge dedup in buildPancakeGraph stays correct.
    return lexicographicGenerators(n).map((g, idx) => ({
      id: idx + 1,
      apply: (p) => {
        const q = new Uint8Array(n);
        for (let k = 0; k < n; k++) q[k] = p[g[k] - 1];
        return q;
      },
    }));
  }
  if (preset === "sliding-puzzle") {
    // 2 × n grid, cells indexed row-major. A move slides the blank (value 0)
    // into an orthogonal neighbor. When the neighbor is off the grid the move
    // is a no-op: returning `p` unchanged yields a fixed point that the edge
    // builder skips, which is exactly how the puzzle's irregular degree arises.
    const rows = SLIDING_PUZZLE_ROWS;
    const cols = n;
    const N = rows * cols;
    const move = (dr: number, dc: number, id: number): Generator => ({
      id,
      apply: (p) => {
        let blank = -1;
        for (let i = 0; i < N; i++) {
          if (p[i] === 0) {
            blank = i;
            break;
          }
        }
        const r = Math.floor(blank / cols);
        const c = blank % cols;
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) return p;
        return swap(p, blank, nr * cols + nc);
      },
    });
    return [move(-1, 0, 1), move(1, 0, 2), move(0, -1, 3), move(0, 1, 4)];
  }
  if (preset === "simplex") {
    // Petrie polygon of the n-simplex = complete graph K_{n+1}, realised as
    // the Cayley graph of Z_{n+1} with the full connection set {1, …, n}.
    // Generator k advances the vertex value by k (mod n+1); since every
    // distinct pair of vertices differs by some k in {1, …, n}, every pair is
    // adjacent — exactly the all-diagonals projection of the simplex.
    const m = n + 1;
    const generators: Generator[] = [];
    for (let k = 1; k <= n; k++) {
      generators.push({
        id: k,
        apply: (p) => {
          const q = new Uint8Array(1);
          q[0] = ((p[0] - 1 + k) % m) + 1;
          return q;
        },
      });
    }
    return generators;
  }
  if (preset === "complete") {
    // Complete graph Kₙ as the Cayley graph of Z_n with the full connection
    // set {1, …, n-1}. Generator k advances the vertex value by k (mod n);
    // since every distinct pair of vertices differs by some k in {1, …, n-1},
    // every pair is adjacent. The connection set is closed under inverse
    // (k ↔ n-k), so the undirected i < j dedup in buildPancakeGraph is exact.
    const generators: Generator[] = [];
    for (let k = 1; k <= n - 1; k++) {
      generators.push({
        id: k,
        apply: (p) => {
          const q = new Uint8Array(1);
          q[0] = ((p[0] - 1 + k) % n) + 1;
          return q;
        },
      });
    }
    return generators;
  }
  if (preset === "cayley-complete") {
    // Cayley graph of Sₙ with the full connection set S_n \ {id}: right-
    // multiply by every non-identity permutation g, (p·g)(k) = p(g(k)). For
    // any two permutations p, q the element p⁻¹·q ≠ id is a generator, so
    // every pair is adjacent — the complete graph K_{n!}. The set is closed
    // under inverse, so the undirected i < j dedup in buildPancakeGraph is
    // exact, and g ≠ id guarantees no fixed points (no self-loops).
    const total = factorial(n);
    const current = new Uint8Array(n);
    for (let i = 0; i < n; i++) current[i] = i + 1;
    const generators: Generator[] = [];
    for (let step = 1; step < total; step++) {
      nextPermutation(current);
      const g = new Uint8Array(current);
      generators.push({
        id: step,
        apply: (p) => {
          const q = new Uint8Array(n);
          for (let k = 0; k < n; k++) q[k] = p[g[k] - 1];
          return q;
        },
      });
    }
    return generators;
  }
  if (preset === "sierpinski") {
    // Sierpiński graph S(n, 3): words over {0, 1, 2}. Two edge families.
    //
    // Deepest level (the K₃ clique on the last symbol): right-rotate the last
    // symbol by d. The set {+1, +2} is closed under inverse, so the i < j dedup
    // in buildPancakeGraph is exact and there are no fixed points.
    //
    // Bridge level h (1 ≤ h ≤ n-1, array index hi = h-1): u and v differ at
    // position hi and agree on a constant suffix, u = (w b a^m), v = (w a b^m).
    // This is an involution but only defined when the suffix after hi is
    // constant and differs from u[hi]; otherwise it is a fixed point (skipped).
    const k = SIERPINSKI_K;
    const generators: Generator[] = [];
    for (let hi = 0; hi < n - 1; hi++) {
      generators.push({
        id: hi + 1,
        apply: (p) => {
          const a = p[n - 1];
          for (let t = hi + 1; t < n - 1; t++) {
            if (p[t] !== a) return p;
          }
          const b = p[hi];
          if (b === a) return p;
          const q = new Uint8Array(p);
          q[hi] = a;
          for (let t = hi + 1; t < n; t++) q[t] = b;
          return q;
        },
      });
    }
    for (let d = 1; d < k; d++) {
      generators.push({
        id: n - 1 + d,
        apply: (p) => {
          const q = new Uint8Array(p);
          q[n - 1] = (p[n - 1] + d) % k;
          return q;
        },
      });
    }
    return generators;
  }

  return [];
}

function aesPolynomial(n: number): number {
  const poly = AES_POLYNOMIALS[n];
  if (!poly) {
    throw new Error(`AES powers are available for n = ${AES_MIN_N}…${AES_MAX_N}.`);
  }
  return poly;
}

function aesXtime(value: number, n: number): number {
  const highBit = 1 << (n - 1);
  const mask = (1 << n) - 1;
  const shifted = (value << 1) & mask;
  return value & highBit ? shifted ^ (aesPolynomial(n) & mask) : shifted;
}

function aesPowerCycleLength(n: number): number {
  aesPolynomial(n);
  return 2 ** n - 1;
}

function aesValueToBits(value: number, n: number): Perm {
  const bits = new Uint8Array(n) as Perm;
  for (let bit = 0; bit < n; bit++) {
    bits[n - bit - 1] = (value >> bit) & 1;
  }
  return bits;
}

function aesBitsToValue(bits: ArrayLike<number>): number {
  let value = 0;
  for (let i = 0; i < bits.length; i++) value = (value << 1) | bits[i];
  return value;
}

async function aesPowerCycleOrder(
  n: number,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
  chunk = 50_000
): Promise<{ path: Perm[]; flips: number[] }> {
  throwIfAborted(signal);
  const total = aesPowerCycleLength(n);
  const path: Perm[] = [];
  const flips: number[] = [];
  let value = 1;
  for (let i = 0; i < total; i++) {
    path.push(aesValueToBits(value, n));
    flips.push(1);
    value = aesXtime(value, n);
    if ((i + 1) % chunk === 0) {
      onProgress?.(i + 1, total);
      await yieldToEventLoop();
      throwIfAborted(signal);
    }
  }
  onProgress?.(total, total);
  return { path, flips };
}

async function hypercubeGrayOrder(
  n: number,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
  chunk = 50_000
): Promise<{ path: Perm[]; flips: number[] }> {
  throwIfAborted(signal);
  const total = 2 ** n;
  const path: Perm[] = [];
  const flips: number[] = [];

  for (let i = 0; i < total; i++) {
    const gray = i ^ (i >> 1);
    const vertex = new Uint8Array(n);
    for (let bit = 0; bit < n; bit++) {
      vertex[n - bit - 1] = (gray >> bit) & 1;
    }
    path.push(vertex);

    if (i > 0) flips.push(changedBitId(path[i - 1], vertex));
    if ((i + 1) % chunk === 0) {
      onProgress?.(i + 1, total);
      await yieldToEventLoop();
      throwIfAborted(signal);
    }
  }

  if (path.length > 1) flips.push(changedBitId(path[path.length - 1], path[0]));
  onProgress?.(total, total);
  return { path, flips };
}

/**
 * Coxeter sign of a signed permutation of Bₙ stored in the byte encoding used
 * by `hyperoctahedralOrder`: position i holds +v as v and −v as v+n. Equals the
 * inversion parity of the magnitudes XOR the parity of the negative count, so
 * every simple reflection (adjacent swap or sign flip) toggles it — making the
 * Coxeter Cayley graph bipartite.
 */
function signedParity(v: Perm): 0 | 1 {
  const n = v.length;
  let par = 0;
  for (let a = 0; a < n; a++) {
    const va = v[a] > n ? v[a] - n : v[a];
    if (v[a] > n) par ^= 1;
    for (let b = a + 1; b < n; b++) {
      const vb = v[b] > n ? v[b] - n : v[b];
      if (va > vb) par ^= 1;
    }
  }
  return par as 0 | 1;
}

/**
 * Steinhaus–Johnson–Trotter "plain changes" as a sequence of n!−1 adjacent
 * transpositions: move m (0-based, the left index of the swapped pair) walks the
 * identity through every permutation of Sₙ. Each move is an involution, so
 * applying the list in reverse retraces the same permutations backwards.
 */
function steinhausJohnsonTrotterMoves(n: number): number[] {
  const p = new Uint8Array(n);
  const dir = new Int8Array(n + 1);
  for (let i = 0; i < n; i++) {
    p[i] = i + 1;
    dir[i + 1] = -1;
  }
  const total = factorial(n);
  const moves: number[] = [];
  let count = 1;
  while (count < total) {
    let mobile = 0;
    let mobileIndex = -1;
    for (let i = 0; i < n; i++) {
      const j = i + dir[p[i]];
      if (j >= 0 && j < n && p[i] > p[j] && p[i] > mobile) {
        mobile = p[i];
        mobileIndex = i;
      }
    }
    if (mobileIndex === -1) break;
    const swapIndex = mobileIndex + dir[mobile];
    const a = Math.min(mobileIndex, swapIndex);
    const t = p[mobileIndex];
    p[mobileIndex] = p[swapIndex];
    p[swapIndex] = t;
    moves.push(a);
    for (let v = mobile + 1; v <= n; v++) dir[v] *= -1;
    count++;
  }
  return moves;
}

/**
 * Hamiltonian cycle of Bₙ as the product of two Gray codes: the
 * Steinhaus–Johnson–Trotter listing of Sₙ (adjacent transpositions) nested
 * inside the binary reflected Gray code of ℤ₂ⁿ (single sign flips). A vertex is
 * a length-n byte array where position i holds w(i): a value v ∈ {1,…,n} means
 * +v and v+n means −v, so the identity is [1,…,n].
 *
 * Signs are read per value (the sign rides with the value through transpositions
 * and is invariant under SJT), so each block of constant sign vector runs a full
 * SJT pass, alternating direction (snake) so successive blocks share an endpoint.
 * Between blocks, one Gray step flips the sign of a single value at its current
 * position — exactly a tₚ generator. The 2ⁿ blocks (even) close back to the
 * identity, so the final flip returns to the start. The returned `flips` are the
 * generator ids along the cycle, which makes it render as the perimeter.
 */
async function hyperoctahedralOrder(
  n: number,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
  chunk = 50_000
): Promise<{ path: Perm[]; flips: number[] }> {
  throwIfAborted(signal);
  const sjt = steinhausJohnsonTrotterMoves(n);
  const blocks = 1 << n;
  const total = blocks * factorial(n);

  let w = new Uint8Array(n) as Perm;
  for (let i = 0; i < n; i++) w[i] = i + 1;
  const path: Perm[] = [w];
  const flips: number[] = [];

  const swapAt = (src: Perm, i: number): Perm => {
    const q = new Uint8Array(src) as Perm;
    const t = q[i];
    q[i] = q[i + 1];
    q[i + 1] = t;
    return q;
  };
  const flipSignAt = (src: Perm, pos: number): Perm => {
    const q = new Uint8Array(src) as Perm;
    q[pos] = q[pos] > n ? q[pos] - n : q[pos] + n;
    return q;
  };
  // Value whose sign flips going from Gray(k) to Gray(k+1): the position of the
  // changed bit, i.e. the number of trailing zeros of (k+1), as a 1-based value.
  const grayChangedValue = (k: number): number => {
    let x = k + 1;
    let b = 0;
    while ((x & 1) === 0) {
      x >>= 1;
      b++;
    }
    return b + 1;
  };

  let done = 0;
  for (let blk = 0; blk < blocks; blk++) {
    const forward = blk % 2 === 0;
    for (let s = 0; s < sjt.length; s++) {
      const m = forward ? sjt[s] : sjt[sjt.length - 1 - s];
      w = swapAt(w, m);
      flips.push(m + 1);
      path.push(w);
      done++;
      if (done % chunk === 0) {
        onProgress?.(done, total);
        await yieldToEventLoop();
        throwIfAborted(signal);
      }
    }
    // Boundary sign flip. The closing flip of the last block goes Gray(2ⁿ−1) →
    // Gray(0), which differs in the top bit (value n); earlier blocks use the
    // normal reflected-Gray transition.
    const value = blk < blocks - 1 ? grayChangedValue(blk) : n;
    let pos = 0;
    for (let i = 0; i < n; i++) {
      const mag = w[i] > n ? w[i] - n : w[i];
      if (mag === value) {
        pos = i;
        break;
      }
    }
    flips.push(n + pos);
    if (blk < blocks - 1) {
      w = flipSignAt(w, pos);
      path.push(w);
      done++;
    }
  }

  onProgress?.(total, total);
  return { path, flips };
}

function feistelRoundCount(n: number): number {
  return Math.max(2, Math.min(6, n));
}

async function feistelOrder(
  n: number,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
  chunk = 50_000
): Promise<{ path: Perm[]; flips: number[] }> {
  throwIfAborted(signal);
  const total = 2 ** n;
  const rounds = feistelRoundCount(n);
  const path: Perm[] = [];

  for (let i = 0; i < total; i++) {
    let vertex = bitsFromInteger(i ^ (i >> 1), n);
    for (let round = 0; round < rounds; round++) {
      vertex = feistelMix(vertex, n, round, round % 2 === 0 ? "left" : "right");
    }
    path.push(vertex);
    if ((i + 1) % chunk === 0) {
      onProgress?.(i + 1, total);
      await yieldToEventLoop();
      throwIfAborted(signal);
    }
  }

  onProgress?.(total, total);
  return { path, flips: [] };
}

function bitsFromInteger(value: number, n: number): Perm {
  const out = new Uint8Array(n);
  for (let bit = 0; bit < n; bit++) {
    out[n - bit - 1] = (value >> bit) & 1;
  }
  return out;
}

function feistelMix(
  p: Perm,
  n: number,
  round: number,
  side: "left" | "right"
): Perm {
  const leftLen = Math.floor(n / 2);
  const rightLen = n - leftLen;
  const targetStart = side === "left" ? 0 : leftLen;
  const targetLen = side === "left" ? leftLen : rightLen;
  const sourceStart = side === "left" ? leftLen : 0;
  const sourceLen = side === "left" ? rightLen : leftLen;
  const mask = feistelMask(p, sourceStart, sourceLen, targetLen, round, side);
  const q = new Uint8Array(p);
  for (let bit = 0; bit < targetLen; bit++) {
    q[targetStart + bit] ^= (mask >> (targetLen - bit - 1)) & 1;
  }
  return q;
}

function feistelMask(
  p: Perm,
  start: number,
  sourceLen: number,
  targetLen: number,
  round: number,
  side: "left" | "right"
): number {
  let source = 0;
  for (let i = 0; i < sourceLen; i++) source = (source << 1) | p[start + i];
  const limit = 1 << targetLen;
  let x =
    (source * 0x45d9f3b +
      (round + 1) * 0x9e3779b +
      (side === "left" ? 0x7f4a7c15 : 0x94d049bb)) >>>
    0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return (x % (limit - 1)) + 1;
}

async function lexicographicOrder(
  n: number,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
  chunk = 50_000
): Promise<{ path: Perm[]; flips: number[] }> {
  throwIfAborted(signal);
  const total = factorial(n);
  const current = new Uint8Array(n);
  for (let i = 0; i < n; i++) current[i] = i + 1;

  const path: Perm[] = [new Uint8Array(current)];
  for (let done = 1; done < total; done++) {
    nextPermutation(current);
    path.push(new Uint8Array(current));
    if (done % chunk === 0) {
      onProgress?.(done, total);
      await yieldToEventLoop();
      throwIfAborted(signal);
    }
  }
  onProgress?.(total, total);
  return { path, flips: [] };
}

/**
 * All arrangements of {0,…,N-1} on the 2 × n puzzle grid (0 = blank), in
 * lexicographic order. There is no natural Hamiltonian display cycle for the
 * puzzle graph, so — like the lexicographic graph — we just enumerate states
 * and leave `flips` empty.
 */
async function slidingPuzzleOrder(
  n: number,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
  chunk = 50_000
): Promise<{ path: Perm[]; flips: number[] }> {
  throwIfAborted(signal);
  const N = SLIDING_PUZZLE_ROWS * n;
  const total = factorial(N);
  const current = new Uint8Array(N);
  for (let i = 0; i < N; i++) current[i] = i;

  const path: Perm[] = [new Uint8Array(current)];
  for (let done = 1; done < total; done++) {
    nextPermutation(current);
    path.push(new Uint8Array(current));
    if (done % chunk === 0) {
      onProgress?.(done, total);
      await yieldToEventLoop();
      throwIfAborted(signal);
    }
  }
  onProgress?.(total, total);
  return { path, flips: [] };
}

/**
 * The n+1 vertices of the simplex's Petrie polygon sit at the corners of a
 * regular (n+1)-gon in value order, so placing path[i] uniformly on the circle
 * reproduces the orthogonal projection. Vertices are length-1 Uint8Arrays
 * holding 1..n+1.
 */
async function simplexOrder(
  n: number,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<{ path: Perm[]; flips: number[] }> {
  throwIfAborted(signal);
  const total = n + 1;
  const path: Perm[] = [];
  for (let i = 0; i < total; i++) {
    const v = new Uint8Array(1);
    v[0] = i + 1;
    path.push(v);
  }
  onProgress?.(total, total);
  return { path, flips: [] };
}

/**
 * The n vertices of Kₙ sit at the corners of a regular n-gon in value order,
 * so placing path[i] uniformly on the circle draws every pair of vertices
 * joined by a straight chord. Vertices are length-1 Uint8Arrays holding 1..n.
 */
async function completeOrder(
  n: number,
  onProgress?: (done: number, total: number) => void
): Promise<{ path: Perm[]; flips: number[] }> {
  const total = n;
  const path: Perm[] = [];
  for (let i = 0; i < total; i++) {
    const v = new Uint8Array(1);
    v[0] = i + 1;
    path.push(v);
  }
  onProgress?.(total, total);
  return { path, flips: [] };
}

async function ehrlichStarOrder(
  n: number,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
  chunk = 50_000
): Promise<{ path: Perm[]; flips: number[] }> {
  throwIfAborted(signal);
  const total = factorial(n);
  const p = new Uint8Array(n);
  const c = new Uint32Array(n);
  const b = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    p[i] = i + 1;
    b[i] = i;
  }

  const path: Perm[] = [new Uint8Array(p)];
  const flips: number[] = [];

  while (path.length < total) {
    let k = 1;
    while (k < n && c[k] >= k) {
      c[k] = 0;
      k++;
    }
    if (k >= n) break;
    c[k]++;

    const swapIndex = b[k];
    const t = p[0];
    p[0] = p[swapIndex];
    p[swapIndex] = t;
    flips.push(swapIndex + 1);

    for (let left = 1, right = k - 1; left < right; left++, right--) {
      const u = b[left];
      b[left] = b[right];
      b[right] = u;
    }

    path.push(new Uint8Array(p));
    if (path.length % chunk === 0) {
      onProgress?.(path.length, total);
      await yieldToEventLoop();
      throwIfAborted(signal);
    }
  }

  const closing = starSwapIdBetween(path[path.length - 1], path[0]);
  if (closing !== null) flips.push(closing);

  onProgress?.(total, total);
  return { path, flips };
}

function starSwapIdBetween(a: Perm, b: Perm): number | null {
  let changed = 0;
  let other = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      changed++;
      if (i !== 0) other = i;
    }
  }
  return changed === 2 && other > 0 && a[0] === b[other] && a[other] === b[0]
    ? other + 1
    : null;
}

/**
 * Hamiltonian-cycle ordering of the Sierpiński graph S(n, 3) — the triangle
 * gasket. Vertices are length-n words over {0, 1, 2}; placing them on the
 * circle in this order traces a Hamiltonian cycle, so the cycle appears as the
 * perimeter of the drawing (exactly like the pancake presets).
 *
 * Construction (Klavžar–Milutinović). S(n,3) is three copies of S(n-1,3)
 * grouped by their leading symbol, joined by a single edge between each pair of
 * copies: (i j^{n-1}) — (j i^{n-1}). The three "extreme" vertices are the
 * constant words 0^n, 1^n, 2^n — the corners shared between the copies. A
 * Hamiltonian path between any two corners is built recursively:
 *
 *   ham(m, a, b) = a·ham(m-1, a, c) ++ c·ham(m-1, a, b) ++ b·ham(m-1, c, b)
 *
 * (c the third symbol), so each crossing between sub-copies lands exactly on a
 * connecting edge. The full cycle stitches three such corner-to-corner paths
 * around the three top-level connecting edges and closes on (1 0^{n-1}) —
 * (0 1^{n-1}).
 */
async function sierpinskiHamiltonianOrder(
  n: number,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<{ path: Perm[]; flips: number[] }> {
  throwIfAborted(signal);
  const total = SIERPINSKI_K ** n;
  const path: Perm[] = [];

  // third(a, b): the remaining symbol of {0, 1, 2}.
  const third = (a: number, b: number) => 3 - a - b;

  // Append the words of the Hamiltonian path of the S(m, 3) copy sitting under
  // `prefix`, walking from corner `a` to corner `b` (over the m-symbol suffix).
  const append = (prefix: number[], m: number, a: number, b: number): void => {
    if (m === 1) {
      const c = third(a, b);
      for (const last of [a, c, b]) {
        const w = new Uint8Array(n);
        for (let t = 0; t < prefix.length; t++) w[t] = prefix[t];
        w[prefix.length] = last;
        path.push(w);
      }
      return;
    }
    const c = third(a, b);
    append([...prefix, a], m - 1, a, c);
    append([...prefix, c], m - 1, a, b);
    append([...prefix, b], m - 1, c, b);
  };

  if (n === 1) {
    for (const v of [0, 1, 2]) path.push(Uint8Array.of(v));
  } else {
    append([0], n - 1, 1, 2);
    append([2], n - 1, 0, 1);
    append([1], n - 1, 2, 0);
  }

  // flips[s] = the differing level (1-based first-difference index) between the
  // consecutive cycle vertices path[s] → path[s+1], with the final entry the
  // closing edge. Only its length (the cycle length) feeds the UI's order-step
  // count; the exact level is informational for this non-pancake graph.
  const flips: number[] = [];
  for (let s = 0; s < total; s++) {
    const a = path[s];
    const b = path[(s + 1) % total];
    let level = n;
    for (let t = 0; t < n; t++) {
      if (a[t] !== b[t]) {
        level = t + 1;
        break;
      }
    }
    flips.push(level);
  }

  onProgress?.(total, total);
  return { path, flips };
}

/**
 * Lexicographic connection set of Sₙ.
 *
 * Enumerate Sₙ in lexicographic order p₁, …, p_{n!}. For each consecutive
 * pair compute the generator gᵢ = pᵢ⁻¹·pᵢ₊₁, so that pᵢ₊₁ = pᵢ·gᵢ under right
 * function composition (p·g)(k) = p(g(k)). Return the distinct generators in
 * order of first appearance — only the set Aₙ = {gᵢ | 1 ≤ i < n!}, not a graph.
 *
 * Every lexicographic step changes only a suffix (the maximal decreasing run),
 * so each generator fixes a prefix. Counting (suffix length, pivot rank) pairs
 * gives exactly |Aₙ| = C(n, 2): |A₃| = 3, |A₄| = 6, |A₅| = 10, |A₆| = 15.
 */
export function lexicographicGenerators(n: number): Perm[] {
  if (n < 2) return [];
  const total = factorial(n);
  const current = new Uint8Array(n);
  for (let i = 0; i < n; i++) current[i] = i + 1;
  const prev = new Uint8Array(current);

  const inv = new Uint8Array(n + 1);
  const seen = new Set<string>();
  const generators: Perm[] = [];

  for (let step = 1; step < total; step++) {
    nextPermutation(current);
    for (let j = 0; j < n; j++) inv[prev[j]] = j + 1;
    const g = new Uint8Array(n);
    for (let k = 0; k < n; k++) g[k] = inv[current[k]];
    const gk = key(g);
    if (!seen.has(gk)) {
      seen.add(gk);
      generators.push(g);
    }
    prev.set(current);
  }
  return generators;
}

async function johnsonTrotterOrder(
  n: number,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
  chunk = 50_000
): Promise<{ path: Perm[]; flips: number[] }> {
  throwIfAborted(signal);
  const total = factorial(n);
  const p = new Uint8Array(n);
  const direction = new Int8Array(n + 1);
  for (let i = 0; i < n; i++) {
    p[i] = i + 1;
    direction[i + 1] = -1;
  }

  const path: Perm[] = [new Uint8Array(p)];
  const flips: number[] = [];
  while (path.length < total) {
    let mobile = 0;
    let mobileIndex = -1;
    for (let i = 0; i < n; i++) {
      const j = i + direction[p[i]];
      if (j >= 0 && j < n && p[i] > p[j] && p[i] > mobile) {
        mobile = p[i];
        mobileIndex = i;
      }
    }
    if (mobileIndex === -1) break;

    const swapIndex = mobileIndex + direction[mobile];
    const a = Math.min(mobileIndex, swapIndex);
    const b = Math.max(mobileIndex, swapIndex);
    const t = p[mobileIndex];
    p[mobileIndex] = p[swapIndex];
    p[swapIndex] = t;
    flips.push((a + 1) * 100 + (b + 1));

    for (let value = mobile + 1; value <= n; value++) direction[value] *= -1;
    path.push(new Uint8Array(p));

    if (path.length % chunk === 0) {
      onProgress?.(path.length, total);
      await yieldToEventLoop();
      throwIfAborted(signal);
    }
  }

  if (path.length === total && isTransposition(path[path.length - 1], path[0])) {
    flips.push(closingTranspositionId(path[path.length - 1], path[0]));
  }
  onProgress?.(path.length, total);
  return { path, flips };
}

/**
 * Greedy Hamiltonian path of the reversal graph Rₙ (Cayley graph of Sₙ whose
 * generators are every contiguous block reversal). The pancake analogue would
 * be a naive smallest- or largest-reversal-first greedy, but on the full
 * reversal set that rule dead-ends for n ≥ 6 (Zaks' theorem is specific to
 * prefix/suffix reversals). We instead use Warnsdorff's rule: step to the
 * unvisited neighbour with the fewest unvisited neighbours, breaking ties
 * toward the shortest reversal. This visits all n! permutations for n ≤ 8, but
 * the path does not generally close back into a cycle (only n ≤ 3 does), so the
 * final perimeter chord may not be a graph edge.
 */
async function reversalGreedyCycle(
  n: number,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
  chunk = 5_000
): Promise<{ path: Perm[]; flips: number[] }> {
  throwIfAborted(signal);
  const total = factorial(n);
  type Op = { id: number; start: number; end: number };
  const ops: Op[] = [];
  for (let start = 0; start < n - 1; start++) {
    for (let end = start + 1; end < n; end++) {
      ops.push({ id: (start + 1) * 100 + (end + 1), start, end });
    }
  }
  // Shortest reversals first so Warnsdorff ties resolve toward small blocks.
  ops.sort((a, b) => a.end - a.start - (b.end - b.start) || a.start - b.start);

  const start = new Uint8Array(n);
  for (let i = 0; i < n; i++) start[i] = i + 1;
  const seen = new Set<string>([key(start)]);
  const path: Perm[] = [start];
  const flips: number[] = [];

  const unvisitedDegree = (q: Perm): number => {
    let d = 0;
    for (const op of ops) {
      if (!seen.has(key(reverseBlock(q, op.start, op.end)))) d++;
    }
    return d;
  };

  let p = start;
  for (let step = 1; step < total; step++) {
    let bestQ: Perm | null = null;
    let bestId = -1;
    let bestDeg = Infinity;
    for (const op of ops) {
      const q = reverseBlock(p, op.start, op.end);
      if (seen.has(key(q))) continue;
      const deg = unvisitedDegree(q);
      if (deg < bestDeg) {
        bestDeg = deg;
        bestQ = q;
        bestId = op.id;
      }
    }
    if (!bestQ) {
      throw new Error(
        `Reversal greedy walk got stuck at ${path.length}/${total} — should be impossible for n ≤ 8.`
      );
    }
    seen.add(key(bestQ));
    path.push(bestQ);
    flips.push(bestId);
    p = bestQ;
    if (step % chunk === 0) {
      onProgress?.(step, total);
      await yieldToEventLoop();
      throwIfAborted(signal);
    }
  }

  const startKey = key(start);
  for (const op of ops) {
    if (key(reverseBlock(p, op.start, op.end)) === startKey) {
      flips.push(op.id);
      break;
    }
  }
  onProgress?.(total, total);
  return { path, flips };
}

function nextPermutation(p: Uint8Array): void {
  let i = p.length - 2;
  while (i >= 0 && p[i] > p[i + 1]) i--;
  let j = p.length - 1;
  while (p[j] < p[i]) j--;
  const t = p[i];
  p[i] = p[j];
  p[j] = t;
  for (let a = i + 1, b = p.length - 1; a < b; a++, b--) {
    const u = p[a];
    p[a] = p[b];
    p[b] = u;
  }
}

function isTransposition(a: Perm, b: Perm): boolean {
  return closingTranspositionId(a, b) !== 0;
}

function closingTranspositionId(a: Perm, b: Perm): number {
  let first = -1;
  let second = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      if (first === -1) first = i;
      else if (second === -1) second = i;
      else return 0;
    }
  }
  if (first === -1 || second === -1) return 0;
  return a[first] === b[second] && a[second] === b[first]
    ? (first + 1) * 100 + (second + 1)
    : 0;
}

function changedBitId(a: Perm, b: Perm): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a.length - i;
  }
  return 0;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) =>
    typeof requestAnimationFrame !== "undefined"
      ? requestAnimationFrame(() => resolve())
      : setTimeout(resolve, 0)
  );
}

/** Pretty-print a permutation as a compact string ("1234..."). */
export function permString(p: Perm): string {
  let s = "";
  for (let i = 0; i < p.length; i++) s += p[i];
  return s;
}
