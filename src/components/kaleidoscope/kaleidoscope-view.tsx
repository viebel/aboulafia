"use client";

import { Button } from "@/components/ui/button";
import {
  readEnumParam,
  readNonNegIntParam,
  readNumberParam,
  writeUrlParams,
} from "@/lib/url-state";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  type PointerEvent,
  type WheelEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

const M_MIN = 3;
const M_DEFAULT = 5;
const POINTS_MIN = 24;
const POINTS_DEFAULT = 120;
const DRAW_THRESHOLD = 10_000;
const SIZE_MIN = 0.05;
const SIZE_STEP = 0.05;
const SIZE_DEFAULT = 1;
const MIN_ZOOM = 0.5;
const ABSOLUTE_MIN_ZOOM = 0.05;
const ZOOM_FACTOR = 1.5;
const VIEW_PARAM_PRECISION = 3;
const WHEEL_LINE_HEIGHT = 16;
const WHEEL_DELTA_LINE = 1;
const WHEEL_DELTA_PAGE = 2;
const GROWING_SURFACE_BASE_M = M_DEFAULT;
const SURFACE_MARGIN = 50;

const SVG_SIZE = 700;
const CX = 350;
const CY = 350;
const R = 300;
const CHAMBER_ONLY_DEG = 60;
const FLAT_X = 120;
const FLAT_Y = 90;
const FLAT_W = 460;
const FLAT_H = 520;
const POLAR_R_MIN = 0.03;
const POLAR_R_MAX = 0.3;
const POLAR_RADIAL_BINS = 18;
const POLAR_MIN_ANGULAR_BINS = 256;
const POLAR_RADIAL_MODES = 8;
const POLAR_HARMONICS = 7;
const POLAR_HEATMAP_MAX_ANGULAR_MODE = 112;
const RADIUS_BANDS_MIN = 2;
const RADIUS_BANDS_MAX = 1000;
const RADIUS_BANDS_DEFAULT = 4;

const COLOR = {
  ring: "var(--border)",
  mirror: "#0891b2",
  guide: "#cbd5e1",
} as const;

interface MotifPoint {
  id: string;
  theta: number;
  radius: number;
}

interface RenderState {
  m: number;
  pointCount: number;
  pointSize: number;
  chamberOnly: boolean;
  incrementalView: boolean;
  incrementalChambers: number;
  showAxes: boolean;
  flatChamber: boolean;
  circleChamber: boolean;
  solidBlack: boolean;
  hashKind: HashKind;
  motifKind: MotifKind;
  copyMode: CopyMode;
  surfaceMode: SurfaceMode;
  zoom: number;
  pan: { x: number; y: number };
}

interface PolarSpectrumCell {
  radialMode: number;
  angularMode: number;
  value: number;
  intensity: number;
}

interface HarmonicEntry {
  harmonic: number;
  angularMode: number;
  value: number;
  intensity: number;
  energy: number;
}

interface RadiusHarmonicProfile {
  rMin: number;
  rMax: number;
  wedgePoints: number;
  samples: number;
  totalEnergy: number;
  totalIntensity: number;
  shownEnergy: number;
  shownIntensity: number;
  harmonics: HarmonicEntry[];
}

interface PolarSpectrum {
  scope: "full" | "circle" | "wedge";
  cells: PolarSpectrumCell[];
  angularModes: number[];
  radialModes: number[];
  radiusBands: number;
  angularBins: number;
  maxAngularMode: number;
  heatmapMaxAngularMode: number;
  totalEnergy: number;
  maxValue: number;
  samples: number;
  targetModes: { mode: number; value: number }[];
  topAngularModes: { mode: number; value: number }[];
  harmonicProfile: HarmonicEntry[];
  radiusProfiles: RadiusHarmonicProfile[];
}

const HASH_KINDS = [
  "sine",
  "cosine",
  "avalanche",
  "wang",
  "xorshift",
  "lcg",
  "mulberry",
  "splitmix",
  "golden",
  "halton",
] as const;
type HashKind = (typeof HASH_KINDS)[number];
const MOTIF_KINDS = ["random", "square", "circle", "pentagon", "hexagon"] as const;
type MotifKind = (typeof MOTIF_KINDS)[number];
const COPY_MODES = ["coxeter", "rotation"] as const;
type CopyMode = (typeof COPY_MODES)[number];
const SURFACE_MODES = ["fixed", "growing"] as const;
type SurfaceMode = (typeof SURFACE_MODES)[number];
type FundamentalView = "wedge" | "incremental" | "flat" | "circle";

const HASH_LABELS: Record<HashKind, string> = {
  sine: "Sine hash",
  cosine: "Cosine hash",
  avalanche: "Avalanche hash",
  wang: "Wang hash",
  xorshift: "Xorshift hash",
  lcg: "LCG hash",
  mulberry: "Mulberry hash",
  splitmix: "Splitmix hash",
  golden: "Golden hash",
  halton: "Halton hash",
};

const MOTIF_LABELS: Record<MotifKind, string> = {
  random: "Random",
  square: "Square",
  circle: "Circle",
  pentagon: "Pentagon",
  hexagon: "Hexagon",
};

const SURFACE_LABELS: Record<SurfaceMode, string> = {
  fixed: "Fixed",
  growing: "Growing",
};

const HASH_NOTES: Record<HashKind, string> = {
  sine:
    "Fractional trigonometric noise: fast and deterministic, but not designed as a statistical generator.",
  cosine:
    "A second trigonometric hash with different frequencies; useful for comparing phase artifacts.",
  avalanche:
    "Integer multiplication plus xor shifts; a small input change should flip many output bits.",
  wang:
    "Thomas Wang-style integer mixing; compact 32-bit scrambling for nearby integer keys.",
  xorshift:
    "A small-state generator built from xor and bit shifts; fast, deterministic, and non-cryptographic.",
  lcg:
    "A linear congruential generator; simple recurrence, fast, but visibly structured with some parameters.",
  mulberry:
    "Mulberry32-style pseudo-random generation; tiny state, fast mixing, non-cryptographic.",
  splitmix:
    "SplitMix-style integer mixing; strong avalanche behavior for sequential integer seeds.",
  golden:
    "Irrational rotation by golden-ratio-related constants; low-discrepancy rather than random.",
  halton:
    "Radical-inverse low-discrepancy sequence; fills the domain more evenly than random sampling.",
};

const HASH_REFERENCES: Partial<Record<HashKind, { label: string; url: string }>> = {
  avalanche: {
    label: "Avalanche effect",
    url: "https://en.wikipedia.org/wiki/Avalanche_effect",
  },
  xorshift: {
    label: "Xorshift",
    url: "https://en.wikipedia.org/wiki/Xorshift",
  },
  lcg: {
    label: "Linear congruential generator",
    url: "https://en.wikipedia.org/wiki/Linear_congruential_generator",
  },
  mulberry: {
    label: "Pseudorandom number generator",
    url: "https://en.wikipedia.org/wiki/Pseudorandom_number_generator",
  },
  golden: {
    label: "Low-discrepancy sequence",
    url: "https://en.wikipedia.org/wiki/Low-discrepancy_sequence",
  },
  halton: {
    label: "Halton sequence",
    url: "https://en.wikipedia.org/wiki/Halton_sequence",
  },
};

function sineUnit(index: number, salt: number): number {
  const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

function cosineUnit(index: number, salt: number): number {
  const x = Math.cos(index * 269.5 + salt * 183.3) * 24634.6345;
  return x - Math.floor(x);
}

function avalancheUnit(index: number, salt: number): number {
  let x = Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b);
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 0x100000000;
}

function wangUnit(index: number, salt: number): number {
  let x = ((index + 1) ^ Math.imul(salt + 1, 0x45d9f3b)) >>> 0;
  x = (x ^ 61) ^ (x >>> 16);
  x = Math.imul(x, 9);
  x ^= x >>> 4;
  x = Math.imul(x, 0x27d4eb2d);
  x ^= x >>> 15;
  return (x >>> 0) / 0x100000000;
}

function xorshiftUnit(index: number, salt: number): number {
  let x = (Math.imul(index + 1, 0x9e3779b9) + Math.imul(salt, 0x7f4a7c15)) >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return (x >>> 0) / 0x100000000;
}

function lcgUnit(index: number, salt: number): number {
  const x =
    (Math.imul(1664525, index + 1) + Math.imul(1013904223, salt + 1)) >>> 0;
  return x / 0x100000000;
}

function mulberryUnit(index: number, salt: number): number {
  let x = (index + 1 + Math.imul(salt + 1, 0x6d2b79f5)) >>> 0;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return ((x ^ (x >>> 14)) >>> 0) / 0x100000000;
}

function splitmixUnit(index: number, salt: number): number {
  let x = (index + 1 + Math.imul(salt + 1, 0x9e3779b9)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 0x100000000;
}

function goldenUnit(index: number, salt: number): number {
  const x =
    (index + 1) *
    (0.6180339887498949 + salt * 0.41421356237309515);
  return x - Math.floor(x);
}

function radicalInverse(index: number, base: number): number {
  let n = index;
  let f = 1 / base;
  let result = 0;
  while (n > 0) {
    result += f * (n % base);
    n = Math.floor(n / base);
    f /= base;
  }
  return result;
}

function haltonUnit(index: number, salt: number): number {
  return radicalInverse(index + 1, salt === 1 ? 2 : 3);
}

function hashUnit(index: number, salt: number, kind: HashKind): number {
  switch (kind) {
    case "sine":
      return sineUnit(index, salt);
    case "cosine":
      return cosineUnit(index, salt);
    case "avalanche":
      return avalancheUnit(index, salt);
    case "wang":
      return wangUnit(index, salt);
    case "xorshift":
      return xorshiftUnit(index, salt);
    case "lcg":
      return lcgUnit(index, salt);
    case "mulberry":
      return mulberryUnit(index, salt);
    case "splitmix":
      return splitmixUnit(index, salt);
    case "golden":
      return goldenUnit(index, salt);
    case "halton":
      return haltonUnit(index, salt);
  }
}

function buildRandomMotif(count: number, hashKind: HashKind): MotifPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `gem-${i}`,
    theta: hashUnit(i, 1, hashKind),
    radius: Math.sqrt(hashUnit(i, 2, hashKind)),
  }));
}

function polygonPoint(sides: number, t: number): [number, number] {
  const side = Math.min(sides - 1, Math.floor(t * sides));
  const sideT = t * sides - side;
  const a0 = -Math.PI / 2 + (2 * Math.PI * side) / sides;
  const a1 = -Math.PI / 2 + (2 * Math.PI * (side + 1)) / sides;
  const x0 = Math.cos(a0);
  const y0 = Math.sin(a0);
  const x1 = Math.cos(a1);
  const y1 = Math.sin(a1);

  return [x0 + (x1 - x0) * sideT, y0 + (y1 - y0) * sideT];
}

function patternUnitPoint(kind: Exclude<MotifKind, "random">, t: number): [number, number] {
  if (kind === "circle") {
    const angle = -Math.PI / 2 + 2 * Math.PI * t;
    return [Math.cos(angle), Math.sin(angle)];
  }

  return polygonPoint(kind === "square" ? 4 : kind === "pentagon" ? 5 : 6, t);
}

function buildPatternMotif(
  count: number,
  m: number,
  hashKind: HashKind,
  motifKind: MotifKind,
  chamberDeg: number,
  startDeg: number
): MotifPoint[] {
  if (motifKind === "random") return buildRandomMotif(count, hashKind);

  const halfAngle = (chamberDeg * Math.PI) / 360;
  const centerRadius = 0.55;
  const tangentLimit = centerRadius * Math.sin(halfAngle) * 0.72;
  const radialLimit = Math.min(centerRadius - 0.08, 0.92 - centerRadius) * 0.72;
  const scale = Math.max(0.01, Math.min(tangentLimit, radialLimit));
  const centerAngle = ((startDeg + chamberDeg / 2) * Math.PI) / 180;
  const centerX = centerRadius * Math.cos(centerAngle);
  const centerY = centerRadius * Math.sin(centerAngle);
  const tangentX = -Math.sin(centerAngle);
  const tangentY = Math.cos(centerAngle);
  const radialX = Math.cos(centerAngle);
  const radialY = Math.sin(centerAngle);

  return Array.from({ length: count }, (_, i) => {
    const t = (i + hashUnit(i, 3, hashKind) * 0.08) / count;
    const [patternX, patternY] = patternUnitPoint(motifKind, t - Math.floor(t));
    const x = centerX + scale * (patternX * tangentX + patternY * radialX);
    const y = centerY + scale * (patternX * tangentY + patternY * radialY);
    const radius = Math.min(0.98, Math.max(0.02, Math.hypot(x, y)));
    const angle = normalizedDeg((Math.atan2(y, x) * 180) / Math.PI);
    const theta = Math.min(
      0.98,
      Math.max(0.02, normalizedDeg(angle - startDeg) / chamberDeg)
    );

    return {
      id: `${motifKind}-${m}-${i}`,
      theta,
      radius,
    };
  });
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function polar(angleDeg: number, radius: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  return [round(CX + radius * Math.cos(a)), round(CY + radius * Math.sin(a))];
}

function surfaceRadius(m: number, mode: SurfaceMode): number {
  return mode === "growing" ? R * Math.sqrt(m / GROWING_SURFACE_BASE_M) : R;
}

function surfaceMinZoom(radius: number): number {
  return Math.min(
    MIN_ZOOM,
    Math.max(ABSOLUTE_MIN_ZOOM, SVG_SIZE / (2 * (radius + SURFACE_MARGIN)))
  );
}

function chamberPoint(
  point: MotifPoint,
  chamber: number,
  chamberDeg: number,
  startDeg: number,
  radius: number
): [number, number] {
  const theta = point.theta * chamberDeg;
  const local =
    chamber % 2 === 0
      ? chamber * chamberDeg + theta
      : (chamber + 1) * chamberDeg - theta;
  return polar(startDeg + local, point.radius * radius);
}

function rotatedChamberPoint(
  point: MotifPoint,
  chamber: number,
  chamberDeg: number,
  startDeg: number,
  radius: number
): [number, number] {
  return polar(
    startDeg + chamber * chamberDeg + point.theta * chamberDeg,
    point.radius * radius
  );
}

function flatPoint(point: MotifPoint): [number, number] {
  return [
    round(FLAT_X + point.theta * FLAT_W),
    round(FLAT_Y + (1 - point.radius) * FLAT_H),
  ];
}

function circleChamberPoint(point: MotifPoint, radius: number): [number, number] {
  return polar(-90 + point.theta * 360, point.radius * radius);
}

function fmtAngle(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function viewParam(value: number): string {
  return Number(value.toFixed(VIEW_PARAM_PRECISION)).toString();
}

function fmtSpectrum(value: number): string {
  if (value === 0) return "0";
  if (value < 0.001) return value.toExponential(1);
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function fmtPercent(part: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function stylePercent(value: number): string {
  return `${Number(value.toFixed(4))}%`;
}

function fmtInteger(value: number): string {
  return Math.round(value).toString();
}

function nextMultiple(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

function polarAngularBins(m: number): number {
  const chamberMultiple = 2 * m;
  const requiredBins = Math.max(
    POLAR_MIN_ANGULAR_BINS,
    2 * POLAR_HARMONICS * m + 1
  );
  return nextMultiple(requiredBins, chamberMultiple);
}

function harmonicUnit(scope: PolarSpectrum["scope"]): string {
  return scope === "wedge" ? "w" : "m";
}

function normalizedDeg(value: number): number {
  return ((value % 360) + 360) % 360;
}

function heatColor(intensity: number): string {
  const alpha = 0.08 + 0.82 * Math.min(1, Math.max(0, intensity));
  return `rgba(8, 145, 178, ${alpha.toFixed(6)})`;
}

function niceStep(value: number): number {
  const target = Math.max(10, value * 0.1);
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const normalized = target / magnitude;
  const nice =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

function sameRenderState(a: RenderState, b: RenderState): boolean {
  return (
    a.m === b.m &&
    a.pointCount === b.pointCount &&
    a.pointSize === b.pointSize &&
    a.chamberOnly === b.chamberOnly &&
    a.incrementalView === b.incrementalView &&
    a.incrementalChambers === b.incrementalChambers &&
    a.showAxes === b.showAxes &&
    a.flatChamber === b.flatChamber &&
    a.circleChamber === b.circleChamber &&
    a.solidBlack === b.solidBlack &&
    a.hashKind === b.hashKind &&
    a.motifKind === b.motifKind &&
    a.copyMode === b.copyMode &&
    a.surfaceMode === b.surfaceMode &&
    a.zoom === b.zoom &&
    a.pan.x === b.pan.x &&
    a.pan.y === b.pan.y
  );
}

function buildPolarSpectrum(
  motif: MotifPoint[],
  m: number,
  chamberDeg: number,
  startDeg: number,
  radiusBands: number,
  scope: "full" | "circle" | "wedge",
  copyMode: CopyMode
): PolarSpectrum | null {
  const angularBins = polarAngularBins(m);
  const maxAngularMode = POLAR_HARMONICS * (scope === "wedge" ? 1 : m);
  const heatmapMaxAngularMode = Math.min(
    POLAR_HEATMAP_MAX_ANGULAR_MODE,
    maxAngularMode
  );
  const grid = Array.from({ length: POLAR_RADIAL_BINS }, () =>
    Array.from({ length: angularBins }, () => 0)
  );
  const radiusGrid = Array.from({ length: radiusBands }, () =>
    Array.from({ length: angularBins }, () => 0)
  );
  let samples = 0;
  const copyCount = scope === "full" ? 2 * m : 1;

  for (const point of motif) {
    if (point.radius < POLAR_R_MIN || point.radius > POLAR_R_MAX) continue;
    const radialBin = Math.min(
      POLAR_RADIAL_BINS - 1,
      Math.floor(
        ((point.radius - POLAR_R_MIN) / (POLAR_R_MAX - POLAR_R_MIN)) *
          POLAR_RADIAL_BINS
      )
    );
    const radiusBand = Math.min(
      radiusBands - 1,
      Math.floor(
        ((point.radius - POLAR_R_MIN) / (POLAR_R_MAX - POLAR_R_MIN)) *
          radiusBands
      )
    );
    for (let copy = 0; copy < copyCount; copy += 1) {
      const local =
        scope === "wedge"
          ? point.theta * 360
          : scope === "circle"
          ? -90 + point.theta * 360
          : copyMode === "rotation" || copy % 2 === 0
            ? startDeg + copy * chamberDeg + point.theta * chamberDeg
            : startDeg + (copy + 1) * chamberDeg - point.theta * chamberDeg;
      const angularBin = Math.min(
        angularBins - 1,
        Math.floor((normalizedDeg(local) / 360) * angularBins)
      );
      grid[radialBin][angularBin] += 1;
      radiusGrid[radiusBand][angularBin] += 1;
      samples += 1;
    }
  }

  if (samples === 0) return null;

  const centered = grid.map((ring) => {
    const mean = ring.reduce((sum, value) => sum + value, 0) / ring.length;
    return ring.map((value) => value - mean);
  });
  const centeredRadiusGrid = radiusGrid.map((ring) => {
    const mean = ring.reduce((sum, value) => sum + value, 0) / ring.length;
    return ring.map((value) => value - mean);
  });
  const radiusSamples = radiusGrid.map((ring) =>
    ring.reduce((sum, value) => sum + value, 0)
  );
  const totalEnergy = centeredRadiusGrid.reduce(
    (outerSum, ring) =>
      outerSum + ring.reduce((innerSum, value) => innerSum + value * value, 0),
    0
  );
  const angularModes = Array.from(
    { length: heatmapMaxAngularMode },
    (_, index) => index + 1
  );
  const radialModes = Array.from({ length: POLAR_RADIAL_MODES }, (_, index) => index);
  const rawCells = angularModes.flatMap((angularMode) =>
    radialModes.map((radialMode) => {
      let re = 0;
      let im = 0;

      for (let rIndex = 0; rIndex < POLAR_RADIAL_BINS; rIndex += 1) {
        for (let thetaIndex = 0; thetaIndex < angularBins; thetaIndex += 1) {
          const phase =
            (-2 * Math.PI * radialMode * rIndex) / POLAR_RADIAL_BINS -
            (2 * Math.PI * angularMode * thetaIndex) / angularBins;
          const value = centered[rIndex][thetaIndex];
          re += value * Math.cos(phase);
          im += value * Math.sin(phase);
        }
      }

      return {
        radialMode,
        angularMode,
        value: Math.hypot(re, im) / samples,
        intensity: 0,
      };
    })
  );
  const maxValue = Math.max(...rawCells.map((cell) => cell.value), 0);
  const cells = rawCells.map((cell) => ({
    ...cell,
    intensity: maxValue > 0 ? cell.value / maxValue : 0,
  }));
  const targetModes = [m, 2 * m]
    .map((mode) => (scope === "wedge" ? mode / m : mode))
    .filter((mode) => mode <= heatmapMaxAngularMode)
    .map((mode) => ({
      mode,
      value: Math.max(
        ...cells.filter((cell) => cell.angularMode === mode).map((cell) => cell.value),
        0
      ),
    }));
  const topAngularModes = angularModes
    .map((mode) => ({
      mode,
      value: Math.max(
        ...cells.filter((cell) => cell.angularMode === mode).map((cell) => cell.value),
        0
      ),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  const rawHarmonicProfile = Array.from(
    { length: POLAR_HARMONICS },
    (_, index) => {
      const harmonic = index + 1;
      const angularMode = harmonic * (scope === "wedge" ? 1 : m);
      return {
        harmonic,
        angularMode,
        value: Math.max(
          ...cells
            .filter((cell) => cell.angularMode === angularMode)
            .map((cell) => cell.value),
          0
        ),
        energy: 0,
        intensity: 0,
      };
    }
  );
  const rawRadiusProfiles = Array.from({ length: radiusBands }, (_, band) => {
    const bandSamples = radiusSamples[band];
    const rawHarmonics = rawHarmonicProfile.map(({ harmonic, angularMode }) => {
      let re = 0;
      let im = 0;

      for (let thetaIndex = 0; thetaIndex < angularBins; thetaIndex += 1) {
        const phase =
          (-2 * Math.PI * angularMode * thetaIndex) / angularBins;
        const value = centeredRadiusGrid[band][thetaIndex];
        re += value * Math.cos(phase);
        im += value * Math.sin(phase);
      }

      return {
        harmonic,
        angularMode,
        value: bandSamples > 0 ? Math.hypot(re, im) / bandSamples : 0,
        energy: (2 * (re * re + im * im)) / angularBins,
        intensity: 0,
      };
    });
    const bandMax = Math.max(...rawHarmonics.map((entry) => entry.energy), 0);

    return {
      rMin:
        POLAR_R_MIN +
        ((POLAR_R_MAX - POLAR_R_MIN) * band) / radiusBands,
      rMax:
        POLAR_R_MIN +
        ((POLAR_R_MAX - POLAR_R_MIN) * (band + 1)) / radiusBands,
      wedgePoints: scope === "full" ? bandSamples / copyCount : bandSamples,
      samples: bandSamples,
      totalEnergy: centeredRadiusGrid[band].reduce(
        (sum, value) => sum + value * value,
        0
      ),
      totalIntensity: 0,
      shownEnergy: rawHarmonics.reduce(
        (sum, entry) => sum + entry.energy,
        0
      ),
      shownIntensity: 0,
      harmonics: rawHarmonics.map((entry) => ({
        ...entry,
        intensity: bandMax > 0 ? entry.energy / bandMax : 0,
      })),
    };
  });
  const maxRadiusEnergy = Math.max(
    ...rawRadiusProfiles.map((profile) => profile.totalEnergy),
    0
  );
  const maxShownEnergy = Math.max(
    ...rawRadiusProfiles.map((profile) => profile.shownEnergy),
    0
  );
  const radiusProfiles = rawRadiusProfiles.map((profile) => ({
    ...profile,
    totalIntensity:
      maxRadiusEnergy > 0 ? profile.totalEnergy / maxRadiusEnergy : 0,
    shownIntensity:
      maxShownEnergy > 0 ? profile.shownEnergy / maxShownEnergy : 0,
  }));
  const rawGlobalHarmonics = rawHarmonicProfile.map(({ harmonic, angularMode }) => ({
    harmonic,
    angularMode,
    value: rawRadiusProfiles.reduce((sum, profile) => {
      const entry = profile.harmonics.find(
        (item) => item.harmonic === harmonic
      );
      return sum + (entry?.energy ?? 0);
    }, 0),
    energy: rawRadiusProfiles.reduce((sum, profile) => {
      const entry = profile.harmonics.find(
        (item) => item.harmonic === harmonic
      );
      return sum + (entry?.energy ?? 0);
    }, 0),
    intensity: 0,
  }));
  const harmonicMax = Math.max(
    ...rawGlobalHarmonics.map((entry) => entry.energy),
    0
  );
  const harmonicProfile = rawGlobalHarmonics.map((entry) => ({
    ...entry,
    intensity: harmonicMax > 0 ? entry.energy / harmonicMax : 0,
  }));

  return {
    scope,
    cells,
    angularModes,
    radialModes,
    radiusBands,
    angularBins,
    maxAngularMode,
    heatmapMaxAngularMode,
    totalEnergy,
    maxValue,
    samples,
    targetModes,
    topAngularModes,
    harmonicProfile,
    radiusProfiles,
  };
}

function buildPolarSpectrumText(
  spectrum: PolarSpectrum,
  state: RenderState
): string {
  const lines = [
    "Polar FFT",
    `scope\t${spectrum.scope}`,
    `m\t${state.m}`,
    `points\t${state.pointCount}`,
    `hash\t${state.hashKind}`,
    `motif\t${state.motifKind}`,
    `copies\t${state.copyMode}`,
    `surface\t${state.surfaceMode}`,
    `scope\t${state.circleChamber ? "circle" : "full"}`,
    `radius_range\t${fmtSpectrum(POLAR_R_MIN)}R..${fmtSpectrum(POLAR_R_MAX)}R`,
    `samples\t${spectrum.samples}`,
    `total_energy\t${fmtSpectrum(spectrum.totalEnergy)}`,
    `radial_bins\t${POLAR_RADIAL_BINS}`,
    `radius_bands\t${spectrum.radiusBands}`,
    `angular_bins\t${spectrum.angularBins}`,
    `max_angular_mode\t${spectrum.maxAngularMode}`,
    `heatmap_max_angular_mode\t${spectrum.heatmapMaxAngularMode}`,
    "",
    "target_modes",
    "mode\tvalue",
    ...spectrum.targetModes.map(
      (entry) => `${entry.mode}\t${fmtSpectrum(entry.value)}`
    ),
    "",
    "top_angular_modes",
    "mode\tvalue",
    ...spectrum.topAngularModes.map(
      (entry) => `${entry.mode}\t${fmtSpectrum(entry.value)}`
    ),
    "",
    "harmonic_profile",
    `h\t${spectrum.scope === "wedge" ? "kwedge" : "ktheta"}\tenergy\tpercent_of_total\tintensity`,
    ...spectrum.harmonicProfile.map(
      (entry) =>
        `${entry.harmonic}\t${entry.angularMode}\t${fmtSpectrum(entry.energy)}\t${fmtPercent(entry.energy, spectrum.totalEnergy)}\t${fmtSpectrum(entry.intensity)}`
    ),
    "",
    "radius_harmonic_profiles",
    `r_min\tr_max\twedge_points\tsamples\ttotal_energy\ttotal_intensity\tshown_energy\tshown_intensity\th\t${spectrum.scope === "wedge" ? "kwedge" : "ktheta"}\tenergy\tpercent_of_ring\tintensity`,
    ...spectrum.radiusProfiles.flatMap((profile) =>
      profile.harmonics.map(
        (entry) =>
          `${fmtSpectrum(profile.rMin)}R\t${fmtSpectrum(profile.rMax)}R\t${fmtInteger(profile.wedgePoints)}\t${profile.samples}\t${fmtSpectrum(profile.totalEnergy)}\t${fmtSpectrum(profile.totalIntensity)}\t${fmtSpectrum(profile.shownEnergy)}\t${fmtSpectrum(profile.shownIntensity)}\t${entry.harmonic}\t${entry.angularMode}\t${fmtSpectrum(entry.energy)}\t${fmtPercent(entry.energy, profile.totalEnergy)}\t${fmtSpectrum(entry.intensity)}`
      )
    ),
    "",
    "cells",
    `${spectrum.scope === "wedge" ? "kwedge" : "ktheta"}\tkr\tvalue\tintensity`,
    ...spectrum.cells.map(
      (cell) =>
        `${cell.angularMode}\t${cell.radialMode}\t${fmtSpectrum(cell.value)}\t${fmtSpectrum(cell.intensity)}`
    ),
  ];

  return lines.join("\n");
}

function buildRadiusProfilesText(spectrum: PolarSpectrum): string {
  const lines = [
    "By radius",
    `scope\t${spectrum.scope}`,
    `r_min\tr_max\twedge_points\tsamples\ttotal_energy\tshown_energy\tshown_percent\th\t${spectrum.scope === "wedge" ? "kwedge" : "ktheta"}\tenergy\tpercent_of_ring`,
    ...spectrum.radiusProfiles.flatMap((profile) =>
      profile.harmonics.map(
        (entry) =>
          `${fmtSpectrum(profile.rMin)}R\t${fmtSpectrum(profile.rMax)}R\t${fmtInteger(profile.wedgePoints)}\t${profile.samples}\t${fmtSpectrum(profile.totalEnergy)}\t${fmtSpectrum(profile.shownEnergy)}\t${fmtPercent(profile.shownEnergy, profile.totalEnergy)}\t${entry.harmonic}\t${entry.angularMode}\t${fmtSpectrum(entry.energy)}\t${fmtPercent(entry.energy, profile.totalEnergy)}`
      )
    ),
  ];

  return lines.join("\n");
}

function HashFormula({ kind }: { kind: HashKind }) {
  const hs = (
    <>
      h<sub>s</sub>(i)
    </>
  );
  const two32 = (
    <>
      2<sup>32</sup>
    </>
  );

  switch (kind) {
    case "sine":
      return (
        <>
          {hs} = frac(sin(i · 127.1 + s · 311.7) · 43758.5453123)
        </>
      );
    case "cosine":
      return (
        <>
          {hs} = frac(cos(i · 269.5 + s · 183.3) · 24634.6345)
        </>
      );
    case "avalanche":
      return (
        <>
          {hs} = mix32((i + 1) · 0x9e3779b1 xor (s + 1) · 0x85ebca6b) / {two32}
        </>
      );
    case "wang":
      return (
        <>
          {hs} = wang32((i + 1) xor ((s + 1) · 0x45d9f3b)) / {two32}
        </>
      );
    case "xorshift":
      return (
        <>
          {hs} = xorshift32((i + 1) · 0x9e3779b9 + s · 0x7f4a7c15) / {two32}
        </>
      );
    case "lcg":
      return (
        <>
          {hs} = (1664525 · (i + 1) + 1013904223 · (s + 1)) mod {two32} / {two32}
        </>
      );
    case "mulberry":
      return (
        <>
          {hs} = mulberry32((i + 1) + (s + 1) · 0x6d2b79f5) / {two32}
        </>
      );
    case "splitmix":
      return (
        <>
          {hs} = splitmix32((i + 1) + (s + 1) · 0x9e3779b9) / {two32}
        </>
      );
    case "golden":
      return (
        <>
          {hs} = frac((i + 1) · (φ − 1 + s · (sqrt(2) − 1)))
        </>
      );
    case "halton":
      return (
        <>
          {hs} = radicalInverse(i + 1, base<sub>s</sub>), base<sub>1</sub> = 2,
          base<sub>2</sub> = 3
        </>
      );
  }
}

export function KaleidoscopeView() {
  const searchParams = useSearchParams();
  const motifId = useId();
  const directMotifId = `${motifId}-direct`;
  const reflectedMotifId = `${motifId}-reflected`;
  const initialM = useMemo(() => {
    const value = readNonNegIntParam(searchParams, "m", M_DEFAULT);
    return Math.max(M_MIN, value);
  }, [searchParams]);
  const initialPoints = useMemo(() => {
    const value = readNonNegIntParam(searchParams, "pts", POINTS_DEFAULT);
    return Math.max(POINTS_MIN, value);
  }, [searchParams]);
  const initialSize = useMemo(() => {
    return readNumberParam(searchParams, "sz", SIZE_DEFAULT, SIZE_MIN);
  }, [searchParams]);
  const initialChamberOnly = useMemo(
    () => readEnumParam(searchParams, "ch", ["0", "1"], "0") === "1",
    [searchParams]
  );
  const initialIncrementalView = useMemo(
    () => readEnumParam(searchParams, "iv", ["0", "1"], "0") === "1",
    [searchParams]
  );
  const initialIncrementalChambers = useMemo(() => {
    const value = readNonNegIntParam(searchParams, "iw", 1);
    return Math.min(2 * initialM, Math.max(1, value));
  }, [initialM, searchParams]);
  const initialShowAxes = useMemo(
    () => readEnumParam(searchParams, "axs", ["0", "1"], "1") === "1",
    [searchParams]
  );
  const initialFlatChamber = useMemo(
    () => readEnumParam(searchParams, "flat", ["0", "1"], "0") === "1",
    [searchParams]
  );
  const initialCircleChamber = useMemo(
    () => readEnumParam(searchParams, "circ", ["0", "1"], "0") === "1",
    [searchParams]
  );
  const initialSolidBlack = useMemo(
    () => readEnumParam(searchParams, "ink", ["0", "1"], "0") === "1",
    [searchParams]
  );
  const initialHashKind = useMemo(
    () => readEnumParam(searchParams, "hash", HASH_KINDS, "sine"),
    [searchParams]
  );
  const initialMotifKind = useMemo(
    () => readEnumParam(searchParams, "motif", MOTIF_KINDS, "random"),
    [searchParams]
  );
  const initialCopyMode = useMemo(
    () => readEnumParam(searchParams, "copy", COPY_MODES, "coxeter"),
    [searchParams]
  );
  const initialSurfaceMode = useMemo(
    () => readEnumParam(searchParams, "surf", SURFACE_MODES, "fixed"),
    [searchParams]
  );
  const initialRadiusBands = useMemo(() => {
    const value = readNonNegIntParam(searchParams, "rings", RADIUS_BANDS_DEFAULT);
    return Math.min(RADIUS_BANDS_MAX, Math.max(RADIUS_BANDS_MIN, value));
  }, [searchParams]);
  const initialSurfaceRadius = useMemo(
    () => surfaceRadius(initialM, initialSurfaceMode),
    [initialM, initialSurfaceMode]
  );
  const initialZoom = useMemo(
    () => readNumberParam(searchParams, "z", 1, surfaceMinZoom(initialSurfaceRadius)),
    [initialSurfaceRadius, searchParams]
  );
  const initialPanX = useMemo(
    () => readNumberParam(searchParams, "px", 0),
    [searchParams]
  );
  const initialPanY = useMemo(
    () => readNumberParam(searchParams, "py", 0),
    [searchParams]
  );

  const svgFrameRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const panStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const [m, setM] = useState(initialM);
  const [pointCount, setPointCount] = useState(initialPoints);
  const [pointSize, setPointSize] = useState(initialSize);
  const [chamberOnly, setChamberOnly] = useState(initialChamberOnly);
  const [incrementalView, setIncrementalView] = useState(
    initialIncrementalView &&
      !initialChamberOnly &&
      !initialFlatChamber &&
      !initialCircleChamber
  );
  const [incrementalChambers, setIncrementalChambers] = useState(
    initialIncrementalChambers
  );
  const [showAxes, setShowAxes] = useState(initialShowAxes);
  const [flatChamber, setFlatChamber] = useState(initialFlatChamber);
  const [circleChamber, setCircleChamber] = useState(
    initialCircleChamber && !initialFlatChamber
  );
  const [solidBlack, setSolidBlack] = useState(initialSolidBlack);
  const [hashKind, setHashKind] = useState<HashKind>(initialHashKind);
  const [motifKind, setMotifKind] = useState<MotifKind>(initialMotifKind);
  const [copyMode, setCopyMode] = useState<CopyMode>(initialCopyMode);
  const [surfaceMode, setSurfaceMode] = useState<SurfaceMode>(initialSurfaceMode);
  const [radiusBands, setRadiusBands] = useState(initialRadiusBands);
  const [zoom, setZoom] = useState(initialZoom);
  const [pan, setPan] = useState({ x: initialPanX, y: initialPanY });
  const [hoveredRadiusBand, setHoveredRadiusBand] = useState<number | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const renderStartRef = useRef<number | null>(null);
  const renderFrameRef = useRef<number | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [lastRenderMs, setLastRenderMs] = useState<number | null>(null);
  const [frameSize, setFrameSize] = useState({
    width: SVG_SIZE,
    height: SVG_SIZE,
  });
  const liveIncrementalChambers = Math.min(
    2 * m,
    Math.max(1, incrementalChambers)
  );
  const initialRenderState = useMemo<RenderState>(
    () => ({
      m: initialM,
      pointCount: initialPoints,
      pointSize: initialSize,
      chamberOnly: initialChamberOnly,
      incrementalView:
        initialIncrementalView &&
        !initialChamberOnly &&
        !initialFlatChamber &&
        !initialCircleChamber,
      incrementalChambers: initialIncrementalChambers,
      showAxes: initialShowAxes,
      flatChamber: initialFlatChamber,
      circleChamber: initialCircleChamber && !initialFlatChamber,
      solidBlack: initialSolidBlack,
      hashKind: initialHashKind,
      motifKind: initialMotifKind,
      copyMode: initialCopyMode,
      surfaceMode: initialSurfaceMode,
      zoom: initialZoom,
      pan: { x: initialPanX, y: initialPanY },
    }),
    [
      initialM,
      initialPoints,
      initialSize,
      initialChamberOnly,
      initialIncrementalView,
      initialIncrementalChambers,
      initialShowAxes,
      initialFlatChamber,
      initialCircleChamber,
      initialSolidBlack,
      initialHashKind,
      initialMotifKind,
      initialCopyMode,
      initialSurfaceMode,
      initialZoom,
      initialPanX,
      initialPanY,
    ]
  );
  const liveRenderState = useMemo<RenderState>(
    () => ({
      m,
      pointCount,
      pointSize,
      chamberOnly,
      incrementalView,
      incrementalChambers: liveIncrementalChambers,
      showAxes,
      flatChamber,
      circleChamber,
      solidBlack,
      hashKind,
      motifKind,
      copyMode,
      surfaceMode,
      zoom,
      pan,
    }),
    [
      m,
      pointCount,
      pointSize,
      chamberOnly,
      incrementalView,
      liveIncrementalChambers,
      showAxes,
      flatChamber,
      circleChamber,
      solidBlack,
      hashKind,
      motifKind,
      copyMode,
      surfaceMode,
      zoom,
      pan,
    ]
  );
  const fullDiskMode = !chamberOnly && !incrementalView && !flatChamber && !circleChamber;
  const deferDraw = pointCount > DRAW_THRESHOLD && fullDiskMode;
  const [drawnState, setDrawnState] = useState<RenderState | null>(
    initialPoints > DRAW_THRESHOLD ? null : initialRenderState
  );
  const rendered = deferDraw ? drawnState : liveRenderState;
  const drawPending =
    deferDraw && (drawnState === null || !sameRenderState(liveRenderState, drawnState));
  const drawnMatchesLive =
    drawnState !== null && sameRenderState(liveRenderState, drawnState);
  const displayState = rendered ?? liveRenderState;
  const chamberDeg = 180 / displayState.m;
  const displaySurfaceRadius = surfaceRadius(displayState.m, displayState.surfaceMode);
  const minZoom = surfaceMinZoom(surfaceRadius(m, surfaceMode));
  const effectiveZoom = Math.max(minZoom, zoom);
  const displayZoom = Math.max(surfaceMinZoom(displaySurfaceRadius), displayState.zoom);
  const displayChamberDeg =
    (displayState.chamberOnly ||
      displayState.flatChamber ||
      displayState.circleChamber) &&
    !displayState.incrementalView
      ? CHAMBER_ONLY_DEG
      : chamberDeg;
  const startDeg = -90 - displayChamberDeg / 2;
  const gemMotif = useMemo(
    () =>
      rendered
        ? buildPatternMotif(
            rendered.pointCount,
            rendered.m,
            rendered.hashKind,
            rendered.motifKind,
            displayChamberDeg,
            startDeg
          )
        : [],
    [displayChamberDeg, rendered, startDeg]
  );
  const chamberCount = 2 * displayState.m;
  const incrementalChamberCount = Math.min(
    chamberCount,
    Math.max(1, displayState.incrementalChambers)
  );
  const visibleChambers =
    displayState.incrementalView
      ? incrementalChamberCount
      : displayState.chamberOnly || displayState.flatChamber || displayState.circleChamber
      ? 1
      : chamberCount;
  const visibleMotifChambers = useMemo(
    () => Array.from({ length: chamberCount }, (_, i) => i),
    [chamberCount]
  );
  const visibleGuides = useMemo(
    () =>
      displayState.incrementalView
        ? Array.from({ length: incrementalChamberCount + 1 }, (_, i) => i)
        : displayState.chamberOnly
        ? [0, 1]
        : Array.from({ length: chamberCount }, (_, i) => i),
    [chamberCount, displayState.chamberOnly, displayState.incrementalView, incrementalChamberCount]
  );
  const optimizedFullDisk =
    rendered !== null &&
    !displayState.chamberOnly &&
    !displayState.incrementalView &&
    !displayState.flatChamber &&
    !displayState.circleChamber;
  const displaySize = Math.min(
    frameSize.width || SVG_SIZE,
    frameSize.height || SVG_SIZE
  );
  const pointPxPerUnit = (displaySize * displayZoom) / SVG_SIZE;
  const pointRadius = displayState.pointSize / pointPxPerUnit;
  const pointStep = niceStep(pointCount);
  const viewPxPerUnit = (displaySize * effectiveZoom) / SVG_SIZE;
  const viewBoxWidth = SVG_SIZE / effectiveZoom;
  const focusX = SVG_SIZE / 2 - pan.x / viewPxPerUnit;
  const focusY = SVG_SIZE / 2 - pan.y / viewPxPerUnit;
  const viewBox = `${focusX - viewBoxWidth / 2} ${focusY - viewBoxWidth / 2} ${viewBoxWidth} ${viewBoxWidth}`;
  const directBasePoints = useMemo(
    () =>
      gemMotif.map((point) =>
        chamberPoint(point, 0, displayChamberDeg, startDeg, displaySurfaceRadius)
      ),
    [gemMotif, displayChamberDeg, startDeg, displaySurfaceRadius]
  );
  const reflectedBasePoints = useMemo(
    () =>
      gemMotif.map((point) =>
        chamberPoint(point, 1, displayChamberDeg, startDeg, displaySurfaceRadius)
      ),
    [gemMotif, displayChamberDeg, startDeg, displaySurfaceRadius]
  );
  const polarSpectrum = useMemo(
    () =>
      rendered &&
      !displayState.incrementalView &&
      !displayState.flatChamber
        ? buildPolarSpectrum(
            gemMotif,
            displayState.m,
            chamberDeg,
            startDeg,
            radiusBands,
            displayState.chamberOnly
              ? "wedge"
              : displayState.circleChamber
                ? "circle"
                : "full",
            displayState.copyMode
          )
        : null,
    [
      chamberDeg,
      displayState.chamberOnly,
      displayState.circleChamber,
      displayState.copyMode,
      displayState.flatChamber,
      displayState.incrementalView,
      displayState.m,
      gemMotif,
      radiusBands,
      rendered,
      startDeg,
    ]
  );

  const copyPolarSpectrum = useCallback(async () => {
    if (!polarSpectrum) return;
    await navigator.clipboard.writeText(
      buildPolarSpectrumText(polarSpectrum, displayState)
    );
  }, [displayState, polarSpectrum]);
  const copyRadiusProfiles = useCallback(async () => {
    if (!polarSpectrum) return;
    await navigator.clipboard.writeText(buildRadiusProfilesText(polarSpectrum));
  }, [polarSpectrum]);

  useEffect(() => {
    writeUrlParams({
      m: m === M_DEFAULT ? null : String(m),
      pts: pointCount === POINTS_DEFAULT ? null : String(pointCount),
      sz: pointSize === SIZE_DEFAULT ? null : String(pointSize),
      ch: chamberOnly ? "1" : null,
      iv: incrementalView ? "1" : null,
      iw:
        incrementalView && liveIncrementalChambers !== 1
          ? String(liveIncrementalChambers)
          : null,
      axs: showAxes ? null : "0",
      flat: flatChamber ? "1" : null,
      circ: circleChamber ? "1" : null,
      ink: solidBlack ? "1" : null,
      hash: hashKind === "sine" ? null : hashKind,
      motif: motifKind === "random" ? null : motifKind,
      copy: copyMode === "coxeter" ? null : copyMode,
      surf: surfaceMode === "fixed" ? null : surfaceMode,
      rings:
        radiusBands === RADIUS_BANDS_DEFAULT ? null : String(radiusBands),
      z: zoom !== 1 || pan.x !== 0 || pan.y !== 0 ? viewParam(zoom) : null,
      px: zoom !== 1 || pan.x !== 0 || pan.y !== 0 ? viewParam(pan.x) : null,
      py: zoom !== 1 || pan.x !== 0 || pan.y !== 0 ? viewParam(pan.y) : null,
    });
  }, [
    m,
    pointCount,
    pointSize,
    chamberOnly,
    incrementalView,
    liveIncrementalChambers,
    showAxes,
    flatChamber,
    circleChamber,
    solidBlack,
    hashKind,
    motifKind,
    copyMode,
    surfaceMode,
    radiusBands,
    zoom,
    pan.x,
    pan.y,
  ]);

  useEffect(() => {
    if (deferDraw || (drawnState && sameRenderState(liveRenderState, drawnState))) return;
    const id = requestAnimationFrame(() => setDrawnState(liveRenderState));
    return () => cancelAnimationFrame(id);
  }, [deferDraw, drawnState, liveRenderState]);

  useEffect(() => {
    if (!isRendering || !drawnMatchesLive || renderStartRef.current === null) return;
    const elapsed = performance.now() - renderStartRef.current;
    setLastRenderMs(elapsed);
    setIsRendering(false);
    renderStartRef.current = null;
  }, [drawnMatchesLive, isRendering]);

  useEffect(() => {
    return () => {
      if (renderFrameRef.current !== null) cancelAnimationFrame(renderFrameRef.current);
    };
  }, []);

  useEffect(() => {
    svgRef.current?.setAttribute("viewBox", viewBox);
  }, [viewBox]);

  useEffect(() => {
    const node = svgFrameRef.current;
    if (!node) return;

    const publish = () => {
      const rect = node.getBoundingClientRect();
      setFrameSize({ width: rect.width || SVG_SIZE, height: rect.height || SVG_SIZE });
    };

    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const changeM = useCallback((delta: number) => {
    const nextM = Math.max(M_MIN, m + delta);
    setM(nextM);
    setZoom((value) =>
      Math.max(surfaceMinZoom(surfaceRadius(nextM, surfaceMode)), value)
    );
  }, [m, surfaceMode]);
  const changePointCount = useCallback((direction: -1 | 1) => {
    setPointCount((value) =>
      Math.max(POINTS_MIN, value + direction * niceStep(value))
    );
  }, []);
  const changePointSize = useCallback((delta: number) => {
    setPointSize((value) => Math.round(Math.max(SIZE_MIN, value + delta) * 100) / 100);
  }, []);
  const changeRadiusBands = useCallback((delta: number) => {
    setRadiusBands((value) =>
      Math.min(RADIUS_BANDS_MAX, Math.max(RADIUS_BANDS_MIN, value + delta))
    );
  }, []);
  const toggleShowAxes = useCallback(() => {
    setShowAxes((value) => !value);
  }, []);
  const fundamentalMode = chamberOnly || incrementalView || flatChamber || circleChamber;
  const fundamentalView: FundamentalView = incrementalView
    ? "incremental"
    : flatChamber
    ? "flat"
    : circleChamber
      ? "circle"
      : "wedge";
  const setScopeMode = useCallback((mode: "full" | "fundamental") => {
    if (mode === "full") {
      setChamberOnly(false);
      setIncrementalView(false);
      setFlatChamber(false);
      setCircleChamber(false);
    } else if (!chamberOnly && !incrementalView && !flatChamber && !circleChamber) {
      setChamberOnly(true);
    }
  }, [chamberOnly, incrementalView, flatChamber, circleChamber]);
  const setFundamentalView = useCallback((mode: FundamentalView) => {
    setChamberOnly(mode === "wedge");
    setIncrementalView(mode === "incremental");
    if (mode === "incremental") setIncrementalChambers(1);
    setFlatChamber(mode === "flat");
    setCircleChamber(mode === "circle");
  }, []);
  const changeIncrementalChambers = useCallback((delta: number) => {
    setIncrementalChambers((value) =>
      Math.min(2 * m, Math.max(1, value + delta))
    );
  }, [m]);
  const toggleSolidBlack = useCallback(() => {
    setSolidBlack((value) => !value);
  }, []);
  const toggleHashKind = useCallback(() => {
    setHashKind((value) => {
      const index = HASH_KINDS.indexOf(value);
      return HASH_KINDS[(index + 1) % HASH_KINDS.length];
    });
  }, []);
  const toggleMotifKind = useCallback(() => {
    setMotifKind((value) => {
      const index = MOTIF_KINDS.indexOf(value);
      return MOTIF_KINDS[(index + 1) % MOTIF_KINDS.length];
    });
  }, []);
  const toggleCopyMode = useCallback(() => {
    setCopyMode((value) => (value === "coxeter" ? "rotation" : "coxeter"));
  }, []);
  const setSurfaceScaleMode = useCallback((mode: SurfaceMode) => {
    setSurfaceMode(mode);
    setZoom((value) => Math.max(surfaceMinZoom(surfaceRadius(m, mode)), value));
  }, [m]);
  const drawNow = useCallback(() => {
    setIsRendering(true);
    setLastRenderMs(null);
    if (renderFrameRef.current !== null) cancelAnimationFrame(renderFrameRef.current);
    renderFrameRef.current = requestAnimationFrame(() => {
      renderFrameRef.current = requestAnimationFrame(() => {
        renderStartRef.current = performance.now();
        setDrawnState(liveRenderState);
        renderFrameRef.current = null;
      });
    });
  }, [liveRenderState]);
  const zoomOut = () => {
    setZoom((value) => Math.max(minZoom, value / ZOOM_FACTOR));
  };
  const zoomIn = () => {
    setZoom((value) => Math.max(minZoom, value) * ZOOM_FACTOR);
  };
  const resetView = () => {
    setZoom(Math.max(minZoom, 1));
    setPan({ x: 0, y: 0 });
  };
  const handlePanStart = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || effectiveZoom <= 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    setIsPanning(true);
  };
  const handlePanMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = panStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setPan({
      x: start.panX + event.clientX - start.x,
      y: start.panY + event.clientY - start.y,
    });
  };
  const handlePanEnd = (event: PointerEvent<HTMLDivElement>) => {
    const start = panStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    panStartRef.current = null;
    setIsPanning(false);
  };
  const handleWheelPan = (event: WheelEvent<HTMLDivElement>) => {
    if (effectiveZoom <= 1) return;
    event.preventDefault();
    const rect = svgFrameRef.current?.getBoundingClientRect();
    const deltaMultiplier =
      event.deltaMode === WHEEL_DELTA_LINE
        ? WHEEL_LINE_HEIGHT
        : event.deltaMode === WHEEL_DELTA_PAGE
          ? Math.max(rect?.height ?? SVG_SIZE, WHEEL_LINE_HEIGHT)
          : 1;
    setPan((value) => ({
      x: value.x - event.deltaX * deltaMultiplier,
      y: value.y - event.deltaY * deltaMultiplier,
    }));
  };

  const svgContent = useMemo(
    () => (
      <>
        {displayState.flatChamber ? (
          displayState.showAxes && (
            <rect
              x={FLAT_X}
              y={FLAT_Y}
              width={FLAT_W}
              height={FLAT_H}
              fill="none"
              stroke={COLOR.mirror}
              strokeDasharray="6 5"
              strokeWidth={1.3}
              opacity={0.65}
            />
          )
        ) : displayState.circleChamber ? (
          <circle
            cx={CX}
            cy={CY}
            r={displaySurfaceRadius}
            fill="none"
            stroke={COLOR.ring}
            strokeWidth={0.8}
          />
        ) : (
          <circle
            cx={CX}
            cy={CY}
            r={displaySurfaceRadius}
            fill="none"
            stroke={COLOR.ring}
            strokeWidth={0.8}
          />
        )}

        {optimizedFullDisk ? (
          <>
            <defs>
              <g id={directMotifId}>
                {gemMotif.map((point, index) => {
                  const [x, y] = directBasePoints[index];
                  return (
                    <circle
                      key={`direct-${point.id}`}
                      cx={x}
                      cy={y}
                      r={pointRadius}
                      fill={displayState.solidBlack ? "#000000" : "currentColor"}
                      stroke="none"
                      fillOpacity={displayState.solidBlack ? 1 : 0.82}
                      className={displayState.solidBlack ? undefined : "text-foreground"}
                    />
                  );
                })}
              </g>
              <g id={reflectedMotifId}>
                {gemMotif.map((point, index) => {
                  const [x, y] = reflectedBasePoints[index];
                  return (
                    <circle
                      key={`reflected-${point.id}`}
                      cx={x}
                      cy={y}
                      r={pointRadius}
                      fill={displayState.solidBlack ? "#000000" : "currentColor"}
                      stroke="none"
                      fillOpacity={displayState.solidBlack ? 1 : 0.82}
                      className={displayState.solidBlack ? undefined : "text-foreground"}
                    />
                  );
                })}
              </g>
            </defs>
            {Array.from(
              { length: displayState.copyMode === "rotation" ? chamberCount : displayState.m },
              (_, orbit) => {
                const rotation =
                  displayState.copyMode === "rotation"
                    ? orbit * chamberDeg
                    : 2 * orbit * chamberDeg;
                return (
                  <g key={`orbit-${orbit}`} opacity={displayState.solidBlack ? 1 : 0.68}>
                    <use
                      href={`#${directMotifId}`}
                      transform={`rotate(${rotation} ${CX} ${CY})`}
                    />
                    {displayState.copyMode === "coxeter" ? (
                      <use
                        href={`#${reflectedMotifId}`}
                        transform={`rotate(${rotation} ${CX} ${CY})`}
                      />
                    ) : null}
                  </g>
                );
              }
            )}
          </>
        ) : (
          visibleMotifChambers.slice(0, visibleChambers).map((chamber) => {
            const points = gemMotif.map((point) => {
              if (displayState.flatChamber) return flatPoint(point);
              if (displayState.circleChamber) {
                return circleChamberPoint(point, displaySurfaceRadius);
              }
              if (displayState.copyMode === "rotation") {
                return rotatedChamberPoint(
                  point,
                  chamber,
                  displayChamberDeg,
                  startDeg,
                  displaySurfaceRadius
                );
              }
              return chamberPoint(
                point,
                chamber,
                displayChamberDeg,
                startDeg,
                displaySurfaceRadius
              );
            });
            const opacity = displayState.solidBlack ? 1 : chamber === 0 ? 0.95 : 0.68;

            return (
              <g key={`motif-${chamber}`} opacity={opacity}>
                {gemMotif.map((point, index) => {
                  const [x, y] = points[index];
                  return (
                    <circle
                      key={`${chamber}-${point.id}`}
                      cx={x}
                      cy={y}
                      r={pointRadius}
                      fill={displayState.solidBlack ? "#000000" : "currentColor"}
                      stroke="none"
                      fillOpacity={displayState.solidBlack ? 1 : 0.82}
                      className={displayState.solidBlack ? undefined : "text-foreground"}
                    />
                  );
                })}
              </g>
            );
          })
        )}

        {hoveredRadiusBand !== null &&
        polarSpectrum &&
        !displayState.flatChamber &&
        polarSpectrum.radiusProfiles[hoveredRadiusBand] ? (
          <circle
            cx={CX}
            cy={CY}
            r={
              ((polarSpectrum.radiusProfiles[hoveredRadiusBand].rMin +
                polarSpectrum.radiusProfiles[hoveredRadiusBand].rMax) /
                2) *
              displaySurfaceRadius
            }
            fill="none"
            stroke={COLOR.mirror}
            strokeWidth={
              (polarSpectrum.radiusProfiles[hoveredRadiusBand].rMax -
                polarSpectrum.radiusProfiles[hoveredRadiusBand].rMin) *
              displaySurfaceRadius
            }
            opacity={0.2}
            pointerEvents="none"
          />
        ) : null}

        {!displayState.flatChamber &&
          !displayState.circleChamber &&
          displayState.showAxes &&
          visibleGuides.map((i) => {
            const angle = startDeg + i * displayChamberDeg;
            const [x, y] = polar(angle, displaySurfaceRadius);
            return (
              <line
                key={`guide-${i}`}
                x1={CX}
                y1={CY}
                x2={x}
                y2={y}
                stroke={displayState.chamberOnly || i % 2 === 0 ? COLOR.mirror : COLOR.guide}
                strokeWidth={displayState.chamberOnly || i % 2 === 0 ? 1.3 : 0.7}
                strokeDasharray={displayState.chamberOnly || i % 2 === 0 ? "6 5" : "2 5"}
                opacity={displayState.chamberOnly || i % 2 === 0 ? 0.65 : 0.45}
              />
            );
          })}

        {!displayState.flatChamber && !displayState.circleChamber && displayState.showAxes && (
          <circle cx={CX} cy={CY} r={3.5} fill={COLOR.mirror} />
        )}
      </>
    ),
    [
      chamberCount,
      chamberDeg,
      directBasePoints,
      directMotifId,
      displayChamberDeg,
      displaySurfaceRadius,
      displayState,
      hoveredRadiusBand,
      gemMotif,
      optimizedFullDisk,
      polarSpectrum,
      pointRadius,
      reflectedBasePoints,
      reflectedMotifId,
      startDeg,
      visibleMotifChambers,
      visibleChambers,
      visibleGuides,
    ]
  );

  return (
    <div className="mx-auto grid w-full max-w-[1600px] gap-5 xl:grid-cols-[minmax(0,920px)_minmax(440px,1fr)]">
      <div
        ref={svgFrameRef}
        className="relative w-full rounded-xl border bg-card p-3 xl:col-start-1 xl:row-start-1"
      >
        <div
          className={`touch-none ${effectiveZoom > 1 ? (isPanning ? "cursor-grabbing" : "cursor-grab") : ""}`}
          onPointerDown={handlePanStart}
          onPointerMove={handlePanMove}
          onPointerUp={handlePanEnd}
          onPointerCancel={handlePanEnd}
          onWheel={handleWheelPan}
        >
        <svg ref={svgRef} viewBox={viewBox} className="w-full" role="img">
          {svgContent}
        </svg>
        </div>
        <div className="absolute right-3 top-3 flex items-center gap-1 rounded-md border bg-background/90 p-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={zoomOut}
            disabled={effectiveZoom <= minZoom}
            aria-label="Zoom out"
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <span className="w-12 text-center font-mono">
            {Math.round(effectiveZoom * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={zoomIn}
            aria-label="Zoom in"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={resetView}
            disabled={effectiveZoom === 1 && pan.x === 0 && pan.y === 0}
            aria-label="Reset zoom and pan"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
        {drawPending ? (
          <div className="pointer-events-none absolute bottom-6 right-6">
            <Button
              size="lg"
              className="pointer-events-auto size-20 rounded-full border-primary/30 bg-primary text-base font-semibold text-primary-foreground shadow-xl shadow-primary/25 ring-4 ring-primary/15 hover:bg-primary/90"
              onClick={drawNow}
              disabled={isRendering}
            >
              Draw
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex w-full flex-wrap items-center justify-between gap-3 xl:col-span-2 xl:row-start-2">
        <p className="font-mono text-sm text-foreground">
          I<sub>2</sub>({m}) · {m} mirrors · {2 * m} copies · {pointCount} points ·{" "}
          {fmtAngle(pointSize)}px size
          {surfaceMode === "growing"
            ? ` · radius ${fmtAngle(displaySurfaceRadius / R)}R`
            : ""}
          {isRendering ? " · rendering..." : ""}
          {drawPending ? " · pending draw" : ""}
          {lastRenderMs !== null ? ` · rendered in ${Math.round(lastRenderMs)} ms` : ""}
        </p>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-background/60 p-2 text-sm">
          <span className="text-muted-foreground">m</span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => changeM(-1)}
            disabled={m <= M_MIN}
            aria-label="Decrease m"
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <span className="w-6 text-center font-mono tabular-nums">{m}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => changeM(1)}
            aria-label="Increase m"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <span className="ml-2 text-muted-foreground">points</span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => changePointCount(-1)}
            disabled={pointCount <= POINTS_MIN}
            aria-label={`Decrease points by ${pointStep}`}
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <span className="w-9 text-center font-mono tabular-nums">{pointCount}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => changePointCount(1)}
            aria-label={`Increase points by ${pointStep}`}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <span className="ml-2 text-muted-foreground">size</span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => changePointSize(-SIZE_STEP)}
            disabled={pointSize <= SIZE_MIN}
            aria-label="Decrease point size"
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <span className="w-12 text-center font-mono tabular-nums">
            {fmtAngle(pointSize)}px
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => changePointSize(SIZE_STEP)}
            aria-label="Increase point size"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <span className="ml-2 text-muted-foreground">scope</span>
          <div className="flex items-center rounded-lg border bg-background p-0.5">
            <Button
              variant={!fundamentalMode ? "default" : "ghost"}
              size="sm"
              onClick={() => setScopeMode("full")}
              aria-pressed={!fundamentalMode}
            >
              Full
            </Button>
            <Button
              variant={fundamentalMode ? "default" : "ghost"}
              size="sm"
              onClick={() => setScopeMode("fundamental")}
              aria-pressed={fundamentalMode}
            >
              Fundamental
            </Button>
          </div>
          <span className="ml-2 text-muted-foreground">surface</span>
          <div className="flex items-center rounded-lg border bg-background p-0.5">
            {SURFACE_MODES.map((mode) => (
              <Button
                key={mode}
                variant={surfaceMode === mode ? "default" : "ghost"}
                size="sm"
                onClick={() => setSurfaceScaleMode(mode)}
                aria-pressed={surfaceMode === mode}
              >
                {SURFACE_LABELS[mode]}
              </Button>
            ))}
          </div>
          <span className="ml-2 text-muted-foreground">fundamental</span>
          <div className="flex items-center rounded-lg border bg-background p-0.5">
            <Button
              variant={fundamentalMode && fundamentalView === "wedge" ? "default" : "ghost"}
              size="sm"
              onClick={() => setFundamentalView("wedge")}
              aria-pressed={fundamentalMode && fundamentalView === "wedge"}
            >
              Wedge
            </Button>
            <Button
              variant={
                fundamentalMode && fundamentalView === "incremental"
                  ? "default"
                  : "ghost"
              }
              size="sm"
              onClick={() => setFundamentalView("incremental")}
              aria-pressed={fundamentalMode && fundamentalView === "incremental"}
            >
              Incremental
            </Button>
            <Button
              variant={fundamentalMode && fundamentalView === "flat" ? "default" : "ghost"}
              size="sm"
              onClick={() => setFundamentalView("flat")}
              aria-pressed={fundamentalMode && fundamentalView === "flat"}
            >
              Flat
            </Button>
            <Button
              variant={fundamentalMode && fundamentalView === "circle" ? "default" : "ghost"}
              size="sm"
              onClick={() => setFundamentalView("circle")}
              aria-pressed={fundamentalMode && fundamentalView === "circle"}
            >
              Circle
            </Button>
          </div>
          {fundamentalMode && fundamentalView === "incremental" ? (
            <>
              <span className="ml-2 text-muted-foreground">wedges</span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => changeIncrementalChambers(-1)}
                disabled={liveIncrementalChambers <= 1}
                aria-label="Remove wedge"
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <span className="w-12 text-center font-mono tabular-nums">
                {liveIncrementalChambers}/{2 * m}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => changeIncrementalChambers(1)}
                disabled={liveIncrementalChambers >= 2 * m}
                aria-label="Add wedge"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : null}
          <Button
            variant={showAxes ? "default" : "outline"}
            size="sm"
            onClick={toggleShowAxes}
            aria-pressed={showAxes}
          >
            Axes
          </Button>
          <Button
            variant={solidBlack ? "default" : "outline"}
            size="sm"
            onClick={toggleSolidBlack}
            aria-pressed={solidBlack}
          >
            Solid black
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={toggleMotifKind}
            aria-label="Change point motif"
          >
            {MOTIF_LABELS[motifKind]}
          </Button>
          <Button
            variant={copyMode === "rotation" ? "default" : "outline"}
            size="sm"
            onClick={toggleCopyMode}
            aria-pressed={copyMode === "rotation"}
          >
            Rotations
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={toggleHashKind}
            aria-label="Change hash function"
          >
            {HASH_LABELS[hashKind]}
          </Button>
        </div>
      </div>

      <div className="w-full rounded-lg border bg-background/60 p-3 text-sm text-muted-foreground xl:col-span-2 xl:row-start-3">
        <p>
          <span className="font-medium text-foreground">Coxeter link.</span>{" "}
          I<sub>2</sub>({m}) is the rank-2 Coxeter group generated by two
          reflections whose mirrors meet at {fmtAngle(chamberDeg)}°. Their product
          is a rotation by {fmtAngle(2 * chamberDeg)}°.
          {copyMode === "rotation"
            ? " The current view keeps only those rotations."
            : " One chamber generates the whole disk."}
        </p>
      </div>

      <div className="w-full rounded-lg border bg-background/60 p-3 text-sm text-muted-foreground xl:col-start-2 xl:row-start-1 xl:max-h-[calc(100vh-3rem)] xl:overflow-auto">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-medium text-foreground">
            Polar FFT · m={displayState.m} · {polarSpectrum?.scope ?? "pending"}
          </p>
          <div className="flex items-center gap-2">
            <p className="font-mono text-xs">
              {fmtSpectrum(POLAR_R_MIN)}R..{fmtSpectrum(POLAR_R_MAX)}R ·{" "}
              {polarSpectrum
                ? `${polarSpectrum.samples} samples · ${polarSpectrum.angularBins} bins · energy ${fmtSpectrum(polarSpectrum.totalEnergy)}`
                : "not available"}
            </p>
            <div className="flex items-center gap-1 rounded-md border bg-background px-1 py-0.5">
              <span className="px-1 text-xs text-muted-foreground">rings</span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => changeRadiusBands(-1)}
                disabled={radiusBands <= RADIUS_BANDS_MIN}
                aria-label="Decrease radius rings"
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <span className="w-5 text-center font-mono text-xs text-foreground">
                {radiusBands}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => changeRadiusBands(1)}
                disabled={radiusBands >= RADIUS_BANDS_MAX}
                aria-label="Increase radius rings"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={copyPolarSpectrum}
              disabled={!polarSpectrum}
            >
              Copy
            </Button>
          </div>
        </div>
        {polarSpectrum ? (
          <div className="mt-3 grid gap-3">
            <div className="rounded-md border bg-background p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-foreground">Harmonic profile</p>
                <p className="font-mono text-xs">h × {harmonicUnit(polarSpectrum.scope)}</p>
              </div>
              <div className="mt-3 grid gap-2">
                {polarSpectrum.harmonicProfile.map((entry) => (
                  <div
                    key={entry.harmonic}
                    className="grid grid-cols-[3.5rem_1fr_4rem] items-center gap-2 font-mono text-xs"
                  >
                    <span className="text-foreground">
                      {entry.harmonic}
                      {harmonicUnit(polarSpectrum.scope)}
                    </span>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-cyan-600"
                        style={{ width: stylePercent(Math.max(2, entry.intensity * 100)) }}
                      />
                    </div>
                    <span className="text-right text-foreground">
                      {fmtPercent(entry.energy, polarSpectrum.totalEnergy)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-md border bg-background p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-foreground">By radius</p>
                <div className="flex items-center gap-2">
                  <p className="font-mono text-xs">ring × harmonic</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyRadiusProfiles}
                  >
                    Copy
                  </Button>
                </div>
              </div>
              <div
                className="mt-3 grid gap-1 font-mono text-xs"
                style={{
                  gridTemplateColumns: `5.75rem minmax(3rem, 1fr) minmax(3rem, 1fr) minmax(3rem, 1fr) repeat(${polarSpectrum.harmonicProfile.length}, minmax(2.5rem, 1fr))`,
                }}
              >
                <span />
                <span className="text-center text-muted-foreground">points</span>
                <span className="text-center text-muted-foreground">total</span>
                <span className="text-center text-muted-foreground">shown</span>
                {polarSpectrum.harmonicProfile.map((entry) => (
                  <span
                    key={`radius-head-${entry.harmonic}`}
                    className="text-center text-muted-foreground"
                  >
                    {entry.harmonic}
                    {harmonicUnit(polarSpectrum.scope)}
                  </span>
                ))}
                {polarSpectrum.radiusProfiles.map((profile, profileIndex) => (
                  <div
                    key={`radius-row-${profileIndex}`}
                    className="contents"
                    onMouseEnter={() => setHoveredRadiusBand(profileIndex)}
                    onMouseLeave={() => setHoveredRadiusBand(null)}
                  >
                    <span className="text-muted-foreground">
                      {fmtSpectrum(profile.rMin)}R..{fmtSpectrum(profile.rMax)}R
                    </span>
                    <div
                      className="rounded-sm px-1 py-1 text-center text-foreground"
                      title={`r=${fmtSpectrum(profile.rMin)}R..${fmtSpectrum(profile.rMax)}R, wedge points: ${fmtInteger(profile.wedgePoints)}, full-circle samples: ${profile.samples}`}
                    >
                      {fmtInteger(profile.wedgePoints)}
                    </div>
                    <div
                      className="rounded-sm px-1 py-1 text-center text-foreground"
                      style={{ backgroundColor: heatColor(profile.totalIntensity) }}
                      title={`r=${fmtSpectrum(profile.rMin)}R..${fmtSpectrum(profile.rMax)}R, total: ${fmtSpectrum(profile.totalEnergy)}`}
                    >
                      {fmtInteger(profile.totalEnergy)}
                    </div>
                    <div
                      className="rounded-sm px-1 py-1 text-center text-foreground"
                      style={{ backgroundColor: heatColor(profile.shownIntensity) }}
                      title={`r=${fmtSpectrum(profile.rMin)}R..${fmtSpectrum(profile.rMax)}R, shown: ${fmtSpectrum(profile.shownEnergy)}`}
                    >
                      {fmtPercent(profile.shownEnergy, profile.totalEnergy)}
                    </div>
                    {profile.harmonics.map((entry) => (
                      <div
                        key={`radius-${profileIndex}-${entry.harmonic}`}
                        className="rounded-sm px-1 py-1 text-center text-foreground"
                        style={{ backgroundColor: heatColor(entry.intensity) }}
                        title={`r=${fmtSpectrum(profile.rMin)}R..${fmtSpectrum(profile.rMax)}R, ${entry.harmonic}${harmonicUnit(polarSpectrum.scope)}: ${fmtPercent(entry.energy, profile.totalEnergy)} (${fmtSpectrum(entry.energy)})`}
                      >
                        {fmtPercent(entry.energy, profile.totalEnergy)}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-2">Draw the full scope to update the spectrum.</p>
        )}
      </div>

      <div className="w-full rounded-lg border bg-background/60 p-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Point algorithm.</p>
        <div className="mt-3 grid gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Motif
            </p>
            <p className="mt-1 font-mono text-xs text-foreground">
              {MOTIF_LABELS[motifKind]}
            </p>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Hash
            </p>
            <div className="mt-1 rounded-md border bg-background px-3 py-2 text-center font-mono text-sm text-foreground">
              <HashFormula kind={hashKind} />
            </div>
            <p className="mt-1 font-mono text-xs text-foreground">
              {HASH_NOTES[hashKind]}
            </p>
            {HASH_REFERENCES[hashKind] ? (
              <p className="mt-1 text-xs">
                Reference:{" "}
                <a
                  href={HASH_REFERENCES[hashKind].url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground underline underline-offset-2"
                >
                  {HASH_REFERENCES[hashKind].label}
                </a>
              </p>
            ) : null}
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Coordinates
            </p>
            <div className="mt-1 grid gap-1 font-mono text-xs text-foreground sm:grid-cols-2">
              {motifKind === "random" ? (
                <>
                  <p>
                    θ(i) = h<sub>1</sub>(i)
                  </p>
                  <p>
                    r(i) = sqrt(h<sub>2</sub>(i))
                  </p>
                </>
              ) : (
                <>
                  <p>shape(i): {MOTIF_LABELS[motifKind]}</p>
                  <p>(θ, r) = polar(shape(i))</p>
                </>
              )}
            </div>
            {motifKind === "random" ? (
              <p className="mt-1">
                θ spans the whole chamber. The square root makes r uniform by disk
                area.
              </p>
            ) : null}
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Views
            </p>
            <div className="mt-1 grid gap-1 font-mono text-xs text-foreground sm:grid-cols-2">
              <p>Flat: (x, y) = (θ, r)</p>
              <p>Circle: polar(r, θ)</p>
            </div>
          </div>
        </div>
      </div>

      <div className="h-1" />
    </div>
  );
}
