/**
 * Rotationally-symmetric Hamilton cycle of the *asymmetric transposition tree*
 * Cayley graph of Sₙ (the "asymmetric-tree" preset), for small n (3 ≤ n ≤ 8).
 *
 * The connection set T is a rigid (identity) spanning tree of transpositions
 * (see `asymmetricTreeEdges`). By Feng's theorem the only automorphisms of
 * Cay(Sₙ, T) are the LEFT translations L_h: x ↦ h·x (value relabelings) — the
 * tree's rigidity removes every "extra" relabeling symmetry. A k-fold
 * rotationally symmetric circular drawing of a Hamilton cycle is exactly one
 * that is invariant under a single automorphism of order k, so here it must be
 * an L_h. Conveniently, left multiplication is an automorphism for *any*
 * connection set, so a symmetric cycle is possible despite the rigidity.
 *
 * We reuse the "compression" idea from the permutahedron preset (Gregor–Merino–
 * Mütze): pick h to be the value relabeling that increments cyclically inside
 * each block of an odd, pairwise-coprime composition of n, so h has order
 * k = lcm(parts) (= λ₀(n), the realized compression factor) and acts freely. Its
 * orbits partition Sₙ into N/k classes (N = n!). A Hamilton cycle invariant
 * under ⟨h⟩ is the unfolding C = P, h^s·P, …, h^{(k-1)s}·P of a *fundamental
 * path* P that visits exactly one vertex per orbit and closes with
 * P_last · τ = h^s · P_first for some s coprime to k (so the lift is one cycle,
 * not gcd(s,k) of them).
 *
 * Unlike the permutahedron (adjacent transpositions, which admit GMM's closed
 * form), an arbitrary rigid tree has no known closed-form symmetric cycle, so
 * we FIND P by searching the quotient graph on the N/k orbits:
 *   • small quotients (M ≤ DFS_MAX) — exhaustive backtracking with voltage
 *     tracking and a coprime-closure check;
 *   • larger quotients — Pósa rotation-extension (these Schreier quotients are
 *     strong expanders, so it finds a Hamilton cycle in milliseconds), retried
 *     with fresh randomness until the lift voltage is coprime to k.
 * At n = 8 the quotient has only 40320/15 = 2688 nodes, so the whole build is a
 * few milliseconds even though the final cycle has 40320 vertices.
 */

export type Perm = Uint8Array<ArrayBuffer>;

/* ------------------------------ small helpers ----------------------------- */

function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

function lcm(values: number[]): number {
  return values.reduce((acc, v) => (acc / gcd(acc, v)) * v, 1);
}

function permKey(p: ArrayLike<number>): string {
  let s = "";
  for (let i = 0; i < p.length; i++) s += String.fromCharCode(p[i]);
  return s;
}

/** Deterministic xorshift32 — a fixed seed keeps the layout reproducible. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/* --------------------------------- the tree ------------------------------- */

/**
 * Edges of the asymmetric transposition tree on positions 1..n, as ordered
 * pairs [a, b] with a < b. A path 1–2–…–(n-1) plus a leaf n hung off vertex 3
 * (a 3-leg spider). For n ≥ 7 the three legs have distinct lengths, so the
 * tree is rigid (Aut = 1); for n ≤ 4 it degenerates to the plain path
 * 1–2–…–n. The result always spans all n positions, so the transpositions
 * generate Sₙ and the Cayley graph is connected.
 */
export function asymmetricTreeEdges(n: number): Array<[number, number]> {
  const edges: Array<[number, number]> = [];
  if (n <= 4) {
    for (let i = 1; i <= n - 1; i++) edges.push([i, i + 1]);
    return edges;
  }
  for (let i = 1; i <= n - 2; i++) edges.push([i, i + 1]);
  edges.push([3, n]);
  return edges;
}

/**
 * The composition of n into pairwise-coprime odd parts (largest part ≥ 3) with
 * maximum lcm — i.e. λ₀(n). The symmetry element h increments values cyclically
 * within each block, so it has order k = lcm(parts). Returns an empty array for
 * n < 3 (no symmetry; k = 1).
 */
function bestOddCoprimeComposition(n: number): number[] {
  let best: number[] = [];
  let bestLcm = 0;
  const parts: number[] = [];
  const search = (remaining: number, maxPart: number): void => {
    if (remaining === 0) {
      if (parts.length === 0 || parts[0] < 3) return;
      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          if (gcd(parts[i], parts[j]) !== 1) return;
        }
      }
      const l = lcm(parts);
      if (l > bestLcm) {
        bestLcm = l;
        best = parts.slice();
      }
      return;
    }
    for (let p = Math.min(maxPart, remaining); p >= 1; p--) {
      if (p % 2 === 0) continue;
      parts.push(p);
      search(remaining - p, p);
      parts.pop();
    }
  };
  search(n, n);
  return best;
}

/** Realized rotational-symmetry (compression) factor k = λ₀(n) for the drawing. */
export function asymmetricTreeCompressionFactor(n: number): number {
  if (n < 3) return 1;
  const comp = bestOddCoprimeComposition(n);
  return comp.length ? lcm(comp) : 1;
}

/* --------------------------- the quotient + lift -------------------------- */

interface Quotient {
  n: number;
  k: number;
  comp: number[];
  /** Distinct orbit-neighbor adjacency of the quotient graph. */
  adj: number[][];
  /** orbit index of the identity permutation. */
  startOrbit: number;
  applyH: (p: number[]) => number[];
  applyGen: (p: number[], g: { i: number; j: number }) => number[];
  gens: Array<{ id: number; i: number; j: number }>;
  orbitOf: (p: number[]) => number;
  /** Per-orbit, the connecting generator + voltage to each neighbor. */
  edgeList: Array<Array<{ to: number; volt: number; gi: number }>>;
}

function buildQuotient(n: number): Quotient {
  const N = factorial(n);
  const comp = bestOddCoprimeComposition(n);
  const k = comp.length ? lcm(comp) : 1;

  const nextVal = new Array<number>(n + 1).fill(0);
  let b = 0;
  for (const sz of comp) {
    for (let v = b + 1; v <= b + sz; v++) nextVal[v] = v === b + sz ? b + 1 : v + 1;
    b += sz;
  }
  if (k === 1) for (let v = 1; v <= n; v++) nextVal[v] = v;
  const applyH = (p: number[]): number[] => p.map((v) => nextVal[v]);

  const gens = asymmetricTreeEdges(n).map(([a, bb]) => ({
    id: a * 100 + bb,
    i: a - 1,
    j: bb - 1,
  }));
  const applyGen = (p: number[], g: { i: number; j: number }): number[] => {
    const q = p.slice();
    const t = q[g.i];
    q[g.i] = q[g.j];
    q[g.j] = t;
    return q;
  };

  // Enumerate all permutations once and index them.
  const perms: number[][] = [];
  const index = new Map<string, number>();
  const cur = Array.from({ length: n }, (_, i) => i + 1);
  const used = new Array<boolean>(n + 1).fill(false);
  const rec = (pos: number): void => {
    if (pos === n) {
      index.set(permKey(cur), perms.length);
      perms.push(cur.slice());
      return;
    }
    for (let v = 1; v <= n; v++) {
      if (used[v]) continue;
      used[v] = true;
      cur[pos] = v;
      rec(pos + 1);
      used[v] = false;
    }
  };
  rec(0);

  // Orbit id + shift (perm = h^shift · rep) for every permutation.
  const orbitId = new Int32Array(N).fill(-1);
  const shiftOf = new Int32Array(N);
  const repIdx: number[] = [];
  for (let i = 0; i < N; i++) {
    if (orbitId[i] !== -1) continue;
    const oid = repIdx.length;
    repIdx.push(i);
    let w = perms[i];
    for (let t = 0; t < k; t++) {
      const wi = index.get(permKey(w))!;
      if (orbitId[wi] === -1) {
        orbitId[wi] = oid;
        shiftOf[wi] = t;
      }
      w = applyH(w);
    }
  }
  const M = repIdx.length;

  const orbitOf = (p: number[]): number => orbitId[index.get(permKey(p))!];

  const adj: number[][] = [];
  const edgeList: Array<Array<{ to: number; volt: number; gi: number }>> = [];
  for (let a = 0; a < M; a++) {
    const rep = perms[repIdx[a]];
    const nbrSet = new Set<number>();
    const es: Array<{ to: number; volt: number; gi: number }> = [];
    for (let gi = 0; gi < gens.length; gi++) {
      const w = applyGen(rep, gens[gi]);
      const wi = index.get(permKey(w))!;
      es.push({ to: orbitId[wi], volt: shiftOf[wi], gi });
      if (orbitId[wi] !== a) nbrSet.add(orbitId[wi]);
    }
    adj.push([...nbrSet]);
    edgeList.push(es);
  }

  const startOrbit = orbitOf(Array.from({ length: n }, (_, i) => i + 1));
  return { n, k, comp, adj, startOrbit, applyH, applyGen, gens, orbitOf, edgeList };
}

// Only the smallest quotients use the exhaustive DFS — Pósa cannot reliably
// close a Hamilton cycle on a handful of nodes (n = 3, 4 give M = 2, 8), while
// the coprime-closure constraint makes the DFS blow up on larger quotients. For
// M ≥ ~24 (n ≥ 5) Pósa finds a cycle in milliseconds, so we hand off there.
const DFS_MAX_ORBITS = 16;

/**
 * Exhaustive backtracking Hamilton-cycle search of the quotient with voltage
 * tracking; accepts the first cycle whose closing voltage is coprime to k.
 * Used only for tiny quotients (M ≤ DFS_MAX_ORBITS). Returns the orbit order
 * and the closing shift s, or null.
 */
function dfsFundamental(
  q: Quotient
): { order: number[]; s: number } | null {
  const { adj, edgeList, startOrbit, k } = q;
  const M = adj.length;
  const visited = new Uint8Array(M);
  const avail = new Int32Array(M);
  for (let v = 0; v < M; v++) avail[v] = adj[v].length;
  const order: number[] = [];
  let visitedCount = 0;
  let result: { order: number[]; s: number } | null = null;

  const mark = (u: number) => {
    visited[u] = 1;
    visitedCount++;
    for (const w of adj[u]) if (!visited[w]) avail[w]--;
  };
  const unmark = (u: number) => {
    visited[u] = 0;
    visitedCount--;
    for (const w of adj[u]) if (!visited[w]) avail[w]++;
  };
  const stack = new Int32Array(M);
  const feasible = (u: number): boolean => {
    const remaining = M - visitedCount;
    if (remaining <= 1) return true;
    let deg1 = 0;
    for (let v = 0; v < M; v++) {
      if (visited[v]) continue;
      const d = avail[v];
      if (d === 0) return false;
      if (d <= 1) deg1++;
    }
    if (deg1 > 2) return false;
    let seed = -1;
    for (const w of adj[u]) if (!visited[w]) { seed = w; break; }
    if (seed === -1) return false;
    const seen = new Uint8Array(M);
    let sp = 0;
    stack[sp++] = seed;
    seen[seed] = 1;
    let reached = 0;
    while (sp > 0) {
      const x = stack[--sp];
      reached++;
      for (const y of adj[x]) if (!visited[y] && !seen[y]) { seen[y] = 1; stack[sp++] = y; }
    }
    return reached === remaining;
  };

  const dfs = (u: number, voltSum: number): boolean => {
    mark(u);
    order.push(u);
    if (visitedCount === M) {
      for (const e of edgeList[u]) {
        if (e.to === startOrbit) {
          const s = (((voltSum + e.volt) % k) + k) % k;
          if (gcd(s, k) === 1) {
            result = { order: order.slice(), s };
            return true;
          }
        }
      }
      unmark(u);
      order.pop();
      return false;
    }
    if (feasible(u)) {
      const cands = edgeList[u].filter((e) => !visited[e.to]);
      cands.sort((x, y) => avail[x.to] - avail[y.to]);
      for (const e of cands) {
        if (dfs(e.to, (voltSum + e.volt) % k)) return true;
      }
    }
    unmark(u);
    order.pop();
    return false;
  };

  dfs(startOrbit, 0);
  return result;
}

/** Pósa rotation-extension Hamilton-cycle search of the quotient graph. */
function posaCycle(
  M: number,
  adj: number[][],
  rand: () => number,
  maxOps: number
): number[] | null {
  let ops = 0;
  const inPath = new Uint8Array(M);
  const pos = new Int32Array(M).fill(-1);
  let path: number[] = [Math.floor(rand() * M)];
  inPath[path[0]] = 1;
  pos[path[0]] = 0;
  const shuffle = (a: number[]): number[] => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const setPath = (a: number[]): void => {
    path = a;
    for (let i = 0; i < path.length; i++) pos[path[i]] = i;
  };
  const closes = (): boolean =>
    path.length === M && adj[path[path.length - 1]].includes(path[0]);

  while (ops < maxOps) {
    ops++;
    const end = path[path.length - 1];
    let extended = false;
    for (const w of shuffle(adj[end].slice())) {
      if (!inPath[w]) {
        path.push(w);
        inPath[w] = 1;
        pos[w] = path.length - 1;
        extended = true;
        break;
      }
    }
    if (extended) {
      if (closes()) return path.slice();
      continue;
    }
    const cands = adj[end].filter((w) => inPath[w] && w !== path[path.length - 2]);
    if (cands.length === 0) {
      inPath.fill(0);
      const s2 = Math.floor(rand() * M);
      setPath([s2]);
      inPath[s2] = 1;
      continue;
    }
    const w = cands[Math.floor(rand() * cands.length)];
    const wp = pos[w];
    setPath(path.slice(0, wp + 1).concat(path.slice(wp + 1).reverse()));
    if (closes()) return path.slice();
  }
  return null;
}

/**
 * Find a fundamental path through the orbits and its coprime closing shift s.
 * Routes tiny quotients to the exhaustive DFS and larger ones to Pósa (retried
 * with fresh randomness until the closing voltage is coprime to k).
 */
function findFundamental(q: Quotient): { u: number[][]; s: number } {
  const { adj, startOrbit, k, gens, applyGen, applyH, orbitOf, n } = q;
  const M = adj.length;
  const identity = Array.from({ length: n }, (_, i) => i + 1);

  // Reconstruct the actual fundamental permutations from an orbit order: walk
  // from the identity applying, at each step, a generator landing in the next
  // orbit. Returns null if the order is not realizable (shouldn't happen for a
  // valid quotient Hamilton cycle) or the closing shift is not coprime to k.
  const realize = (order: number[]): { u: number[][]; s: number } | null => {
    const u: number[][] = [identity.slice()];
    for (let i = 0; i < M - 1; i++) {
      const target = order[i + 1];
      let next: number[] | null = null;
      for (const g of gens) {
        const w = applyGen(u[i], g);
        if (orbitOf(w) === target) {
          next = w;
          break;
        }
      }
      if (!next) return null;
      u.push(next);
    }
    // Try every closing generator back into the start orbit: each lands on a
    // different element h^s·u0, giving a different shift s. Accept any whose s
    // is coprime to k (⇒ the unfolding is a single n!-cycle, not gcd(s,k) of
    // them). Precompute the orbit's shift ladder h^t·u0 for the lookup.
    const ladder = new Map<string, number>();
    {
      let w = u[0];
      for (let t = 0; t < k; t++) {
        ladder.set(permKey(w), t);
        w = applyH(w);
      }
    }
    for (const g of gens) {
      const w = applyGen(u[M - 1], g);
      if (orbitOf(w) !== startOrbit) continue;
      const s = ladder.get(permKey(w))!;
      if (s > 0 && gcd(s, k) === 1) return { u, s };
    }
    return null;
  };

  if (M <= DFS_MAX_ORBITS) {
    const found = dfsFundamental(q);
    if (found) {
      // The DFS already verified a coprime closure; rebuild the actual path.
      // Rotate the orbit order so the identity's orbit is first.
      const si = found.order.indexOf(startOrbit);
      const order = found.order.slice(si).concat(found.order.slice(0, si));
      const realized = realize(order);
      if (realized) return realized;
    }
  }

  const rand = makeRng(0x9e3779b9 ^ n);
  for (let attempt = 0; attempt < 4000; attempt++) {
    const cyc = posaCycle(M, adj, rand, M * 300);
    if (!cyc) continue;
    const si = cyc.indexOf(startOrbit);
    const order = cyc.slice(si).concat(cyc.slice(0, si));
    const realized = realize(order);
    if (realized) return realized;
  }
  throw new Error(
    `Could not find a symmetric Hamilton cycle for the asymmetric tree at n = ${n}.`
  );
}

/* ------------------------------ public ordering --------------------------- */

/**
 * Vertex ordering for the "asymmetric-tree" preset: a k-fold rotationally
 * symmetric Hamilton cycle of Cay(Sₙ, T), as a `path` of permutations plus the
 * `flips` (tree-transposition generator ids, id = (i+1)·100 + (j+1) for the
 * swap of positions i, j) along the cycle.
 */
export async function asymmetricTreeCycleOrder(
  n: number,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<{ path: Perm[]; flips: number[] }> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const total = factorial(n);
  onProgress?.(0, total);

  const q = buildQuotient(n);
  const { u, s } = findFundamental(q);
  const M = u.length;
  const { k, applyH } = q;

  // Unfold C = P, h^s·P, …, h^{(k-1)s}·P (gcd(s,k) = 1 ⇒ a single n!-cycle).
  const path: Perm[] = new Array(total);
  let idx = 0;
  for (let j = 0; j < k; j++) {
    const m = (j * s) % k;
    for (let i = 0; i < M; i++) {
      let w = u[i];
      for (let t = 0; t < m; t++) w = applyH(w);
      const v = new Uint8Array(n) as Perm;
      for (let p = 0; p < n; p++) v[p] = w[p];
      path[idx++] = v;
    }
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    onProgress?.(idx, total);
  }

  // Generator id along each step = the swapped positions (i, j) ⇒ (i+1)·100+(j+1),
  // matching the asymmetric-tree generator ids in pancake.ts.
  const flips: number[] = new Array(path.length);
  for (let step = 0; step < path.length; step++) {
    const a = path[step];
    const b = path[(step + 1) % path.length];
    flips[step] = swapId(a, b);
  }

  onProgress?.(total, total);
  return { path, flips };
}

function swapId(p: Perm, q: Perm): number {
  let first = -1;
  for (let i = 0; i < p.length; i++) {
    if (p[i] !== q[i]) {
      if (first === -1) first = i;
      else return (first + 1) * 100 + (i + 1);
    }
  }
  return 0;
}
