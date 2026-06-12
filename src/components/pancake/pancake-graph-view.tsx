"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AngleWhiteCharts,
  CircularAutocorrelationChart,
} from "@/components/analysis/analysis-view";
import { LineSpaceView } from "@/components/analysis/line-space-view";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import {
  asymmetricTreeCompressionFactor,
  buildPancakeGraph,
  buildKaleidoscopeSamplingGraph,
  buildRandomCyclicSamplingGraph,
  buildRandomDihedralSamplingGraph,
  buildSimplexSamplingGraph,
  buildWedgeClippedDihedralSamplingGraph,
  buildZaksSymmetryGraph,
  buildZaksSamplingGraph,
  buildQuotientGraph,
  EDGE_DISTANCE_BIN_DEGREES,
  factorial,
  graphEdgesPerVertex,
  graphEdgeCount,
  graphPresetDescription,
  graphPresetLabel,
  graphMaxN,
  graphVertexCount,
  permutahedronCompressionFactor,
  quotientDepthOptions,
  supportsQuotient,
  type EdgeDistanceBin,
  type PancakeGraph,
  type GraphPreset,
  type QuotientGraph,
} from "@/lib/pancake";
import {
  drawQuotientToCanvas,
  drawToCanvas,
  drawYankelovichToCanvas,
  ensureYankelovichField,
  yankelovichFieldKey,
  type YankelovichFieldCache,
  type YankelovichFieldTimings,
  type YankelovichHistogram,
  type YankelovichTone,
  type YankelovichColormap,
  type YankelovichFieldViewport,
  drawZaksSymmetryToCanvas,
  type ZaksSymmetrySectors,
  edgeAlphaToSlider,
  edgeWidthToSlider,
  type EdgeRenderMode,
  supportsSymmetry,
  toSampledLinesSVG,
  toSVG,
  toSymmetrySVG,
  toZaksSymmetrySVG,
  computeZaksOrbits,
  levelColor,
  type OrbitInfo,
  type OrbitParts,
  type RenderSettings,
  type SymmetryColoring,
  type ZaksFundamentalView,
  supportsVertexLabels,
  VERTEX_LABEL_MAX_N,
} from "@/lib/pancake-render";
import {
  readEnumParam,
  readIntParam,
  readNumberParam,
  readNonNegIntParam,
  writeUrlParams,
} from "@/lib/url-state";
import {
  buildPancakeGraphLineSpace,
  type LineSpace,
  type LineSpaceResolution,
} from "@/lib/radon-space";
import { formatUiNumber } from "@/lib/utils";
import {
  Dices,
  Download,
  Loader2,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Shuffle,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { flushSync } from "react-dom";

const SVG_VIEWBOX = 1200;

const RADON_GRID_OPTIONS = [
  { key: "90x80", psiBins: 90, pBins: 80, label: "90 × 80" },
  { key: "180x120", psiBins: 180, pBins: 120, label: "180 × 120" },
  { key: "360x180", psiBins: 360, pBins: 180, label: "360 × 180" },
] as const;
type RadonGridKey = (typeof RADON_GRID_OPTIONS)[number]["key"];
const DEFAULT_RADON_GRID_KEY: RadonGridKey = "180x120";

const RADON_SEED_PSI_OPTIONS = [180, 360, 720] as const;
type RadonSeedPsi = (typeof RADON_SEED_PSI_OPTIONS)[number];
const DEFAULT_RADON_SEED_PSI: RadonSeedPsi = 360;

const RADON_FFT_OPTIONS = [
  { key: "512x64", thetaBins: 512, pBins: 64, label: "512 × 64" },
  { key: "1024x128", thetaBins: 1024, pBins: 128, label: "1024 × 128" },
  { key: "2048x128", thetaBins: 2048, pBins: 128, label: "2048 × 128" },
] as const;
type RadonFftKey = (typeof RADON_FFT_OPTIONS)[number]["key"];
const DEFAULT_RADON_FFT_KEY: RadonFftKey = "1024x128";

function radonGridOption(key: RadonGridKey) {
  return (
    RADON_GRID_OPTIONS.find((option) => option.key === key) ??
    RADON_GRID_OPTIONS[1]
  );
}

function radonFftOption(key: RadonFftKey) {
  return (
    RADON_FFT_OPTIONS.find((option) => option.key === key) ??
    RADON_FFT_OPTIONS[1]
  );
}

function vertexCountLabel(count: number): string {
  return formatUiNumber(count);
}

function yankelovichDihedralSectorVertexCount(n: number): number {
  return Math.max(1, Math.floor(factorial(n - 1) / 2));
}

function simplexYankelovichVertexCount(n: number): number {
  return factorial(n);
}

function simplexYankelovichEdgeCount(n: number): number {
  const vertices = simplexYankelovichVertexCount(n);
  return (vertices * (vertices - 1)) / 2;
}

function yankelovichSampleMax(
  n: number,
  preset: GraphPreset,
  renderer?: Renderer,
  simplexFactorial = false
): number {
  if (preset === "simplex" && renderer === "yankelovich" && simplexFactorial) {
    return simplexYankelovichEdgeCount(n);
  }
  return usesAnalyticYankelovich(preset)
    ? yankelovichDihedralSectorVertexCount(n)
    : Math.max(1, graphEdgeCount(n, preset));
}

function clampYankelovichSampleCount(
  count: number,
  n: number,
  preset: GraphPreset,
  renderer?: Renderer,
  simplexFactorial = false
): number {
  const fallback = Math.min(
    YANKELOVICH_DEFAULT_SAMPLE_COUNT,
    yankelovichSampleMax(n, preset, renderer, simplexFactorial)
  );
  const parsed = Number.isFinite(count) ? Math.round(count) : fallback;
  return Math.max(
    1,
    Math.min(yankelovichSampleMax(n, preset, renderer, simplexFactorial), parsed)
  );
}

function secondsLabel(ms: number): string {
  return `${formatUiNumber(Math.round(ms / 100) / 10)} s`;
}

function degreesLabel(value: number): string {
  return `${Number(value.toFixed(2)).toString()}°`;
}

function formatHistogramPercentage(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0%";
  if (value < 0.1) return "<0.1%";
  if (value < 10) return `${Number(value.toFixed(1)).toString()}%`;
  return `${Math.round(value)}%`;
}

function yankelovichPhaseTimings(
  field: YankelovichFieldTimings,
  canvasMs: number
): PhaseTiming[] {
  return [
    ...(field.viewportMs > 0
      ? [
          {
            id: "viewport",
            label: "Find visible edges",
            elapsedMs: field.viewportMs,
          },
        ]
      : []),
    { id: "matrix", label: "Matrix", elapsedMs: field.matrixMs },
    ...(field.symmetryMs > 0
      ? [{ id: "symmetries", label: "Symmetries", elapsedMs: field.symmetryMs }]
      : []),
    { id: "canvas", label: "Canvas", elapsedMs: canvasMs },
  ];
}

/**
 * Density-appropriate starting positions for the edge strength/width
 * sliders. We pick a target effective style from the edge count and
 * convert it to a slider value (1..100); the renderer maps the same
 * slider value back to that style. Sparse graphs start strong and thick,
 * dense graphs start faint and thin — and the user can adjust from there.
 */
function recommendedEdgeSliders(
  n: number,
  preset: GraphPreset
): { alpha: number; width: number } {
  if (
    preset === "coxeter-a" ||
    preset === "coxeter-b" ||
    preset === "coxeter-d" ||
    preset === "coxeter-h4-600-cell"
  ) {
    return { alpha: 100, width: 70 };
  }
  const e = Math.max(1, graphEdgeCount(n, preset));
  const targetAlpha = 2.4 / Math.pow(e, 0.2);
  const targetWidth = 4.2 / Math.pow(e, 0.3);
  const width =
    n === 8 &&
    (preset === "pancake-zaks" ||
      preset === "pancake-zaks-recursive" ||
      preset === "pancake-williams")
      ? 7
      : edgeWidthToSlider(targetWidth);
  return {
    alpha: edgeAlphaToSlider(targetAlpha),
    width,
  };
}

function defaultVisibilityFor(preset: GraphPreset): {
  showCycle: boolean;
  showVertices: boolean;
} {
  if (
    preset === "coxeter-a" ||
    preset === "coxeter-b" ||
    preset === "coxeter-d"
  ) {
    return { showCycle: false, showVertices: true };
  }
  if (
    preset === "coxeter-h4-600-cell"
  ) {
    return { showCycle: false, showVertices: false };
  }
  return { showCycle: true, showVertices: true };
}

// Values above 10 only apply to graphs/renderers that opt into them
// (simplex/complete stay tiny, while Yankelovich samples analytically);
// availableNOptions filters this list per preset + renderer.
const N_OPTIONS: readonly number[] = Array.from(
  { length: 38 },
  (_, i) => i + 3
);
const SIMPLEX_YANKELOVICH_N_OPTIONS: readonly number[] = Array.from(
  { length: 19 },
  (_, i) => i + 4
);
const DEFAULT_N = 6;

/**
 * Generators a freshly built graph should hide by default. Most graphs start
 * fully visible (empty list). Pancake graphs use generator id = suffix-reversal
 * length, and each generator is an involution, so it contributes a perfect
 * matching of n!/2 chords. Large Zaks graphs emit only rₙ; Williams always
 * emits all suffix reversals and keeps them visible.
 */
function defaultHiddenGenerators(graph: PancakeGraph): number[] {
  if (graph.kind !== "pancake" || graph.n <= 6) return [];
  if (graph.preset === "pancake-williams") return [];
  return graph.generators
    .map((gen) => gen.id)
    .filter((id) => id < graph.n);
}
type NValue = number;

interface JumpHistogramBin {
  minJump: number;
  maxJump: number;
  count: number;
}

const GRAPH_PRESETS: GraphPreset[] = [
  "pancake-zaks",
  "random-cyclic",
  "random-dihedral",
  "wedge-clipped-dihedral",
  "kaleidoscope",
  "coxeter-a",
  "coxeter-b",
  "coxeter-d",
  "pancake-zaks-recursive",
  "pancake-williams",
  "aes-powers",
  "complete",
  "cayley-complete",
  "star",
  "permutohedron",
  "permutahedron-compressed",
  "cyclic-adjacent",
  "transposition",
  "asymmetric-tree",
  "reversal",
  "reversal-greedy",
  "reversal-graycode",
  "lexicographic",
  "hyperoctahedral",
  "hypercube",
  "feistel",
  "sliding-puzzle",
  "simplex",
  "coxeter-h4-600-cell",
  "sierpinski",
];

type Renderer =
  | "svg"
  | "canvas"
  | "density"
  | "quotient"
  | "symmetry"
  | "yankelovich"
  | "sampled";

function supportsYankelovich(preset: GraphPreset): boolean {
  return GRAPH_PRESETS.includes(preset);
}

function usesAnalyticYankelovich(preset: GraphPreset): boolean {
  return (
    preset === "pancake-zaks" ||
    preset === "random-cyclic" ||
    preset === "random-dihedral" ||
    preset === "wedge-clipped-dihedral"
  );
}

function requiresYankelovich(preset: GraphPreset): boolean {
  return (
    preset === "random-cyclic" ||
    preset === "random-dihedral" ||
    preset === "wedge-clipped-dihedral"
  );
}

/**
 * The kaleidoscope is a small materialized vector graph (shards × 2n segments),
 * so it renders in SVG / Canvas / density alike. Its pattern is rebuilt from the
 * sample seed, so reseeding must rebuild the graph.
 */
function isKaleidoscope(preset: GraphPreset): boolean {
  return preset === "kaleidoscope";
}

function isVariableCoxeterRootPreset(preset: GraphPreset): boolean {
  return preset === "coxeter-a" || preset === "coxeter-b" || preset === "coxeter-d";
}

/**
 * The sampled-lines renderer draws a random subset of the rₙ matching as vector
 * lines; it shares the Yankelovich analytic sampling, so it is offered on the
 * same Zaks layout.
 */
function supportsSampledLines(preset: GraphPreset): boolean {
  return preset === "pancake-zaks";
}

/**
 * The Yankelovich renderer never enumerates the n! cycle (it samples chords via
 * the analytic Zaks rank/unrank), so it can go well past the other renderers'
 * ceiling. 40! is still sampled without materializing the graph.
 */
const YANKELOVICH_MAX_N = 40;
const YANKELOVICH_FIELD_SIZE_OPTIONS: readonly number[] = Array.from(
  { length: 27 },
  (_, i) => 600 + i * 100
);
const YANKELOVICH_DEFAULT_FIELD_SIZE = 1200;
const YANKELOVICH_NOISE_FLOOR_OPTIONS: readonly number[] = Array.from(
  { length: 20 },
  (_, i) => i * 5
);
const YANKELOVICH_DEFAULT_SAMPLE_COUNT = 50_000;
const YANKELOVICH_SAMPLE_COUNT_STEP = 50_000;
const YANKELOVICH_SAMPLE_STEP_OPTIONS: readonly number[] = [
  1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000,
];

// Like Yankelovich's "Random vertices", the sampled-lines count is the number
// of representatives accepted; each is drawn with its 2n symmetric copies, so
// the line count is up to 2n× this. Kept modest because alpha-blended lines
// saturate the disk past a few thousand, hiding the envelope structure.
const SAMPLED_REPS_DEFAULT = 500;
const SAMPLED_REPS_STEP = 100;
const SAMPLED_REPS_MAX = 200_000;
const SAMPLED_CONTRAST_RANGE: readonly number[] = Array.from(
  { length: 101 },
  (_, i) => i
);

function clampSampledRepCount(count: number, n: number): number {
  // Cap at the number of distinct representatives that actually exist in the
  // fundamental sector ((n-1)!/2): at small n there simply aren't more.
  const sectorMax = yankelovichDihedralSectorVertexCount(n);
  const hi = Math.min(SAMPLED_REPS_MAX, sectorMax);
  const lo = Math.min(SAMPLED_REPS_STEP, hi);
  const parsed = Number.isFinite(count) ? Math.round(count) : SAMPLED_REPS_DEFAULT;
  return Math.max(lo, Math.min(hi, parsed));
}

const YANKELOVICH_TONES: readonly YankelovichTone[] = [
  "log",
  "equalize",
  "clahe",
];
const YANKELOVICH_DEFAULT_TONE: YankelovichTone = "clahe";
const YANKELOVICH_TONE_LABELS: Record<YankelovichTone, string> = {
  log: "Log",
  equalize: "Equalize",
  clahe: "CLAHE (local, default)",
};
const YANKELOVICH_COLORMAPS: readonly YankelovichColormap[] = [
  "gray",
  "viridis",
  "magma",
  "inferno",
  "stained",
];
const YANKELOVICH_COLORMAP_LABELS: Record<YankelovichColormap, string> = {
  gray: "Grayscale",
  viridis: "Viridis",
  magma: "Magma",
  inferno: "Inferno",
  stained: "Stained glass",
};

/** The kaleidoscope reads as stained glass; everything else defaults to gray. */
function defaultColormapFor(preset: GraphPreset): YankelovichColormap {
  return preset === "kaleidoscope" ? "stained" : "gray";
}

/** Highest n offered for a given preset + renderer combination. */
function maxNForRenderer(preset: GraphPreset, renderer: Renderer): number {
  if (renderer === "yankelovich" && preset === "simplex") {
    return SIMPLEX_YANKELOVICH_N_OPTIONS[SIMPLEX_YANKELOVICH_N_OPTIONS.length - 1];
  }
  if (renderer === "yankelovich" && usesAnalyticYankelovich(preset)) {
    return YANKELOVICH_MAX_N;
  }
  if (renderer === "sampled" && supportsSampledLines(preset)) {
    return YANKELOVICH_MAX_N;
  }
  return graphMaxN(preset);
}

function nOptionsForRenderer(
  preset: GraphPreset,
  renderer: Renderer
): readonly number[] {
  if (
    preset === "coxeter-a" ||
    preset === "coxeter-b" ||
    preset === "coxeter-d"
  ) {
    return Array.from(
      { length: maxNForRenderer(preset, renderer) - 2 },
      (_, i) => i + 3
    );
  }
  if (preset === "simplex" && renderer === "yankelovich") {
    return N_OPTIONS.filter((option) => option <= graphMaxN(preset));
  }
  return N_OPTIONS.filter((option) => option <= maxNForRenderer(preset, renderer));
}

function displayVertexCount(
  n: number,
  preset: GraphPreset,
  renderer: Renderer,
  simplexFactorial = false
): number {
  return preset === "simplex" && renderer === "yankelovich" && simplexFactorial
    ? simplexYankelovichVertexCount(n)
    : graphVertexCount(n, preset);
}

function displayEdgeCount(
  n: number,
  preset: GraphPreset,
  renderer: Renderer,
  simplexFactorial = false
): number {
  if (preset === "simplex" && renderer === "yankelovich" && simplexFactorial) {
    return simplexYankelovichEdgeCount(n);
  }
  return graphEdgeCount(n, preset);
}

function hypercubeRecursiveCoords(graph: PancakeGraph): Float64Array {
  const coords = new Float64Array(graph.path.length * 2);
  const pad = 0.08;
  const size = 2 - 2 * pad;

  for (let i = 0; i < graph.path.length; i++) {
    const bits = graph.path[i];
    let x0 = -1 + pad;
    let x1 = x0 + size;
    let y0 = -1 + pad;
    let y1 = y0 + size;
    let mirrorX = false;
    let mirrorY = false;

    for (let bitIndex = 0; bitIndex < bits.length; bitIndex++) {
      const bit = bits[bitIndex];
      const splitX = bitIndex % 2 === 0;
      if (splitX) {
        const mid = (x0 + x1) / 2;
        const visualBit = bit ^ (mirrorX ? 1 : 0);
        if (visualBit === 0) x1 = mid;
        else x0 = mid;
        if (bit === 1) mirrorX = !mirrorX;
      } else {
        const mid = (y0 + y1) / 2;
        const visualBit = bit ^ (mirrorY ? 1 : 0);
        if (visualBit === 0) y1 = mid;
        else y0 = mid;
        if (bit === 1) mirrorY = !mirrorY;
      }
    }

    coords[2 * i] = (x0 + x1) / 2;
    coords[2 * i + 1] = (y0 + y1) / 2;
  }

  return coords;
}

function displayEdgesPerVertex(
  n: number,
  preset: GraphPreset,
  renderer: Renderer,
  simplexFactorial = false
): number | null {
  if (preset === "simplex" && renderer === "yankelovich" && simplexFactorial) {
    return simplexYankelovichVertexCount(n) - 1;
  }
  return graphEdgesPerVertex(n, preset);
}

interface NSelectOption {
  value: string;
  n: number;
  simplexFactorial: boolean;
}

function nSelectOptionsForRenderer(
  preset: GraphPreset,
  renderer: Renderer
): readonly NSelectOption[] {
  const options = nOptionsForRenderer(preset, renderer).map((n) => ({
    value: `n:${n}`,
    n,
    simplexFactorial: false,
  }));
  if (preset !== "simplex" || renderer !== "yankelovich") return options;
  return [
    ...options,
    ...SIMPLEX_YANKELOVICH_N_OPTIONS.map((n) => ({
      value: `f:${n}`,
      n,
      simplexFactorial: true,
    })),
  ];
}

function nSelectValue(n: number, simplexFactorial: boolean): string {
  return `${simplexFactorial ? "f" : "n"}:${n}`;
}

function parseNSelectValue(value: string): NSelectOption {
  const simplexFactorial = value.startsWith("f:");
  const n = Number(value.slice(2));
  return {
    value,
    n: Number.isFinite(n) ? n : DEFAULT_N,
    simplexFactorial,
  };
}

function nOptionLabel(option: NSelectOption, preset: GraphPreset, renderer: Renderer): string {
  if (preset === "kaleidoscope") {
    return `${option.n} mirrors · ${degreesLabel(180 / option.n)} wedge`;
  }
  const prefix = option.simplexFactorial ? `n = ${option.n}!` : `n = ${option.n}`;
  return `${prefix} — ${vertexCountLabel(
    displayVertexCount(option.n, preset, renderer, option.simplexFactorial)
  )} vertices`;
}

/** Number of quotient blocks = n·(n-1)···(n-depth+1). */
function quotientBlockCount(n: number, depth: number): number {
  let r = 1;
  for (let i = 0; i < depth; i++) r *= n - i;
  return r;
}

/** Quotient depth that best shows the recursive block structure for a graph. */
function defaultQuotientDepth(n: number, preset: GraphPreset): number {
  const opts = quotientDepthOptions(n, preset);
  if (opts.length === 0) return 1;
  return opts.includes(2) ? 2 : opts[opts.length - 1];
}
const MIN_ZOOM = 0.5;
const ZOOM_FACTOR = 1.5;
const VIEW_PARAM_PRECISION = 3;
const WHEEL_LINE_HEIGHT = 16;
const WHEEL_DELTA_LINE = 1;
const WHEEL_DELTA_PAGE = 2;
const STAGE_INFO_BAR_CLEARANCE = 52;

function viewParam(value: number): string {
  return Number(value.toFixed(VIEW_PARAM_PRECISION)).toString();
}

function hasCustomView(zoom: number, pan: { x: number; y: number }): boolean {
  return (
    Math.abs(zoom - 1) > 1e-6 ||
    Math.abs(pan.x) > 1e-6 ||
    Math.abs(pan.y) > 1e-6
  );
}

function yankelovichStageSize(stageSize: {
  width: number;
  height: number;
}): number {
  const { width, height } = stageSize;
  const inset = Math.max(0, Math.min(height - 1, STAGE_INFO_BAR_CLEARANCE));
  const availableH = Math.max(1, height - inset);
  return Math.max(1, Math.min(width, availableH));
}

function yankelovichViewportForView(
  stageSize: { width: number; height: number },
  zoom: number,
  pan: { x: number; y: number }
): YankelovichFieldViewport {
  const size = yankelovichStageSize(stageSize);
  return {
    centerX: (-2 * pan.x) / (zoom * size),
    centerY: (-2 * pan.y) / (zoom * size),
    scale: 1 / zoom,
  };
}

/** Inverse of {@link yankelovichViewportForView}: place the given map-space
 * center (in the [-1, 1] full-graph frame) at the middle of the stage. */
function panForYankelovichCenter(
  stageSize: { width: number; height: number },
  zoom: number,
  center: { x: number; y: number }
): { x: number; y: number } {
  const size = yankelovichStageSize(stageSize);
  return {
    x: (-center.x * zoom * size) / 2,
    y: (-center.y * zoom * size) / 2,
  };
}

interface RunMetrics {
  vertices: number;
  cayleyEdges: number;
  cycleEdges: number;
  rnEdges: number;
  evenEdges: number;
  oddEdges: number;
  elapsedMs: number;
  timings: PhaseTiming[];
}

interface PhaseTiming {
  id: string;
  label: string;
  elapsedMs: number;
}

const BUILD_PHASE_LABELS: Record<string, string> = {
  cycle: "Order",
  index: "Index",
  parity: "Classify",
  edges: "Edges",
  lite: "Graph",
};

const RENDERERS: readonly Renderer[] = [
  "svg",
  "canvas",
  "density",
  "quotient",
  "symmetry",
  "yankelovich",
  "sampled",
];

const SYMMETRY_COLORING_LABELS: Record<SymmetryColoring, string> = {
  parity: "Default",
  orbit: "Cₙ orbit (rotation)",
  dihedral: "Dₙ orbit (reflection)",
  blocks: "Blocks (first symbol)",
};
const SYMMETRY_COLORINGS = Object.keys(
  SYMMETRY_COLORING_LABELS
) as SymmetryColoring[];
const ZAKS_FUNDAMENTAL_VIEWS: readonly ZaksFundamentalView[] = [
  "wedge",
  "circle",
  "flat",
];

const ORBIT_PARTS: readonly OrbitParts[] = ["both", "rotations", "reflections"];

// Generous allowed list for the piece/axis indices; the renderer clamps to the
// valid count for the current n, so the exact upper bound is not critical.
const DOMAIN_INDEX_RANGE: readonly number[] = Array.from(
  { length: 44 },
  (_, i) => i
);
const SLIDER_RANGE: readonly number[] = Array.from(
  { length: 100 },
  (_, i) => i + 1
);
// Dihedral recursion level m for the vertex-orbit overlay (3…n); the renderer
// clamps to [3, n], so the exact upper bound here is not critical.
const LEVEL_RANGE: readonly number[] = Array.from({ length: 38 }, (_, i) => i + 3);
const HYPERCUBE_LAYOUTS = ["circle", "recursive"] as const;
type HypercubeLayout = (typeof HYPERCUBE_LAYOUTS)[number];

/** The n a preset starts at: the global default, clamped to its maximum. */
function defaultNFor(preset: GraphPreset): NValue {
  return Math.min(DEFAULT_N, graphMaxN(preset)) as NValue;
}

interface GraphState {
  n: NValue;
  preset: GraphPreset;
  renderer: Renderer;
  simplexFactorial: boolean;
  symmetryColoring: SymmetryColoring;
  zaksFundamentalOnly: boolean;
  zaksFundamentalView: ZaksFundamentalView;
  showDihedralAxes: boolean;
  showSymmetryAxes: boolean;
  showFundamentalDomain: boolean;
  domainPiece: number;
  domainAxis: number;
  showVertexOrbit: boolean;
  vertexOrbitIndex: number;
  vertexOrbitParts: OrbitParts;
  vertexOrbitLongOnly: boolean;
  vertexOrbitLevel: number;
  vertexOrbitStack: boolean;
  orbitEdgeA: number;
  orbitEdgeB: number;
  showLabels: boolean;
  alpha: number;
  width: number;
  zoom: number;
  panX: number;
  panY: number;
  yankelovichGamma: number;
  yankelovichFieldSize: number;
  yankelovichNoiseFloor: number;
  yankelovichBinary: boolean;
  yankelovichInvert: boolean;
  yankelovichTone: YankelovichTone;
  yankelovichColormap: YankelovichColormap;
  yankelovichSampleCount: number;
  yankelovichSampleSeed: number;
  kaleidoscopeLevel: number;
  sampledRepCount: number;
  sampledContrast: number;
  quotientDepth: number;
  hypercubeLayout: HypercubeLayout;
}

// The kaleidoscope's density is picked from five discrete levels; each maps to a
// base-ribbon count tuned to render as a nice rosette.
const KALEIDOSCOPE_LEVELS: readonly number[] = [8, 14, 22, 34, 50];
const KALEIDOSCOPE_LEVEL_VALUES: readonly number[] = [1, 2, 3, 4, 5];
const KALEIDOSCOPE_DEFAULT_LEVEL = 3;
const KALEIDOSCOPE_LEVEL_LABELS: Record<number, string> = {
  1: "1 — minimal",
  2: "2 — sparse",
  3: "3 — balanced",
  4: "4 — dense",
  5: "5 — maximal",
};

/** Base-ribbon count for a kaleidoscope level (1…5). */
function kaleidoscopeStrokesForLevel(level: number): number {
  const i = Math.max(1, Math.min(KALEIDOSCOPE_LEVELS.length, Math.round(level)));
  return KALEIDOSCOPE_LEVELS[i - 1];
}

/** Restore the explorer's controls from the URL query string (deep linking). */
function readGraphState(params: URLSearchParams | null): GraphState {
  const preset = readEnumParam(params, "g", GRAPH_PRESETS, "pancake-zaks");

  let renderer = readEnumParam(params, "r", RENDERERS, "svg");
  if (requiresYankelovich(preset)) renderer = "yankelovich";
  if (renderer === "quotient" && !supportsQuotient(preset)) renderer = "svg";
  if (renderer === "symmetry" && !supportsSymmetry({ preset })) renderer = "svg";
  if (renderer === "yankelovich" && !supportsYankelovich(preset)) renderer = "svg";
  if (renderer === "sampled" && !supportsSampledLines(preset)) renderer = "svg";
  if (isVariableCoxeterRootPreset(preset) && renderer === "svg") renderer = "canvas";

  // The n ceiling depends on the renderer: Yankelovich samples chords, so it
  // reaches n = 40 where the other renderers top out at graphMaxN(preset).
  const allowedN = nOptionsForRenderer(preset, renderer);
  const n = readIntParam(params, "n", allowedN, defaultNFor(preset)) as NValue;
  const simplexFactorial =
    preset === "simplex" &&
    renderer === "yankelovich" &&
    n >= SIMPLEX_YANKELOVICH_N_OPTIONS[0] &&
    readEnumParam(params, "sf", ["0", "1"], "0") === "1";

  // Sampled lines wants bold, thick strokes by default (its accumulation +
  // tone-map expects them); other renderers use a density-appropriate guess.
  const rec =
    renderer === "sampled" && supportsSampledLines(preset)
      ? { alpha: 100, width: 50 }
      : recommendedEdgeSliders(n, preset);

  return {
    n,
    preset,
    renderer,
    simplexFactorial,
    symmetryColoring: readEnumParam(params, "sc", SYMMETRY_COLORINGS, "parity"),
    zaksFundamentalOnly:
      readEnumParam(params, "zfw", ["0", "1"], "0") === "1",
    zaksFundamentalView: readEnumParam(
      params,
      "zfv",
      ZAKS_FUNDAMENTAL_VIEWS,
      "wedge"
    ),
    showDihedralAxes: readEnumParam(params, "ax", ["0", "1"], "0") === "1",
    showSymmetryAxes: readEnumParam(params, "sym", ["0", "1"], "0") === "1",
    showFundamentalDomain: readEnumParam(params, "fd", ["0", "1"], "0") === "1",
    domainPiece: readIntParam(params, "dp", DOMAIN_INDEX_RANGE, 0),
    domainAxis: readIntParam(params, "da", DOMAIN_INDEX_RANGE, 0),
    showVertexOrbit: readEnumParam(params, "vo", ["0", "1"], "0") === "1",
    vertexOrbitIndex: readNonNegIntParam(params, "vi"),
    vertexOrbitParts: readEnumParam(params, "vp", ORBIT_PARTS, "both"),
    vertexOrbitLongOnly: readEnumParam(params, "vl", ["0", "1"], "0") === "1",
    vertexOrbitLevel: readIntParam(params, "vlvl", LEVEL_RANGE, n),
    vertexOrbitStack: readEnumParam(params, "vst", ["0", "1"], "0") === "1",
    orbitEdgeA: readNonNegIntParam(params, "ea", -1),
    orbitEdgeB: readNonNegIntParam(params, "eb", -1),
    showLabels: readEnumParam(params, "lbl", ["0", "1"], "0") === "1",
    alpha: readIntParam(params, "alpha", SLIDER_RANGE, rec.alpha),
    width: readIntParam(params, "width", SLIDER_RANGE, rec.width),
    zoom: readNumberParam(params, "z", 1, MIN_ZOOM),
    panX: readNumberParam(params, "px", 0),
    panY: readNumberParam(params, "py", 0),
    yankelovichGamma: readIntParam(params, "yg", SLIDER_RANGE, 50),
    yankelovichFieldSize: readIntParam(
      params,
      "yfs",
      YANKELOVICH_FIELD_SIZE_OPTIONS,
      YANKELOVICH_DEFAULT_FIELD_SIZE
    ),
    yankelovichNoiseFloor: readIntParam(
      params,
      "ynf",
      YANKELOVICH_NOISE_FLOOR_OPTIONS,
      0
    ),
    yankelovichBinary: readEnumParam(params, "yb", ["0", "1"], "0") === "1",
    yankelovichInvert: readEnumParam(params, "yi", ["0", "1"], "0") === "1",
    yankelovichTone: readEnumParam(
      params,
      "yt",
      YANKELOVICH_TONES,
      YANKELOVICH_DEFAULT_TONE
    ),
    yankelovichColormap: readEnumParam(
      params,
      "ycm",
      YANKELOVICH_COLORMAPS,
      defaultColormapFor(preset)
    ),
    yankelovichSampleCount: clampYankelovichSampleCount(
      readNonNegIntParam(params, "ysc", YANKELOVICH_DEFAULT_SAMPLE_COUNT),
      n,
      preset,
      renderer,
      simplexFactorial
    ),
    yankelovichSampleSeed: readNonNegIntParam(params, "yseed", 0),
    kaleidoscopeLevel: readIntParam(
      params,
      "kst",
      KALEIDOSCOPE_LEVEL_VALUES,
      KALEIDOSCOPE_DEFAULT_LEVEL
    ),
    sampledRepCount: clampSampledRepCount(
      readNonNegIntParam(params, "srp", SAMPLED_REPS_DEFAULT),
      n
    ),
    sampledContrast: readIntParam(params, "sct", SAMPLED_CONTRAST_RANGE, 50),
    quotientDepth: readIntParam(
      params,
      "depth",
      quotientDepthOptions(n, preset),
      defaultQuotientDepth(n, preset)
    ),
    hypercubeLayout: readEnumParam(params, "hy", HYPERCUBE_LAYOUTS, "circle"),
  };
}

export function PancakeGraphView() {
  const searchParams = useSearchParams();
  const initial = useMemo(() => readGraphState(searchParams), [searchParams]);
  const [n, setN] = useState<NValue>(initial.n);
  const [kaleidoscopeLevel, setKaleidoscopeLevel] = useState<number>(
    initial.kaleidoscopeLevel
  );
  const [preset, setPreset] = useState<GraphPreset>(initial.preset);
  const [renderer, setRenderer] = useState<Renderer>(initial.renderer);
  const [hypercubeLayout, setHypercubeLayout] = useState<HypercubeLayout>(
    initial.hypercubeLayout
  );
  const [simplexFactorial, setSimplexFactorial] = useState(
    initial.simplexFactorial
  );
  const [graph, setGraph] = useState<PancakeGraph | null>(null);
  const [metrics, setMetrics] = useState<RunMetrics | null>(null);
  const [status, setStatus] = useState<string>("Ready.");
  const [running, setRunning] = useState(false);
  // The build (running) and the actual draw are separate phases: for large
  // graphs the SVG string + DOM injection can take a while *after* the graph is
  // ready, so we surface it as its own "Rendering…" state.
  const [isRendering, setIsRendering] = useState(false);
  // The Yankelovich density field has a heavy compute phase (sampling /
  // rasterizing the chords) distinct from the cheap draw; surfaced separately so
  // the user sees "Computing…" then "Rendering…".
  const [isComputing, setIsComputing] = useState(false);
  // Distribution of the Yankelovich matrix values, surfaced from the cached
  // field so the sidebar can show a histogram.
  const [yankelovichHistogram, setYankelovichHistogram] =
    useState<YankelovichHistogram | null>(null);
  const [yankelovichTimings, setYankelovichTimings] = useState<PhaseTiming[]>([]);
  const [yankelovichField, setYankelovichField] = useState<number | null>(null);
  const [yankelovichMatrixEdges, setYankelovichMatrixEdges] =
    useState<number | null>(null);
  const [yankelovichStage, setYankelovichStage] = useState<string | null>(null);
  const [sampledStats, setSampledStats] = useState<{
    lines: number;
    representatives: number;
    distinctRepresentatives: number;
    culled: boolean;
  } | null>(null);
  const [yankelovichTotalMs, setYankelovichTotalMs] = useState<number | null>(null);
  const [radonAnalysis, setRadonAnalysis] = useState<LineSpace | null>(null);
  const [radonComputing, setRadonComputing] = useState(false);
  const [radonSeedWedgeOnly, setRadonSeedWedgeOnly] = useState(false);
  const [radonGridKey, setRadonGridKey] = useState<RadonGridKey>(
    DEFAULT_RADON_GRID_KEY
  );
  const [radonSeedPsi, setRadonSeedPsi] = useState<RadonSeedPsi>(
    DEFAULT_RADON_SEED_PSI
  );
  const [radonFftKey, setRadonFftKey] = useState<RadonFftKey>(
    DEFAULT_RADON_FFT_KEY
  );
  const radonResolution = useMemo<LineSpaceResolution>(() => {
    const grid = radonGridOption(radonGridKey);
    const fft = radonFftOption(radonFftKey);
    return {
      psiBins: grid.psiBins,
      pBins: grid.pBins,
      seedWedgePsiBins: radonSeedPsi,
      autocorrThetaBins: fft.thetaBins,
      autocorrPBins: fft.pBins,
    };
  }, [radonFftKey, radonGridKey, radonSeedPsi]);

  const [settings, setSettings] = useState<RenderSettings>({
    alpha: initial.alpha,
    width: initial.width,
    showCayley: true,
    showCycle: defaultVisibilityFor(initial.preset).showCycle,
    showVertices: defaultVisibilityFor(initial.preset).showVertices,
    showLabels: initial.showLabels,
    parityMode: "off",
    symmetryColoring: initial.symmetryColoring,
    zaksFundamentalOnly: initial.zaksFundamentalOnly,
    zaksFundamentalView: initial.zaksFundamentalView,
    showDihedralAxes: initial.showDihedralAxes,
    showSymmetryAxes: initial.showSymmetryAxes,
    showFundamentalDomain: initial.showFundamentalDomain,
    domainPiece: initial.domainPiece,
    domainAxis: initial.domainAxis,
    showVertexOrbit: initial.showVertexOrbit,
    vertexOrbitIndex: initial.vertexOrbitIndex,
    vertexOrbitParts: initial.vertexOrbitParts,
    vertexOrbitLongOnly: initial.vertexOrbitLongOnly,
    vertexOrbitLevel: initial.vertexOrbitLevel,
    vertexOrbitStack: initial.vertexOrbitStack,
    orbitEdgeA: initial.orbitEdgeA,
    orbitEdgeB: initial.orbitEdgeB,
    yankelovichGamma: initial.yankelovichGamma,
    yankelovichFieldSize: initial.yankelovichFieldSize,
    yankelovichNoiseFloor: initial.yankelovichNoiseFloor,
    yankelovichBinary: initial.yankelovichBinary,
    yankelovichInvert: initial.yankelovichInvert,
    yankelovichTone: initial.yankelovichTone,
    yankelovichColormap: initial.yankelovichColormap,
    yankelovichSampleCount: initial.yankelovichSampleCount,
    yankelovichSampleSeed: initial.yankelovichSampleSeed,
    sampledRepCount: initial.sampledRepCount,
    sampledContrast: initial.sampledContrast,
    hiddenGenerators: [],
  });
  const [yankelovichSampleDraftCount, setYankelovichSampleDraftCount] =
    useState<number>(initial.yankelovichSampleCount);
  const [yankelovichSampleStep, setYankelovichSampleStep] = useState<number>(
    YANKELOVICH_SAMPLE_COUNT_STEP
  );
  const [yankelovichFieldDraftSize, setYankelovichFieldDraftSize] =
    useState<number>(initial.yankelovichFieldSize);
  const [svgExportSize, setSvgExportSize] = useState<number>(2400);
  const [quotientDepth, setQuotientDepth] = useState<number>(initial.quotientDepth);
  const [quotient, setQuotient] = useState<QuotientGraph | null>(null);
  const [quotientLoading, setQuotientLoading] = useState(false);
  const [zoom, setZoom] = useState(initial.zoom);
  const [pan, setPan] = useState({ x: initial.panX, y: initial.panY });
  const [isPanning, setIsPanning] = useState(false);
  // What a click on the graph selects for the fundamental domain, so the axis
  // and the wedge can be picked independently.
  const [domainClickTarget, setDomainClickTarget] = useState<
    "piece" | "axis" | "both"
  >("piece");
  // Vertex-orbit animation: when playing, the chosen vertex advances around the
  // ring in an infinite loop at `orbitSpeed` vertices per second.
  const [orbitPlaying, setOrbitPlaying] = useState(false);
  const [orbitSpeed, setOrbitSpeed] = useState(3);
  const needsTallStage =
    preset === "pancake-zaks" &&
    renderer === "symmetry" &&
    (settings.zaksFundamentalOnly ?? false) &&
    (settings.zaksFundamentalView ?? "wedge") === "circle";

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);
  // Cached fundamental-sector geometry for the canvas symmetry renderer, reused
  // across zoom/pan/alpha/width so only n/size/parity/hidden changes re-enumerate.
  const symSectorCacheRef = useRef<ZaksSymmetrySectors | null>(null);
  // Cached symmetrized density field for the Yankelovich renderer, reused across
  // zoom/pan (and gamma tweaks reuse the float field, repainting only the
  // grayscale bitmap) until Redraw captures a new zoom window.
  const yankelovichCacheRef = useRef<YankelovichFieldCache | null>(null);
  const yankelovichTotalStartRef = useRef<number | null>(null);
  const fallbackYankelovichSeedRef = useRef(1);
  const [yankelovichFieldViewport, setYankelovichFieldViewport] =
    useState<YankelovichFieldViewport | null>(null);
  const initialYankelovichFieldViewportRef = useRef<
    YankelovichFieldViewport | null | undefined
  >(
    hasCustomView(initial.zoom, { x: initial.panX, y: initial.panY })
      ? undefined
      : null
  );
  const panStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  // True once a pointer interaction moved enough to count as a drag, so the
  // ensuing click does not also trigger a fundamental-domain selection.
  const pointerDraggedRef = useRef(false);
  // Active while interacting with the axis handle near the rim; records the
  // press point so a small movement reads as a click (step) vs a drag (free).
  const axisDragRef = useRef(false);
  const axisDownRef = useRef<{ x: number; y: number } | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [canvasDpr, setCanvasDpr] = useState(1);
  const canvasPixelSize = {
    width: Math.floor(stageSize.width * canvasDpr),
    height: Math.floor(stageSize.height * canvasDpr),
  };

  // SVG is never blocked by graph size — the user can always opt into the
  // vector renderer even for dense graphs (it may be slow, but that is their
  // choice).
  const canUseInteractiveSvg = true;
  const activeRenderer: Renderer = renderer;
  // pancake-zaks symmetry is rendered straight from the recursion, so it needs
  // only the O((n-1)!) fundamental sector — never the full n! graph. When this
  // is active we build the lightweight payload instead (and rebuild the full
  // graph lazily if the user switches to a graph-dependent renderer).
  const symmetryLite = preset === "pancake-zaks" && renderer === "symmetry";
  const simplexYankelovichFactorial =
    preset === "simplex" &&
    renderer === "yankelovich" &&
    simplexFactorial &&
    n >= SIMPLEX_YANKELOVICH_N_OPTIONS[0];
  // Analytic random Yankelovich presets avoid materializing the n! graph.
  const analyticYankelovich =
    (usesAnalyticYankelovich(preset) || simplexYankelovichFactorial) &&
    renderer === "yankelovich";
  const yankelovich = supportsYankelovich(preset) && renderer === "yankelovich";
  // The sampled-lines renderer also draws straight from the Zaks recursion (it
  // samples chords analytically), so it uses the same lightweight build path.
  const sampledLines = supportsSampledLines(preset) && renderer === "sampled";
  // The kaleidoscope is always built via its lightweight materializer (never the
  // n! Cayley builder), whatever the renderer.
  const kaleidoscope = isKaleidoscope(preset);
  const liteBuild = symmetryLite || analyticYankelovich || sampledLines || kaleidoscope;
  // Only the kaleidoscope rebuilds on reseed; other presets reseed the field
  // alone, so this stays constant for them and triggers no extra graph builds.
  const kaleidoscopeSeed = kaleidoscope ? settings.yankelovichSampleSeed ?? 0 : 0;
  // Vector renders above this many segments are slow enough to be worth a
  // visible "Rendering…" phase; smaller ones draw synchronously to keep slider
  // tweaks snappy and flicker-free. Symmetry only emits a 1/n sector.
  const svgRenderLoad =
    activeRenderer === "symmetry" && supportsSymmetry({ preset })
      ? graphEdgeCount(n, preset) / n
      : displayEdgeCount(n, preset, renderer, simplexYankelovichFactorial);
  const showRenderProgress =
    (activeRenderer === "svg" || activeRenderer === "symmetry") &&
    svgRenderLoad >= 120_000;
  const availableNOptions = useMemo(
    () => nSelectOptionsForRenderer(preset, renderer),
    [preset, renderer]
  );
  const yankelovichSampleCount = clampYankelovichSampleCount(
    yankelovichSampleDraftCount,
    n,
    preset,
    renderer,
    simplexYankelovichFactorial
  );
  const sampledRepCount = clampSampledRepCount(
    settings.sampledRepCount ?? SAMPLED_REPS_DEFAULT,
    n
  );
  const renderGraph = useMemo<PancakeGraph | null>(() => {
    if (!graph) return null;
    if (graph.preset !== "hypercube" || hypercubeLayout !== "recursive") {
      return graph;
    }
    return { ...graph, coords: hypercubeRecursiveCoords(graph) };
  }, [graph, hypercubeLayout]);

  // Reflect every control in the URL so a given view can be shared and
  // restored, including default values.
  useEffect(() => {
    const viewChanged =
      Math.abs(zoom - 1) > 1e-6 ||
      Math.abs(pan.x) > 1e-6 ||
      Math.abs(pan.y) > 1e-6;
    writeUrlParams({
      g: preset,
      n: String(n),
      r: renderer,
      sf: simplexYankelovichFactorial ? "1" : null,
      parity: null,
      sc: settings.symmetryColoring,
      zfw: settings.zaksFundamentalOnly ? "1" : null,
      zfv:
        settings.zaksFundamentalOnly &&
        (settings.zaksFundamentalView ?? "wedge") !== "wedge"
          ? settings.zaksFundamentalView
          : null,
      ax: settings.showDihedralAxes ? "1" : null,
      sym: settings.showSymmetryAxes ? "1" : null,
      fd: settings.showFundamentalDomain ? "1" : null,
      dp: settings.showFundamentalDomain ? String(settings.domainPiece) : null,
      da: settings.showFundamentalDomain ? String(settings.domainAxis) : null,
      vo: settings.showVertexOrbit ? "1" : null,
      vi: settings.showVertexOrbit ? String(settings.vertexOrbitIndex) : null,
      vp: settings.showVertexOrbit ? settings.vertexOrbitParts : null,
      vl: settings.showVertexOrbit && settings.vertexOrbitLongOnly ? "1" : null,
      vlvl:
        settings.showVertexOrbit && (settings.vertexOrbitLevel ?? n) !== n
          ? String(settings.vertexOrbitLevel)
          : null,
      vst: settings.showVertexOrbit && settings.vertexOrbitStack ? "1" : null,
      ea:
        settings.showVertexOrbit && (settings.orbitEdgeA ?? -1) >= 0
          ? String(settings.orbitEdgeA)
          : null,
      eb:
        settings.showVertexOrbit && (settings.orbitEdgeB ?? -1) >= 0
          ? String(settings.orbitEdgeB)
          : null,
      lbl: settings.showLabels ? "1" : null,
      alpha: String(settings.alpha),
      width: String(settings.width),
      z: viewChanged ? viewParam(zoom) : null,
      px: viewChanged ? viewParam(pan.x) : null,
      py: viewChanged ? viewParam(pan.y) : null,
      yg:
        (settings.yankelovichGamma ?? 50) !== 50
          ? String(settings.yankelovichGamma)
          : null,
      yfs:
        (settings.yankelovichFieldSize ?? YANKELOVICH_DEFAULT_FIELD_SIZE) !==
        YANKELOVICH_DEFAULT_FIELD_SIZE
          ? String(settings.yankelovichFieldSize)
          : null,
      ynf:
        (settings.yankelovichNoiseFloor ?? 0) !== 0
          ? String(settings.yankelovichNoiseFloor)
          : null,
      yb: settings.yankelovichBinary ? "1" : null,
      yi: settings.yankelovichInvert ? "1" : null,
      yt:
        (settings.yankelovichTone ?? YANKELOVICH_DEFAULT_TONE) !==
        YANKELOVICH_DEFAULT_TONE
          ? settings.yankelovichTone
          : null,
      ycm:
        (settings.yankelovichColormap ?? defaultColormapFor(preset)) !==
        defaultColormapFor(preset)
          ? settings.yankelovichColormap
          : null,
      ysc:
        (settings.yankelovichSampleCount ?? YANKELOVICH_DEFAULT_SAMPLE_COUNT) !==
        YANKELOVICH_DEFAULT_SAMPLE_COUNT
          ? String(settings.yankelovichSampleCount)
          : null,
      yseed:
        (settings.yankelovichSampleSeed ?? 0) > 0
          ? String(settings.yankelovichSampleSeed)
          : null,
      kst:
        kaleidoscopeLevel !== KALEIDOSCOPE_DEFAULT_LEVEL
          ? String(kaleidoscopeLevel)
          : null,
      srp:
        (settings.sampledRepCount ?? SAMPLED_REPS_DEFAULT) !==
        SAMPLED_REPS_DEFAULT
          ? String(settings.sampledRepCount)
          : null,
      sct:
        (settings.sampledContrast ?? 50) !== 50
          ? String(settings.sampledContrast)
          : null,
      depth: String(quotientDepth),
      hy:
        preset === "hypercube" && hypercubeLayout !== "circle"
          ? hypercubeLayout
          : null,
    });
  }, [
    n,
    preset,
    renderer,
    hypercubeLayout,
    simplexYankelovichFactorial,
    settings.symmetryColoring,
    settings.zaksFundamentalOnly,
    settings.zaksFundamentalView,
    settings.showDihedralAxes,
    settings.showSymmetryAxes,
    settings.showFundamentalDomain,
    settings.domainPiece,
    settings.domainAxis,
    settings.showVertexOrbit,
    settings.vertexOrbitIndex,
    settings.vertexOrbitParts,
    settings.vertexOrbitLongOnly,
    settings.vertexOrbitLevel,
    settings.vertexOrbitStack,
    settings.orbitEdgeA,
    settings.orbitEdgeB,
    settings.showLabels,
    settings.alpha,
    settings.width,
    zoom,
    pan.x,
    pan.y,
    settings.yankelovichGamma,
    settings.yankelovichFieldSize,
    settings.yankelovichNoiseFloor,
    settings.yankelovichBinary,
    settings.yankelovichInvert,
    settings.yankelovichTone,
    settings.yankelovichColormap,
    settings.yankelovichSampleCount,
    settings.yankelovichSampleSeed,
    kaleidoscopeLevel,
    settings.sampledRepCount,
    settings.sampledContrast,
    quotientDepth,
  ]);

  useEffect(() => {
    const ac = new AbortController();
    const signal = ac.signal;

    const run = async () => {
      if (yankelovich) flushSync(() => setRunning(true));
      else setRunning(true);
      const t0 = performance.now();
      if (yankelovich) {
        yankelovichTotalStartRef.current = t0;
        setYankelovichTotalMs(null);
      } else {
        yankelovichTotalStartRef.current = null;
        setYankelovichTotalMs(null);
        setYankelovichStage(null);
      }
      const timings: PhaseTiming[] = [];
      let activePhase: string | null = null;
      let activePhaseStart = t0;
      const startPhase = (phase: string) => {
        const now = performance.now();
        if (activePhase) {
          timings.push({
            id: activePhase,
            label: BUILD_PHASE_LABELS[activePhase] ?? activePhase,
            elapsedMs: Math.round(now - activePhaseStart),
          });
        }
        activePhase = phase;
        activePhaseStart = now;
      };
      const finishPhase = () => {
        if (!activePhase) return;
        const now = performance.now();
        timings.push({
          id: activePhase,
          label: BUILD_PHASE_LABELS[activePhase] ?? activePhase,
          elapsedMs: Math.round(now - activePhaseStart),
        });
        activePhase = null;
      };
      try {
        if (liteBuild) {
          // Built from the recursive sector or the O(n²) sampling payload, with
          // no path/edge arrays. Yield one frame first: otherwise setRunning(true)
          // and the blocking build run in the same task and the browser never
          // paints the loading spinner until everything is already done.
          const graphStatus =
            simplexYankelovichFactorial
              ? `Computing ${graphPresetLabel(preset)} for n = ${n}!…`
              : `Computing ${graphPresetLabel(preset)} symmetry for n = ${n}…`;
          if (yankelovich) {
            flushSync(() => {
              setYankelovichStage("Graph");
              setStatus(graphStatus);
            });
          } else {
            setStatus(graphStatus);
          }
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve())
          );
          if (signal.aborted) return;
          startPhase("lite");
          // Past the enumeration ceiling (n ≥ 12) even the (n-1)! fundamental
          // sector is too large to materialize; the Yankelovich renderer samples
          // chords analytically, so hand it the O(n²) sampling payload instead.
          const g =
            preset === "random-cyclic"
              ? buildRandomCyclicSamplingGraph(n)
              : simplexYankelovichFactorial
                ? buildSimplexSamplingGraph(n)
              : preset === "random-dihedral"
              ? buildRandomDihedralSamplingGraph(n)
              : preset === "wedge-clipped-dihedral"
                ? buildWedgeClippedDihedralSamplingGraph(n)
                : preset === "kaleidoscope"
                ? buildKaleidoscopeSamplingGraph(
                    n,
                    settings.yankelovichSampleSeed ?? 0,
                    kaleidoscopeStrokesForLevel(kaleidoscopeLevel)
                  )
                : (yankelovich || sampledLines) && factorial(n - 1) > 4_000_000
                  ? buildZaksSamplingGraph(n)
                  : buildZaksSymmetryGraph(n);
          if (signal.aborted) return;
          finishPhase();
          setGraph(g);
          setSettings((s) => {
            const initialHidden = defaultHiddenGenerators(g);
            const unchanged =
              s.hiddenGenerators.length === initialHidden.length &&
              s.hiddenGenerators.every((id, i) => id === initialHidden[i]);
            return unchanged ? s : { ...s, hiddenGenerators: initialHidden };
          });
          setMetrics({
            // The kaleidoscope has no n! Cayley structure; report what is
            // actually drawn (segments and their endpoints).
            vertices: isKaleidoscope(preset)
              ? g.path.length
              : displayVertexCount(
                  n,
                  preset,
                  renderer,
                  simplexYankelovichFactorial
                ),
            cayleyEdges: isKaleidoscope(preset)
              ? g.edges.length / 3
              : displayEdgeCount(
                  n,
                  preset,
                  renderer,
                  simplexYankelovichFactorial
                ),
            cycleEdges: factorial(n),
            rnEdges: preset === "pancake-zaks" ? n : 0,
            evenEdges: g.evenEdgeCount,
            oddEdges: g.oddEdgeCount,
            elapsedMs: Math.round(performance.now() - t0),
            timings: [...timings],
          });
          setStatus("Ready.");
          return;
        }
        setStatus(`Computing ${graphPresetLabel(preset)} for n = ${n}…`);
        const g = await buildPancakeGraph(
          n,
          preset,
          (phase, done, total) => {
            if (signal.aborted) return;
            if (phase !== activePhase) startPhase(phase);
            const pct = ((done / total) * 100).toFixed(1);
            const label =
              phase === "cycle"
                ? `Ordering vertices: ${formatUiNumber(done)} / ${formatUiNumber(total)} (${pct}%)`
                : phase === "index"
                  ? `Indexing vertices: ${formatUiNumber(done)} / ${formatUiNumber(total)} (${pct}%)`
                : phase === "edges"
                  ? `Building edges: ${formatUiNumber(done)} / ${formatUiNumber(total)} (${pct}%)`
                  : phase === "parity"
                    ? `Classifying vertices: ${formatUiNumber(done)} / ${formatUiNumber(total)} (${pct}%)`
                    : phase;
            setStatus(label);
          },
          signal
        );
        if (signal.aborted) return;
        finishPhase();
        setGraph(g);
        // Different presets/n use different generator-id schemes, so reset the
        // hide-list to the new graph's default (empty for most graphs; the
        // short reversals for large pancake graphs — see defaultHiddenGenerators).
        setSettings((s) => {
          const initialHidden = defaultHiddenGenerators(g);
          const unchanged =
            s.hiddenGenerators.length === initialHidden.length &&
            s.hiddenGenerators.every((id, i) => id === initialHidden[i]);
          return unchanged ? s : { ...s, hiddenGenerators: initialHidden };
        });
        const elapsed = Math.round(performance.now() - t0);
        setMetrics({
          vertices: g.path.length,
          cayleyEdges: g.edges.length / 3,
          cycleEdges: g.flips.length,
          rnEdges: g.rn.length,
          evenEdges: g.evenEdgeCount,
          oddEdges: g.oddEdgeCount,
          elapsedMs: elapsed,
          timings: [...timings],
        });
        setStatus("Ready.");
      } catch (e) {
        if (signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
          return;
        }
        setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (!signal.aborted) setRunning(false);
      }
    };

    const id = setTimeout(() => void run(), 0);
    return () => {
      ac.abort();
      clearTimeout(id);
    };
  }, [
    n,
    preset,
    liteBuild,
    yankelovich,
    sampledLines,
    simplexYankelovichFactorial,
    kaleidoscopeSeed,
    kaleidoscopeLevel,
  ]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        setStageSize({ width: cr.width, height: cr.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const updateCanvasDpr = () => {
      setCanvasDpr(Math.max(1, Math.min(3, window.devicePixelRatio || 1)));
    };
    updateCanvasDpr();
    window.addEventListener("resize", updateCanvasDpr);
    return () => window.removeEventListener("resize", updateCanvasDpr);
  }, []);

  useEffect(() => {
    if (activeRenderer !== "canvas" && activeRenderer !== "density") return;
    const canvas = canvasRef.current;
    if (!canvas || !renderGraph) return;
    const { width, height } = stageSize;
    if (width === 0 || height === 0) return;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const edgeMode: EdgeRenderMode =
      activeRenderer === "density" ? "density" : "line";
    drawToCanvas(ctx, {
      graph: renderGraph,
      settings: { ...settings, edgeMode },
      cssWidth: width,
      cssHeight: height,
      dpr,
      zoom,
      panX: pan.x,
      panY: pan.y,
    });
  }, [activeRenderer, renderGraph, settings, stageSize, pan.x, pan.y, zoom]);

  // Build the coarsened quotient when that renderer is active. It only needs
  // per-block counts, so even the n = 10 pancake (3.6M vertices) collapses to a
  // few hundred weighted super-edges — cheap to draw and full of structure.
  useEffect(() => {
    if (activeRenderer !== "quotient") return;
    // The radio is disabled for unsupported presets and selectPreset switches
    // away from quotient, so an unsupported graph here means a stale render
    // pass — bail without touching state.
    if (!graph || !supportsQuotient(graph.preset)) return;
    const ac = new AbortController();
    const signal = ac.signal;

    const run = async () => {
      setQuotient(null);
      setQuotientLoading(true);
      setStatus(`Coarsening (depth ${quotientDepth})…`);
      try {
        const q = await buildQuotientGraph(
          graph,
          quotientDepth,
          (done, total) => {
            if (signal.aborted) return;
            setStatus(`Coarsening: ${((done / total) * 100).toFixed(0)}%`);
          },
          signal
        );
        if (signal.aborted) return;
        setQuotient(q);
        setStatus(
          `Quotient — ${formatUiNumber(q.blockCount)} blocks, ${formatUiNumber(q.totalSuperEdges)} super-edges.`
        );
      } catch (e) {
        if (signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
          return;
        }
        setStatus(`Quotient error: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (!signal.aborted) setQuotientLoading(false);
      }
    };

    const id = setTimeout(() => void run(), 0);
    return () => {
      ac.abort();
      clearTimeout(id);
    };
  }, [activeRenderer, graph, quotientDepth]);

  useEffect(() => {
    if (activeRenderer !== "quotient") return;
    const canvas = canvasRef.current;
    if (!canvas || !quotient) return;
    const { width, height } = stageSize;
    if (width === 0 || height === 0) return;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawQuotientToCanvas(ctx, {
      quotient,
      settings,
      cssWidth: width,
      cssHeight: height,
      dpr,
      zoom,
      panX: pan.x,
      panY: pan.y,
    });
  }, [activeRenderer, quotient, settings, stageSize, pan.x, pan.y, zoom]);

  useEffect(() => {
    // pancake-zaks symmetry renders to canvas (see the effect below) to avoid a
    // multi-GB SVG render tree at large n, so the SVG host only handles the flat
    // renderer and the non-zaks symmetry fallback here.
    if (symmetryLite) return;
    if (activeRenderer !== "svg" && activeRenderer !== "symmetry") return;
    const host = svgHostRef.current;
    if (!host || !renderGraph) return;
    // Square SVG with a viewBox — CSS scales it to fill the stage. The symmetry
    // renderer falls back to the flat one if the graph lacks the n-fold layout.
    const useSymmetry =
      activeRenderer === "symmetry" && supportsSymmetry(renderGraph);
    const render = !useSymmetry
      ? toSVG
      : renderGraph.preset === "pancake-zaks"
        ? toZaksSymmetrySVG
        : toSymmetrySVG;
    const draw = () => {
      const svg = render({ graph: renderGraph, settings, size: SVG_VIEWBOX });
      host.innerHTML = svg
        .replace(`width="${SVG_VIEWBOX}"`, 'width="100%"')
        .replace(`height="${SVG_VIEWBOX}"`, 'height="100%"');
    };

    // Light graphs draw inline (no flicker on slider tweaks). Heavy ones are
    // deferred a frame so the "Rendering…" indicator can paint before the
    // (blocking) string build + DOM injection runs.
    if (!showRenderProgress) {
      draw();
      return;
    }
    // Defer past a paint so the "Rendering…" indicator is visible while the
    // blocking string build + DOM injection runs. All state changes happen in
    // these async callbacks (and cleanup), never synchronously in the body.
    let cancelled = false;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      if (cancelled) return;
      setIsRendering(true);
      setStatus(`Rendering n = ${renderGraph.n}…`);
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        draw();
        setIsRendering(false);
        setStatus("Ready.");
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      setIsRendering(false);
    };
  }, [symmetryLite, activeRenderer, renderGraph, settings, showRenderProgress]);

  // Sampled-lines renderer (pancake-zaks only): draws a random subset of the rₙ
  // matching as a single vector <path> in the SVG host, so zoom/pan reuse the
  // crisp viewBox path below. Like Yankelovich, the sample is bound to a
  // captured zoom window (set on Redraw): live zoom/pan only re-aims the
  // viewBox, while Redraw re-samples, concentrating lines on the visible region.
  // Heavy samples are deferred a frame behind the "Rendering…" indicator.
  useEffect(() => {
    if (!sampledLines) return;
    const host = svgHostRef.current;
    if (!host || !graph) return;
    if (initialYankelovichFieldViewportRef.current === undefined) {
      initialYankelovichFieldViewportRef.current = yankelovichViewportForView(
        stageSize,
        zoom,
        { x: pan.x, y: pan.y }
      );
    }
    const activeFieldViewport =
      yankelovichFieldViewport ?? initialYankelovichFieldViewportRef.current;
    const draw = () => {
      const res = toSampledLinesSVG({
        n: graph.n,
        settings,
        size: SVG_VIEWBOX,
        viewport: activeFieldViewport,
      });
      host.innerHTML = res.svg
        .replace(`width="${SVG_VIEWBOX}"`, 'width="100%"')
        .replace(`height="${SVG_VIEWBOX}"`, 'height="100%"');
      return res;
    };
    const heavy = (settings.sampledRepCount ?? 0) * 2 * graph.n >= 80_000;
    if (!heavy) {
      const res = draw();
      // Publish stats in a frame so it never cascades a synchronous re-render.
      const id = requestAnimationFrame(() =>
        setSampledStats({
          lines: res.lines,
          representatives: res.representatives,
          distinctRepresentatives: res.distinctRepresentatives,
          culled: res.culled,
        })
      );
      return () => cancelAnimationFrame(id);
    }
    let cancelled = false;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      if (cancelled) return;
      setIsRendering(true);
      setStatus(`Rendering n = ${graph.n}…`);
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        const res = draw();
        setSampledStats({
          lines: res.lines,
          representatives: res.representatives,
          distinctRepresentatives: res.distinctRepresentatives,
          culled: res.culled,
        });
        setIsRendering(false);
        setStatus("Ready.");
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      setIsRendering(false);
    };
    // zoom/pan intentionally excluded: live view only re-aims the viewBox; the
    // sample is rebound on Redraw (which sets yankelovichFieldViewport).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sampledLines, graph, settings, yankelovichFieldViewport, stageSize]);

  // Canvas symmetry renderer for pancake-zaks: draws the fundamental sector and
  // composites n rotated copies, with pixel-bound memory instead of the SVG
  // render tree. Sector geometry is cached, so only n/size/parity/hidden changes
  // re-enumerate; zoom/pan/alpha/width reuse it and draw inline.
  useEffect(() => {
    if (!symmetryLite) return;
    const canvas = canvasRef.current;
    if (!canvas || !graph) return;
    const { width, height } = stageSize;
    if (width === 0 || height === 0) return;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const draw = () => {
      drawZaksSymmetryToCanvas(ctx, {
        n: graph.n,
        settings,
        cssWidth: width,
        cssHeight: height,
        dpr,
        zoom,
        panX: pan.x,
        panY: pan.y,
        cache: symSectorCacheRef,
      });
    };

    // Only the first draw of a new sector enumerates; cache hits (zoom/pan/
    // alpha/width) draw inline so they stay smooth and flicker-free.
    const hiddenKey = [...new Set(settings.hiddenGenerators)]
      .sort((a, b) => a - b)
      .join(",");
    const key = `${graph.n}|${Math.floor(width * dpr)}x${Math.floor(
      height * dpr
    )}|${settings.symmetryColoring ?? "parity"}|${hiddenKey}|${
      settings.zaksFundamentalOnly
        ? `fund-${settings.zaksFundamentalView ?? "wedge"}`
        : "full"
    }`;
    const cacheMiss = symSectorCacheRef.current?.key !== key;

    if (!cacheMiss || !showRenderProgress) {
      draw();
      return;
    }
    let cancelled = false;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      if (cancelled) return;
      setIsRendering(true);
      setStatus(`Rendering n = ${graph.n}…`);
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        draw();
        setIsRendering(false);
        setStatus("Ready.");
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      setIsRendering(false);
    };
  }, [symmetryLite, graph, settings, stageSize, zoom, pan.x, pan.y, showRenderProgress]);

  // Yankelovich density-field renderer. Pancake Zaks uses the analytic Dₙ field;
  // other graphs sample their materialized edges. Redraw can bind the matrix to
  // the current zoom window; zoom/pan alone still repaints inline.
  useEffect(() => {
    if (!yankelovich) return;
    if (running) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height } = stageSize;
    if (width === 0 || height === 0) return;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (initialYankelovichFieldViewportRef.current === undefined) {
      initialYankelovichFieldViewportRef.current = yankelovichViewportForView(
        stageSize,
        zoom,
        { x: pan.x, y: pan.y }
      );
    }
    const activeFieldViewport =
      yankelovichFieldViewport ?? initialYankelovichFieldViewportRef.current;
    const draw = () => {
      drawYankelovichToCanvas(ctx, {
        n,
        graph: graph ?? undefined,
        settings,
        cssWidth: width,
        cssHeight: height,
        dpr,
        zoom,
        panX: pan.x,
        panY: pan.y,
        topInset: STAGE_INFO_BAR_CLEARANCE,
        fieldViewport: activeFieldViewport,
        cache: yankelovichCacheRef,
      });
    };

    // Only a new field (n / resolution / hidden change) rasterizes — heavy at
    // large n; cache hits (zoom/pan/gamma) draw inline so interaction stays
    // smooth. Compare the exact cache key so a resolution bump is treated as a
    // miss and gets the "Computing…" phase.
    const fieldReady =
      yankelovichCacheRef.current?.key ===
      yankelovichFieldKey({
        n,
        graph: graph ?? undefined,
        settings,
        cssWidth: width,
        cssHeight: height,
        dpr,
        fieldViewport: activeFieldViewport,
      });
    // Mirror the cached field's value histogram into state for the sidebar.
    // Always called from a rAF callback (never synchronously in the effect body)
    // so it does not trip the cascading-render lint rule.
    const publishHistogram = () => {
      const entry = yankelovichCacheRef.current;
      setYankelovichHistogram(entry?.histogram ?? null);
      setYankelovichField(entry?.field ?? null);
      setYankelovichMatrixEdges(entry?.matrixEdges ?? null);
    };

    // Cache hits (zoom/pan/gamma/invert) redraw inline; any rebuild (cache miss)
    // goes through the deferred "Computing…" phase, since even the draft now
    // super-samples 4× and is never instant.
    if (fieldReady) {
      setYankelovichTotalMs(null);
      setYankelovichTimings([]);
      const totalT0 = yankelovichTotalStartRef.current ?? performance.now();
      const renderT0 = performance.now();
      draw();
      const canvasMs = performance.now() - renderT0;
      const totalMs = performance.now() - totalT0;
      yankelovichTotalStartRef.current = null;
      const id = requestAnimationFrame(() => {
        setYankelovichTimings([
          { id: "canvas", label: "Canvas", elapsedMs: canvasMs },
        ]);
        setYankelovichTotalMs(totalMs);
        publishHistogram();
      });
      return () => cancelAnimationFrame(id);
    }
    // Two visible phases: the heavy density-field computation (sampling /
    // rasterization) first, then the cheap tone-map + blit. Each is deferred a
    // frame so its indicator can paint before the blocking work runs.
    let cancelled = false;
    let raf2 = 0;
    let raf3 = 0;
    const raf1 = requestAnimationFrame(() => {
      if (cancelled) return;
      if (yankelovichTotalStartRef.current === null) {
        yankelovichTotalStartRef.current = performance.now();
      }
      flushSync(() => {
        setIsComputing(true);
        setYankelovichStage("Matrix");
        setYankelovichTotalMs(null);
        setYankelovichTimings([]);
        setStatus(`Computing field for n = ${n}…`);
      });
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        const fieldTimings: YankelovichFieldTimings = {
          matrixMs: 0,
          symmetryMs: 0,
          matrixEdges: 0,
          viewportMs: 0,
          visibleVertices: 0,
        };
        ensureYankelovichField({
          n,
          graph: graph ?? undefined,
          settings,
          cssWidth: width,
          cssHeight: height,
          dpr,
          fieldViewport: activeFieldViewport,
          cache: yankelovichCacheRef,
          onFieldTimings: (timings) => {
            fieldTimings.matrixMs = timings.matrixMs;
            fieldTimings.symmetryMs = timings.symmetryMs;
            fieldTimings.matrixEdges = timings.matrixEdges;
            fieldTimings.viewportMs = timings.viewportMs;
            fieldTimings.visibleVertices = timings.visibleVertices;
          },
        });
        flushSync(() => {
          setIsComputing(false);
          setIsRendering(true);
          setYankelovichStage("Canvas");
          setStatus(`Rendering n = ${n}…`);
        });
        raf3 = requestAnimationFrame(() => {
          if (cancelled) return;
          const renderT0 = performance.now();
          draw();
          const canvasMs = performance.now() - renderT0;
          const totalT0 = yankelovichTotalStartRef.current ?? renderT0;
          const totalMs = performance.now() - totalT0;
          yankelovichTotalStartRef.current = null;
          setYankelovichTimings(yankelovichPhaseTimings(fieldTimings, canvasMs));
          setYankelovichTotalMs(totalMs);
          publishHistogram();
          setIsRendering(false);
          setYankelovichStage(null);
          setStatus("Ready.");
        });
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      cancelAnimationFrame(raf3);
      setIsComputing(false);
      setIsRendering(false);
      setYankelovichStage(null);
      yankelovichTotalStartRef.current = null;
    };
  }, [
    yankelovich,
    running,
    n,
    preset,
    graph,
    settings,
    stageSize,
    zoom,
    pan.x,
    pan.y,
    yankelovichFieldViewport,
  ]);

  // Zoom/pan for SVG are driven through the viewBox rather than a CSS
  // transform: changing the viewBox re-rasterizes the vectors crisply at
  // any zoom, whereas `transform: scale()` bitmap-scales a 100k-path SVG
  // into a blur. This only mutates an attribute, so it is cheap enough to
  // run on every zoom/pan tick without regenerating the path data.
  useEffect(() => {
    if (
      activeRenderer !== "svg" &&
      activeRenderer !== "symmetry" &&
      activeRenderer !== "sampled"
    )
      return;
    const host = svgHostRef.current;
    const svgEl = host?.querySelector("svg");
    if (!svgEl) return;
    const display = Math.min(stageSize.width, stageSize.height) || SVG_VIEWBOX;
    const pxPerUnit = (display * zoom) / SVG_VIEWBOX;
    const w = SVG_VIEWBOX / zoom;
    const focusX = SVG_VIEWBOX / 2 - pan.x / pxPerUnit;
    const focusY = SVG_VIEWBOX / 2 - pan.y / pxPerUnit;
    svgEl.setAttribute(
      "viewBox",
      `${focusX - w / 2} ${focusY - w / 2} ${w} ${w}`
    );
  }, [activeRenderer, graph, settings, zoom, pan.x, pan.y, stageSize]);

  const downloadSVG = useCallback(() => {
    if (!graph || !renderGraph) return;
    setStatus("Generating SVG…");
    setTimeout(() => {
      try {
        const useSymmetry =
          activeRenderer === "symmetry" && supportsSymmetry(renderGraph);
        const svg = sampledLines
          ? toSampledLinesSVG({
              n: graph.n,
              settings,
              size: svgExportSize,
              viewport: yankelovichFieldViewport,
            }).svg
          : (!useSymmetry
              ? toSVG
              : renderGraph.preset === "pancake-zaks"
                ? toZaksSymmetrySVG
                : toSymmetrySVG)({
              graph: renderGraph,
              settings,
              size: svgExportSize,
            });
        const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const suffix = sampledLines ? "_sampled" : useSymmetry ? "_sym" : "";
        a.download = `${graph.preset}_n${graph.n}${suffix}.svg`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setStatus(`n = ${graph.n} SVG downloaded.`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus(`SVG export error: ${msg}`);
      }
    }, 30);
  }, [activeRenderer, sampledLines, graph, renderGraph, settings, svgExportSize, yankelovichFieldViewport]);

  const downloadPNG = useCallback(() => {
    if (!graph || !renderGraph) return;
    setStatus("Generating PNG…");
    setTimeout(() => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = svgExportSize;
        canvas.height = svgExportSize;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Could not create canvas context.");

        if (sampledLines) {
          // Rasterize the vector sample through an <img>, so the PNG matches
          // the on-screen lines without a separate canvas line-drawing path.
          const svg = toSampledLinesSVG({
            n: graph.n,
            settings,
            size: svgExportSize,
            viewport: yankelovichFieldViewport,
          }).svg;
          const blob = new Blob([svg], {
            type: "image/svg+xml;charset=utf-8",
          });
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            ctx.drawImage(img, 0, 0, svgExportSize, svgExportSize);
            URL.revokeObjectURL(url);
            canvas.toBlob((pngBlob) => {
              if (!pngBlob) {
                setStatus("PNG export error: could not encode image.");
                return;
              }
              const pngUrl = URL.createObjectURL(pngBlob);
              const a = document.createElement("a");
              a.href = pngUrl;
              a.download = `${graph.preset}_n${graph.n}_sampled.png`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(pngUrl);
              setStatus(`n = ${graph.n} PNG downloaded.`);
            }, "image/png");
          };
          img.onerror = () => {
            URL.revokeObjectURL(url);
            setStatus("PNG export error: could not rasterize sample.");
          };
          img.src = url;
          return;
        }

        if (symmetryLite) {
          drawZaksSymmetryToCanvas(ctx, {
            n: graph.n,
            settings,
            cssWidth: svgExportSize,
            cssHeight: svgExportSize,
            dpr: 1,
          });
        } else if (yankelovich) {
          // Match the on-screen view: the square export shows exactly the
          // currently visible window of the graph (zoom/pan included), and
          // reuses the field bound to that window for identical pixels.
          const visible = yankelovichViewportForView(stageSize, zoom, pan);
          const activeFieldViewport =
            yankelovichFieldViewport ??
            initialYankelovichFieldViewportRef.current ??
            visible;
          const exportZoom = 1 / visible.scale;
          drawYankelovichToCanvas(ctx, {
            n: graph.n,
            graph: renderGraph,
            settings,
            cssWidth: svgExportSize,
            cssHeight: svgExportSize,
            dpr: 1,
            zoom: exportZoom,
            panX: (-visible.centerX * exportZoom * svgExportSize) / 2,
            panY: (-visible.centerY * exportZoom * svgExportSize) / 2,
            fieldViewport: activeFieldViewport,
          });
        } else if (activeRenderer === "quotient") {
          if (!quotient) throw new Error("Quotient is still building.");
          drawQuotientToCanvas(ctx, {
            quotient,
            settings,
            cssWidth: svgExportSize,
            cssHeight: svgExportSize,
            dpr: 1,
          });
        } else {
          const edgeMode: EdgeRenderMode =
            activeRenderer === "density" ? "density" : "line";
          drawToCanvas(ctx, {
            graph: renderGraph,
            settings: { ...settings, edgeMode },
            cssWidth: svgExportSize,
            cssHeight: svgExportSize,
            dpr: 1,
          });
        }

        canvas.toBlob((blob) => {
          if (!blob) {
            setStatus("PNG export error: could not encode image.");
            return;
          }
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${graph.preset}_n${graph.n}.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          setStatus(`n = ${graph.n} PNG downloaded.`);
        }, "image/png");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus(`PNG export error: ${msg}`);
      }
    }, 30);
  }, [activeRenderer, symmetryLite, sampledLines, yankelovich, graph, renderGraph, quotient, settings, svgExportSize, stageSize, zoom, pan, yankelovichFieldViewport]);

  const svgDownloadDisabled = useMemo(() => {
    if (!graph) return true;
    if (
      activeRenderer === "density" ||
      activeRenderer === "quotient" ||
      activeRenderer === "yankelovich"
    )
      return true;
    // The symmetry renderer emits an ~n× smaller file (one sector + rotations),
    // so it stays exportable exactly where the flat SVG would be too large.
    if (activeRenderer === "symmetry" && supportsSymmetry(graph)) return false;
    // Sampled lines are a single <path> with a bounded number of segments, so
    // the file size depends on the sample count, never on n.
    if (activeRenderer === "sampled") return false;
    // Gate on vertex count rather than n: the sliding puzzle reaches millions
    // of states at a small n, where an SVG file would be unusably large.
    return (
      graph.kind !== "hypercube" &&
      graphVertexCount(graph.n, graph.preset) >= 300_000
    );
  }, [activeRenderer, graph]);

  const imageDownloadDisabled = !graph;

  const currentYankelovichViewport = (): YankelovichFieldViewport => {
    return yankelovichViewportForView(stageSize, zoom, pan);
  };

  const setS = <K extends keyof RenderSettings>(
    key: K,
    value: RenderSettings[K]
  ) => setSettings((s) => ({ ...s, [key]: value }));

  const setYankelovichDraftStep = (delta: number) => {
    setYankelovichSampleDraftCount((value) =>
      clampYankelovichSampleCount(
        value + delta,
        n,
        preset,
        renderer,
        simplexYankelovichFactorial
      )
    );
  };

  // The sampled-lines count applies live (re-rendering is cheap), unlike the
  // Yankelovich count which is batched into Redraw with the field rebuild.
  const setSampledRepStep = (delta: number) => {
    setS("sampledRepCount", clampSampledRepCount(sampledRepCount + delta, n));
  };

  const newRandomSeed = () =>
    (typeof crypto !== "undefined" && "getRandomValues" in crypto
      ? crypto.getRandomValues(new Uint32Array(1))[0]
      : fallbackYankelovichSeedRef.current++) || 1;

  // Random presets (random-cyclic / -dihedral / wedge-clipped) derive their
  // entire matching from the sample seed, so a fresh seed is a brand-new random
  // graph. Unlike Redraw this keeps the sample count/field-size drafts intact.
  const regenerateRandomGraph = () => {
    setSettings((s) => ({ ...s, yankelovichSampleSeed: newRandomSeed() }));
    initialYankelovichFieldViewportRef.current = null;
    setYankelovichFieldViewport(currentYankelovichViewport());
  };

  const redrawYankelovichSample = () => {
    if (sampledLines) {
      // Like Yankelovich: bind the sample to the current zoom window and reseed,
      // so lines concentrate on the visible region.
      setS("yankelovichSampleSeed", newRandomSeed());
      initialYankelovichFieldViewportRef.current = null;
      setYankelovichFieldViewport(currentYankelovichViewport());
      return;
    }
    if (isKaleidoscope(preset)) {
      // The kaleidoscope is deterministic (reseeding is "New pattern"): redraw
      // only rebinds the field to the current zoom/pan window and resolution.
      setSettings((s) => ({ ...s, yankelovichFieldSize: yankelovichFieldDraftSize }));
      initialYankelovichFieldViewportRef.current = null;
      setYankelovichFieldViewport(currentYankelovichViewport());
      return;
    }
    setSettings((s) => ({
      ...s,
      yankelovichFieldSize: yankelovichFieldDraftSize,
      yankelovichSampleCount,
      yankelovichSampleSeed: newRandomSeed(),
    }));
    initialYankelovichFieldViewportRef.current = null;
    setYankelovichFieldViewport(currentYankelovichViewport());
  };

  const generateRadonAnalysis = useCallback(() => {
    if (!graph || radonComputing) return;
    if (graph.preset === "pancake-zaks" && graph.n > 10) return;
    setRadonComputing(true);
    setStatus("Computing Radon space…");
    window.setTimeout(() => {
      try {
        const analysis = buildPancakeGraphLineSpace(graph, {
          sampleCount: settings.yankelovichSampleCount,
          sampleSeed: settings.yankelovichSampleSeed,
          hiddenGenerators: settings.hiddenGenerators,
          resolution: radonResolution,
        });
        setRadonAnalysis(analysis);
        setStatus("Ready.");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus(`Radon space error: ${msg}`);
      } finally {
        setRadonComputing(false);
      }
    }, 30);
  }, [
    graph,
    radonComputing,
    radonResolution,
    settings.hiddenGenerators,
    settings.yankelovichSampleCount,
    settings.yankelovichSampleSeed,
  ]);

  const resetViewForGraph = (
    nextN: number,
    nextPreset: GraphPreset,
    nextRenderer: Renderer = renderer,
    nextSimplexFactorial = simplexFactorial
  ) => {
    // Switching graph or n changes the whole layout, so any prior
    // zoom/pan no longer makes sense — snap the view back to fit.
    setZoom(1);
    setPan({ x: 0, y: 0 });
    initialYankelovichFieldViewportRef.current = null;
    setYankelovichFieldViewport(null);
    setRadonAnalysis(null);
    setRadonSeedWedgeOnly(false);

    // Edge density changes too, so move the strength/width sliders to a
    // density-appropriate recommendation for the new graph. The sampled-lines
    // renderer instead wants bold, thick strokes (its accumulation + tone-map
    // expects them), so it keeps its own strong defaults.
    const rec =
      nextRenderer === "sampled" && supportsSampledLines(nextPreset)
        ? { alpha: 100, width: 50 }
        : recommendedEdgeSliders(nextN, nextPreset);
    const nextYankelovichSampleCount = clampYankelovichSampleCount(
      YANKELOVICH_DEFAULT_SAMPLE_COUNT,
      nextN,
      nextPreset,
      nextRenderer,
      nextSimplexFactorial
    );
    setSettings((s) => ({
      ...s,
      alpha: rec.alpha,
      width: rec.width,
      showCycle: defaultVisibilityFor(nextPreset).showCycle,
      showVertices: defaultVisibilityFor(nextPreset).showVertices,
      vertexOrbitLevel: nextN,
      yankelovichSampleCount: nextYankelovichSampleCount,
      sampledRepCount: clampSampledRepCount(SAMPLED_REPS_DEFAULT, nextN),
    }));
    setYankelovichSampleDraftCount(nextYankelovichSampleCount);

    // Reset the quotient depth to the new graph's best default.
    setQuotientDepth(defaultQuotientDepth(nextN, nextPreset));
  };

  const selectN = (value: string) => {
    const option = parseNSelectValue(value);
    const nextN = option.n as NValue;
    setSimplexFactorial(option.simplexFactorial);
    setN(nextN);
    resetViewForGraph(nextN, preset, renderer, option.simplexFactorial);
  };

  const selectPreset = (value: string) => {
    const nextPreset = value as GraphPreset;
    let nextRenderer: Renderer = requiresYankelovich(nextPreset) ? "yankelovich" : renderer;
    if (isVariableCoxeterRootPreset(nextPreset) && nextRenderer === "svg") {
      nextRenderer = "canvas";
    }
    const nextSimplexFactorial = false;
    const nextN = Math.min(
      DEFAULT_N,
      maxNForRenderer(nextPreset, nextRenderer)
    ) as NValue;
    // The quotient view only applies to full-permutation graphs; fall back to
    // Canvas when the new family does not support it.
    if (renderer === "quotient" && !supportsQuotient(nextPreset)) {
      setRenderer("canvas");
    }
    // The symmetry renderer only applies to the Zaks pancake layout.
    if (renderer === "symmetry" && !supportsSymmetry({ preset: nextPreset })) {
      setRenderer("svg");
    }
    // Sampled lines only apply to layouts that support analytic chord sampling.
    if (renderer === "sampled" && !supportsSampledLines(nextPreset)) {
      setRenderer("svg");
    }
    if (requiresYankelovich(nextPreset)) {
      setRenderer("yankelovich");
    }
    if (isVariableCoxeterRootPreset(nextPreset) && renderer === "svg") {
      setRenderer("canvas");
    }
    setSimplexFactorial(nextSimplexFactorial);
    // Follow the new family's default colour map unless the user picked one.
    setSettings((s) => {
      const current = s.yankelovichColormap ?? defaultColormapFor(preset);
      return current === defaultColormapFor(preset)
        ? { ...s, yankelovichColormap: defaultColormapFor(nextPreset) }
        : s;
    });
    setPreset(nextPreset);
    // Switching graph family resets n to the default, clamped to the new
    // preset's maximum (some presets, e.g. the sliding puzzle, top out lower).
    setN(nextN);
    resetViewForGraph(nextN, nextPreset, nextRenderer, nextSimplexFactorial);
  };

  const zoomOut = () => {
    setZoom((value) => Math.max(MIN_ZOOM, value / ZOOM_FACTOR));
  };

  const zoomIn = () => {
    setZoom((value) => value * ZOOM_FACTOR);
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    initialYankelovichFieldViewportRef.current = null;
    setYankelovichFieldViewport(null);
  };

  // Pan the stage by clicking/dragging on the viewport minimap: the picked
  // point (in the map's [-1, 1] frame) becomes the new center of the view.
  const navigateToViewportCenter = (center: { x: number; y: number }) => {
    if (zoom <= 1) return;
    setPan(panForYankelovichCenter(stageSize, zoom, center));
  };

  const handlePanStart = (event: PointerEvent<HTMLDivElement>) => {
    pointerDraggedRef.current = false;
    if (event.button !== 0) return;
    // Grab the axis when pressing near the rim (the axis handle band), so the
    // user can drag the axis around the circle. Takes precedence over panning.
    if (settings.showFundamentalDomain) {
      const g = pointerGeom(event);
      if (g && g.radius > 0 && g.dist > 0.72 * g.radius) {
        // Grab the rim: a small movement is a click (step/jump on release),
        // a larger one is a free drag (handled in move).
        axisDragRef.current = true;
        axisDownRef.current = { x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    }
    if (zoom <= 1) return;
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
    if (axisDragRef.current) {
      const start = axisDownRef.current;
      if (
        start &&
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4
      ) {
        pointerDraggedRef.current = true; // promoted to a free drag
      }
      if (pointerDraggedRef.current) {
        const g = pointerGeom(event);
        if (g) setS("domainAxis", axisFromAngle(g.angle));
      }
      return;
    }
    const start = panStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) {
      pointerDraggedRef.current = true;
    }
    setPan({
      x: start.panX + event.clientX - start.x,
      y: start.panY + event.clientY - start.y,
    });
  };

  const handlePanEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (axisDragRef.current) {
      axisDragRef.current = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      // A click (no drag): jump to the nearest axis, or — when already on it
      // (e.g. clicking an arrow) — step one toward the click's side.
      if (!pointerDraggedRef.current) {
        const g = pointerGeom(event);
        if (g) {
          const cur = (((settings.domainAxis ?? 0) % n) + n) % n;
          const nearest = axisFromAngle(g.angle);
          if (nearest !== cur) {
            setS("domainAxis", nearest);
          } else {
            const off = -Math.PI / factorial(n);
            const d0 = ((g.angle - (off + cur * (Math.PI / n))) % Math.PI + Math.PI) % Math.PI;
            const d = d0 > Math.PI / 2 ? d0 - Math.PI : d0;
            if (Math.abs(d) > 1e-3) {
              setS("domainAxis", (cur + (d > 0 ? 1 : -1) + n) % n);
            }
          }
        }
      }
      pointerDraggedRef.current = true; // suppress the trailing onClick
      return;
    }
    const start = panStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    panStartRef.current = null;
    setIsPanning(false);
  };

  const handleWheelPan = (event: WheelEvent<HTMLDivElement>) => {
    if (zoom <= 1) return;
    event.preventDefault();

    const deltaMultiplier =
      event.deltaMode === WHEEL_DELTA_LINE
        ? WHEEL_LINE_HEIGHT
        : event.deltaMode === WHEEL_DELTA_PAGE
          ? Math.max(stageSize.height, WHEEL_LINE_HEIGHT)
          : 1;

    setPan((value) => ({
      x: value.x - event.deltaX * deltaMultiplier,
      y: value.y - event.deltaY * deltaMultiplier,
    }));
  };

  const selectedPresetLabel = graphPresetLabel(preset);
  const selectedPresetDescription = graphPresetDescription(preset);
  const selectedDistanceHistogram = useMemo(() => {
    if (!graph) return [];
    const hidden = new Set(settings.hiddenGenerators);
    const totals = new Map<number, EdgeDistanceBin>();

    for (const gen of graph.generators) {
      if (hidden.has(gen.id)) continue;
      for (const bin of gen.distanceBins ?? []) {
        const existing = totals.get(bin.minDegrees);
        if (existing) {
          existing.count += bin.count;
        } else {
          totals.set(bin.minDegrees, { ...bin });
        }
      }
    }

    return Array.from(totals.values()).sort(
      (a, b) => a.minDegrees - b.minDegrees
    );
  }, [graph, settings.hiddenGenerators]);
  const selectedJumpHistogram = useMemo<JumpHistogramBin[]>(() => {
    if (!graph || !metrics) return [];
    const hidden = new Set(settings.hiddenGenerators);
    const vertexCount = metrics.vertices;
    const maxJump = Math.max(1, Math.floor(vertexCount / 2));

    if (graph.edges.length > 0 && graph.path.length > 0) {
      const binCount = Math.min(32, Math.max(1, maxJump));
      const counts = new Array<number>(binCount).fill(0);
      for (let t = 0; t < graph.edges.length; t += 3) {
        if (hidden.has(graph.edges[t + 2])) continue;
        const raw = Math.abs(graph.edges[t + 1] - graph.edges[t]);
        const jump = Math.min(raw, vertexCount - raw);
        const index = Math.min(
          binCount - 1,
          Math.floor(((Math.max(1, jump) - 1) / maxJump) * binCount)
        );
        counts[index]++;
      }
      return counts
        .map((count, index) => ({
          minJump: Math.floor((index / binCount) * maxJump) + 1,
          maxJump: Math.max(
            Math.floor(((index + 1) / binCount) * maxJump),
            Math.floor((index / binCount) * maxJump) + 1
          ),
          count,
        }))
        .filter((bin) => bin.count > 0);
    }

    return selectedDistanceHistogram.map((bin) => ({
      minJump: Math.max(1, Math.floor((bin.minDegrees / 180) * maxJump) + 1),
      maxJump: Math.max(
        1,
        Math.floor((bin.maxDegrees / 180) * maxJump)
      ),
      count: bin.count,
    }));
  }, [graph, metrics, selectedDistanceHistogram, settings.hiddenGenerators]);
  const selectedGeneratorCount = useMemo(() => {
    if (!graph) return 0;
    const hidden = new Set(settings.hiddenGenerators);
    return graph.generators.filter((gen) => !hidden.has(gen.id)).length;
  }, [graph, settings.hiddenGenerators]);
  const hypercubeGraySequence = useMemo(() => {
    if (!graph || graph.preset !== "hypercube" || graph.n > 5) return null;
    return {
      generators: graph.flips.map((id) => `b${id}`),
      vertices: graph.path.map((vertex) => Array.from(vertex).join("")),
    };
  }, [graph]);

  // Cₙ orbit table: only meaningful for the pancake-zaks layout, where the
  // index ring matches the fundamental-sector enumeration, and only legible at
  // small n (the same range the orbit coloring itself stays readable).
  const orbitTable = useMemo<OrbitInfo[]>(
    () => (preset === "pancake-zaks" && n <= 5 ? computeZaksOrbits(n) : []),
    [preset, n]
  );
  const showOrbitTable =
    orbitTable.length > 0 &&
    (settings.symmetryColoring ?? "parity") === "orbit" &&
    (renderer === "symmetry" || renderer === "canvas" || renderer === "svg");

  const domainPieceCount = n;
  const vertexCount = factorial(n);
  const canShowVertexLabels =
    activeRenderer !== "quotient" &&
    !yankelovich &&
    (graph
      ? supportsVertexLabels(graph)
      : n <= VERTEX_LABEL_MAX_N &&
        preset !== "sliding-puzzle" &&
        preset !== "sierpinski");
  // Dihedral recursion level for the vertex-orbit overlay, clamped to [3, n].
  const orbitLevel = Math.min(Math.max(settings.vertexOrbitLevel ?? n, 3), n);
  const stackLevels = Array.from(
    { length: n - orbitLevel + 1 },
    (_, i) => n - i
  );

  // Stop the animation if the vertex-orbit overlay is turned off, so the
  // play/pause state never lingers while the controls are hidden.
  useEffect(() => {
    if (settings.showVertexOrbit || !orbitPlaying) return;
    const id = requestAnimationFrame(() => setOrbitPlaying(false));
    return () => cancelAnimationFrame(id);
  }, [settings.showVertexOrbit, orbitPlaying]);

  // Vertex-orbit animation loop: advance the chosen vertex one step at a time
  // around the ring, wrapping forever. Driven by requestAnimationFrame with a
  // time accumulator so the cadence tracks `orbitSpeed` (vertices/second)
  // regardless of frame rate, and speed changes apply immediately.
  const orbitSpeedRef = useRef(orbitSpeed);
  useEffect(() => {
    orbitSpeedRef.current = orbitSpeed;
  }, [orbitSpeed]);
  useEffect(() => {
    if (!orbitPlaying || !settings.showVertexOrbit) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const tick = (now: number) => {
      acc += (now - last) / 1000;
      last = now;
      const step = 1 / Math.max(0.1, orbitSpeedRef.current);
      if (acc >= step) {
        const advance = Math.floor(acc / step);
        acc -= advance * step;
        setSettings((s) => ({
          ...s,
          vertexOrbitIndex:
            ((((s.vertexOrbitIndex ?? 0) + advance) % vertexCount) +
              vertexCount) %
            vertexCount,
          orbitEdgeA: -1,
          orbitEdgeB: -1,
        }));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [orbitPlaying, settings.showVertexOrbit, vertexCount]);

  // Geometry of a pointer event relative to the drawing: the drawing is
  // centered in the stage (offset by the pan), and zoom scales about that
  // center, so the angle/radius around it are computed directly. The drawing
  // radius is ~0.405·min(stage) and scales with zoom (matches the renderers).
  const pointerGeom = (event: PointerEvent<HTMLDivElement>) => {
    const el = stageRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const dx = event.clientX - rect.left - (rect.width / 2 + pan.x);
    const dy = event.clientY - rect.top - (rect.height / 2 + pan.y);
    return {
      dx,
      dy,
      angle: Math.atan2(dy, dx),
      dist: Math.hypot(dx, dy),
      radius: 0.405 * Math.min(rect.width, rect.height) * zoom,
    };
  };

  // Nearest graph edge to a click (in the drawing's centered, zoom-scaled
  // frame), or null if none is within the pick threshold. Vertex i sits at
  // angle 2πi/total on a circle of the given screen radius.
  const nearestEdge = (
    dx: number,
    dy: number,
    radius: number
  ): [number, number] | null => {
    if (!graph || graph.edges.length === 0) return null;
    const total = graph.path.length || factorial(n);
    const { edges } = graph;
    const pt = (i: number): [number, number] => {
      const a = (2 * Math.PI * i) / total;
      return [radius * Math.cos(a), radius * Math.sin(a)];
    };
    let best: [number, number] | null = null;
    let bestD = Math.max(7, radius * 0.02);
    for (let t = 0; t < edges.length; t += 3) {
      const [ax, ay] = pt(edges[t]);
      const [bx, by] = pt(edges[t + 1]);
      const vx = bx - ax;
      const vy = by - ay;
      const len2 = vx * vx + vy * vy || 1;
      let s = ((dx - ax) * vx + (dy - ay) * vy) / len2;
      s = s < 0 ? 0 : s > 1 ? 1 : s;
      const cxp = ax + s * vx;
      const cyp = ay + s * vy;
      const d = Math.hypot(dx - cxp, dy - cyp);
      if (d < bestD) {
        bestD = d;
        best = [edges[t], edges[t + 1]];
      }
    }
    return best;
  };

  const axisFromAngle = (angle: number) => {
    const off = -Math.PI / factorial(n);
    const relAxis = ((angle - off) % Math.PI + Math.PI) % Math.PI;
    return Math.round(relAxis / (Math.PI / n)) % n;
  };

  const pieceFromAngle = (angle: number) => {
    const off = -Math.PI / factorial(n);
    const wedge = (2 * Math.PI) / n;
    const rel = ((angle - off) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    return Math.min(n - 1, Math.floor(rel / wedge));
  };

  // Clicking near the rim grabs the axis (see the pan handlers); interior
  // clicks set the piece (and/or axis) per the "Click sets" mode.
  const handleStageClick = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerDraggedRef.current) return;
    const g = pointerGeom(event);
    if (!g || g.dist < 6) return;
    // Vertex-orbit selection takes priority. Prefer the nearest edge under the
    // click (show that chord's orbit); otherwise pick the nearest vertex (its
    // incident edges' orbit) and clear any selected edge.
    if (settings.showVertexOrbit) {
      const e = nearestEdge(g.dx, g.dy, g.radius);
      if (e) {
        setSettings((s) => ({ ...s, orbitEdgeA: e[0], orbitEdgeB: e[1] }));
        return;
      }
      const total = factorial(n);
      const idx =
        ((Math.round((g.angle / (2 * Math.PI)) * total) % total) + total) % total;
      setSettings((s) => ({
        ...s,
        vertexOrbitIndex: idx,
        orbitEdgeA: -1,
        orbitEdgeB: -1,
      }));
      return;
    }
    if (!settings.showFundamentalDomain) return;
    const piece = pieceFromAngle(g.angle);
    const axis = axisFromAngle(g.angle);
    setSettings((s) => ({
      ...s,
      domainPiece: domainClickTarget === "axis" ? s.domainPiece : piece,
      domainAxis: domainClickTarget === "piece" ? s.domainAxis : axis,
    }));
  };

  const stepTimings = yankelovich ? yankelovichTimings : (metrics?.timings ?? []);
  const canGenerateRadon =
    !!graph && (graph.preset !== "pancake-zaks" || graph.n <= 10);

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <Card className="self-start lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
        <CardHeader className="space-y-1">
          <CardTitle className="text-lg">Graph explorer</CardTitle>
          <CardDescription>
            Vertices use the selected layout and connect by graph generators.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <section className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-sm font-medium">The Graph</h2>
              <p className="text-xs text-muted-foreground">
                Pick the graph family and the dimension/order parameter.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Graph / order
              </Label>
              <Select
                value={preset}
                onValueChange={selectPreset}
                disabled={running}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {GRAPH_PRESETS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {graphPresetLabel(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs leading-snug text-muted-foreground">
                {selectedPresetLabel}: {selectedPresetDescription}.
                {preset === "permutahedron-compressed" ? (
                  <>
                    {" "}
                    The drawing has{" "}
                    <span className="font-medium">
                      {permutahedronCompressionFactor(n)}-fold
                    </span>{" "}
                    rotational symmetry (compression κ = {permutahedronCompressionFactor(n)}).
                  </>
                ) : preset === "asymmetric-tree" ? (
                  <>
                    {" "}
                    Laid out on a Hamilton cycle invariant under a left
                    translation of order{" "}
                    <span className="font-medium">
                      {asymmetricTreeCompressionFactor(n)}
                    </span>
                    , so the drawing has{" "}
                    <span className="font-medium">
                      {asymmetricTreeCompressionFactor(n)}-fold
                    </span>{" "}
                    rotational symmetry.
                  </>
                ) : null}
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                {kaleidoscope ? "Mirrors" : "Value of n"}
              </Label>
              <Select
                value={nSelectValue(n, simplexYankelovichFactorial)}
                onValueChange={selectN}
                disabled={running}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {availableNOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {nOptionLabel(option, preset, renderer)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {preset === "hypercube" ? (
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Layout
                </Label>
                <Select
                  value={hypercubeLayout}
                  onValueChange={(value) =>
                    setHypercubeLayout(value as HypercubeLayout)
                  }
                  disabled={running}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="circle">Circle</SelectItem>
                    <SelectItem value="recursive">Recursive mirror blocks</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {kaleidoscope ? (
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Segments
                </Label>
                <Select
                  value={String(kaleidoscopeLevel)}
                  onValueChange={(v) => setKaleidoscopeLevel(Number(v))}
                  disabled={running}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {KALEIDOSCOPE_LEVEL_VALUES.map((level) => (
                      <SelectItem key={level} value={String(level)}>
                        {KALEIDOSCOPE_LEVEL_LABELS[level]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
              {kaleidoscope ? (
                <>
                  <Stat label="Mirrors" value={n} />
                  <Stat label="Sectors" value={2 * n} />
                  <Stat label="Wedge" value={degreesLabel(180 / n)} />
                  <Stat label="Level" value={`${kaleidoscopeLevel} / 5`} />
                  <Stat label="Segments" value={metrics?.cayleyEdges} full />
                </>
              ) : (
                <>
                  <Stat label="Vertices" value={metrics?.vertices} />
                  <Stat label="Edges" value={metrics?.cayleyEdges} />
                  <Stat
                    label="Degree"
                    value={
                      metrics
                        ? (displayEdgesPerVertex(
                            n,
                            preset,
                            renderer,
                            simplexYankelovichFactorial
                          ) ?? "—")
                        : undefined
                    }
                  />
                </>
              )}
              {yankelovich ? (
                <Stat
                  label="Visible edges"
                  value={yankelovichMatrixEdges ?? undefined}
                  full
                />
              ) : null}
              {sampledLines ? (
                <Stat
                  label="Lines drawn"
                  value={sampledStats?.lines ?? undefined}
                  full
                />
              ) : null}
              {sampledLines ? (
                <Stat
                  label="Distinct reps"
                  value={sampledStats?.distinctRepresentatives ?? undefined}
                  full
                />
              ) : null}
              {sampledLines && sampledStats?.culled ? (
                <Stat
                  label="Visible rate"
                  value={
                    sampledStats && sampledStats.representatives > 0
                      ? `${(
                          (sampledStats.lines /
                            (sampledStats.representatives * 2 * n)) *
                          100
                        ).toFixed(1)}%`
                      : undefined
                  }
                  full
                />
              ) : null}
              {yankelovich ? (
                <Stat
                  label="Matrix size"
                  value={
                    yankelovichField
                      ? `${formatUiNumber(yankelovichField)} × ${formatUiNumber(yankelovichField)}`
                      : undefined
                  }
                  full
                />
              ) : null}
              {yankelovich ? (
                <Stat
                  label="Total time"
                  value={
                    yankelovichTotalMs === null
                      ? undefined
                      : secondsLabel(yankelovichTotalMs)
                  }
                  full
                />
              ) : null}
              <Stat
                label={yankelovich ? "Graph time" : "Time"}
                value={metrics ? secondsLabel(metrics.elapsedMs) : undefined}
                full
              />
              {stepTimings.length ? (
                <div className="col-span-2 flex items-start justify-between gap-3">
                  <dt className="text-xs text-muted-foreground">Steps</dt>
                  <dd className="space-y-0.5 text-right font-mono text-xs">
                    {stepTimings.map((step, i) => (
                      <span key={`${step.id}-${i}`} className="block">
                        {step.label} {secondsLabel(step.elapsedMs)}
                      </span>
                    ))}
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>

          <Separator />

          <section className="space-y-4">
            <h2 className="text-sm font-medium">The Rendering</h2>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Rendering engine
              </Label>
              <RadioGroup
                value={activeRenderer}
                onValueChange={(v) => {
                  if (requiresYankelovich(preset) && v !== "yankelovich") return;
                  if (v === "svg" && !canUseInteractiveSvg) return;
                  if (v === "quotient" && !supportsQuotient(preset)) return;
                  if (v === "symmetry" && !supportsSymmetry({ preset })) return;
                  if (v === "yankelovich" && !supportsYankelovich(preset)) return;
                  if (v === "sampled" && !supportsSampledLines(preset)) return;
                  const next = v as Renderer;
                  // Leaving Yankelovich for a renderer that enumerates the graph
                  // must drop n back under that renderer's ceiling.
                  const nextOptions = nOptionsForRenderer(preset, next);
                  const cap = nextOptions[nextOptions.length - 1];
                  const floor = nextOptions[0];
                  const nextN = n > cap ? cap : n < floor ? floor : n;
                  const nextSimplexFactorial =
                    preset === "simplex" &&
                    next === "yankelovich" &&
                    simplexFactorial &&
                    nextN >= SIMPLEX_YANKELOVICH_N_OPTIONS[0];
                  if (
                    nextN !== n ||
                    nextSimplexFactorial !== simplexFactorial
                  ) {
                    setN(nextN as NValue);
                    setSimplexFactorial(nextSimplexFactorial);
                    resetViewForGraph(
                      nextN,
                      preset,
                      next,
                      nextSimplexFactorial
                    );
                  }
                  // The auto edge sliders target the full 10²⁰-edge density, so
                  // they bottom out; a sparse line sample needs visibly stronger
                  // but thin strokes so the chord envelopes read. Seed sensible
                  // defaults on first entry to sampled.
                  if (next === "sampled" && renderer !== "sampled") {
                    setSettings((s) => ({ ...s, alpha: 100, width: 50 }));
                  }
                  setRenderer(next);
                }}
                className="grid grid-cols-2 gap-2"
              >
                <RendererRadio
                  value="svg"
                  label="SVG"
                  checked={activeRenderer === "svg"}
                  disabled={!canUseInteractiveSvg || requiresYankelovich(preset)}
                />
                <RendererRadio
                  value="canvas"
                  label="Canvas"
                  checked={activeRenderer === "canvas"}
                  disabled={requiresYankelovich(preset)}
                />
                <RendererRadio
                  value="density"
                  label="Density"
                  checked={activeRenderer === "density"}
                  disabled={requiresYankelovich(preset)}
                />
                <RendererRadio
                  value="quotient"
                  label="Quotient"
                  checked={activeRenderer === "quotient"}
                  disabled={!supportsQuotient(preset)}
                />
                <RendererRadio
                  value="symmetry"
                  label="Symmetry"
                  checked={activeRenderer === "symmetry"}
                  disabled={!supportsSymmetry({ preset })}
                />
                <RendererRadio
                  value="yankelovich"
                  label="Yankelovich"
                  checked={activeRenderer === "yankelovich"}
                  disabled={!supportsYankelovich(preset)}
                />
                <RendererRadio
                  value="sampled"
                  label="Sampled lines"
                  checked={activeRenderer === "sampled"}
                  disabled={!supportsSampledLines(preset)}
                />
              </RadioGroup>
            </div>

            {(activeRenderer === "symmetry" ||
              activeRenderer === "canvas" ||
              activeRenderer === "svg") &&
            supportsSymmetry({ preset }) ? (
              <div className="space-y-2 rounded-md border border-violet-200 bg-violet-50/40 p-2.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Dihedral color scheme
                </Label>
                <Select
                  value={settings.symmetryColoring ?? "parity"}
                  onValueChange={(v) =>
                    setS("symmetryColoring", v as SymmetryColoring)
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SYMMETRY_COLORINGS.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {SYMMETRY_COLORING_LABELS[mode]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {preset === "pancake-zaks" && activeRenderer === "symmetry" ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground">
                        Scope
                      </span>
                      <div className="inline-flex overflow-hidden rounded-md border">
                        <button
                          type="button"
                          onClick={() => setS("zaksFundamentalOnly", false)}
                          className={`px-2 py-0.5 text-[11px] transition-colors ${
                            !settings.zaksFundamentalOnly
                              ? "bg-violet-600 text-white"
                              : "bg-background hover:bg-muted"
                          }`}
                        >
                          Full
                        </button>
                        <button
                          type="button"
                          onClick={() => setS("zaksFundamentalOnly", true)}
                          className={`px-2 py-0.5 text-[11px] transition-colors ${
                            settings.zaksFundamentalOnly
                              ? "bg-violet-600 text-white"
                              : "bg-background hover:bg-muted"
                          }`}
                        >
                          Fundamental
                        </button>
                      </div>
                    </div>
                    {settings.zaksFundamentalOnly ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          View
                        </span>
                        <div className="inline-flex overflow-hidden rounded-md border">
                          {ZAKS_FUNDAMENTAL_VIEWS.map((view) => (
                            <button
                              key={view}
                              type="button"
                              onClick={() => setS("zaksFundamentalView", view)}
                              className={`px-2 py-0.5 text-[11px] capitalize transition-colors ${
                                (settings.zaksFundamentalView ?? "wedge") ===
                                view
                                  ? "bg-violet-600 text-white"
                                  : "bg-background hover:bg-muted"
                              }`}
                            >
                              {view}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : null}
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {settings.zaksFundamentalOnly ? (
                    <>
                      Fundamental scope shows the 360/(2n) wedge, rₙ only.
                      {(settings.zaksFundamentalView ?? "wedge") === "circle"
                        ? " Bottom circle: n−1 quotient by reflection."
                        : ""}
                    </>
                  ) : settings.symmetryColoring === "orbit" ? (
                    <>
                      One hue per <span className="font-medium">Cₙ orbit</span>{" "}
                      (ρ: i ↦ i+(n-1)!): each color class is a clean rotated
                      n-set at 360/n steps — the decisive rotation test.
                    </>
                  ) : settings.symmetryColoring === "dihedral" ? (
                    <>
                      One hue per <span className="font-medium">Dₙ orbit</span>:
                      like Cₙ orbit, but a chord and its mirror under ω: i ↦
                      (n!−1)−i share a color — the reflection test (≈ half as
                      many colors).
                    </>
                  ) : settings.symmetryColoring === "blocks" ? (
                    <>
                      Dots banded into n arcs by leading symbol (one ρ-block
                      each). Chords split into{" "}
                      <span style={{ color: "#0ea5e9" }}>short within-block</span>{" "}
                      reversals and the{" "}
                      <span style={{ color: "#111827" }}>long rₙ skeleton</span>.
                    </>
                  ) : (
                    <>Default single-color edge drawing.</>
                  )}
                </p>
              </div>
            ) : null}

            {(activeRenderer === "symmetry" ||
              activeRenderer === "canvas" ||
              activeRenderer === "svg") &&
            supportsSymmetry({ preset }) ? (
              <div className="space-y-2 rounded-md border border-violet-200 bg-violet-50/40 p-2.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Symmetry overlays
                </Label>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Drawn on top of any color scheme.
                </p>
                <label className="flex cursor-pointer items-center gap-2 pt-0.5 text-xs">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-violet-600"
                    checked={settings.showDihedralAxes ?? false}
                    onChange={(e) =>
                      setS("showDihedralAxes", e.target.checked)
                    }
                  />
                  <span>
                    Dₙ axis &amp; wedge —{" "}
                    <span style={{ color: "#7c3aed" }}>ω mirror</span> + sector
                    lines +{" "}
                    <span style={{ color: "#059669" }}>Cₙ rotation</span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-violet-600"
                    checked={settings.showSymmetryAxes ?? false}
                    onChange={(e) =>
                      setS("showSymmetryAxes", e.target.checked)
                    }
                  />
                  <span>
                    Axes of symmetry — all n Dₙ mirror lines (
                    <span style={{ color: "#7c3aed" }}>alternating</span>{" "}
                    <span style={{ color: "#ea580c" }}>colors</span> so neighbors
                    differ)
                  </span>
                </label>
              </div>
            ) : null}

            {(activeRenderer === "symmetry" ||
              activeRenderer === "canvas" ||
              activeRenderer === "svg") &&
            supportsSymmetry({ preset }) ? (
              <div className="space-y-2 rounded-md border border-violet-200 bg-violet-50/40 p-2.5">
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-violet-600"
                    checked={settings.showFundamentalDomain ?? false}
                    onChange={(e) =>
                      setS("showFundamentalDomain", e.target.checked)
                    }
                  />
                  <span className="font-medium">Fundamental domain</span>
                </label>
                {settings.showFundamentalDomain ? (
                  <div className="space-y-2.5 pl-5">
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      Highlight one 360/n{" "}
                      <span style={{ color: "#7c3aed" }}>sector</span> (a Cₙ
                      fundamental domain) and tile the disk with its n rotation
                      images. Use the steppers, drag the rim handle to move the{" "}
                      <span style={{ color: "#059669" }}>axis</span>, or click
                      the graph (&ldquo;Click sets&rdquo; chooses what a click
                      moves).
                    </p>
                    <IndexStepper
                      label="Sector"
                      value={
                        (((settings.domainPiece ?? 0) % domainPieceCount) +
                          domainPieceCount) %
                        domainPieceCount
                      }
                      count={domainPieceCount}
                      onChange={(v) => setS("domainPiece", v)}
                    />
                    <IndexStepper
                      label="Axis"
                      value={(((settings.domainAxis ?? 0) % n) + n) % n}
                      count={n}
                      onChange={(v) => setS("domainAxis", v)}
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground">
                        Click sets
                      </span>
                      <div className="inline-flex overflow-hidden rounded-md border">
                        {(["piece", "axis", "both"] as const).map((target) => (
                          <button
                            key={target}
                            type="button"
                            onClick={() => setDomainClickTarget(target)}
                            className={`px-2 py-0.5 text-[11px] capitalize transition-colors ${
                              domainClickTarget === target
                                ? "bg-violet-600 text-white"
                                : "bg-background hover:bg-muted"
                            }`}
                          >
                            {target}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {(activeRenderer === "symmetry" ||
              activeRenderer === "canvas" ||
              activeRenderer === "svg") &&
            supportsSymmetry({ preset }) ? (
              <div className="space-y-2 rounded-md border border-violet-200 bg-violet-50/40 p-2.5">
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-violet-600"
                    checked={settings.showVertexOrbit ?? false}
                    onChange={(e) => setS("showVertexOrbit", e.target.checked)}
                  />
                  <span className="font-medium">Vertex orbit</span>
                </label>
                {settings.showVertexOrbit ? (
                  <div className="space-y-2.5 pl-5">
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      Click an <span className="font-medium">edge</span> to show
                      that chord&apos;s orbit; click empty space (or step) to use
                      a vertex&apos;s incident edges.{" "}
                      The <span style={{ color: "#7c3aed" }}>darker</span> half
                      is the rotation orbit; the{" "}
                      <span style={{ color: "#c4b5fd" }}>lighter</span> half is
                      its mirror across ω. Show picks which halves to draw.
                      {(settings.orbitEdgeA ?? -1) >= 0 &&
                      (settings.orbitEdgeB ?? -1) >= 0 ? (
                        <>
                          {" "}
                          Selected edge: {"{"}
                          {settings.orbitEdgeA}, {settings.orbitEdgeB}
                          {"}"}.
                        </>
                      ) : null}
                    </p>
                    <IndexStepper
                      label="Vertex"
                      value={
                        (((settings.vertexOrbitIndex ?? 0) % vertexCount) +
                          vertexCount) %
                        vertexCount
                      }
                      count={vertexCount}
                      oneBased={false}
                      onChange={(v) =>
                        setSettings((s) => ({
                          ...s,
                          vertexOrbitIndex: v,
                          orbitEdgeA: -1,
                          orbitEdgeB: -1,
                        }))
                      }
                    />
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <Button
                          variant={orbitPlaying ? "default" : "outline"}
                          size="sm"
                          className="h-7 gap-1.5 px-2 text-[11px]"
                          onClick={() => setOrbitPlaying((p) => !p)}
                          aria-label={
                            orbitPlaying ? "Pause animation" : "Play animation"
                          }
                          aria-pressed={orbitPlaying}
                        >
                          {orbitPlaying ? (
                            <Pause className="h-3.5 w-3.5" />
                          ) : (
                            <Play className="h-3.5 w-3.5" />
                          )}
                          {orbitPlaying ? "Pause" : "Animate"}
                        </Button>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {orbitSpeed} v/s
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          Speed
                        </span>
                        <Slider
                          value={[orbitSpeed]}
                          min={1}
                          max={30}
                          step={1}
                          onValueChange={([v]) => setOrbitSpeed(v)}
                          aria-label="Animation speed"
                          className="flex-1"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground">
                        Show
                      </span>
                      <div className="inline-flex overflow-hidden rounded-md border">
                        {ORBIT_PARTS.map((part) => (
                          <button
                            key={part}
                            type="button"
                            onClick={() => setS("vertexOrbitParts", part)}
                            className={`px-2 py-0.5 text-[11px] capitalize transition-colors ${
                              (settings.vertexOrbitParts ?? "both") === part
                                ? "bg-violet-600 text-white"
                                : "bg-background hover:bg-muted"
                            }`}
                          >
                            {part}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-[11px]">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-violet-600"
                        checked={settings.vertexOrbitLongOnly ?? false}
                        onChange={(e) =>
                          setS("vertexOrbitLongOnly", e.target.checked)
                        }
                      />
                      <span>Full reversal rₙ only</span>
                    </label>
                    {settings.vertexOrbitLongOnly ? (
                      <p className="text-[11px] leading-snug text-muted-foreground">
                        rₙ reverses the whole word — it&apos;s &ldquo;long&rdquo;
                        combinatorially, not geometrically. When the reversal
                        lands a near-neighbour in Zaks order the chord is short;
                        the rₙ tag confirms it&apos;s still the full reversal.
                      </p>
                    ) : null}
                    {n >= 4 ? (
                      <div className="space-y-2 border-t border-violet-200/60 pt-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-medium">
                            Nested symmetry D<sub>{orbitLevel}</sub>
                          </span>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            level {orbitLevel} / {n}
                          </span>
                        </div>
                        <Slider
                          value={[orbitLevel]}
                          min={3}
                          max={n}
                          step={1}
                          onValueChange={([v]) => setS("vertexOrbitLevel", v)}
                          aria-label="Dihedral recursion level"
                        />
                        <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                          <span>
                            D<sub>3</sub> deep
                          </span>
                          <span>
                            D<sub>{n}</sub> global
                          </span>
                        </div>
                        <p className="text-[11px] leading-snug text-muted-foreground">
                          The orbit under the level-m dihedral group: the whole
                          disk at m = {n}, shrinking into one ever-smaller Zaks
                          sub-block as m → 3 — the nested tower D<sub>3</sub> ⊂ …
                          ⊂ D<sub>{n}</sub>.
                        </p>
                        <label className="flex cursor-pointer items-center gap-2 text-[11px]">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 accent-violet-600"
                            checked={settings.vertexOrbitStack ?? false}
                            onChange={(e) =>
                              setS("vertexOrbitStack", e.target.checked)
                            }
                          />
                          <span>Stack all levels n → m, colored by depth</span>
                        </label>
                        {settings.vertexOrbitStack ? (
                          <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5">
                            {stackLevels.map((lv) => (
                              <span
                                key={lv}
                                className="inline-flex items-center gap-1 text-[11px]"
                              >
                                <span
                                  className="inline-block h-3 w-3 rounded-sm ring-1 ring-black/10"
                                  style={{ backgroundColor: levelColor(lv, n) }}
                                />
                                <span className="font-mono">
                                  D<sub>{lv}</sub>
                                </span>
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {activeRenderer === "quotient" && supportsQuotient(preset) ? (
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Coarsen depth
                </Label>
                <Select
                  value={String(quotientDepth)}
                  onValueChange={(v) => setQuotientDepth(Number(v))}
                  disabled={running}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {quotientDepthOptions(n, preset).map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        first {d} symbol{d === 1 ? "" : "s"} —{" "}
                        {formatUiNumber(quotientBlockCount(n, d))} blocks
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {yankelovich || sampledLines ? (
              <div className="space-y-2">
                {!isKaleidoscope(preset) ? (
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      {sampledLines || usesAnalyticYankelovich(preset)
                        ? "Random vertices"
                        : "Random edges"}
                    </Label>
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatUiNumber(
                        sampledLines ? sampledRepCount : yankelovichSampleCount
                      )}
                    </span>
                  </div>
                ) : null}
                {sampledLines || usesAnalyticYankelovich(preset) ? (
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Angular sector</span>
                    <span className="font-mono">
                      {formatUiNumber(yankelovichDihedralSectorVertexCount(n))}{" "}
                      · {degreesLabel(180 / n)}
                    </span>
                  </div>
                ) : null}
                {!isKaleidoscope(preset) ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      sampledLines
                        ? setSampledRepStep(-SAMPLED_REPS_STEP)
                        : setYankelovichDraftStep(-yankelovichSampleStep)
                    }
                    disabled={
                      sampledLines
                        ? sampledRepCount <=
                          Math.min(
                            SAMPLED_REPS_STEP,
                            yankelovichDihedralSectorVertexCount(n)
                          )
                        : yankelovichSampleCount <= 1
                    }
                    aria-label="Fewer samples"
                  >
                    <Minus className="size-3.5" />
                    {formatUiNumber(
                      sampledLines ? SAMPLED_REPS_STEP : yankelovichSampleStep
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      sampledLines
                        ? setSampledRepStep(SAMPLED_REPS_STEP)
                        : setYankelovichDraftStep(yankelovichSampleStep)
                    }
                    disabled={
                      sampledLines
                        ? sampledRepCount >=
                          Math.min(
                            SAMPLED_REPS_MAX,
                            yankelovichDihedralSectorVertexCount(n)
                          )
                        : yankelovichSampleCount >=
                          yankelovichSampleMax(n, preset)
                    }
                    aria-label="More samples"
                  >
                    <Plus className="size-3.5" />
                    {formatUiNumber(
                      sampledLines ? SAMPLED_REPS_STEP : yankelovichSampleStep
                    )}
                  </Button>
                </div>
                ) : null}
                {!sampledLines && !isKaleidoscope(preset) ? (
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      Step
                    </Label>
                    <Select
                      value={String(yankelovichSampleStep)}
                      onValueChange={(v) =>
                        setYankelovichSampleStep(Number(v))
                      }
                    >
                      <SelectTrigger className="h-8 w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {YANKELOVICH_SAMPLE_STEP_OPTIONS.map((step) => (
                          <SelectItem key={step} value={String(step)}>
                            {formatUiNumber(step)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                {requiresYankelovich(preset) || isKaleidoscope(preset) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={regenerateRandomGraph}
                    disabled={running || isComputing || isRendering}
                  >
                    <Dices className="size-3.5" />
                    {isKaleidoscope(preset) ? "New pattern" : "New random graph"}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={redrawYankelovichSample}
                  disabled={running || isComputing || isRendering}
                >
                  <Shuffle className="size-3.5" />
                  Redraw
                </Button>
                {sampledLines ? (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                        Caustic contrast
                      </Label>
                      <span className="font-mono text-xs text-muted-foreground">
                        {settings.sampledContrast ?? 50}
                      </span>
                    </div>
                    <Slider
                      value={[settings.sampledContrast ?? 50]}
                      min={0}
                      max={100}
                      step={1}
                      onValueChange={([v]) => setS("sampledContrast", v)}
                    />
                    <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                      <span>flat</span>
                      <span>caustics</span>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {yankelovich ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Matrix size
                  </Label>
                  <span className="font-mono text-xs text-muted-foreground">
                    {yankelovichFieldDraftSize}
                  </span>
                </div>
                <Slider
                  value={[yankelovichFieldDraftSize]}
                  min={YANKELOVICH_FIELD_SIZE_OPTIONS[0]}
                  max={
                    YANKELOVICH_FIELD_SIZE_OPTIONS[
                      YANKELOVICH_FIELD_SIZE_OPTIONS.length - 1
                    ]
                  }
                  step={100}
                  onValueChange={([v]) => setYankelovichFieldDraftSize(v)}
                />
              </div>
            ) : null}

            {yankelovich ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Noise floor
                  </Label>
                  <span className="font-mono text-xs text-muted-foreground">
                    {settings.yankelovichNoiseFloor ?? 0}%
                  </span>
                </div>
                <Slider
                  value={[settings.yankelovichNoiseFloor ?? 0]}
                  min={0}
                  max={95}
                  step={5}
                  onValueChange={([v]) => setS("yankelovichNoiseFloor", v)}
                />
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-primary"
                    checked={settings.yankelovichBinary ?? false}
                    onChange={(e) => setS("yankelovichBinary", e.target.checked)}
                  />
                  <span>Binary mask</span>
                </label>
              </div>
            ) : null}

            {yankelovich ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Tone mapping
                  </Label>
                  <Select
                    value={settings.yankelovichTone ?? YANKELOVICH_DEFAULT_TONE}
                    onValueChange={(v) =>
                      setS("yankelovichTone", v as YankelovichTone)
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {YANKELOVICH_TONES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {YANKELOVICH_TONE_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Colormap
                  </Label>
                  <Select
                    value={
                      settings.yankelovichColormap ?? defaultColormapFor(preset)
                    }
                    onValueChange={(v) =>
                      setS("yankelovichColormap", v as YankelovichColormap)
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {YANKELOVICH_COLORMAPS.map((c) => (
                        <SelectItem key={c} value={c}>
                          {YANKELOVICH_COLORMAP_LABELS[c]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}

            {yankelovich ? (
              <p className="text-[11px] leading-snug text-muted-foreground">
                <span className="font-medium">Equalize</span> /{" "}
                <span className="font-medium">CLAHE</span> are scale-free: they
                reveal the caustic/void web at any n (the log curve flattens it as
                n grows). CLAHE adds local contrast.
              </p>
            ) : null}

            {yankelovich ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Envelope contrast
                  </Label>
                  <span className="font-mono text-xs text-muted-foreground">
                    {settings.yankelovichGamma ?? 50}
                  </span>
                </div>
                <Slider
                  value={[settings.yankelovichGamma ?? 50]}
                  min={1}
                  max={100}
                  step={1}
                  onValueChange={([v]) => setS("yankelovichGamma", v)}
                />
                <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                  <span>faint envelopes</span>
                  <span>bright caustics</span>
                </div>
                <label className="flex cursor-pointer items-center gap-2 pt-1 text-xs">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-primary"
                    checked={settings.yankelovichInvert ?? false}
                    onChange={(e) =>
                      setS("yankelovichInvert", e.target.checked)
                    }
                  />
                  <span>Invert — dark chords on white</span>
                </label>
              </div>
            ) : null}

            {yankelovich ? (
              <FieldHistogram histogram={yankelovichHistogram} />
            ) : null}

            {!yankelovich ? (
            <>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Edge strength
              </Label>
              <span className="font-mono text-xs text-muted-foreground">
                {settings.alpha}
              </span>
            </div>
            <Slider
              value={[settings.alpha]}
              min={1}
              max={100}
              step={1}
              onValueChange={([v]) => setS("alpha", v)}
            />
            <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>light</span>
              <span>dark</span>
            </div>
          </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Edge width
              </Label>
              <span className="font-mono text-xs text-muted-foreground">
                {settings.width}
              </span>
            </div>
            <Slider
              value={[settings.width]}
              min={1}
              max={100}
              step={1}
              onValueChange={([v]) => setS("width", v)}
            />
            <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>thin</span>
              <span>thick</span>
            </div>
          </div>
            </>
            ) : null}

            {canShowVertexLabels ? (
              <div className="space-y-1">
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-primary"
                    checked={settings.showLabels}
                    onChange={(e) => setS("showLabels", e.target.checked)}
                  />
                  <span>Vertex labels</span>
                </label>
              </div>
            ) : null}

            {graph && graph.generators.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Generators
                  </Label>
                  <div className="flex gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <button
                      type="button"
                      className="hover:text-foreground"
                      onClick={() => setS("hiddenGenerators", [])}
                    >
                      all
                    </button>
                    <span className="opacity-40">·</span>
                    <button
                      type="button"
                      className="hover:text-foreground"
                      onClick={() =>
                        setS(
                          "hiddenGenerators",
                          graph.generators.map((g) => g.id)
                        )
                      }
                    >
                      none
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {graph.generators.map((gen) => {
                    const hidden = settings.hiddenGenerators.includes(gen.id);
                    return (
                      <GeneratorChip
                        key={gen.id}
                        label={gen.label}
                        avgArcDegrees={gen.avgArcDegrees}
                        hidden={hidden}
                        onClick={() =>
                          setSettings((s) => {
                            const exists = s.hiddenGenerators.includes(gen.id);
                            return {
                              ...s,
                              hiddenGenerators: exists
                                ? s.hiddenGenerators.filter((id) => id !== gen.id)
                                : [...s.hiddenGenerators, gen.id],
                            };
                          })
                        }
                      />
                    );
                  })}
                </div>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Click a label to hide its edges. The small degree value is the
                  average arc between the points each generator connects.
                  {graph.preset === "hypercube"
                    ? " For hypercube, b1 is the LSB and bn is the MSB."
                    : ""}
                </p>
                <DistanceHistogram
                  bins={selectedDistanceHistogram}
                  selectedGeneratorCount={selectedGeneratorCount}
                />
                <JumpHistogram
                  bins={selectedJumpHistogram}
                  selectedGeneratorCount={selectedGeneratorCount}
                />
              </div>
            ) : null}

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Export size
              </Label>
              <Select
                value={String(svgExportSize)}
                onValueChange={(v) => setSvgExportSize(Number(v))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1600">1600 × 1600</SelectItem>
                  <SelectItem value="2400">2400 × 2400</SelectItem>
                  <SelectItem value="3600">3600 × 3600</SelectItem>
                  <SelectItem value="6000">6000 × 6000</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={downloadSVG}
                disabled={running || svgDownloadDisabled}
                title={
                  svgDownloadDisabled
                    ? activeRenderer === "density"
                      ? "Density rendering is raster-only; use PNG export"
                      : "SVG export is unavailable for this many vertices"
                    : undefined
                }
              >
                <Download className="h-4 w-4" />
                SVG
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={downloadPNG}
                disabled={running || imageDownloadDisabled}
              >
                <Download className="h-4 w-4" />
                PNG
              </Button>
            </div>
          </section>
        </CardContent>
      </Card>

      <div className="min-w-0 space-y-4">
      <Card className="overflow-hidden p-0">
        <div
          ref={stageRef}
          className={`relative h-[calc(100vh-9rem)] w-full bg-white ${
            needsTallStage ? "min-h-[1360px]" : "min-h-[680px]"
          }`}
        >
          {running || (activeRenderer === "quotient" && quotientLoading) ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-white">
              <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
              {yankelovichStage ? (
                <p className="font-mono text-5xl font-semibold tracking-tight text-amber-700">
                  {yankelovichStage}
                </p>
              ) : null}
              <div className="flex flex-col items-center gap-1 text-center">
                <p className="font-mono text-sm">n = {n}</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  {status}
                </p>
              </div>
            </div>
          ) : (
            <>
              <div
                className={`absolute inset-0 touch-none ${
                  settings.showFundamentalDomain || settings.showVertexOrbit
                    ? "cursor-crosshair"
                    : zoom > 1
                      ? isPanning
                        ? "cursor-grabbing"
                        : "cursor-grab"
                      : ""
                }`}
                onPointerDown={handlePanStart}
                onPointerMove={handlePanMove}
                onPointerUp={handlePanEnd}
                onPointerCancel={handlePanEnd}
                onClick={handleStageClick}
                onWheel={handleWheelPan}
              >
                {activeRenderer === "canvas" ||
                activeRenderer === "density" ||
                activeRenderer === "quotient" ||
                yankelovich ||
                symmetryLite ? (
                  <canvas ref={canvasRef} className="block h-full w-full" />
                ) : (
                  <div
                    ref={svgHostRef}
                    className="block h-full w-full [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
                  />
                )}
              </div>
              {isComputing || isRendering ? (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-5 bg-white">
                  <Loader2
                    className={`h-12 w-12 animate-spin ${
                      isComputing ? "text-amber-600" : "text-sky-600"
                    }`}
                  />
                  <span
                    className={`font-mono text-5xl font-semibold tracking-tight ${
                      isComputing ? "text-amber-700" : "text-sky-700"
                    }`}
                  >
                    {yankelovichStage ??
                      (isComputing ? "Computing density field…" : "Rendering…")}
                  </span>
                  <span className="text-sm text-muted-foreground">{status}</span>
                </div>
              ) : null}
              <div className="absolute left-3 top-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur">
                <span className="rounded border bg-muted px-1 py-px font-mono text-[10px] uppercase">
                  {graphPresetLabel(preset)}
                </span>
                <span>·</span>
                {kaleidoscope ? (
                  <>
                    <span className="font-mono">
                      {n} mirrors · {degreesLabel(180 / n)}
                    </span>
                    <span>·</span>
                    <span>{2 * n} sectors</span>
                    {metrics ? (
                      <>
                        <span>·</span>
                        <span>
                          {formatUiNumber(metrics.cayleyEdges)} segments
                        </span>
                      </>
                    ) : null}
                  </>
                ) : (
                  <>
                    <span className="font-mono">n = {n}</span>
                    {metrics ? (
                      <>
                        <span>·</span>
                        <span>{formatUiNumber(metrics.vertices)} vertices</span>
                        <span>·</span>
                        <span>{formatUiNumber(metrics.cayleyEdges)} edges</span>
                      </>
                    ) : null}
                  </>
                )}
                <span>·</span>
                <span className="rounded border bg-muted px-1 py-px font-mono text-[10px] uppercase">
                  {activeRenderer}
                </span>
                {canvasPixelSize.width > 0 && canvasPixelSize.height > 0 ? (
                  <>
                    <span>·</span>
                    <span className="font-mono">
                      canvas {canvasPixelSize.width}×{canvasPixelSize.height} px
                    </span>
                  </>
                ) : null}
              </div>
              <div className="absolute right-3 top-3 flex items-center gap-1 rounded-md border bg-background/90 p-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={zoomOut}
                  disabled={zoom <= MIN_ZOOM}
                  aria-label="Zoom out"
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <span className="w-12 text-center font-mono">
                  {Math.round(zoom * 100)}%
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
                  disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
                  aria-label="Reset zoom and pan"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              </div>
              {yankelovich ? (
                <YankelovichViewportMap
                  viewport={currentYankelovichViewport()}
                  onNavigate={navigateToViewportCenter}
                />
              ) : null}
            </>
          )}
        </div>
      </Card>
      {graph && hypercubeGraySequence ? (
        <HypercubeGraySequenceCard
          n={graph.n}
          generators={hypercubeGraySequence.generators}
          vertices={hypercubeGraySequence.vertices}
        />
      ) : null}
      <RadonSpaceCard
        result={radonAnalysis}
        computing={radonComputing}
        onGenerate={generateRadonAnalysis}
        disabled={!canGenerateRadon || running || isComputing || isRendering}
        seedWedgeOnly={radonSeedWedgeOnly}
        setSeedWedgeOnly={setRadonSeedWedgeOnly}
        gridKey={radonGridKey}
        setGridKey={(value) => {
          setRadonGridKey(value);
          setRadonAnalysis(null);
        }}
        seedPsi={radonSeedPsi}
        setSeedPsi={(value) => {
          setRadonSeedPsi(value);
          setRadonAnalysis(null);
        }}
        fftKey={radonFftKey}
        setFftKey={(value) => {
          setRadonFftKey(value);
          setRadonAnalysis(null);
        }}
      />
      {showOrbitTable ? <OrbitTable orbits={orbitTable} n={n} /> : null}
      </div>
    </div>
  );
}

function RadonSpaceCard({
  result,
  computing,
  onGenerate,
  disabled,
  seedWedgeOnly,
  setSeedWedgeOnly,
  gridKey,
  setGridKey,
  seedPsi,
  setSeedPsi,
  fftKey,
  setFftKey,
}: {
  result: LineSpace | null;
  computing: boolean;
  onGenerate: () => void;
  disabled: boolean;
  seedWedgeOnly: boolean;
  setSeedWedgeOnly: (value: boolean) => void;
  gridKey: RadonGridKey;
  setGridKey: (value: RadonGridKey) => void;
  seedPsi: RadonSeedPsi;
  setSeedPsi: (value: RadonSeedPsi) => void;
  fftKey: RadonFftKey;
  setFftKey: (value: RadonFftKey) => void;
}) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Radon space</CardTitle>
            <CardDescription>Dual chord coordinates.</CardDescription>
          </div>
          <Button
            type="button"
            variant={result ? "outline" : "default"}
            size="sm"
            onClick={onGenerate}
            disabled={disabled || computing}
          >
            {computing ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {result ? "Regenerate" : "Generate charts"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 text-xs sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Radon bins</Label>
            <Select
              value={gridKey}
              onValueChange={(value) => setGridKey(value as RadonGridKey)}
            >
              <SelectTrigger className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RADON_GRID_OPTIONS.map((option) => (
                  <SelectItem key={option.key} value={option.key}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Seed θ bins</Label>
            <Select
              value={String(seedPsi)}
              onValueChange={(value) => setSeedPsi(Number(value) as RadonSeedPsi)}
            >
              <SelectTrigger className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RADON_SEED_PSI_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">FFT bins</Label>
            <Select
              value={fftKey}
              onValueChange={(value) => setFftKey(value as RadonFftKey)}
            >
              <SelectTrigger className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RADON_FFT_OPTIONS.map((option) => (
                  <SelectItem key={option.key} value={option.key}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {result ? (
          <>
            {result.hasSeedWedge ? (
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
            <LineSpaceView
              lineSpace={result}
              orderLabel="graph"
              showRasterLayer
              seedWedgeOnly={seedWedgeOnly}
            />
            <AngleWhiteCharts
              lineSpace={result}
              seedWedgeOnly={seedWedgeOnly}
              setSeedWedgeOnly={setSeedWedgeOnly}
            />
            <CircularAutocorrelationChart
              lineSpace={result}
              seedWedgeOnly={seedWedgeOnly}
            />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function YankelovichViewportMap({
  viewport,
  onNavigate,
}: {
  viewport: YankelovichFieldViewport;
  onNavigate: (center: { x: number; y: number }) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef(false);

  const rectX = viewport.centerX - viewport.scale;
  const rectY = viewport.centerY - viewport.scale;
  const rectSize = viewport.scale * 2;

  // Translate a pointer position into the map's [-1, 1] frame (the viewBox).
  const navigateFromEvent = (event: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    onNavigate({
      x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      y: ((event.clientY - rect.top) / rect.height) * 2 - 1,
    });
  };

  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    navigateFromEvent(event);
  };

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current) return;
    navigateFromEvent(event);
  };

  const handlePointerUp = (event: PointerEvent<SVGSVGElement>) => {
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      className="absolute right-3 top-14 rounded-md border bg-background/90 p-2 shadow-sm backdrop-blur"
      aria-label="Zoom map"
    >
      <svg
        ref={svgRef}
        viewBox="-1 -1 2 2"
        className="h-24 w-24 cursor-pointer touch-none overflow-visible"
        role="img"
        aria-label="Visible area in full graph — click or drag to pan"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <circle
          cx="0"
          cy="0"
          r="1"
          fill="rgb(248 250 252)"
          stroke="rgb(148 163 184)"
          strokeWidth="0.025"
        />
        <line
          x1="-1"
          y1="0"
          x2="1"
          y2="0"
          stroke="rgb(203 213 225)"
          strokeWidth="0.012"
        />
        <line
          x1="0"
          y1="-1"
          x2="0"
          y2="1"
          stroke="rgb(203 213 225)"
          strokeWidth="0.012"
        />
        <rect
          x={rectX}
          y={rectY}
          width={rectSize}
          height={rectSize}
          fill="rgb(59 130 246 / 0.12)"
          stroke="rgb(37 99 235)"
          strokeWidth="0.03"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={viewport.centerX}
          cy={viewport.centerY}
          r="0.035"
          fill="rgb(37 99 235)"
        />
      </svg>
    </div>
  );
}

function OrbitTable({ orbits, n }: { orbits: OrbitInfo[]; n: number }) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">Cₙ orbits — index pairs</CardTitle>
        <CardDescription>
          Each row is one rotation orbit: the {n} chords{" "}
          <span className="font-mono">{"{i+k·(n−1)!, j+k·(n−1)!}"}</span> (mod n!)
          that share a color. {orbits.length} orbits · vertices indexed 0…
          {formatUiNumber(factorial(n) - 1)} in Zaks order.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="max-h-[360px] overflow-auto rounded-md border">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur">
              <tr className="text-left text-muted-foreground">
                <th className="px-2 py-1.5 font-medium">color</th>
                <th className="px-2 py-1.5 font-medium">rₖ</th>
                <th className="px-2 py-1.5 font-medium">size</th>
                <th className="px-2 py-1.5 font-medium">index pairs</th>
              </tr>
            </thead>
            <tbody>
              {orbits.map((orbit, idx) => (
                <tr key={idx} className="border-t align-top">
                  <td className="px-2 py-1.5">
                    <span
                      className="inline-block h-3 w-3 rounded-full ring-1 ring-black/10"
                      style={{ backgroundColor: orbit.color }}
                    />
                  </td>
                  <td className="px-2 py-1.5 font-mono">r{orbit.gen}</td>
                  <td className="px-2 py-1.5 font-mono text-muted-foreground">
                    {orbit.pairs.length}
                    {orbit.half ? " ◊" : ""}
                  </td>
                  <td className="px-2 py-1.5 font-mono leading-relaxed">
                    {orbit.pairs.map(([i, j], k) => (
                      <span key={k} className="mr-2 inline-block whitespace-nowrap">
                        {"{"}
                        {i},{j}
                        {"}"}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="pt-2 text-[11px] leading-snug text-muted-foreground">
          ◊ = antipodal &ldquo;diameter&rdquo; orbit (size n/2). Colors match the
          orbit-colored graph above.
        </p>
      </CardContent>
    </Card>
  );
}

function IndexStepper({
  label,
  value,
  count,
  onChange,
  oneBased = true,
}: {
  label: string;
  value: number;
  count: number;
  onChange: (value: number) => void;
  oneBased?: boolean;
}) {
  const wrap = (v: number) => ((v % count) + count) % count;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => onChange(wrap(value - 1))}
          aria-label={`Previous ${label}`}
        >
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <span className="w-14 text-center font-mono text-xs">
          {value + (oneBased ? 1 : 0)} / {count}
        </span>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => onChange(wrap(value + 1))}
          aria-label={`Next ${label}`}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function RendererRadio({
  value,
  label,
  checked,
  disabled,
}: {
  value: Renderer;
  label: string;
  checked: boolean;
  disabled?: boolean;
}) {
  return (
    <Label
      htmlFor={`renderer-${value}`}
      className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-sm transition-colors ${
        disabled
          ? "cursor-not-allowed opacity-50"
          : checked
            ? "cursor-pointer border-primary bg-primary/5"
            : "cursor-pointer hover:bg-muted/50"
      }`}
    >
      <RadioGroupItem id={`renderer-${value}`} value={value} disabled={disabled} />
      <span className="font-medium">{label}</span>
    </Label>
  );
}

function Stat({
  label,
  value,
  full,
}: {
  label: string;
  value: number | string | undefined;
  full?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between ${full ? "col-span-2" : ""}`}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-xs">
        {value === undefined
          ? "—"
          : typeof value === "number"
            ? formatUiNumber(value)
            : value}
      </dd>
    </div>
  );
}

function GeneratorChip({
  label,
  avgArcDegrees,
  hidden,
  onClick,
}: {
  label: string;
  avgArcDegrees?: number;
  hidden: boolean;
  onClick: () => void;
}) {
  const arcLabel =
    avgArcDegrees === undefined ? undefined : `${Math.round(avgArcDegrees)}°`;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label}${arcLabel ? ` · avg arc ${avgArcDegrees!.toFixed(1)}°` : ""}${
        hidden ? " · hidden" : ""
      }`}
      className={`flex min-w-7 flex-col items-center rounded-md border bg-background px-2 py-0.5 text-center font-mono text-xs leading-5 text-muted-foreground transition-opacity hover:opacity-100 ${
        hidden ? "opacity-30 line-through" : "opacity-100"
      }`}
    >
      <span>{label}</span>
      {arcLabel ? (
        <span className="text-[9px] leading-none opacity-70">{arcLabel}</span>
      ) : null}
    </button>
  );
}

function HypercubeGraySequenceCard({
  n,
  generators,
  vertices,
}: {
  n: number;
  generators: string[];
  vertices: string[];
}) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">Gray-code generator sequence</CardTitle>
        <CardDescription>
          n = {n}; b1 is the LSB. Closing edge included.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <h3 className="text-xs font-medium">Vertices</h3>
          <p className="break-words font-mono text-xs leading-6 text-muted-foreground">
            {vertices.join(", ")}
          </p>
        </div>
        <div className="space-y-1">
          <h3 className="text-xs font-medium">Generators</h3>
          <p className="break-words font-mono text-xs leading-6 text-muted-foreground">
            {generators.join(", ")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function DistanceHistogram({
  bins,
  selectedGeneratorCount,
}: {
  bins: EdgeDistanceBin[];
  selectedGeneratorCount: number;
}) {
  const maxCount = bins.reduce((max, bin) => Math.max(max, bin.count), 0);
  const totalEdges = bins.reduce((sum, bin) => sum + bin.count, 0);

  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-medium">Edge distance histogram</h3>
          <p className="text-[10px] text-muted-foreground">
            {EDGE_DISTANCE_BIN_DEGREES}° bins · selected generators only
          </p>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          {selectedGeneratorCount} gen · {formatUiNumber(totalEdges)} edges
        </span>
      </div>

      {selectedGeneratorCount === 0 ? (
        <p className="text-[11px] leading-snug text-muted-foreground">
          Select at least one generator to see edge distances.
        </p>
      ) : bins.length === 0 ? (
        <p className="text-[11px] leading-snug text-muted-foreground">
          No edge distance data for the selected generators.
        </p>
      ) : (
        <div className="space-y-1">
          {bins.map((bin) => {
            const width = maxCount === 0 ? 0 : (bin.count / maxCount) * 100;
            const percentage =
              totalEdges === 0 ? 0 : (bin.count / totalEdges) * 100;
            return (
              <div
                key={bin.minDegrees}
                className="grid grid-cols-[4.5rem_minmax(0,1fr)_4rem] items-center gap-2 text-[10px]"
                title={`${formatUiNumber(bin.count)} edges`}
              >
                <span className="font-mono text-muted-foreground">
                  {bin.minDegrees}–{bin.maxDegrees}°
                </span>
                <div className="h-2 overflow-hidden rounded-full bg-background">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${width}%` }}
                  />
                </div>
                <span className="text-right font-mono text-muted-foreground">
                  {formatHistogramPercentage(percentage)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function JumpHistogram({
  bins,
  selectedGeneratorCount,
}: {
  bins: JumpHistogramBin[];
  selectedGeneratorCount: number;
}) {
  const maxCount = bins.reduce((max, bin) => Math.max(max, bin.count), 0);
  const totalEdges = bins.reduce((sum, bin) => sum + bin.count, 0);

  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-medium">Edge jump histogram</h3>
          <p className="text-[10px] text-muted-foreground">
            circular index jumps · selected generators only
          </p>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          {selectedGeneratorCount} gen · {formatUiNumber(totalEdges)} edges
        </span>
      </div>

      {selectedGeneratorCount === 0 ? (
        <p className="text-[11px] leading-snug text-muted-foreground">
          Select at least one generator to see edge jumps.
        </p>
      ) : bins.length === 0 ? (
        <p className="text-[11px] leading-snug text-muted-foreground">
          No edge jump data for the selected generators.
        </p>
      ) : (
        <div className="space-y-1">
          {bins.map((bin) => {
            const width = maxCount === 0 ? 0 : (bin.count / maxCount) * 100;
            const percentage =
              totalEdges === 0 ? 0 : (bin.count / totalEdges) * 100;
            return (
              <div
                key={`${bin.minJump}-${bin.maxJump}`}
                className="grid grid-cols-[5.75rem_minmax(0,1fr)_4rem] items-center gap-2 text-[10px]"
                title={`${formatUiNumber(bin.count)} edges`}
              >
                <span className="font-mono text-muted-foreground">
                  {formatJumpRange(bin)}
                </span>
                <div className="h-2 overflow-hidden rounded-full bg-background">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${width}%` }}
                  />
                </div>
                <span className="text-right font-mono text-muted-foreground">
                  {formatHistogramPercentage(percentage)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatJumpRange(bin: JumpHistogramBin): string {
  if (bin.minJump === bin.maxJump) return formatUiNumber(bin.minJump);
  return `${formatUiNumber(bin.minJump)}–${formatUiNumber(bin.maxJump)}`;
}

function FieldHistogram({
  histogram,
}: {
  histogram: YankelovichHistogram | null;
}) {
  if (!histogram) {
    return (
      <div className="space-y-2 rounded-md border bg-muted/20 p-2.5">
        <h3 className="text-xs font-medium">Matrix value histogram</h3>
        <p className="text-[11px] leading-snug text-muted-foreground">
          Computing the density field…
        </p>
      </div>
    );
  }
  const { bins, max, norm } = histogram;
  const maxCount = bins.reduce((m, c) => Math.max(m, c), 0);
  const logMax = Math.log1p(maxCount);
  // Bin index where the tone-map white point (norm) falls.
  const normBin =
    max > 0 ? Math.min(bins.length - 1, Math.floor((norm / max) * bins.length)) : 0;

  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-2.5">
      <div>
        <h3 className="text-xs font-medium">Matrix value histogram</h3>
        <p className="text-[10px] text-muted-foreground">
          density per cell · log count · {bins.length} bins
        </p>
      </div>

      <div className="flex h-20 items-end gap-px">
        {bins.map((count, i) => {
          const h = logMax > 0 ? (Math.log1p(count) / logMax) * 100 : 0;
          const isNorm = i === normBin;
          return (
            <div
              key={i}
              className="flex-1 rounded-sm"
              style={{
                height: `${count > 0 ? Math.max(h, 3) : 0}%`,
                backgroundColor: isNorm
                  ? "#f59e0b"
                  : "rgba(99, 102, 241, 0.7)",
              }}
              title={`[${((i / bins.length) * max).toFixed(0)} – ${(
                ((i + 1) / bins.length) *
                max
              ).toFixed(0)}]: ${formatUiNumber(count)} cells`}
            />
          );
        })}
      </div>

      <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>0</span>
        <span>max {formatUiNumber(Math.round(max))}</span>
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Distribution of the N×N density matrix (empty cells excluded). The{" "}
        <span className="font-medium text-amber-600">amber</span> bar is the
        normalization white point (p99.9); everything at or above it maps to
        full white.
      </p>
    </div>
  );
}

