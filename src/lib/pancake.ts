/**
 * Cayley-style graph visualizations.
 *
 * The pancake, star, permutohedron, cyclic-adjacent, transposition, and
 * kaleidoscope graphs have every permutation of {1,…,n} as a vertex. The
 * hypercube has every n-bit string as a vertex. They differ by the generator
 * set used for edges.
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

/** Reverse the first k elements of p, returning a new Uint8Array. */
export function flip(p: Perm, k: number): Perm {
  const q = new Uint8Array(p);
  for (let i = 0, j = k - 1; i < j; i++, j--) {
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
  | "pancake-williams"
  | "star"
  | "permutohedron"
  | "cyclic-adjacent"
  | "transposition"
  | "kaleidoscope"
  | "lexicographic"
  | "hypercube"
  | "sliding-puzzle"
  | "simplex"
  | "complete"
  | "cayley-complete";
export type GraphKind =
  | "pancake"
  | "star"
  | "permutohedron"
  | "cyclic-adjacent"
  | "transposition"
  | "kaleidoscope"
  | "lexicographic"
  | "hypercube"
  | "sliding-puzzle"
  | "simplex"
  | "complete"
  | "cayley-complete";

export interface PancakeCycle {
  order: PancakeOrder;
  /** The visited permutations, in cycle order (length = n!). */
  path: Perm[];
  /** flips[s] is the prefix size used to go from path[s] to path[s+1].
   *  The final entry closes the cycle (path[n!-1] → path[0]). */
  flips: number[];
}

/**
 * Walk the pancake graph greedily, taking either the smallest (Zaks) or
 * largest (Williams) available prefix flip that leads somewhere new.
 *
 * Yields control back to the event loop every `chunk` iterations so
 * the UI stays responsive even for large n.
 */
export async function prefixReversalCycle(
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
  return prefixReversalCycle(n, "zaks", onProgress, signal, chunk);
}

export async function williamsCycle(
  n: number,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
  chunk = 50_000
): Promise<PancakeCycle> {
  return prefixReversalCycle(n, "williams", onProgress, signal, chunk);
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
  if (n < 2 || n > maxN) {
    throw new Error(`n must be between 2 and ${maxN} for ${graphPresetLabel(preset)}, got ${n}`);
  }
  throwIfAborted(signal);

  const kind = graphKind(preset);
  const order = preset === "pancake-williams" ? "williams" : preset === "pancake-zaks" ? "zaks" : undefined;
  onProgress?.("cycle", 0, graphVertexCount(n, preset));
  const { path, flips } =
    preset === "hypercube"
      ? await hypercubeGrayOrder(n, (done, total) => onProgress?.("cycle", done, total), signal)
      : preset === "sliding-puzzle"
      ? await slidingPuzzleOrder(n, (done, total) => onProgress?.("cycle", done, total), signal)
      : preset === "simplex"
      ? await simplexOrder(n, (done, total) => onProgress?.("cycle", done, total), signal)
      : preset === "complete"
      ? await completeOrder(n, (done, total) => onProgress?.("cycle", done, total))
      : order === undefined
        ? preset === "permutohedron" || preset === "cyclic-adjacent" || preset === "transposition"
        ? await johnsonTrotterOrder(n, (done, total) => onProgress?.("cycle", done, total), signal)
        : await lexicographicOrder(n, (done, total) => onProgress?.("cycle", done, total), signal)
        : await prefixReversalCycle(
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
  const vertexParity = await computeVertexParity(
    path,
    preset === "hypercube",
    (done, totalSteps) => onProgress?.("parity", done, totalSteps),
    signal
  );
  throwIfAborted(signal);

  const generators = graphGenerators(n, preset);
  const generatorInfos = computeGeneratorInfos(n, preset, generators);
  const edgeCount = (generators.length * total) / 2;
  const edges = new Uint32Array(edgeCount * 3);
  let edgeWriteIdx = 0;
  let evenEdgeCount = 0;
  let oddEdgeCount = 0;
  // Per-generator accumulation of angular distance between connected vertices,
  // measured as the shortest arc along the display circle (in index steps).
  const arcStepSum = new Map<number, number>();
  const arcCount = new Map<number, number>();

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

  const degreesPerStep = 360 / total;
  for (const info of generatorInfos) {
    const count = arcCount.get(info.id) ?? 0;
    if (count > 0) {
      info.avgArcDegrees = (arcStepSum.get(info.id)! / count) * degreesPerStep;
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
  };
}

function computeGeneratorInfos(
  n: number,
  preset: GraphPreset,
  generators: Generator[]
): GeneratorInfo[] {
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

  const isHypercube = preset === "hypercube";
  const identity = new Uint8Array(n);
  if (!isHypercube) {
    for (let i = 0; i < n; i++) identity[i] = i + 1;
  }

  const infos = generators.map((gen) => {
    const result = gen.apply(identity);
    let parity: 0 | 1 = 0;
    if (isHypercube) {
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
    return String(id);
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
  if (preset === "transposition") {
    const i = Math.floor(id / 100);
    const j = id % 100;
    return `${i},${j}`;
  }
  if (preset === "kaleidoscope") {
    const i = Math.floor(id / 100);
    const j = id % 100;
    return `${i}–${j}`;
  }
  return String(id);
}

async function computeVertexParity(
  path: Perm[],
  isHypercube: boolean,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
  chunk = 100_000
): Promise<Uint8Array> {
  throwIfAborted(signal);
  const total = path.length;
  const parity = new Uint8Array(total);

  if (isHypercube) {
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
    case "pancake-williams":
      return "Pancake graph — Williams";
    case "star":
      return "Star graph";
    case "permutohedron":
      return "Permutohedron graph";
    case "cyclic-adjacent":
      return "Cyclic adjacent graph";
    case "transposition":
      return "Transposition graph";
    case "kaleidoscope":
      return "Kaleidoscope graph";
    case "lexicographic":
      return "Lexicographic graph";
    case "hypercube":
      return "Hypercube";
    case "sliding-puzzle":
      return "Sliding puzzle (15-puzzle)";
    case "simplex":
      return "Simplex (Petrie polygon)";
    case "complete":
      return "Complete graph Kₙ";
    case "cayley-complete":
      return "Complete Cayley graph of Sₙ";
  }
}

export function graphPresetDescription(preset: GraphPreset): string {
  switch (preset) {
    case "pancake-zaks":
      return "Prefix reversals, minimum new flip";
    case "pancake-williams":
      return "Prefix reversals, maximum new flip";
    case "star":
      return "Swap the first position with any other";
    case "permutohedron":
      return "Adjacent transpositions s_i = (i, i+1)";
    case "cyclic-adjacent":
      return "Adjacent transpositions on a ring, including (n, 1)";
    case "transposition":
      return "All transpositions (i, j)";
    case "kaleidoscope":
      return "Reverse any contiguous block";
    case "lexicographic":
      return "Lexicographic-successor generators Aₙ = {pᵢ⁻¹·pᵢ₊₁}";
    case "hypercube":
      return "Flip one bit";
    case "sliding-puzzle":
      return "Slide a tile into the blank on a 2 × n grid";
    case "simplex":
      return "Complete graph Kₙ₊₁ — n-simplex projected onto a regular (n+1)-gon with all diagonals";
    case "complete":
      return "Complete graph Kₙ — n vertices on a regular n-gon with every pair joined";
    case "cayley-complete":
      return "Cayley graph of Sₙ with every non-identity permutation as a generator — the complete graph K_{n!}";
  }
}

export function graphVertexCount(n: number, preset: GraphPreset): number {
  if (preset === "sliding-puzzle") return factorial(SLIDING_PUZZLE_ROWS * n);
  if (preset === "simplex") return n + 1;
  if (preset === "complete") return n;
  return preset === "hypercube" ? 2 ** n : factorial(n);
}

export function graphEdgeCount(n: number, preset: GraphPreset): number {
  if (preset === "simplex") return (n * (n + 1)) / 2;
  if (preset === "complete") return (n * (n - 1)) / 2;
  if (preset === "cayley-complete") {
    const v = factorial(n);
    return (v * (v - 1)) / 2;
  }
  if (preset === "hypercube") return n * 2 ** (n - 1);
  if (preset === "sliding-puzzle") {
    // One state-graph edge per grid adjacency per blank placement on it:
    // (grid edges) × (N - 1)!, with N = 2n cells and 3n - 2 grid edges.
    const N = SLIDING_PUZZLE_ROWS * n;
    return (3 * n - 2) * factorial(N - 1);
  }
  if (
    preset === "kaleidoscope" ||
    preset === "transposition" ||
    preset === "lexicographic"
  ) {
    return ((n * (n - 1)) / 2 * factorial(n)) / 2;
  }
  if (preset === "cyclic-adjacent") return (n * factorial(n)) / 2;
  return ((n - 1) * factorial(n)) / 2;
}

export function graphMaxN(preset: GraphPreset): number {
  // The puzzle has (2n)! states, so it hits the 10! ceiling already at n = 5
  // (a 2 × 5 grid). The true 15-puzzle (4 × 4, 16!/2 ≈ 10¹³ states) is far
  // beyond what can be enumerated here.
  if (preset === "sliding-puzzle") return 5;
  // K_{n+1} has only n+1 vertices and n(n+1)/2 edges, so the simplex stays
  // cheap far past the permutation graphs' limits. Kₙ is just as cheap.
  if (preset === "simplex") return 40;
  if (preset === "complete") return 40;
  // K_{n!} explodes fast: the generator set is S_n \ {id}, so edge-building
  // is O((n!)²). n = 6 already gives 720 vertices, 719 generators, and
  // ~259k edges; n = 7 would be 5040 vertices and ~12.7M edges, so cap here.
  if (preset === "cayley-complete") return 6;
  return preset === "kaleidoscope" ||
    preset === "transposition" ||
    preset === "lexicographic"
    ? 9
    : 10;
}

function graphKind(preset: GraphPreset): GraphKind {
  if (
    preset === "star" ||
    preset === "permutohedron" ||
    preset === "cyclic-adjacent" ||
    preset === "transposition" ||
    preset === "kaleidoscope" ||
    preset === "lexicographic" ||
    preset === "hypercube" ||
    preset === "sliding-puzzle" ||
    preset === "simplex" ||
    preset === "complete" ||
    preset === "cayley-complete"
  ) {
    return preset;
  }
  return "pancake";
}

function graphGenerators(n: number, preset: GraphPreset): Generator[] {
  if (preset.startsWith("pancake")) {
    const generators: Generator[] = [];
    for (let k = 2; k <= n; k++) generators.push({ id: k, apply: (p) => flip(p, k) });
    return generators;
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
        id: i + 1,
        apply: (p) => {
          const q = new Uint8Array(p);
          q[i] = q[i] === 0 ? 1 : 0;
          return q;
        },
      });
    }
    return generators;
  }
  if (preset === "permutohedron" || preset === "cyclic-adjacent") {
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
  if (preset === "kaleidoscope") {
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

  return [];
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
    if (a[i] !== b[i]) return i + 1;
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
