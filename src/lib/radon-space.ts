import { factorial, zaksSigma, type PancakeGraph } from "./pancake";

export const SEED_WEDGE_PSI_BINS = 360;
export const TWO_WEDGE_PSI_BINS = 2 * SEED_WEDGE_PSI_BINS;
export const AUTOCORR_THETA_BINS = 1024;
export const TWO_WEDGE_AUTOCORR_THETA_BINS = 4096;
export const AUTOCORR_P_BINS = 128;

export interface LineSpaceBin {
  x: number;
  y: number;
  count: number;
}

export interface AngleWhiteBin {
  x: number;
  whiteCells: number;
  holeCount: number;
}

export interface AngleWhiteStats {
  bins: AngleWhiteBin[];
  maxWhiteCells: number;
  maxHoleCount: number;
}

export interface AutocorrelationField {
  width: number;
  height: number;
  values: Float32Array;
  maxAbs: number;
  peak: number;
}

export interface LineSpace {
  n: number;
  vertexCount: number;
  hasSeedWedge: boolean;
  thetaMax: number;
  psiBins: number;
  pBins: number;
  bins: LineSpaceBin[];
  angleWhiteBins: AngleWhiteBin[];
  seedWedgeAngleWhiteBins: AngleWhiteBin[];
  thetaAutocorrelation: AutocorrelationField;
  twoWedgeAutocorrelation: AutocorrelationField;
  maxCount: number;
  maxWhiteCells: number;
  maxHoleCount: number;
  totalEdgeCount: number;
  seedEdgeCount: number;
  usedEdgeCount: number;
}

function angleWhiteStats(
  counts: Uint32Array,
  psiBins: number,
  pBins: number
): AngleWhiteStats {
  const bins: AngleWhiteBin[] = [];
  let maxWhiteCells = 0;
  let maxHoleCount = 0;
  for (let x = 0; x < psiBins; x++) {
    let whiteCells = 0;
    let holeCount = 0;
    let inHole = false;
    for (let y = 0; y < pBins; y++) {
      const isWhite = counts[y * psiBins + x] === 0;
      if (isWhite) {
        whiteCells++;
        if (!inHole) {
          holeCount++;
          inHole = true;
        }
      } else {
        inHole = false;
      }
    }
    if (whiteCells > maxWhiteCells) maxWhiteCells = whiteCells;
    if (holeCount > maxHoleCount) maxHoleCount = holeCount;
    bins.push({ x, whiteCells, holeCount });
  }
  return { bins, maxWhiteCells, maxHoleCount };
}

function bitReverse(value: number, bits: number): number {
  let reversed = 0;
  for (let i = 0; i < bits; i++) {
    reversed = (reversed << 1) | (value & 1);
    value >>= 1;
  }
  return reversed;
}

function fftStrided(
  real: Float64Array,
  imag: Float64Array,
  offset: number,
  stride: number,
  length: number,
  inverse: boolean
) {
  const bits = Math.log2(length);
  if (!Number.isInteger(bits)) {
    throw new Error("FFT length must be a power of two.");
  }

  for (let i = 0; i < length; i++) {
    const j = bitReverse(i, bits);
    if (j <= i) continue;
    const a = offset + i * stride;
    const b = offset + j * stride;
    const realValue = real[a];
    const imagValue = imag[a];
    real[a] = real[b];
    imag[a] = imag[b];
    real[b] = realValue;
    imag[b] = imagValue;
  }

  for (let size = 2; size <= length; size *= 2) {
    const half = size / 2;
    const angleSign = inverse ? 1 : -1;
    const angleStep = (angleSign * 2 * Math.PI) / size;
    for (let start = 0; start < length; start += size) {
      for (let j = 0; j < half; j++) {
        const angle = angleStep * j;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);
        const even = offset + (start + j) * stride;
        const odd = offset + (start + j + half) * stride;
        const tr = wr * real[odd] - wi * imag[odd];
        const ti = wr * imag[odd] + wi * real[odd];
        real[odd] = real[even] - tr;
        imag[odd] = imag[even] - ti;
        real[even] += tr;
        imag[even] += ti;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < length; i++) {
      const index = offset + i * stride;
      real[index] /= length;
      imag[index] /= length;
    }
  }
}

function circularThetaAutocorrelationByRow(
  counts: Uint32Array,
  width: number,
  height: number
): AutocorrelationField {
  const values = new Float32Array(width * height);
  let maxAbs = 0;
  let peak = -1;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    const real = new Float64Array(width);
    const imag = new Float64Array(width);
    let mean = 0;
    for (let x = 0; x < width; x++) {
      const value = Math.log1p(counts[rowOffset + x]);
      real[x] = value;
      mean += value;
    }
    mean /= width;

    let energy = 0;
    for (let x = 0; x < width; x++) {
      real[x] -= mean;
      energy += real[x] * real[x];
    }
    if (energy <= 0) continue;

    fftStrided(real, imag, 0, 1, width, false);
    for (let x = 0; x < width; x++) {
      const magnitudeSquared = real[x] * real[x] + imag[x] * imag[x];
      real[x] = magnitudeSquared;
      imag[x] = 0;
    }
    fftStrided(real, imag, 0, 1, width, true);

    for (let shift = 0; shift < width; shift++) {
      const value = real[shift] / energy;
      values[rowOffset + shift] = value;
      const abs = Math.abs(value);
      if (abs > maxAbs) maxAbs = abs;
      if (shift !== 0 && value > peak) peak = value;
    }
  }

  return { width, height, values, maxAbs, peak: peak < -0.5 ? 0 : peak };
}

export function buildLineSpaceFromEdges({
  n,
  vertexCount,
  totalEdgeCount,
  seedEdgeCount,
  hasSeedWedge,
  emitEdges,
}: {
  n: number;
  vertexCount: number;
  totalEdgeCount: number;
  seedEdgeCount: number;
  hasSeedWedge: boolean;
  emitEdges: (
    addEdge: (
      a: number,
      b: number,
      includeFull: boolean,
      includeSeedWedge: boolean
    ) => void
  ) => void;
}): LineSpace {
  const total = vertexCount;
  const psiBins = 180;
  const pBins = 120;
  const thetaMax = Math.PI;
  const seedWedgeThetaMax = thetaMax / n;
  const counts = new Uint32Array(psiBins * pBins);
  const seedWedgeCounts = new Uint32Array(SEED_WEDGE_PSI_BINS * pBins);
  const twoWedgeCounts = new Uint32Array(TWO_WEDGE_PSI_BINS * pBins);
  const autocorrCounts = new Uint32Array(AUTOCORR_THETA_BINS * AUTOCORR_P_BINS);
  const twoWedgeAutocorrCounts = new Uint32Array(
    TWO_WEDGE_AUTOCORR_THETA_BINS * AUTOCORR_P_BINS
  );
  let usedEdgeCount = 0;
  let maxCount = 0;

  const addLine = (
    aIndex: number,
    bIndex: number,
    includeFull: boolean,
    includeSeedWedge: boolean
  ) => {
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

    const y = Math.min(
      pBins - 1,
      Math.max(0, Math.floor(((p + 1) / 2) * pBins))
    );

    if (includeFull) {
      const x = Math.min(psiBins - 1, Math.floor((psi / thetaMax) * psiBins));
      const index = y * psiBins + x;
      const count = counts[index] + 1;
      counts[index] = count;
      if (count > maxCount) maxCount = count;

      const autocorrX = Math.min(
        AUTOCORR_THETA_BINS - 1,
        Math.floor((psi / thetaMax) * AUTOCORR_THETA_BINS)
      );
      const autocorrY = Math.min(
        AUTOCORR_P_BINS - 1,
        Math.max(0, Math.floor(((p + 1) / 2) * AUTOCORR_P_BINS))
      );
      autocorrCounts[autocorrY * AUTOCORR_THETA_BINS + autocorrX]++;

      usedEdgeCount++;
    }

    if (includeSeedWedge) {
      if (psi <= seedWedgeThetaMax) {
        const seedX = Math.min(
          SEED_WEDGE_PSI_BINS - 1,
          Math.floor((psi / seedWedgeThetaMax) * SEED_WEDGE_PSI_BINS)
        );
        seedWedgeCounts[y * SEED_WEDGE_PSI_BINS + seedX]++;
      }

      const twoWedgeThetaMax = 2 * seedWedgeThetaMax;
      if (psi <= twoWedgeThetaMax) {
        const twoWedgeX = Math.min(
          TWO_WEDGE_PSI_BINS - 1,
          Math.floor((psi / twoWedgeThetaMax) * TWO_WEDGE_PSI_BINS)
        );
        twoWedgeCounts[y * TWO_WEDGE_PSI_BINS + twoWedgeX]++;

        const twoWedgeAutocorrX = Math.min(
          TWO_WEDGE_AUTOCORR_THETA_BINS - 1,
          Math.floor((psi / twoWedgeThetaMax) * TWO_WEDGE_AUTOCORR_THETA_BINS)
        );
        const twoWedgeAutocorrY = Math.min(
          AUTOCORR_P_BINS - 1,
          Math.max(0, Math.floor(((p + 1) / 2) * AUTOCORR_P_BINS))
        );
        twoWedgeAutocorrCounts[
          twoWedgeAutocorrY * TWO_WEDGE_AUTOCORR_THETA_BINS + twoWedgeAutocorrX
        ]++;
      }
    }
  };

  const addEdge = (
    a: number,
    b: number,
    includeFull: boolean,
    includeSeedWedge: boolean
  ) => {
    if (a < b) addLine(a, b, includeFull, includeSeedWedge);
  };

  emitEdges(addEdge);

  const fullWhiteStats = angleWhiteStats(counts, psiBins, pBins);
  const seedWedgeWhiteStats = angleWhiteStats(
    seedWedgeCounts,
    SEED_WEDGE_PSI_BINS,
    pBins
  );
  const thetaAutocorrelation = circularThetaAutocorrelationByRow(
    autocorrCounts,
    AUTOCORR_THETA_BINS,
    AUTOCORR_P_BINS
  );
  const twoWedgeAutocorrelation = circularThetaAutocorrelationByRow(
    twoWedgeAutocorrCounts,
    TWO_WEDGE_AUTOCORR_THETA_BINS,
    AUTOCORR_P_BINS
  );

  const bins: LineSpaceBin[] = [];
  for (let y = 0; y < pBins; y++) {
    for (let x = 0; x < psiBins; x++) {
      const count = counts[y * psiBins + x];
      if (count > 0) bins.push({ x, y, count });
    }
  }

  return {
    n,
    vertexCount,
    hasSeedWedge,
    thetaMax,
    psiBins,
    pBins,
    bins,
    angleWhiteBins: fullWhiteStats.bins,
    seedWedgeAngleWhiteBins: seedWedgeWhiteStats.bins,
    thetaAutocorrelation,
    twoWedgeAutocorrelation,
    maxCount,
    maxWhiteCells: fullWhiteStats.maxWhiteCells,
    maxHoleCount: fullWhiteStats.maxHoleCount,
    totalEdgeCount,
    seedEdgeCount,
    usedEdgeCount,
  };
}

export function buildPancakeGraphLineSpace(graph: PancakeGraph): LineSpace {
  const n = graph.n;
  const total = graph.path.length || factorial(n);
  const blockSize = factorial(n - 1);
  const hasSeedWedge = graph.preset === "pancake-zaks";
  const totalEdgeCount =
    graph.preset === "pancake-zaks"
      ? total / 2
      : graph.preset === "pancake-williams"
        ? (total * (n - 1)) / 2
        : graph.edges.length / 3;
  const wedgeVertexCount = Math.floor(blockSize / 2);
  const seedEdgeCount = hasSeedWedge ? wedgeVertexCount : totalEdgeCount;

  return buildLineSpaceFromEdges({
    n,
    vertexCount: total,
    totalEdgeCount,
    seedEdgeCount,
    hasSeedWedge,
    emitEdges(addEdge) {
      if (graph.preset === "pancake-zaks") {
        for (let i = 0; i < total; i++) {
          addEdge(i, zaksSigma(n, i), true, false);
        }

        for (let i = 0; i < wedgeVertexCount; i++) {
          const j = zaksSigma(n, i);
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
        return;
      }

      for (let t = 0; t < graph.edges.length; t += 3) {
        addEdge(graph.edges[t], graph.edges[t + 1], true, false);
      }
    },
  });
}
