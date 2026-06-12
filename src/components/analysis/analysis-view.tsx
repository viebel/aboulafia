"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LineSpaceView } from "@/components/analysis/line-space-view";
import {
  type GeneratorInfo,
  type GraphKind,
  type GraphPreset,
  type PancakeGraph,
  type Perm,
  factorial,
  zaksSigma,
  zaksUnrank,
} from "@/lib/pancake";
import { drawToCanvas, type RenderSettings } from "@/lib/pancake-render";
import {
  buildLineSpaceFromEdges,
  type LineSpace,
} from "@/lib/radon-space";
import { readEnumParam, readIntParam, writeUrlParams } from "@/lib/url-state";
import { formatUiNumber } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

const MIN_N = 3;
const BASE_MAX_N = 10;
const SIMPLEX_MAX_N = 22;
const N_OPTIONS: readonly number[] = Array.from(
  { length: BASE_MAX_N - MIN_N + 1 },
  (_, i) => i + MIN_N
);
const SIMPLEX_N_OPTIONS: readonly number[] = Array.from(
  { length: SIMPLEX_MAX_N - MIN_N + 1 },
  (_, i) => i + MIN_N
);
type NValue = number;
const DEFAULT_N: NValue = 4;
const ORDER_OPTIONS = [
  "zaks",
  "williams",
  "random",
  "simplex",
  "sierpinski",
  "sierpinski-random-dihedral",
] as const;
type AnalysisOrder = (typeof ORDER_OPTIONS)[number];
type PancakeAnalysisOrder = Extract<AnalysisOrder, "zaks" | "williams">;
const DEFAULT_ORDER: AnalysisOrder = "zaks";
const ROW_PREVIEW_LIMIT = 5000;
const COMPARE_WIDTH = 120;
const COMPARE_HEIGHT = 90;
const WILLIAMS_RANDOMNESS_MAX_N = 9;
const STRUCTURED_JUMP_COUNT = 50;
const SIERPINSKI_K = 3;
const RANDOM_DIHEDRAL_JITTER = 3;

const ORDER_LABELS: Record<AnalysisOrder, string> = {
  zaks: "Pancake Zaks",
  williams: "Pancake Williams",
  random: "Random",
  simplex: "Simplex",
  sierpinski: "Sierpinski",
  "sierpinski-random-dihedral": "Sierpinski random dihedral",
};

function nOptionsForOrder(order: AnalysisOrder): readonly number[] {
  return order === "simplex" ? SIMPLEX_N_OPTIONS : N_OPTIONS;
}

function maxNForOrder(order: AnalysisOrder): number {
  return order === "simplex" ? SIMPLEX_MAX_N : BASE_MAX_N;
}

const GRAPH_PREVIEW_SETTINGS: RenderSettings = {
  alpha: 36,
  width: 28,
  showCayley: true,
  showCycle: true,
  showVertices: false,
  showLabels: false,
  parityMode: "off",
  edgeMode: "line",
  hiddenGenerators: [],
};

const GRAPH_PREVIEW_GENERATOR: GeneratorInfo = {
  id: 1,
  parity: 0,
  label: "edges",
};

interface Row {
  i: number;
  perm: string;
  sigma: number;
  delta: number;
}

interface Analysis {
  order: AnalysisOrder;
  total: number;
  blockSize: number;
  rows: Row[];
  shownRows: number;
  distinctDeltas: number | null;
  affine: boolean | null;
  deltaPeriod: number | null;
  blockEquivariant: boolean;
  lineSpace: LineSpace;
  fullComparison: WedgeComparison | null;
  wedgeComparison: WedgeComparison | null;
  randomness: RandomnessComparison | null;
}

interface SigmaData {
  values: Uint32Array;
  pathLehmer: Int32Array | null;
  positionByLehmer: Int32Array | null;
  blockEquivariant: boolean;
}

interface RandomnessMetrics {
  kind: "zaks" | "random" | "williams";
  label: string;
  serialMiBits: number;
  jumpTop10: number;
  jumpTop50: number;
  jumpEffectiveRatio: number;
  jumpDistinct: number;
  rareMass: number;
  rareEvenness: number;
  rareTop10: number;
  rareGapCv: number | null;
  rareMaxRun: number;
}

interface RandomnessComparison {
  zaksRaw: RandomnessMetrics;
  randomRaw: RandomnessMetrics;
  williams: RandomnessMetrics | null;
}

interface WedgeField {
  n: number;
  width: number;
  height: number;
  values: Float32Array;
  max: number;
}

interface WedgeResidual {
  width: number;
  height: number;
  values: Float32Array;
  maxAbs: number;
}

interface WedgeComparison {
  current: WedgeField;
  previous: WedgeField;
  residual: WedgeResidual;
  correlation: number;
  rms: number;
}

function analyze(n: number, order: AnalysisOrder): Analysis {
  if (!isPancakeOrder(order)) return analyzeGraphSource(n, order);

  const total = factorial(n);
  const blockSize = factorial(n - 1);
  const sigmaData = buildSigmaData(n, order);
  const sigmaValues = sigmaData.values;
  const periodSearchLength = sigmaData.blockEquivariant ? blockSize : total;
  const deltas = new Uint32Array(total);
  const rowCount = Math.min(total, ROW_PREVIEW_LIMIT);
  const rows: Row[] = new Array(rowCount);
  const deltaValues = new Set<number>();

  for (let i = 0; i < total; i++) {
    // Cyclic finite difference on ℤ/n!: index i−1 wraps to n!−1, so row 0 is
    // σ(0) − σ(n!−1).
    const prev = i === 0 ? sigmaValues[total - 1] : sigmaValues[i - 1];
    const delta = (((sigmaValues[i] - prev) % total) + total) % total;
    deltas[i] = delta;
    if (i < periodSearchLength) deltaValues.add(delta);
  }

  for (let i = 0; i < rowCount; i++) {
    const p =
      sigmaData.pathLehmer === null
        ? zaksUnrank(n, i)
        : lehmerDecode(sigmaData.pathLehmer[i], n);
    let perm = "";
    for (let t = 0; t < n; t++) perm += String(p[t]);
    rows[i] = {
      i,
      perm,
      sigma: sigmaValues[i],
      delta: deltas[i],
    };
  }

  // Smallest period p of the cyclic finite-difference sequence Δ(i).
  let deltaPeriod = periodSearchLength;
  for (const p of divisors(periodSearchLength)) {
    let ok = true;
    for (let i = 0; i < periodSearchLength; i++) {
      if (deltas[i] !== deltas[(i + p) % periodSearchLength]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      deltaPeriod = p;
      break;
    }
  }

  const lineSpace = buildLineSpace(n, sigmaData, order);

  return {
    order,
    total,
    blockSize,
    rows,
    shownRows: rowCount,
    distinctDeltas: deltaValues.size,
    affine: deltaValues.size === 1,
    deltaPeriod,
    blockEquivariant: sigmaData.blockEquivariant,
    lineSpace,
    fullComparison: buildFullComparison(n, lineSpace, order),
    wedgeComparison: buildWedgeComparison(n, sigmaValues, order),
    randomness: buildRandomnessComparison(n, sigmaValues, order),
  };
}

function buildAnalysisGraph(analysis: Analysis): PancakeGraph {
  const n = analysis.lineSpace.n;
  const total = analysis.total;
  const edges = collectAnalysisEdges(n, analysis.order, analysis.lineSpace.totalEdgeCount);
  const coords =
    analysis.order === "sierpinski"
      ? sierpinskiGasketCoords(buildSierpinskiPath(n), n)
      : undefined;
  const generator =
    analysis.order === "zaks"
      ? { id: n, parity: 0 as const, label: `r${n}` }
      : analysis.order === "williams"
        ? { id: n, parity: 0 as const, label: "suffix reversals" }
        : GRAPH_PREVIEW_GENERATOR;

  return {
    n,
    preset: analysisPreset(analysis.order),
    kind: analysisGraphKind(analysis.order),
    order: isPancakeOrder(analysis.order) ? analysis.order : undefined,
    path: new Array(total) as Perm[],
    flips: [],
    edges,
    rn: analysis.order === "zaks" ? zaksRnEdges(edges, n) : new Uint32Array(0),
    vertexParity: new Uint8Array(0),
    evenEdgeCount: 0,
    oddEdgeCount: 0,
    generators: [generator],
    coords,
  };
}

function analysisPreset(order: AnalysisOrder): GraphPreset {
  if (order === "zaks") return "pancake-zaks";
  if (order === "williams") return "pancake-williams";
  if (order === "simplex") return "simplex";
  if (order === "sierpinski") return "sierpinski";
  return "random-dihedral";
}

function analysisGraphKind(order: AnalysisOrder): GraphKind {
  if (order === "zaks" || order === "williams") return "pancake";
  if (order === "simplex") return "simplex";
  if (order === "sierpinski") return "sierpinski";
  return "random-dihedral";
}

function collectAnalysisEdges(
  n: number,
  order: AnalysisOrder,
  edgeUpperBound: number
): Uint32Array {
  const edges = new Uint32Array(Math.ceil(edgeUpperBound) * 3);
  let write = 0;
  const addEdge = (a: number, b: number, generatorId = 1) => {
    if (a >= b) return;
    edges[write++] = a;
    edges[write++] = b;
    edges[write++] = generatorId;
  };

  if (order === "zaks") {
    const total = factorial(n);
    for (let i = 0; i < total; i++) addEdge(i, zaksSigma(n, i), n);
  } else if (order === "williams") {
    const sigmaData = buildSigmaData(n, order);
    if (sigmaData.pathLehmer && sigmaData.positionByLehmer) {
      for (let i = 0; i < sigmaData.pathLehmer.length; i++) {
        const perm = lehmerDecode(sigmaData.pathLehmer[i], n);
        for (let k = 2; k <= n; k++) {
          const j = sigmaData.positionByLehmer[lehmerEncode(suffixFlip(perm, k), n)];
          addEdge(i, j, k);
        }
      }
    }
  } else if (order === "random") {
    const total = factorial(n);
    const pairs = shuffledRange(total, 41000 + n);
    for (let i = 0; i + 1 < total; i += 2) {
      const a = pairs[i];
      const b = pairs[i + 1];
      addEdge(Math.min(a, b), Math.max(a, b));
    }
  } else if (order === "simplex") {
    const total = n + 1;
    for (let i = 0; i < total; i++) {
      for (let j = i + 1; j < total; j++) addEdge(i, j);
    }
  } else {
    collectSierpinskiAnalysisEdges(n, order, addEdge);
  }

  return write === edges.length ? edges : edges.slice(0, write);
}

function collectSierpinskiAnalysisEdges(
  n: number,
  order: AnalysisOrder,
  addEdge: (a: number, b: number, generatorId?: number) => void
): void {
  const path = buildSierpinskiPath(n);
  const positionByCode = buildSierpinskiPositions(path, n);
  const total = path.length;

  if (order === "sierpinski-random-dihedral") {
    const seedEdges = collectSierpinskiEdges(n, path, positionByCode);
    const wedgeSize = Math.max(2, Math.floor(total / (2 * n)));
    const random = seededRandom(73000 + n);
    for (const [a, b] of seedEdges) {
      const seedA = jitterWedgeIndex(
        foldIndexToDihedralWedge(a, total, n, wedgeSize),
        wedgeSize,
        random
      );
      let seedB = jitterWedgeIndex(
        foldIndexToDihedralWedge(b, total, n, wedgeSize),
        wedgeSize,
        random
      );
      if (seedA === seedB) seedB = (seedB + 1) % wedgeSize;

      for (let k = 0; k < n; k++) {
        const offset = k * Math.floor(total / n);
        addUndirectedPreviewEdge((seedA + offset) % total, (seedB + offset) % total, addEdge);
        addUndirectedPreviewEdge(
          (total - 1 - seedA + offset) % total,
          (total - 1 - seedB + offset) % total,
          addEdge
        );
      }
    }
    return;
  }

  emitSierpinskiEdges(n, path, positionByCode, (a, b) =>
    addUndirectedPreviewEdge(a, b, addEdge)
  );
}

function addUndirectedPreviewEdge(
  a: number,
  b: number,
  addEdge: (a: number, b: number, generatorId?: number) => void
): void {
  if (a === b) return;
  addEdge(Math.min(a, b), Math.max(a, b));
}

function zaksRnEdges(edges: Uint32Array, generatorId: number): Uint32Array {
  const rn: number[] = [];
  for (let edgeIndex = 0, t = 0; t < edges.length; t += 3, edgeIndex++) {
    if (edges[t + 2] === generatorId) rn.push(edgeIndex);
  }
  return new Uint32Array(rn);
}

function sierpinskiGasketCoords(path: Uint8Array[], n: number): Float64Array {
  const vertices: ReadonlyArray<readonly [number, number]> = [
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
    const word = path[i];
    let x = 0;
    let y = 0;
    let scale = 1;
    for (let k = 0; k < n; k++) {
      scale *= 0.5;
      const vertex = vertices[word[k]];
      x += scale * vertex[0];
      y += scale * vertex[1];
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
    const distance = Math.hypot(xs[i] - cx, ys[i] - cy);
    if (distance > maxDist) maxDist = distance;
  }

  const normalize = 0.98 / maxDist;
  const coords = new Float64Array(total * 2);
  for (let i = 0; i < total; i++) {
    coords[2 * i] = (xs[i] - cx) * normalize;
    coords[2 * i + 1] = (ys[i] - cy) * normalize;
  }
  return coords;
}

function isPancakeOrder(order: AnalysisOrder): order is PancakeAnalysisOrder {
  return order === "zaks" || order === "williams";
}

function analysisVertexCount(n: number, order: AnalysisOrder): number {
  if (order === "simplex") return n + 1;
  if (order === "sierpinski" || order === "sierpinski-random-dihedral") {
    return SIERPINSKI_K ** n;
  }
  return factorial(n);
}

function analyzeGraphSource(n: number, order: AnalysisOrder): Analysis {
  const lineSpace = buildGraphLineSpace(n, order);
  return {
    order,
    total: lineSpace.vertexCount,
    blockSize: 0,
    rows: [],
    shownRows: 0,
    distinctDeltas: null,
    affine: null,
    deltaPeriod: null,
    blockEquivariant: false,
    lineSpace,
    fullComparison: buildFullComparison(n, lineSpace, order),
    wedgeComparison: null,
    randomness: null,
  };
}

function buildSigmaData(n: number, order: PancakeAnalysisOrder): SigmaData {
  if (order === "williams") {
    const williams = buildWilliamsSigmaData(n);
    if (!williams) {
      throw new Error(`Williams analysis is available up to n = ${WILLIAMS_RANDOMNESS_MAX_N}.`);
    }
    return williams;
  }

  const total = factorial(n);
  const blockSize = factorial(n - 1);
  const sigmaBlock = buildZaksSigmaBlock(n);
  const values = new Uint32Array(total);
  for (let i = 0; i < total; i++) {
    values[i] = sigmaFromBlock(i, sigmaBlock, blockSize, total);
  }
  return {
    values,
    pathLehmer: null,
    positionByLehmer: null,
    blockEquivariant: true,
  };
}

function buildZaksSigmaBlock(n: number): Uint32Array {
  const blockSize = factorial(n - 1);
  const sigmaBlock = new Uint32Array(blockSize);
  for (let i = 0; i < blockSize; i++) sigmaBlock[i] = zaksSigma(n, i);
  return sigmaBlock;
}

function sigmaFromBlock(
  i: number,
  sigmaBlock: ArrayLike<number>,
  blockSize: number,
  total: number
): number {
  const block = Math.floor(i / blockSize);
  return (sigmaBlock[i % blockSize] + block * blockSize) % total;
}

function divisors(value: number): number[] {
  const small: number[] = [];
  const large: number[] = [];
  for (let d = 1; d * d <= value; d++) {
    if (value % d !== 0) continue;
    small.push(d);
    if (d * d !== value) large.push(value / d);
  }
  return small.concat(large.reverse());
}

function buildLineSpace(
  n: number,
  sigmaData: SigmaData,
  order: PancakeAnalysisOrder
): LineSpace {
  const total = factorial(n);
  const blockSize = factorial(n - 1);
  const hasSeedWedge = order === "zaks";
  const sigma = sigmaData.values;
  const totalEdgeCount = hasSeedWedge ? total / 2 : (total * (n - 1)) / 2;
  const wedgeVertexCount = Math.floor(blockSize / 2);
  const seedEdgeCount = hasSeedWedge ? wedgeVertexCount : totalEdgeCount;
  return buildLineSpaceFromEdges({
    n,
    vertexCount: total,
    totalEdgeCount,
    seedEdgeCount,
    hasSeedWedge,
    emitEdges(addEdge) {
      if (hasSeedWedge) {
        for (let i = 0; i < total; i++) {
          addEdge(i, sigma[i], true, false);
        }
      } else if (sigmaData.pathLehmer && sigmaData.positionByLehmer) {
        for (let i = 0; i < total; i++) {
          const perm = lehmerDecode(sigmaData.pathLehmer[i], n);
          for (let k = 2; k <= n; k++) {
            const j =
              sigmaData.positionByLehmer[lehmerEncode(suffixFlip(perm, k), n)];
            addEdge(i, j, true, false);
          }
        }
      }

      if (hasSeedWedge) {
        for (let i = 0; i < wedgeVertexCount; i++) {
          const j = sigma[i];
          for (let k = 0; k < n; k++) {
            const offset = k * blockSize;
            addEdge((i + offset) % total, (j + offset) % total, false, true);
            addEdge(
              (total - 1 - i + offset) % total,
              (total - 1 - j + offset) % total,
              false,
              true
            );
          }
        }
      }
    },
  });
}

function buildGraphLineSpace(n: number, order: AnalysisOrder): LineSpace {
  if (order === "random") {
    const total = factorial(n);
    const pairs = shuffledRange(total, 41000 + n);
    return buildLineSpaceFromEdges({
      n,
      vertexCount: total,
      totalEdgeCount: total / 2,
      seedEdgeCount: total / 2,
      hasSeedWedge: false,
      emitEdges(addEdge) {
        for (let i = 0; i + 1 < total; i += 2) {
          addEdge(pairs[i], pairs[i + 1], true, false);
        }
      },
    });
  }

  if (order === "simplex") {
    const total = n + 1;
    return buildLineSpaceFromEdges({
      n,
      vertexCount: total,
      totalEdgeCount: (n * (n + 1)) / 2,
      seedEdgeCount: (n * (n + 1)) / 2,
      hasSeedWedge: false,
      emitEdges(addEdge) {
        for (let i = 0; i < total; i++) {
          for (let j = i + 1; j < total; j++) addEdge(i, j, true, false);
        }
      },
    });
  }

  const path = buildSierpinskiPath(n);
  const positionByCode = buildSierpinskiPositions(path, n);
  const total = path.length;
  const edgeCount = (SIERPINSKI_K * (SIERPINSKI_K ** n - 1)) / 2;

  if (order === "sierpinski-random-dihedral") {
    const seedEdges = collectSierpinskiEdges(n, path, positionByCode);
    const wedgeSize = Math.max(2, Math.floor(total / (2 * n)));
    const random = seededRandom(73000 + n);
    return buildLineSpaceFromEdges({
      n,
      vertexCount: total,
      totalEdgeCount: seedEdges.length * 2 * n,
      seedEdgeCount: seedEdges.length,
      hasSeedWedge: true,
      emitEdges(addEdge) {
        for (const [a, b] of seedEdges) {
          const seedA = jitterWedgeIndex(
            foldIndexToDihedralWedge(a, total, n, wedgeSize),
            wedgeSize,
            random
          );
          let seedB = jitterWedgeIndex(
            foldIndexToDihedralWedge(b, total, n, wedgeSize),
            wedgeSize,
            random
          );
          if (seedA === seedB) seedB = (seedB + 1) % wedgeSize;

          for (let k = 0; k < n; k++) {
            const offset = k * Math.floor(total / n);
            addEdge((seedA + offset) % total, (seedB + offset) % total, true, true);
            addEdge(
              (total - 1 - seedA + offset) % total,
              (total - 1 - seedB + offset) % total,
              true,
              true
            );
          }
        }
      },
    });
  }

  return buildLineSpaceFromEdges({
    n,
    vertexCount: total,
    totalEdgeCount: edgeCount,
    seedEdgeCount: edgeCount,
    hasSeedWedge: false,
    emitEdges(addEdge) {
      emitSierpinskiEdges(n, path, positionByCode, addEdge);
    },
  });
}

function buildSierpinskiPath(n: number): Uint8Array[] {
  const path: Uint8Array[] = [];
  const third = (a: number, b: number) => 3 - a - b;
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
  return path;
}

function buildSierpinskiPositions(path: Uint8Array[], n: number): Int32Array {
  const positions = new Int32Array(SIERPINSKI_K ** n).fill(-1);
  for (let i = 0; i < path.length; i++) positions[sierpinskiCode(path[i])] = i;
  return positions;
}

function collectSierpinskiEdges(
  n: number,
  path: Uint8Array[],
  positionByCode: Int32Array
): [number, number][] {
  const edges: [number, number][] = [];
  emitSierpinskiEdges(n, path, positionByCode, (a, b) => edges.push([a, b]));
  return edges;
}

function emitSierpinskiEdges(
  n: number,
  path: Uint8Array[],
  positionByCode: Int32Array,
  addEdge: (
    a: number,
    b: number,
    includeFull: boolean,
    includeSeedWedge: boolean
  ) => void
): void {
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    for (let hi = 0; hi < n - 1; hi++) {
      const a = p[n - 1];
      let suffixConstant = true;
      for (let t = hi + 1; t < n - 1; t++) {
        if (p[t] !== a) {
          suffixConstant = false;
          break;
        }
      }
      const b = p[hi];
      if (suffixConstant && b !== a) {
        const q = new Uint8Array(p);
        q[hi] = a;
        for (let t = hi + 1; t < n; t++) q[t] = b;
        addEdge(i, positionByCode[sierpinskiCode(q)], true, false);
      }
    }

    for (let d = 1; d < SIERPINSKI_K; d++) {
      const q = new Uint8Array(p);
      q[n - 1] = (p[n - 1] + d) % SIERPINSKI_K;
      addEdge(i, positionByCode[sierpinskiCode(q)], true, false);
    }
  }
}

function sierpinskiCode(word: Uint8Array): number {
  let code = 0;
  for (let i = 0; i < word.length; i++) code = code * SIERPINSKI_K + word[i];
  return code;
}

function foldIndexToDihedralWedge(
  index: number,
  total: number,
  n: number,
  wedgeSize: number
): number {
  const theta = (2 * Math.PI * index) / total;
  const folded = foldDihedralAngle(theta, n);
  return Math.min(wedgeSize - 1, Math.floor((folded / (Math.PI / n)) * wedgeSize));
}

function jitterWedgeIndex(
  index: number,
  wedgeSize: number,
  random: () => number
): number {
  const jitter = Math.floor((random() * 2 - 1) * RANDOM_DIHEDRAL_JITTER);
  return Math.max(0, Math.min(wedgeSize - 1, index + jitter));
}

function buildWedgeComparison(
  n: number,
  sigmaValues: ArrayLike<number>,
  order: PancakeAnalysisOrder
): WedgeComparison | null {
  if (order !== "zaks") return null;
  const previousN = n - 2;
  if (previousN < MIN_N) return null;

  const previousSigma = buildSigmaData(previousN, order).values;
  const current = buildFoldedWedgeField(n, sigmaValues);
  const previous = buildFoldedWedgeField(previousN, previousSigma);
  return compareFields(current, previous);
}

function buildFullComparison(
  n: number,
  lineSpace: LineSpace,
  order: AnalysisOrder
): WedgeComparison | null {
  const previousN = n - 2;
  if (previousN < MIN_N) return null;

  const previousLineSpace = isPancakeOrder(order)
    ? buildLineSpace(previousN, buildSigmaData(previousN, order), order)
    : buildGraphLineSpace(previousN, order);
  return compareFields(
    fieldFromLineSpace(lineSpace),
    fieldFromLineSpace(previousLineSpace)
  );
}

function compareFields(
  current: WedgeField,
  previous: WedgeField
): WedgeComparison {
  const values = new Float32Array(current.values.length);
  let maxAbs = 0;
  let sumSq = 0;
  let currentMean = 0;
  let previousMean = 0;

  for (let i = 0; i < values.length; i++) {
    currentMean += current.values[i];
    previousMean += previous.values[i];
  }
  currentMean /= values.length;
  previousMean /= values.length;

  let numerator = 0;
  let currentEnergy = 0;
  let previousEnergy = 0;
  for (let i = 0; i < values.length; i++) {
    const diff = current.values[i] - previous.values[i];
    values[i] = diff;
    const abs = Math.abs(diff);
    if (abs > maxAbs) maxAbs = abs;
    sumSq += diff * diff;

    const a = current.values[i] - currentMean;
    const b = previous.values[i] - previousMean;
    numerator += a * b;
    currentEnergy += a * a;
    previousEnergy += b * b;
  }

  return {
    current,
    previous,
    residual: {
      width: current.width,
      height: current.height,
      values,
      maxAbs,
    },
    correlation:
      currentEnergy > 0 && previousEnergy > 0
        ? numerator / Math.sqrt(currentEnergy * previousEnergy)
        : 0,
    rms: Math.sqrt(sumSq / values.length),
  };
}

function fieldFromLineSpace(lineSpace: LineSpace): WedgeField {
  const counts = new Uint32Array(lineSpace.psiBins * lineSpace.pBins);
  for (const bin of lineSpace.bins) {
    counts[bin.y * lineSpace.psiBins + bin.x] = bin.count;
  }
  return normalizeField(
    lineSpace.n,
    lineSpace.psiBins,
    lineSpace.pBins,
    smoothField(toneCounts(counts), lineSpace.psiBins, lineSpace.pBins)
  );
}

function buildFoldedWedgeField(
  n: number,
  sigmaValues: ArrayLike<number>
): WedgeField {
  const total = factorial(n);
  const counts = new Uint32Array(COMPARE_WIDTH * COMPARE_HEIGHT);

  const addLine = (aIndex: number, bIndex: number) => {
    const a = (2 * Math.PI * aIndex) / total;
    const b = (2 * Math.PI * bIndex) / total;
    const x1 = Math.cos(a);
    const y1 = Math.sin(a);
    const x2 = Math.cos(b);
    const y2 = Math.sin(b);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    if (length === 0) return;

    const nx = -dy / length;
    const ny = dx / length;
    let p = nx * x1 + ny * y1;
    let psi = Math.atan2(ny, nx);

    if (psi < 0) {
      psi += Math.PI;
      p = -p;
    } else if (psi >= Math.PI) {
      psi -= Math.PI;
      p = -p;
    }

    const theta = foldDihedralAngle(psi, n);
    const x = Math.min(
      COMPARE_WIDTH - 1,
      Math.floor((theta / (Math.PI / n)) * COMPARE_WIDTH)
    );
    const y = Math.min(
      COMPARE_HEIGHT - 1,
      Math.max(0, Math.floor(((p + 1) / 2) * COMPARE_HEIGHT))
    );
    counts[y * COMPARE_WIDTH + x]++;
  };

  const addEdge = (a: number, b: number) => {
    if (a < b) addLine(a, b);
  };

  for (let i = 0; i < total; i++) {
    addEdge(i, sigmaValues[i]);
  }

  return normalizeField(
    n,
    COMPARE_WIDTH,
    COMPARE_HEIGHT,
    smoothField(toneCounts(counts), COMPARE_WIDTH, COMPARE_HEIGHT)
  );
}

function normalizeField(
  n: number,
  width: number,
  height: number,
  values: Float32Array
): WedgeField {
  let max = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] > max) max = values[i];
  }
  if (max > 0) {
    for (let i = 0; i < values.length; i++) values[i] /= max;
    max = 1;
  }

  return { n, width, height, values, max };
}

function toneCounts(counts: Uint32Array): Float32Array {
  const values = new Float32Array(counts.length);
  for (let i = 0; i < counts.length; i++) values[i] = Math.log1p(counts[i]);
  return values;
}

function smoothField(
  values: Float32Array,
  width: number,
  height: number
): Float32Array {
  let out = values;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(out.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let weight = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            const w = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
            sum += out[yy * width + xx] * w;
            weight += w;
          }
        }
        next[y * width + x] = sum / weight;
      }
    }
    out = next;
  }
  return out;
}

function foldDihedralAngle(theta: number, n: number): number {
  const wedge = Math.PI / n;
  const period = 2 * wedge;
  const t = ((theta % period) + period) % period;
  return t <= wedge ? t : period - t;
}

function wrapSigned(value: number, modulus: number): number {
  let out = value % modulus;
  if (out > modulus / 2) out -= modulus;
  if (out <= -modulus / 2) out += modulus;
  return out;
}

function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function shuffledRange(size: number, seed: number): Uint32Array {
  const out = new Uint32Array(size);
  for (let i = 0; i < size; i++) out[i] = i;
  const random = seededRandom(seed);
  for (let i = size - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const value = out[i];
    out[i] = out[j];
    out[j] = value;
  }
  return out;
}

function suffixFlip(p: Uint8Array, k: number): Perm {
  const q = Uint8Array.from(p) as Perm;
  for (let i = q.length - k, j = q.length - 1; i < j; i++, j--) {
    const value = q[i];
    q[i] = q[j];
    q[j] = value;
  }
  return q;
}

function lehmerEncode(p: Uint8Array, n: number): number {
  let index = 0;
  for (let i = 0; i < n; i++) {
    let smaller = 0;
    for (let j = i + 1; j < n; j++) {
      if (p[j] < p[i]) smaller++;
    }
    index = index * (n - i) + smaller;
  }
  return index;
}

function lehmerDecode(index: number, n: number): Perm {
  const out = new Uint8Array(n) as Perm;
  const available: number[] = [];
  for (let v = 1; v <= n; v++) available.push(v);
  for (let i = 0; i < n; i++) {
    const f = factorial(n - 1 - i);
    const digit = Math.floor(index / f);
    index -= digit * f;
    out[i] = available[digit];
    available.splice(digit, 1);
  }
  return out;
}

function buildWilliamsSigmaData(n: number): SigmaData | null {
  if (n > WILLIAMS_RANDOMNESS_MAX_N) return null;
  const total = factorial(n);
  const seen = new Uint8Array(total);
  const positionByLehmer = new Int32Array(total).fill(-1);
  const pathLehmer = new Int32Array(total);
  let p = new Uint8Array(n) as Perm;
  for (let i = 0; i < n; i++) p[i] = i + 1;

  let count = 0;
  while (count < total) {
    const encoded = lehmerEncode(p, n);
    seen[encoded] = 1;
    positionByLehmer[encoded] = count;
    pathLehmer[count] = encoded;
    count++;

    let next: Perm | null = null;
    for (let k = n; k >= 2; k--) {
      const q = suffixFlip(p, k);
      if (!seen[lehmerEncode(q, n)]) {
        next = q;
        break;
      }
    }
    if (!next) break;
    p = next;
  }

  if (count !== total) return null;
  const values = new Uint32Array(total);
  for (let i = 0; i < total; i++) {
    const perm = lehmerDecode(pathLehmer[i], n);
    values[i] = positionByLehmer[lehmerEncode(suffixFlip(perm, n), n)];
  }
  return { values, pathLehmer, positionByLehmer, blockEquivariant: false };
}

function buildRandomnessComparison(
  n: number,
  sigmaValues: Uint32Array,
  order: PancakeAnalysisOrder
): RandomnessComparison {
  const total = factorial(n);
  const zaksRawValues =
    order === "zaks" ? sigmaValues : buildSigmaData(n, "zaks").values;
  const randomRawValues = shuffledRange(total, 19000 + n);
  const williamsValues =
    order === "williams" ? sigmaValues : buildWilliamsSigmaData(n)?.values;
  return {
    zaksRaw: randomnessMetrics("zaks", "Zaks", zaksRawValues, total),
    randomRaw: randomnessMetrics(
      "random",
      "Random",
      randomRawValues,
      total
    ),
    williams: williamsValues
      ? randomnessMetrics("williams", "Williams", williamsValues, total)
      : null,
  };
}

function randomnessMetrics(
  kind: RandomnessMetrics["kind"],
  label: string,
  values: Uint32Array,
  sectorSize: number
): RandomnessMetrics {
  const spectrum = new Map<number, number>();
  for (let i = 0; i + 1 < values.length; i++) {
    const jump = wrapSigned(values[i + 1] - values[i], sectorSize);
    spectrum.set(jump, (spectrum.get(jump) ?? 0) + 1);
  }
  const entries = Array.from(spectrum.entries()).sort((a, b) => b[1] - a[1]);
  const counts = entries.map(([, count]) => count);
  const totalJumps = Math.max(1, values.length - 1);
  const jumpEntropy = entropyFromCounts(counts, totalJumps);
  const effective = Math.exp(jumpEntropy);
  const residualCounts = counts.slice(STRUCTURED_JUMP_COUNT);
  const residualTotal = residualCounts.reduce((a, b) => a + b, 0);
  const residualEffective = residualTotal
    ? Math.exp(entropyFromCounts(residualCounts, residualTotal))
    : 0;
  const structuredJumps = new Set(
    entries.slice(0, STRUCTURED_JUMP_COUNT).map(([jump]) => jump)
  );
  let rareMaxRun = 0;
  let currentRun = 0;
  let lastRare = -1;
  let gapCount = 0;
  let gapSum = 0;
  let gapSqSum = 0;
  for (let i = 0; i + 1 < values.length; i++) {
    const jump = wrapSigned(values[i + 1] - values[i], sectorSize);
    const rare = !structuredJumps.has(jump);
    if (rare) {
      currentRun++;
      if (currentRun > rareMaxRun) rareMaxRun = currentRun;
      if (lastRare >= 0) {
        const gap = i - lastRare;
        gapCount++;
        gapSum += gap;
        gapSqSum += gap * gap;
      }
      lastRare = i;
    } else {
      currentRun = 0;
    }
  }
  const gapMean = gapCount > 0 ? gapSum / gapCount : 0;
  const gapVariance =
    gapCount > 0 ? Math.max(0, gapSqSum / gapCount - gapMean * gapMean) : 0;
  return {
    kind,
    label,
    serialMiBits: serialMutualInformation(values, sectorSize),
    jumpTop10: counts.slice(0, 10).reduce((a, b) => a + b, 0) / totalJumps,
    jumpTop50: counts.slice(0, 50).reduce((a, b) => a + b, 0) / totalJumps,
    jumpEffectiveRatio: effective / Math.max(1, spectrum.size),
    jumpDistinct: spectrum.size,
    rareMass: residualTotal / totalJumps,
    rareEvenness:
      residualCounts.length > 0 ? residualEffective / residualCounts.length : 0,
    rareTop10:
      residualTotal > 0
        ? residualCounts.slice(0, 10).reduce((a, b) => a + b, 0) / residualTotal
        : 0,
    rareGapCv:
      gapCount > 0 && gapMean > 0 ? Math.sqrt(gapVariance) / gapMean : null,
    rareMaxRun,
  };
}

function entropyFromCounts(counts: Iterable<number>, total: number): number {
  let entropy = 0;
  for (const count of counts) {
    if (count <= 0) continue;
    const p = count / total;
    entropy -= p * Math.log(p);
  }
  return entropy;
}

function serialMutualInformation(
  values: Uint32Array,
  sectorSize: number,
  maxBins = 128
): number {
  if (values.length < 2) return 0;
  const bins = Math.max(1, Math.min(maxBins, sectorSize));
  const joint = new Uint32Array(bins * bins);
  const row = new Uint32Array(bins);
  const col = new Uint32Array(bins);
  const total = values.length - 1;
  for (let i = 0; i < total; i++) {
    const a = Math.min(bins - 1, Math.floor((values[i] / sectorSize) * bins));
    const b = Math.min(
      bins - 1,
      Math.floor((values[i + 1] / sectorSize) * bins)
    );
    joint[a * bins + b]++;
    row[a]++;
    col[b]++;
  }
  let mi = 0;
  for (let a = 0; a < bins; a++) {
    for (let b = 0; b < bins; b++) {
      const count = joint[a * bins + b];
      if (!count) continue;
      mi +=
        (count / total) * Math.log2((count * total) / (row[a] * col[b]));
    }
  }
  return mi;
}

function svgNumber(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function svgRgba(r: number, g: number, b: number, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${svgNumber(alpha)})`;
}

function piShiftLabel(theta: number): string {
  if (Math.abs(theta) < 1e-12) return "0";
  const denominator = (2 * Math.PI) / theta;
  const rounded = Math.round(denominator);
  if (Math.abs(denominator - rounded) < 1e-6) return `2π/${rounded}`;
  return `2π/${denominator.toFixed(3)}`;
}

function GraphPreview({ analysis }: { analysis: Analysis }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [graph, setGraph] = useState<PancakeGraph | null>(null);
  const [status, setStatus] = useState<"drawing" | "ready" | "error">("drawing");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const resize = () => {
      const rect = host.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const id = setTimeout(() => {
      if (cancelled) return;
      setStatus("drawing");
      setGraph(null);

      try {
        const nextGraph = buildAnalysisGraph(analysis);
        if (cancelled) return;
        setGraph(nextGraph);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [analysis]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !graph || size.width === 0 || size.height === 0) return;

    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = Math.floor(size.width * dpr);
    canvas.height = Math.floor(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    drawToCanvas(ctx, {
      graph,
      settings: GRAPH_PREVIEW_SETTINGS,
      cssWidth: size.width,
      cssHeight: size.height,
      dpr,
    });
  }, [graph, size.height, size.width]);

  return (
    <div ref={hostRef} className="relative aspect-square overflow-hidden rounded-lg border bg-card">
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        role="img"
        aria-label={`${ORDER_LABELS[analysis.order]} graph`}
      />
      {status === "drawing" ? (
        <div className="absolute inset-0 grid place-items-center bg-background/70">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
        </div>
      ) : status === "error" ? (
        <div className="absolute inset-0 grid place-items-center bg-background/80 px-3 text-center text-xs text-muted-foreground">
          Preview unavailable.
        </div>
      ) : null}
    </div>
  );
}

export function AnalysisView() {
  const searchParams = useSearchParams();
  const initialOrder = useMemo(
    () => readEnumParam(searchParams, "order", ORDER_OPTIONS, DEFAULT_ORDER),
    [searchParams]
  );
  const initialN = useMemo(
    () => {
      const value = readIntParam(
        searchParams,
        "n",
        nOptionsForOrder(initialOrder),
        DEFAULT_N
      ) as NValue;
      return initialOrder === "williams" && value > WILLIAMS_RANDOMNESS_MAX_N
        ? WILLIAMS_RANDOMNESS_MAX_N
        : value;
    },
    [initialOrder, searchParams]
  );
  const [n, setN] = useState<NValue>(initialN);
  const [order, setOrder] = useState<AnalysisOrder>(initialOrder);
  const [showRasterLayers, setShowRasterLayers] = useState(false);
  const [seedWedgeOnly, setSeedWedgeOnly] = useState(false);
  const [analysis, setAnalysis] = useState(() => analyze(initialN, initialOrder));
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState("Ready.");
  const didMountRef = useRef(false);
  const availableNOptions = nOptionsForOrder(order);

  useEffect(() => {
    writeUrlParams({ n: String(n), order });
  }, [n, order]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShowRasterLayers(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }

    let cancelled = false;
    let frame = 0;
    setIsAnalyzing(true);
    setAnalysisStatus(`Building Radon space for n = ${n}…`);

    frame = requestAnimationFrame(() => {
      if (cancelled) return;
      try {
        const nextAnalysis = analyze(n, order);
        if (cancelled) return;
        setAnalysis(nextAnalysis);
        setAnalysisStatus("Ready.");
      } catch (error) {
        if (!cancelled) {
          setAnalysisStatus(
            `Error: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      } finally {
        if (!cancelled) setIsAnalyzing(false);
      }
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [n, order]);

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="self-start lg:sticky lg:top-4 space-y-5">
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Graph
          </Label>
          <Select
            value={order}
            onValueChange={(value) => {
              const nextOrder = value as AnalysisOrder;
              setOrder(nextOrder);
              const nextMax =
                nextOrder === "williams"
                  ? WILLIAMS_RANDOMNESS_MAX_N
                  : maxNForOrder(nextOrder);
              if (n > nextMax) {
                setN(nextMax);
              }
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ORDER_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {ORDER_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Size
          </Label>
          <Select value={String(n)} onValueChange={(v) => setN(Number(v) as NValue)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableNOptions.map((option) => (
                <SelectItem
                  key={option}
                  value={String(option)}
                  disabled={
                    order === "williams" && option > WILLIAMS_RANDOMNESS_MAX_N
                  }
                >
                  n = {option} —{" "}
                  {formatUiNumber(analysisVertexCount(option, order))} vertices
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
          <Stat label="n" value={n} />
          <Stat label="Vertices" value={analysis.total} />
          {isPancakeOrder(analysis.order) ? (
            <>
              <Stat label="Block (n−1)!" value={analysis.blockSize} />
              <Stat label="Distinct slopes" value={analysis.distinctDeltas ?? ""} />
              <Stat label="Δ period" value={analysis.deltaPeriod ?? ""} />
              <Stat label="Affine" value={analysis.affine ? "yes" : "no"} />
            </>
          ) : null}
        </dl>

        <GraphPreview analysis={analysis} />

        {analysis.order === "zaks" ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            σₙ = rank ∘ reverse ∘ unrank sends vertex i to the far end of its rₙ
            chord. Affine would mean a constant slope Δ(i) = σ(i) − σ(i−1). It is
            not — but Δ is periodic with period (n−1)!, because σ is
            block-equivariant:{" "}
            <span className="font-mono text-foreground">
              σ(i + (n−1)!) ≡ σ(i) + (n−1)! (mod n!)
            </span>{" "}
            {analysis.blockEquivariant ? "✓" : "✗"}.
          </p>
        ) : analysis.order === "williams" ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            σ_W sends each Williams cycle position to the position of its rₙ
            reversal. Δ is measured on the full Williams cycle.
          </p>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Radon space is computed from the graph edges in this circular order.
          </p>
        )}
      </aside>

      <main className="relative space-y-4" aria-busy={isAnalyzing}>
        {isAnalyzing ? (
          <div className="sticky top-4 z-20 flex items-center gap-3 rounded-lg border bg-background/95 px-3 py-2 text-sm shadow-sm backdrop-blur">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            <span className="font-mono text-xs text-muted-foreground">
              {analysisStatus}
            </span>
          </div>
        ) : null}
        <LineSpaceView
          lineSpace={analysis.lineSpace}
          orderLabel={ORDER_LABELS[analysis.order]}
          showRasterLayer={showRasterLayers}
          seedWedgeOnly={seedWedgeOnly}
        />
        <AngleWhiteCharts
          lineSpace={analysis.lineSpace}
          seedWedgeOnly={seedWedgeOnly}
          setSeedWedgeOnly={setSeedWedgeOnly}
        />
        <CircularAutocorrelationChart
          lineSpace={analysis.lineSpace}
          seedWedgeOnly={seedWedgeOnly}
        />
        {showRasterLayers && analysis.fullComparison && (
          <WedgeComparisonView
            comparison={analysis.fullComparison}
            title="Full comparison"
          />
        )}
        {showRasterLayers && analysis.wedgeComparison && (
          <WedgeComparisonView
            comparison={analysis.wedgeComparison}
            title="Wedge comparison"
          />
        )}
        {analysis.randomness ? <RandomnessView comparison={analysis.randomness} /> : null}
        {isPancakeOrder(analysis.order) ? <SigmaTable analysis={analysis} /> : null}
      </main>
    </div>
  );
}

export function CircularAutocorrelationChart({
  lineSpace,
  seedWedgeOnly,
}: {
  lineSpace: LineSpace;
  seedWedgeOnly: boolean;
}) {
  const [lowBound, setLowBound] = useState(0);
  const [highBound, setHighBound] = useState(1);
  const lowNumberRef = useRef<HTMLInputElement>(null);
  const highNumberRef = useRef<HTMLInputElement>(null);
  const showTwoWedge = lineSpace.hasSeedWedge && seedWedgeOnly;
  const field = showTwoWedge
    ? lineSpace.twoWedgeAutocorrelation
    : lineSpace.thetaAutocorrelation;
  const width = 900;
  const height = 360;
  const margin = { top: 14, right: 16, bottom: 32, left: 44 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const shiftMax = showTwoWedge
    ? (2 * lineSpace.thetaMax) / lineSpace.n
    : lineSpace.thetaMax;
  const boundUnit = lineSpace.thetaMax / lineSpace.n;
  const minVisibleBins = 2;
  const lowIndex = Math.min(
    field.width - minVisibleBins,
    Math.max(0, Math.floor(lowBound * field.width))
  );
  const highIndex = Math.max(
    lowIndex + minVisibleBins,
    Math.min(field.width, Math.ceil(highBound * field.width))
  );
  const visibleWidth = highIndex - lowIndex;
  const visibleShiftStart = (lowIndex / field.width) * shiftMax;
  const visibleShiftEnd = (highIndex / field.width) * shiftMax;
  const maxBoundUnit = shiftMax / boundUnit;
  const visibleShiftSpan = visibleShiftEnd - visibleShiftStart;
  const cellWidth = plotWidth / visibleWidth;
  const cellHeight = plotHeight / field.height;
  const colorMax = Math.max(1e-9, field.maxAbs);
  const xForShift = (shift: number) =>
    margin.left + ((shift - visibleShiftStart) / visibleShiftSpan) * plotWidth;
  const yForP = (p: number) => margin.top + (1 - (p + 1) / 2) * plotHeight;
  const indexToUnit = (index: number) =>
    ((index / field.width) * shiftMax) / boundUnit;
  const unitToIndex = (unit: number) =>
    Math.round((Math.min(maxBoundUnit, Math.max(0, unit)) / maxBoundUnit) * field.width);
  const syncDraftInputs = (low: number, high: number) => {
    if (lowNumberRef.current) lowNumberRef.current.value = String(svgNumber(indexToUnit(low)));
    if (highNumberRef.current) highNumberRef.current.value = String(svgNumber(indexToUnit(high)));
  };
  const draftUnitToIndex = (value: string | undefined, fallbackIndex: number) => {
    const unit = Number(value);
    return Number.isFinite(unit) ? unitToIndex(unit) : fallbackIndex;
  };
  const absSumValues = Array.from({ length: visibleWidth }, (_, x) => {
    const sourceX = lowIndex + x;
    let sum = 0;
    for (let y = 0; y < field.height; y++) {
      sum += Math.abs(field.values[y * field.width + sourceX]);
    }
    return sum;
  });
  const absSumMax = Math.max(0, ...absSumValues);
  const thetaTicks = [
    { value: visibleShiftStart, label: piShiftLabel(visibleShiftStart) },
    {
      value: visibleShiftStart + visibleShiftSpan / 2,
      label: piShiftLabel(visibleShiftStart + visibleShiftSpan / 2),
    },
    { value: visibleShiftEnd, label: piShiftLabel(visibleShiftEnd) },
  ];
  const wedgeMarkers = Array.from(
    { length: Math.floor(visibleShiftEnd / boundUnit) + 1 },
    (_, i) => i * boundUnit
  ).filter((theta) => theta >= visibleShiftStart && theta <= visibleShiftEnd);

  return (
    <section className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="cursor-help rounded-sm text-sm font-medium underline decoration-dotted underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              θ autocorrelation by p row
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            sideOffset={8}
            className="block max-w-sm bg-popover p-3 text-left text-popover-foreground shadow-lg"
          >
            <p className="text-xs leading-relaxed text-muted-foreground">
              Each row is one p band. Green means that row is similar after the θ
              shift; blue means anti-correlation. Stronger color means larger
              absolute correlation; blank cells are near zero. The curve below
              sums absolute correlation over all p rows.
            </p>
          </TooltipContent>
        </Tooltip>
        <span className="font-mono text-xs text-muted-foreground">
          bins {field.width} × {field.height} · peak {field.peak.toFixed(3)}
        </span>
      </div>
      <div className="mb-2 grid gap-2 text-xs text-muted-foreground">
        <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_4.5rem] items-center gap-2">
          <span>Units</span>
          <div className="grid grid-cols-2 gap-2">
            <input
              ref={lowNumberRef}
              type="text"
              defaultValue={svgNumber(indexToUnit(lowIndex))}
              className="h-7 rounded border bg-background px-2 font-mono text-xs text-foreground"
              aria-label="Low bound in 2 pi over 2 n units"
            />
            <input
              ref={highNumberRef}
              type="text"
              defaultValue={svgNumber(indexToUnit(highIndex))}
              className="h-7 rounded border bg-background px-2 font-mono text-xs text-foreground"
              aria-label="High bound in 2 pi over 2 n units"
            />
          </div>
          <span className="text-right font-mono">×2π/2n</span>
        </div>
        <div className="flex items-center justify-end gap-2">
          <span className="font-mono">
            {piShiftLabel(visibleShiftStart)} – {piShiftLabel(visibleShiftEnd)}
          </span>
          <button
            type="button"
            className="rounded border bg-background px-2 py-0.5 font-medium hover:text-foreground"
            onClick={() => {
              const draftLow = draftUnitToIndex(lowNumberRef.current?.value, lowIndex);
              const draftHigh = draftUnitToIndex(highNumberRef.current?.value, highIndex);
              const nextLow = Math.min(
                draftLow,
                draftHigh - minVisibleBins
              );
              const nextHigh = Math.max(draftHigh, nextLow + minVisibleBins);
              syncDraftInputs(nextLow, nextHigh);
              setLowBound(nextLow / field.width);
              setHighBound(nextHigh / field.width);
            }}
          >
            Go
          </button>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label="Theta autocorrelation by p row"
      >
        <rect
          x={margin.left}
          y={margin.top}
          width={plotWidth}
          height={plotHeight}
          fill="var(--muted)"
          fillOpacity={0.25}
        />

        {[-1, 0, 1].map((p) => (
          <g key={`p-${p}`}>
            <line
              x1={margin.left}
              y1={svgNumber(yForP(p))}
              x2={margin.left + plotWidth}
              y2={svgNumber(yForP(p))}
              stroke="var(--border)"
              strokeDasharray={p === 0 ? "4 4" : undefined}
            />
            <text
              x={margin.left - 8}
              y={svgNumber(yForP(p) + 4)}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
            >
              {p}
            </text>
          </g>
        ))}

        {thetaTicks.map((tick) => (
          <g key={`shift-${tick.value}`}>
            <line
              x1={svgNumber(xForShift(tick.value))}
              y1={margin.top}
              x2={svgNumber(xForShift(tick.value))}
              y2={margin.top + plotHeight}
              stroke="var(--border)"
            />
            <text
              x={svgNumber(xForShift(tick.value))}
              y={height - 10}
              textAnchor="middle"
              className="fill-muted-foreground text-[11px]"
            >
              {tick.label}
            </text>
          </g>
        ))}

        {wedgeMarkers.map((theta, index) => (
          <line
            key={`wedge-shift-${index}`}
            x1={svgNumber(xForShift(theta))}
            y1={margin.top}
            x2={svgNumber(xForShift(theta))}
            y2={margin.top + plotHeight}
            stroke={svgRgba(124, 58, 237, index === 0 ? 0.55 : 0.28)}
            strokeDasharray="3 5"
          />
        ))}

        {Array.from({ length: field.height }, (_, y) =>
          Array.from({ length: visibleWidth }, (_, x) => {
            const value = field.values[y * field.width + lowIndex + x];
            if (Math.abs(value) < 0.002) return null;
            const t = Math.min(1, Math.abs(value) / colorMax);
            const color =
              value >= 0
                ? svgRgba(16, 185, 129, 0.12 + 0.88 * Math.sqrt(t))
                : svgRgba(59, 130, 246, 0.12 + 0.88 * Math.sqrt(t));
            return (
              <rect
                key={`${x}-${y}`}
                x={svgNumber(margin.left + x * cellWidth)}
                y={svgNumber(margin.top + (field.height - 1 - y) * cellHeight)}
                width={svgNumber(Math.max(0.75, cellWidth))}
                height={svgNumber(Math.max(0.75, cellHeight))}
                fill={color}
              />
            );
          })
        )}

        {wedgeMarkers.map((theta, index) => (
          <line
            key={`wedge-shift-overlay-${index}`}
            x1={svgNumber(xForShift(theta))}
            y1={margin.top}
            x2={svgNumber(xForShift(theta))}
            y2={margin.top + plotHeight}
            stroke={svgRgba(124, 58, 237, index === 0 ? 0.75 : 0.5)}
            strokeDasharray="3 5"
          />
        ))}

        <text
          x={svgNumber(margin.left + plotWidth / 2)}
          y={height - 1}
          textAnchor="middle"
          className="fill-muted-foreground text-[11px]"
        >
          θ shift
        </text>
        <text
          x={14}
          y={svgNumber(margin.top + plotHeight / 2)}
          textAnchor="middle"
          transform={`rotate(-90 14 ${svgNumber(margin.top + plotHeight / 2)})`}
          className="fill-muted-foreground text-[11px]"
        >
          p
        </text>
      </svg>
      <SummedCorrelationChart
        values={absSumValues}
        maxValue={absSumMax}
        thetaStart={visibleShiftStart}
        thetaMax={visibleShiftEnd}
        thetaTicks={thetaTicks}
        wedgeStep={boundUnit}
      />
    </section>
  );
}

function SummedCorrelationChart({
  values,
  maxValue,
  thetaStart,
  thetaMax,
  thetaTicks,
  wedgeStep,
}: {
  values: number[];
  maxValue: number;
  thetaStart: number;
  thetaMax: number;
  thetaTicks: { value: number; label: string }[];
  wedgeStep: number;
}) {
  const width = 900;
  const height = 180;
  const margin = { top: 12, right: 16, bottom: 30, left: 44 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const valueMax = Math.max(1, maxValue);
  const thetaSpan = Math.max(1e-12, thetaMax - thetaStart);
  const xForTheta = (theta: number) =>
    margin.left + ((theta - thetaStart) / thetaSpan) * plotWidth;
  const xForIndex = (index: number) =>
    margin.left + (index / Math.max(1, values.length - 1)) * plotWidth;
  const yForValue = (value: number) =>
    margin.top + (1 - value / valueMax) * plotHeight;
  const path = values
    .map((value, index) => {
      const command = index === 0 ? "M" : "L";
      return `${command}${svgNumber(xForIndex(index))},${svgNumber(yForValue(value))}`;
    })
    .join(" ");
  const wedgeMarkers = Array.from(
    { length: Math.floor(thetaMax / wedgeStep) + 1 },
    (_, i) => i * wedgeStep
  ).filter((theta) => theta >= thetaStart && theta <= thetaMax);

  return (
    <div className="mt-3 border-t pt-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Sum |correlation|</h3>
        <span className="font-mono text-xs text-muted-foreground">
          max {maxValue.toFixed(3)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label="Sum absolute correlation"
      >
        <rect
          x={margin.left}
          y={margin.top}
          width={plotWidth}
          height={plotHeight}
          fill="var(--muted)"
          fillOpacity={0.25}
        />

        {[0, valueMax / 2, valueMax].map((value) => (
          <g key={`sum-${value}`}>
            <line
              x1={margin.left}
              y1={svgNumber(yForValue(value))}
              x2={margin.left + plotWidth}
              y2={svgNumber(yForValue(value))}
              stroke="var(--border)"
              strokeDasharray={value === 0 ? undefined : "4 4"}
            />
            <text
              x={margin.left - 8}
              y={svgNumber(yForValue(value) + 4)}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
            >
              {value.toFixed(valueMax >= 10 ? 0 : 1)}
            </text>
          </g>
        ))}

        {thetaTicks.map((tick) => (
          <g key={`sum-shift-${tick.value}`}>
            <line
              x1={svgNumber(xForTheta(tick.value))}
              y1={margin.top}
              x2={svgNumber(xForTheta(tick.value))}
              y2={margin.top + plotHeight}
              stroke="var(--border)"
            />
            <text
              x={svgNumber(xForTheta(tick.value))}
              y={height - 10}
              textAnchor="middle"
              className="fill-muted-foreground text-[11px]"
            >
              {tick.label}
            </text>
          </g>
        ))}

        {wedgeMarkers.map((theta, index) => (
          <line
            key={`sum-wedge-${index}`}
            x1={svgNumber(xForTheta(theta))}
            y1={margin.top}
            x2={svgNumber(xForTheta(theta))}
            y2={margin.top + plotHeight}
            stroke={svgRgba(124, 58, 237, index === 0 ? 0.55 : 0.28)}
            strokeDasharray="3 5"
          />
        ))}

        {path ? (
          <path
            d={path}
            fill="none"
            stroke={svgRgba(139, 92, 246, 0.95)}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
          />
        ) : null}

        <text
          x={svgNumber(margin.left + plotWidth / 2)}
          y={height - 1}
          textAnchor="middle"
          className="fill-muted-foreground text-[11px]"
        >
          θ shift
        </text>
      </svg>
    </div>
  );
}

export function AngleWhiteCharts({
  lineSpace,
  seedWedgeOnly,
  setSeedWedgeOnly,
  showSeedWedgeToggle = true,
}: {
  lineSpace: LineSpace;
  seedWedgeOnly: boolean;
  setSeedWedgeOnly: (value: boolean) => void;
  showSeedWedgeToggle?: boolean;
}) {
  const showSeedWedge = lineSpace.hasSeedWedge && seedWedgeOnly;
  const seedThetaMax = lineSpace.thetaMax / lineSpace.n;
  const visibleBins = showSeedWedge
    ? lineSpace.seedWedgeAngleWhiteBins
    : lineSpace.angleWhiteBins;
  const whiteValues = visibleBins.map((bin) => bin.whiteCells);
  const holeValues = visibleBins.map((bin) => bin.holeCount);
  const thetaMax = showSeedWedge ? seedThetaMax : lineSpace.thetaMax;
  const thetaTicks = showSeedWedge
    ? [
        { value: 0, label: "0" },
        { value: thetaMax / 2, label: `π/${2 * lineSpace.n}` },
        { value: thetaMax, label: `π/${lineSpace.n}` },
      ]
    : [
        { value: 0, label: "0" },
        { value: thetaMax / 2, label: "π/2" },
        { value: thetaMax, label: "π" },
      ];

  return (
    <section className="space-y-3">
      {lineSpace.hasSeedWedge && showSeedWedgeToggle ? (
        <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-blue-600"
            checked={seedWedgeOnly}
            onChange={(event) => setSeedWedgeOnly(event.target.checked)}
          />
          <span>Seed wedge only</span>
        </label>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <AngleLineChart
          title="White per angle"
          values={whiteValues}
          maxValue={Math.max(0, ...whiteValues)}
          thetaMax={thetaMax}
          thetaTicks={thetaTicks}
          wedgeStep={lineSpace.hasSeedWedge ? seedThetaMax : null}
          yLabel="white cells"
        />
        <AngleLineChart
          title="Holes per angle"
          values={holeValues}
          maxValue={Math.max(0, ...holeValues)}
          thetaMax={thetaMax}
          thetaTicks={thetaTicks}
          wedgeStep={lineSpace.hasSeedWedge ? seedThetaMax : null}
          yLabel="holes"
        />
      </div>
    </section>
  );
}

function AngleLineChart({
  title,
  values,
  maxValue,
  thetaMax,
  thetaTicks,
  wedgeStep,
  yLabel,
}: {
  title: string;
  values: number[];
  maxValue: number;
  thetaMax: number;
  thetaTicks: { value: number; label: string }[];
  wedgeStep: number | null;
  yLabel: string;
}) {
  const width = 440;
  const height = 220;
  const margin = { top: 14, right: 14, bottom: 30, left: 42 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const valueMax = Math.max(1, maxValue);
  const xForTheta = (theta: number) => margin.left + (theta / thetaMax) * plotWidth;
  const xForIndex = (index: number) =>
    margin.left + ((index + 0.5) / Math.max(1, values.length)) * plotWidth;
  const yForValue = (value: number) =>
    margin.top + (1 - value / valueMax) * plotHeight;
  const path = values
    .map((value, index) => {
      const command = index === 0 ? "M" : "L";
      return `${command}${svgNumber(xForIndex(index))},${svgNumber(yForValue(value))}`;
    })
    .join(" ");
  const wedgeMarkers = wedgeStep
    ? Array.from(
        { length: Math.floor(thetaMax / wedgeStep) + 1 },
        (_, i) => i * wedgeStep
      )
    : [];

  return (
    <section className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{title}</h2>
        <span className="font-mono text-xs text-muted-foreground">
          max {formatUiNumber(maxValue)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={title}
      >
        <rect
          x={margin.left}
          y={margin.top}
          width={plotWidth}
          height={plotHeight}
          fill="var(--muted)"
          fillOpacity={0.25}
        />

        {[0, valueMax / 2, valueMax].map((value) => (
          <g key={`value-${value}`}>
            <line
              x1={margin.left}
              y1={svgNumber(yForValue(value))}
              x2={margin.left + plotWidth}
              y2={svgNumber(yForValue(value))}
              stroke="var(--border)"
              strokeDasharray={value === 0 ? undefined : "4 4"}
            />
            <text
              x={margin.left - 8}
              y={svgNumber(yForValue(value) + 4)}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
            >
              {formatUiNumber(Math.round(value))}
            </text>
          </g>
        ))}

        {thetaTicks.map((tick) => (
          <g key={`theta-${tick.value}`}>
            <line
              x1={svgNumber(xForTheta(tick.value))}
              y1={margin.top}
              x2={svgNumber(xForTheta(tick.value))}
              y2={margin.top + plotHeight}
              stroke="var(--border)"
            />
            <text
              x={svgNumber(xForTheta(tick.value))}
              y={height - 10}
              textAnchor="middle"
              className="fill-muted-foreground text-[11px]"
            >
              {tick.label}
            </text>
          </g>
        ))}

        {wedgeMarkers.map((theta, index) => (
          <line
            key={`wedge-${index}`}
            x1={svgNumber(xForTheta(theta))}
            y1={margin.top}
            x2={svgNumber(xForTheta(theta))}
            y2={margin.top + plotHeight}
            stroke={svgRgba(124, 58, 237, index === 0 ? 0.55 : 0.28)}
            strokeDasharray="3 5"
          />
        ))}

        {path ? (
          <path
            d={path}
            fill="none"
            stroke={svgRgba(59, 130, 246, 0.9)}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
          />
        ) : null}

        {wedgeMarkers.map((theta, index) => (
          <line
            key={`wedge-overlay-${index}`}
            x1={svgNumber(xForTheta(theta))}
            y1={margin.top}
            x2={svgNumber(xForTheta(theta))}
            y2={margin.top + plotHeight}
            stroke={svgRgba(124, 58, 237, index === 0 ? 0.75 : 0.5)}
            strokeDasharray="3 5"
          />
        ))}

        <text
          x={svgNumber(margin.left + plotWidth / 2)}
          y={height - 1}
          textAnchor="middle"
          className="fill-muted-foreground text-[11px]"
        >
          θ
        </text>
        <text
          x={14}
          y={svgNumber(margin.top + plotHeight / 2)}
          textAnchor="middle"
          transform={`rotate(-90 14 ${svgNumber(margin.top + plotHeight / 2)})`}
          className="fill-muted-foreground text-[11px]"
        >
          {yLabel}
        </text>
      </svg>
    </section>
  );
}

function WedgeComparisonView({
  comparison,
  title,
}: {
  comparison: WedgeComparison;
  title: string;
}) {
  return (
    <section className="rounded-lg border bg-card p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{title}</h2>
        <div className="font-mono text-xs text-muted-foreground">
          corr {comparison.correlation.toFixed(3)} · rms{" "}
          {comparison.rms.toFixed(3)}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <WedgeFieldPanel field={comparison.current} label={`n = ${comparison.current.n}`} />
        <WedgeFieldPanel field={comparison.previous} label={`n = ${comparison.previous.n}`} />
        <ResidualPanel residual={comparison.residual} label="Residual" />
      </div>
    </section>
  );
}

function WedgeFieldPanel({ field, label }: { field: WedgeField; label: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <svg viewBox={`0 0 ${field.width} ${field.height}`} className="w-full rounded border">
        <rect width={field.width} height={field.height} fill="var(--muted)" fillOpacity={0.35} />
        {Array.from({ length: field.height }, (_, y) =>
          Array.from({ length: field.width }, (_, x) => {
            const value = field.values[y * field.width + x];
            if (value <= 0) return null;
            const opacity = 0.1 + 0.9 * Math.sqrt(value / Math.max(field.max, 1));
            return (
              <rect
                key={`${x}-${y}`}
                x={x}
                y={field.height - 1 - y}
                width={1}
                height={1}
                fill={svgRgba(249, 115, 22, opacity)}
              />
            );
          })
        )}
      </svg>
    </div>
  );
}

function ResidualPanel({
  residual,
  label,
}: {
  residual: WedgeResidual;
  label: string;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <svg
        viewBox={`0 0 ${residual.width} ${residual.height}`}
        className="w-full rounded border"
      >
        <rect
          width={residual.width}
          height={residual.height}
          fill="var(--muted)"
          fillOpacity={0.35}
        />
        {Array.from({ length: residual.height }, (_, y) =>
          Array.from({ length: residual.width }, (_, x) => {
            const value = residual.values[y * residual.width + x];
            if (value === 0) return null;
            const t = Math.min(1, Math.abs(value) / Math.max(residual.maxAbs, 1e-9));
            const color =
              value > 0
                ? svgRgba(249, 115, 22, 0.12 + 0.88 * Math.sqrt(t))
                : svgRgba(59, 130, 246, 0.12 + 0.88 * Math.sqrt(t));
            return (
              <rect
                key={`${x}-${y}`}
                x={x}
                y={residual.height - 1 - y}
                width={1}
                height={1}
                fill={color}
              />
            );
          })
        )}
      </svg>
    </div>
  );
}

function RandomnessView({
  comparison,
}: {
  comparison: RandomnessComparison;
}) {
  const rows = [
    comparison.zaksRaw,
    comparison.randomRaw,
    ...(comparison.williams ? [comparison.williams] : []),
  ];
  return (
    <section className="rounded-lg border bg-card p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Randomness</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
              <MetricHeader
                label="Sequence"
                align="left"
                description="The ordered sequence being tested on the full circle: Zaks uses σₙ(i), random is a uniform shuffle of the same size, and Williams uses σ_W(i)."
                link="https://en.wikipedia.org/wiki/Random_permutation"
                linkLabel="Random permutation"
              />
              <MetricHeader
                label="Serial MI"
                description="Mutual information between binned consecutive values. Near 0 means f(i) gives little information about f(i+1); larger values mean local predictability."
                formula="I(f(i); f(i+1))"
                link="https://en.wikipedia.org/wiki/Mutual_information"
                linkLabel="Mutual information"
              />
              <MetricHeader
                label="Top 10 jumps"
                description="Share of signed jumps carried by the 10 most frequent values. A random-like sequence spreads jump mass thinly, so this number should be small."
                formula="Δ = f(i+1) − f(i)"
                link="https://en.wikipedia.org/wiki/Frequency_distribution"
                linkLabel="Frequency distribution"
              />
              <MetricHeader
                label="Top 50 jumps"
                description="Same as Top 10 jumps, but using the 50 most frequent jump values. It shows whether a medium-size jump vocabulary dominates the sequence."
                formula="mass(top 50 Δ)"
                link="https://en.wikipedia.org/wiki/Frequency_distribution"
                linkLabel="Frequency distribution"
              />
              <MetricHeader
                label="Jump evenness"
                description="Effective entropy of the jump distribution divided by the number of distinct jumps. Near 100% means the observed jump values are used evenly; it does not measure how many different jumps exist."
                formula="exp(H(Δ)) / distinct(Δ)"
                link="https://en.wikipedia.org/wiki/Entropy_(information_theory)"
                linkLabel="Information entropy"
              />
              <MetricHeader
                label="Distinct jumps"
                description="Number of different signed jump values observed. This measures variety only; it does not say whether those jumps are evenly used."
                formula="|{Δ}|"
                link="https://en.wikipedia.org/wiki/Support_(mathematics)"
                linkLabel="Support of a distribution"
              />
              <MetricHeader
                label="Rare mass"
                description={`Share of jumps left after removing the ${STRUCTURED_JUMP_COUNT} most frequent jump values. Low values mean the visible jump vocabulary explains almost everything.`}
                formula={`mass(Δ outside top ${STRUCTURED_JUMP_COUNT})`}
                link="https://en.wikipedia.org/wiki/Residual_(numerical_analysis)"
                linkLabel="Residual"
              />
              <MetricHeader
                label="Rare evenness"
                description="Evenness of the remaining jump values after the dominant jumps are removed. This only describes the residual, not how large it is."
                formula="exp(H(residual Δ)) / distinct(residual Δ)"
                link="https://en.wikipedia.org/wiki/Entropy_(information_theory)"
                linkLabel="Information entropy"
              />
              <MetricHeader
                label="Rare top 10"
                description="Within the residual only, share carried by its 10 most frequent jumps. Lower is more noise-like among the leftover jumps."
                formula="mass(top 10 residual Δ)"
                link="https://en.wikipedia.org/wiki/Frequency_distribution"
                linkLabel="Frequency distribution"
              />
              <MetricHeader
                label="Rare gap CV"
                description="Coefficient of variation of gaps between rare jump positions. Near 0 means regular spacing; around 1 is Poisson-like; larger means clustering and long deserts."
                formula="std(gap) / mean(gap)"
                link="https://en.wikipedia.org/wiki/Coefficient_of_variation"
                linkLabel="Coefficient of variation"
              />
              <MetricHeader
                label="Rare max run"
                description="Longest consecutive run of rare jumps after the dominant jump values are removed. Larger values indicate bursts of local surprises."
                formula="max consecutive rare Δ"
                link="https://en.wikipedia.org/wiki/Runs_test"
                linkLabel="Runs test"
              />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.kind} className="border-b border-border/40">
                <td className="px-2 py-1.5 font-medium">{row.label}</td>
                <td className="px-2 py-1.5 text-right font-mono">
                  {row.serialMiBits.toFixed(3)} bits
                </td>
                <td className="px-2 py-1.5 text-right font-mono">
                  {percentLabel(row.jumpTop10)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono">
                  {percentLabel(row.jumpTop50)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono">
                  {percentLabel(row.jumpEffectiveRatio)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono">
                  {formatUiNumber(row.jumpDistinct)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono">
                  {percentLabel(row.rareMass)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono">
                  {percentLabel(row.rareEvenness)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono">
                  {percentLabel(row.rareTop10)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono">
                  {row.rareGapCv === null ? "—" : row.rareGapCv.toFixed(2)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono">
                  {formatUiNumber(row.rareMaxRun)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        These columns test local order: lower serial MI and lower top-jump mass
        are more random-like.
        {!comparison.williams
          ? ` Williams is omitted above n = ${WILLIAMS_RANDOMNESS_MAX_N}.`
          : null}
      </p>
    </section>
  );
}

function MetricHeader({
  label,
  description,
  formula,
  link,
  linkLabel,
  align = "right",
}: {
  label: string;
  description: string;
  formula?: string;
  link: string;
  linkLabel: string;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-2 py-1.5 font-medium ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="cursor-help rounded-sm underline decoration-dotted underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {label}
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          sideOffset={8}
          className="block max-w-sm space-y-2 bg-popover p-3 text-left text-popover-foreground shadow-lg"
        >
          <div className="font-medium">{label}</div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
          {formula ? (
            <div className="rounded bg-muted px-2 py-1 font-mono text-[11px] text-foreground">
              {formula}
            </div>
          ) : null}
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex text-xs font-medium text-primary underline underline-offset-4"
          >
            Learn more: {linkLabel}
          </a>
        </TooltipContent>
      </Tooltip>
    </th>
  );
}

function SigmaTable({ analysis }: { analysis: Analysis }) {
  const { rows, blockSize, deltaPeriod, shownRows, total } = analysis;
  const period = deltaPeriod ?? total;
  return (
    <div className="rounded-lg border">
      {shownRows < total && (
        <div className="border-b px-3 py-2 text-xs text-muted-foreground">
          Showing first {formatUiNumber(shownRows)} rows of {formatUiNumber(total)}.
        </div>
      )}
      <div className="max-h-[78vh] overflow-auto">
        <table className="w-full border-collapse font-mono text-sm tabular-nums">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 font-medium">i</th>
              <th className="px-3 py-2 font-medium">perm(i)</th>
              <th className="px-3 py-2 font-medium">σ(i)</th>
              <th className="px-3 py-2 font-medium">Δ = σ(i) − σ(i−1) mod n!</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const blockEven = Math.floor(row.i / blockSize) % 2 === 0;
              const motifStart = row.i % period === 0;
              return (
                <tr
                  key={row.i}
                  className={`border-b border-border/40 ${
                    blockEven ? "" : "bg-muted/40"
                  }`}
                >
                  <td className="px-3 py-1 text-muted-foreground">{row.i}</td>
                  <td className="px-3 py-1">[{row.perm}]</td>
                  <td className="px-3 py-1">{row.sigma}</td>
                  <td className="px-3 py-1">
                    <span
                      className={
                        motifStart && row.i >= period
                          ? "rounded bg-amber-500/15 px-1 text-amber-700 dark:text-amber-300"
                          : ""
                      }
                    >
                      {row.delta}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function percentLabel(value: number): string {
  return `${(100 * value).toFixed(2)}%`;
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono text-xs">
        {typeof value === "number" ? formatUiNumber(value) : value}
      </dd>
    </div>
  );
}
