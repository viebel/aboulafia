"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  buildZaksSymmetryGraph,
  buildQuotientGraph,
  EDGE_DISTANCE_BIN_DEGREES,
  factorial,
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
  drawZaksSymmetryToCanvas,
  type ZaksSymmetrySectors,
  edgeAlphaToSlider,
  edgeWidthToSlider,
  type EdgeRenderMode,
  supportsSymmetry,
  toSVG,
  toSymmetrySVG,
  toZaksSymmetrySVG,
  computeZaksOrbits,
  type OrbitInfo,
  type OrbitParts,
  type ParityMode,
  type RenderSettings,
  type SymmetryColoring,
} from "@/lib/pancake-render";
import {
  readEnumParam,
  readIntParam,
  readNonNegIntParam,
  writeUrlParams,
} from "@/lib/url-state";
import { AlertTriangle, Download, Loader2, Minus, Plus, RotateCcw } from "lucide-react";
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

const NUMBER_FORMAT = new Intl.NumberFormat("en-US");

const SVG_VIEWBOX = 1200;

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

// Values above 10 only apply to graphs that opt into them via graphMaxN
// (currently the simplex, whose K_{n+1} stays tiny even at n = 40);
// availableNOptions filters this list per preset.
const N_OPTIONS: readonly number[] = Array.from(
  { length: 38 },
  (_, i) => i + 3
);
const DEFAULT_N = 6;

/**
 * Generators a freshly built graph should hide by default. Most graphs start
 * fully visible (empty list). Pancake graphs use generator id = suffix-reversal
 * length, and each generator is an involution, so it contributes a perfect
 * matching of n!/2 chords. For n > 6 the graph builder only emits the full
 * reversal rₙ (id = n) to avoid spending CPU on edges that would be hidden;
 * this fallback keeps older/full graph payloads focused the same way.
 */
function defaultHiddenGenerators(graph: PancakeGraph): number[] {
  if (graph.kind !== "pancake" || graph.n <= 6) return [];
  return graph.generators
    .map((gen) => gen.id)
    .filter((id) => id < graph.n);
}
type NValue = number;

const GRAPH_PRESETS: GraphPreset[] = [
  "pancake-zaks",
  "pancake-zaks-recursive",
  "pancake-williams",
  "complete",
  "cayley-complete",
  "star",
  "permutohedron",
  "permutahedron-compressed",
  "cyclic-adjacent",
  "transposition",
  "asymmetric-tree",
  "kaleidoscope",
  "lexicographic",
  "hypercube",
  "sliding-puzzle",
  "simplex",
];

type Renderer = "svg" | "canvas" | "density" | "quotient" | "symmetry";

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
const MAX_ZOOM = 64;
const ZOOM_FACTOR = 1.5;
const WHEEL_LINE_HEIGHT = 16;
const WHEEL_DELTA_LINE = 1;
const WHEEL_DELTA_PAGE = 2;

interface RunMetrics {
  vertices: number;
  cayleyEdges: number;
  cycleEdges: number;
  rnEdges: number;
  evenEdges: number;
  oddEdges: number;
  elapsedMs: number;
}

const PARITY_MODE_LABELS: Record<ParityMode, string> = {
  off: "Single color",
  both: "Color by parity",
  even: "Even only",
  odd: "Odd only",
};

const RENDERERS: readonly Renderer[] = [
  "svg",
  "canvas",
  "density",
  "quotient",
  "symmetry",
];
const PARITY_MODES = Object.keys(PARITY_MODE_LABELS) as ParityMode[];

const SYMMETRY_COLORING_LABELS: Record<SymmetryColoring, string> = {
  parity: "Parity (default)",
  orbit: "Cₙ orbit (rotation)",
  dihedral: "Dₙ orbit (reflection)",
  blocks: "Blocks (first symbol)",
};
const SYMMETRY_COLORINGS = Object.keys(
  SYMMETRY_COLORING_LABELS
) as SymmetryColoring[];

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

/** The n a preset starts at: the global default, clamped to its maximum. */
function defaultNFor(preset: GraphPreset): NValue {
  return Math.min(DEFAULT_N, graphMaxN(preset)) as NValue;
}

interface GraphState {
  n: NValue;
  preset: GraphPreset;
  renderer: Renderer;
  parityMode: ParityMode;
  symmetryColoring: SymmetryColoring;
  showDihedralAxes: boolean;
  showSymmetryAxes: boolean;
  showFundamentalDomain: boolean;
  domainPiece: number;
  domainAxis: number;
  showVertexOrbit: boolean;
  vertexOrbitIndex: number;
  vertexOrbitParts: OrbitParts;
  vertexOrbitLongOnly: boolean;
  orbitEdgeA: number;
  orbitEdgeB: number;
  showLabels: boolean;
  alpha: number;
  width: number;
  quotientDepth: number;
}

/** Restore the explorer's controls from the URL query string (deep linking). */
function readGraphState(params: URLSearchParams | null): GraphState {
  const preset = readEnumParam(params, "g", GRAPH_PRESETS, "pancake-zaks");
  const allowedN = N_OPTIONS.filter((opt) => opt <= graphMaxN(preset));
  const n = readIntParam(params, "n", allowedN, defaultNFor(preset)) as NValue;

  let renderer = readEnumParam(params, "r", RENDERERS, "svg");
  if (renderer === "quotient" && !supportsQuotient(preset)) renderer = "svg";
  if (renderer === "symmetry" && !supportsSymmetry({ preset })) renderer = "svg";

  const rec = recommendedEdgeSliders(n, preset);

  return {
    n,
    preset,
    renderer,
    parityMode: readEnumParam(params, "parity", PARITY_MODES, "off"),
    symmetryColoring: readEnumParam(params, "sc", SYMMETRY_COLORINGS, "parity"),
    showDihedralAxes: readEnumParam(params, "ax", ["0", "1"], "0") === "1",
    showSymmetryAxes: readEnumParam(params, "sym", ["0", "1"], "0") === "1",
    showFundamentalDomain: readEnumParam(params, "fd", ["0", "1"], "0") === "1",
    domainPiece: readIntParam(params, "dp", DOMAIN_INDEX_RANGE, 0),
    domainAxis: readIntParam(params, "da", DOMAIN_INDEX_RANGE, 0),
    showVertexOrbit: readEnumParam(params, "vo", ["0", "1"], "0") === "1",
    vertexOrbitIndex: readNonNegIntParam(params, "vi"),
    vertexOrbitParts: readEnumParam(params, "vp", ORBIT_PARTS, "both"),
    vertexOrbitLongOnly: readEnumParam(params, "vl", ["0", "1"], "0") === "1",
    orbitEdgeA: readNonNegIntParam(params, "ea", -1),
    orbitEdgeB: readNonNegIntParam(params, "eb", -1),
    showLabels: readEnumParam(params, "lbl", ["0", "1"], "0") === "1",
    alpha: readIntParam(params, "alpha", SLIDER_RANGE, rec.alpha),
    width: readIntParam(params, "width", SLIDER_RANGE, rec.width),
    quotientDepth: readIntParam(
      params,
      "depth",
      quotientDepthOptions(n, preset),
      defaultQuotientDepth(n, preset)
    ),
  };
}

export function PancakeGraphView() {
  const searchParams = useSearchParams();
  const initial = useMemo(() => readGraphState(searchParams), [searchParams]);
  const [n, setN] = useState<NValue>(initial.n);
  const [preset, setPreset] = useState<GraphPreset>(initial.preset);
  const [renderer, setRenderer] = useState<Renderer>(initial.renderer);
  const [graph, setGraph] = useState<PancakeGraph | null>(null);
  const [metrics, setMetrics] = useState<RunMetrics | null>(null);
  const [status, setStatus] = useState<string>("Ready.");
  const [running, setRunning] = useState(false);
  // The build (running) and the actual draw are separate phases: for large
  // graphs the SVG string + DOM injection can take a while *after* the graph is
  // ready, so we surface it as its own "Rendering…" state.
  const [isRendering, setIsRendering] = useState(false);

  const [settings, setSettings] = useState<RenderSettings>({
    alpha: initial.alpha,
    width: initial.width,
    showCayley: true,
    showCycle: true,
    showVertices: true,
    showLabels: initial.showLabels,
    parityMode: initial.parityMode,
    symmetryColoring: initial.symmetryColoring,
    showDihedralAxes: initial.showDihedralAxes,
    showSymmetryAxes: initial.showSymmetryAxes,
    showFundamentalDomain: initial.showFundamentalDomain,
    domainPiece: initial.domainPiece,
    domainAxis: initial.domainAxis,
    showVertexOrbit: initial.showVertexOrbit,
    vertexOrbitIndex: initial.vertexOrbitIndex,
    vertexOrbitParts: initial.vertexOrbitParts,
    vertexOrbitLongOnly: initial.vertexOrbitLongOnly,
    orbitEdgeA: initial.orbitEdgeA,
    orbitEdgeB: initial.orbitEdgeB,
    hiddenGenerators: [],
  });
  const [svgExportSize, setSvgExportSize] = useState<number>(2400);
  const [quotientDepth, setQuotientDepth] = useState<number>(initial.quotientDepth);
  const [quotient, setQuotient] = useState<QuotientGraph | null>(null);
  const [quotientLoading, setQuotientLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  // What a click on the graph selects for the fundamental domain, so the axis
  // and the wedge can be picked independently.
  const [domainClickTarget, setDomainClickTarget] = useState<
    "piece" | "axis" | "both"
  >("piece");

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);
  // Cached fundamental-sector geometry for the canvas symmetry renderer, reused
  // across zoom/pan/alpha/width so only n/size/parity/hidden changes re-enumerate.
  const symSectorCacheRef = useRef<ZaksSymmetrySectors | null>(null);
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

  const estimatedVertices = graphVertexCount(n, preset);
  const estimatedEdges = graphEdgeCount(n, preset);
  const isHeavy = estimatedVertices >= 300_000 || estimatedEdges >= 1_000_000;
  const isVeryHeavy = estimatedVertices > 1_000_000 || estimatedEdges > 10_000_000;
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
  // Vector renders above this many segments are slow enough to be worth a
  // visible "Rendering…" phase; smaller ones draw synchronously to keep slider
  // tweaks snappy and flicker-free. Symmetry only emits a 1/n sector.
  const svgRenderLoad =
    activeRenderer === "symmetry" && supportsSymmetry({ preset })
      ? graphEdgeCount(n, preset) / n
      : graphEdgeCount(n, preset);
  const showRenderProgress =
    (activeRenderer === "svg" || activeRenderer === "symmetry") &&
    svgRenderLoad >= 120_000;
  const availableNOptions = useMemo(
    () => N_OPTIONS.filter((option) => option <= graphMaxN(preset)),
    [preset]
  );

  // Reflect every control in the URL so a given view can be shared and
  // restored, including default values.
  useEffect(() => {
    writeUrlParams({
      g: preset,
      n: String(n),
      r: renderer,
      parity: settings.parityMode,
      sc: settings.symmetryColoring,
      ax: settings.showDihedralAxes ? "1" : null,
      sym: settings.showSymmetryAxes ? "1" : null,
      fd: settings.showFundamentalDomain ? "1" : null,
      dp: settings.showFundamentalDomain ? String(settings.domainPiece) : null,
      da: settings.showFundamentalDomain ? String(settings.domainAxis) : null,
      vo: settings.showVertexOrbit ? "1" : null,
      vi: settings.showVertexOrbit ? String(settings.vertexOrbitIndex) : null,
      vp: settings.showVertexOrbit ? settings.vertexOrbitParts : null,
      vl: settings.showVertexOrbit && settings.vertexOrbitLongOnly ? "1" : null,
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
      depth: String(quotientDepth),
    });
  }, [
    n,
    preset,
    renderer,
    settings.parityMode,
    settings.symmetryColoring,
    settings.showDihedralAxes,
    settings.showSymmetryAxes,
    settings.showFundamentalDomain,
    settings.domainPiece,
    settings.domainAxis,
    settings.showVertexOrbit,
    settings.vertexOrbitIndex,
    settings.vertexOrbitParts,
    settings.vertexOrbitLongOnly,
    settings.orbitEdgeA,
    settings.orbitEdgeB,
    settings.showLabels,
    settings.alpha,
    settings.width,
    quotientDepth,
  ]);

  useEffect(() => {
    const ac = new AbortController();
    const signal = ac.signal;

    const run = async () => {
      setRunning(true);
      const t0 = performance.now();
      try {
        if (symmetryLite) {
          // Built from the recursive fundamental sector only — O((n-1)!), no
          // path/edge arrays. It is synchronous (no chunking needed even at the
          // n = 11 ceiling), so yield one frame first: otherwise setRunning(true)
          // and the blocking build run in the same task and the browser never
          // paints the loading spinner until everything is already done.
          setStatus(`Computing ${graphPresetLabel(preset)} symmetry for n = ${n}…`);
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve())
          );
          if (signal.aborted) return;
          const g = buildZaksSymmetryGraph(n);
          if (signal.aborted) return;
          setGraph(g);
          setSettings((s) => {
            const initialHidden = defaultHiddenGenerators(g);
            const unchanged =
              s.hiddenGenerators.length === initialHidden.length &&
              s.hiddenGenerators.every((id, i) => id === initialHidden[i]);
            return unchanged ? s : { ...s, hiddenGenerators: initialHidden };
          });
          setMetrics({
            vertices: graphVertexCount(n, preset),
            cayleyEdges: graphEdgeCount(n, preset),
            cycleEdges: factorial(n),
            rnEdges: n,
            evenEdges: g.evenEdgeCount,
            oddEdges: g.oddEdgeCount,
            elapsedMs: Math.round(performance.now() - t0),
          });
          setStatus(`${graphPresetLabel(preset)} drawn.`);
          return;
        }
        setStatus(`Computing ${graphPresetLabel(preset)} for n = ${n}…`);
        const g = await buildPancakeGraph(
          n,
          preset,
          (phase, done, total) => {
            if (signal.aborted) return;
            const pct = ((done / total) * 100).toFixed(1);
            const label =
              phase === "cycle"
                ? `Ordering vertices: ${NUMBER_FORMAT.format(done)} / ${NUMBER_FORMAT.format(total)} (${pct}%)`
                : phase === "edges"
                  ? `Building edges: ${NUMBER_FORMAT.format(done)} / ${NUMBER_FORMAT.format(total)} (${pct}%)`
                  : phase === "parity"
                    ? `Computing parity: ${NUMBER_FORMAT.format(done)} / ${NUMBER_FORMAT.format(total)} (${pct}%)`
                    : phase;
            setStatus(label);
          },
          signal
        );
        if (signal.aborted) return;
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
        });
        setStatus(`${graphPresetLabel(preset)} drawn.`);
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
  }, [n, preset, symmetryLite]);

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
    if (activeRenderer !== "canvas" && activeRenderer !== "density") return;
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
    const edgeMode: EdgeRenderMode =
      activeRenderer === "density" ? "density" : "line";
    drawToCanvas(ctx, {
      graph,
      settings: { ...settings, edgeMode },
      cssWidth: width,
      cssHeight: height,
      dpr,
      zoom,
      panX: pan.x,
      panY: pan.y,
    });
  }, [activeRenderer, graph, settings, stageSize, pan.x, pan.y, zoom]);

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
          `Quotient drawn — ${NUMBER_FORMAT.format(q.blockCount)} blocks, ${NUMBER_FORMAT.format(q.totalSuperEdges)} super-edges.`
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
    if (!host || !graph) return;
    // Square SVG with a viewBox — CSS scales it to fill the stage. The symmetry
    // renderer falls back to the flat one if the graph lacks the n-fold layout.
    const useSymmetry = activeRenderer === "symmetry" && supportsSymmetry(graph);
    const render = !useSymmetry
      ? toSVG
      : graph.preset === "pancake-zaks"
        ? toZaksSymmetrySVG
        : toSymmetrySVG;
    const draw = () => {
      const svg = render({ graph, settings, size: SVG_VIEWBOX });
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
      setStatus(`Rendering n = ${graph.n}…`);
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        draw();
        setIsRendering(false);
        setStatus(`${graphPresetLabel(graph.preset)} drawn.`);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      setIsRendering(false);
    };
  }, [symmetryLite, activeRenderer, graph, settings, showRenderProgress]);

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
    )}|${settings.symmetryColoring ?? "parity"}|${settings.parityMode}|${hiddenKey}`;
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
        setStatus(`${graphPresetLabel(graph.preset)} drawn.`);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      setIsRendering(false);
    };
  }, [symmetryLite, graph, settings, stageSize, zoom, pan.x, pan.y, showRenderProgress]);

  // Zoom/pan for SVG are driven through the viewBox rather than a CSS
  // transform: changing the viewBox re-rasterizes the vectors crisply at
  // any zoom, whereas `transform: scale()` bitmap-scales a 100k-path SVG
  // into a blur. This only mutates an attribute, so it is cheap enough to
  // run on every zoom/pan tick without regenerating the path data.
  useEffect(() => {
    if (activeRenderer !== "svg" && activeRenderer !== "symmetry") return;
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
    if (!graph) return;
    setStatus("Generating SVG…");
    setTimeout(() => {
      try {
        const useSymmetry =
          activeRenderer === "symmetry" && supportsSymmetry(graph);
        const render = !useSymmetry
          ? toSVG
          : graph.preset === "pancake-zaks"
            ? toZaksSymmetrySVG
            : toSymmetrySVG;
        const svg = render({
          graph,
          settings,
          size: svgExportSize,
        });
        const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${graph.preset}_n${graph.n}${useSymmetry ? "_sym" : ""}.svg`;
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
  }, [activeRenderer, graph, settings, svgExportSize]);

  const downloadPNG = useCallback(() => {
    if (!graph) return;
    setStatus("Generating PNG…");
    setTimeout(() => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = svgExportSize;
        canvas.height = svgExportSize;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Could not create canvas context.");

        if (symmetryLite) {
          drawZaksSymmetryToCanvas(ctx, {
            n: graph.n,
            settings,
            cssWidth: svgExportSize,
            cssHeight: svgExportSize,
            dpr: 1,
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
            graph,
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
  }, [activeRenderer, symmetryLite, graph, quotient, settings, svgExportSize]);

  const svgDownloadDisabled = useMemo(() => {
    if (!graph) return true;
    if (activeRenderer === "density" || activeRenderer === "quotient") return true;
    // The symmetry renderer emits an ~n× smaller file (one sector + rotations),
    // so it stays exportable exactly where the flat SVG would be too large.
    if (activeRenderer === "symmetry" && supportsSymmetry(graph)) return false;
    // Gate on vertex count rather than n: the sliding puzzle reaches millions
    // of states at a small n, where an SVG file would be unusably large.
    return (
      graph.kind !== "hypercube" &&
      graphVertexCount(graph.n, graph.preset) >= 300_000
    );
  }, [activeRenderer, graph]);

  const imageDownloadDisabled = !graph;

  const setS = <K extends keyof RenderSettings>(
    key: K,
    value: RenderSettings[K]
  ) => setSettings((s) => ({ ...s, [key]: value }));

  const resetViewForGraph = (nextN: number, nextPreset: GraphPreset) => {
    // Switching graph or n changes the whole layout, so any prior
    // zoom/pan no longer makes sense — snap the view back to fit.
    setZoom(1);
    setPan({ x: 0, y: 0 });

    // Edge density changes too, so move the strength/width sliders to a
    // density-appropriate recommendation for the new graph.
    const rec = recommendedEdgeSliders(nextN, nextPreset);
    setSettings((s) => ({ ...s, alpha: rec.alpha, width: rec.width }));

    // Reset the quotient depth to the new graph's best default.
    setQuotientDepth(defaultQuotientDepth(nextN, nextPreset));
  };

  const selectN = (value: string) => {
    const nextN = Number(value) as NValue;
    setN(nextN);
    resetViewForGraph(nextN, preset);
  };

  const selectPreset = (value: string) => {
    const nextPreset = value as GraphPreset;
    const nextN = Math.min(DEFAULT_N, graphMaxN(nextPreset)) as NValue;
    // The quotient view only applies to full-permutation graphs; fall back to
    // Canvas when the new family does not support it.
    if (renderer === "quotient" && !supportsQuotient(nextPreset)) {
      setRenderer("canvas");
    }
    // The symmetry renderer only applies to the Zaks pancake layout.
    if (renderer === "symmetry" && !supportsSymmetry({ preset: nextPreset })) {
      setRenderer("svg");
    }
    setPreset(nextPreset);
    // Switching graph family resets n to the default, clamped to the new
    // preset's maximum (some presets, e.g. the sliding puzzle, top out lower).
    setN(nextN);
    resetViewForGraph(nextN, nextPreset);
  };

  const zoomOut = () => {
    setZoom((value) => Math.max(MIN_ZOOM, value / ZOOM_FACTOR));
  };

  const zoomIn = () => {
    setZoom((value) => Math.min(MAX_ZOOM, value * ZOOM_FACTOR));
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
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
  const selectedGeneratorCount = useMemo(() => {
    if (!graph) return 0;
    const hidden = new Set(settings.hiddenGenerators);
    return graph.generators.filter((gen) => !hidden.has(gen.id)).length;
  }, [graph, settings.hiddenGenerators]);

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

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <Card className="self-start lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
        <CardHeader className="space-y-1">
          <CardTitle className="text-lg">Graph explorer</CardTitle>
          <CardDescription>
            Vertices are placed on a circle and connected by the selected graph
            generators.
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
                Value of n
              </Label>
              <Select
                value={String(n)}
                onValueChange={selectN}
                disabled={running}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {availableNOptions.map((opt) => (
                    <SelectItem key={opt} value={String(opt)}>
                      n = {opt} —{" "}
                      {NUMBER_FORMAT.format(graphVertexCount(opt, preset))} vertices
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isVeryHeavy ? (
                <HeavyWarning
                  title="Massive graph"
                  body={`${NUMBER_FORMAT.format(estimatedVertices)} vertices and about ${NUMBER_FORMAT.format(estimatedEdges)} edges. Canvas is recommended on-screen; SVG may freeze the browser at this size.`}
                />
              ) : isHeavy ? (
                <HeavyWarning
                  title="Heavy computation"
                  body={`${NUMBER_FORMAT.format(estimatedVertices)} vertices and about ${NUMBER_FORMAT.format(estimatedEdges)} edges. Building the graph takes a few seconds; Canvas is recommended on-screen.`}
                />
              ) : null}
            </div>

            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
              <Stat label="Vertices" value={metrics?.vertices} />
              <Stat label="Cayley edges" value={metrics?.cayleyEdges} />
              <Stat label="Order steps" value={metrics?.cycleEdges} />
              <Stat
                label="rₙ edges"
                value={graph?.kind === "pancake" ? metrics?.rnEdges : "—"}
              />
              <Stat label="Even edges" value={metrics?.evenEdges} />
              <Stat label="Odd edges" value={metrics?.oddEdges} />
              <Stat
                label="Time"
                value={metrics ? `${NUMBER_FORMAT.format(metrics.elapsedMs)} ms` : undefined}
                full
              />
            </dl>
          </section>

          <Separator />

          <section className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-sm font-medium">The Rendering</h2>
              <p className="text-xs text-muted-foreground">
                Choose the drawing engine, edge style, and export size.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Rendering engine
              </Label>
              <RadioGroup
                value={activeRenderer}
                onValueChange={(v) => {
                  if (v === "svg" && !canUseInteractiveSvg) return;
                  if (v === "quotient" && !supportsQuotient(preset)) return;
                  if (v === "symmetry" && !supportsSymmetry({ preset })) return;
                  setRenderer(v as Renderer);
                }}
                className="grid grid-cols-2 gap-2"
              >
                <RendererRadio
                  value="svg"
                  label="SVG"
                  hint="vector · crisp zoom"
                  checked={activeRenderer === "svg"}
                  disabled={!canUseInteractiveSvg}
                />
                <RendererRadio
                  value="canvas"
                  label="Canvas"
                  hint="raster · large n"
                  checked={activeRenderer === "canvas"}
                />
                <RendererRadio
                  value="density"
                  label="Density"
                  hint="x-ray · binned"
                  checked={activeRenderer === "density"}
                />
                <RendererRadio
                  value="quotient"
                  label="Quotient"
                  hint="blocks · recursive"
                  checked={activeRenderer === "quotient"}
                  disabled={!supportsQuotient(preset)}
                />
                <RendererRadio
                  value="symmetry"
                  label="Symmetry"
                  hint="vector · 360/n folds"
                  checked={activeRenderer === "symmetry"}
                  disabled={!supportsSymmetry({ preset })}
                />
              </RadioGroup>
              {activeRenderer === "density" ? (
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Density mode groups nearby chord endpoints into angular bins
                  and uses log-scaled strokes, so million-edge views do not
                  saturate to a black disk.
                </p>
              ) : null}
              {activeRenderer === "quotient" ? (
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Quotient mode collapses permutations sharing their first{" "}
                  {quotientDepth} symbol{quotientDepth === 1 ? "" : "s"} into one
                  block — the recursive decomposition Pₙ = copies of Pₙ₋
                  {quotientDepth} under Zaks suffix reversals. Node size is
                  intra-block density; chords are log-weighted inter-block edges;
                  color groups blocks by leading symbol.
                </p>
              ) : null}
              {activeRenderer === "symmetry" ? (
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Symmetry mode exploits the exact 360/n rotational symmetry of
                  the Zaks layout: it draws a single angular sector and reuses it
                  via n rotated copies. Identical picture, but the SVG is ~n×
                  smaller — so large n (≥ 9) stays exportable instead of
                  producing a multi-megabyte file.
                </p>
              ) : null}
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
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {settings.symmetryColoring === "orbit" ? (
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
                    <>Edges colored by endpoint parity (the default scheme).</>
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
                        {NUMBER_FORMAT.format(quotientBlockCount(n, d))} blocks
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

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

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Edge parity
              </Label>
              <Select
                value={settings.parityMode}
                onValueChange={(v) => setS("parityMode", v as ParityMode)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PARITY_MODE_LABELS) as ParityMode[]).map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {PARITY_MODE_LABELS[mode]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="grid grid-cols-2 gap-2 pt-0.5">
                <ParityCount
                  color="#0ea5e9"
                  label="even"
                  value={metrics?.evenEdges}
                />
                <ParityCount
                  color="#f43f5e"
                  label="odd"
                  value={metrics?.oddEdges}
                />
              </div>
              {settings.parityMode === "both" ? (
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Even = same-parity endpoints (parity-preserving generators).
                  Odd = opposite-parity endpoints. The rarer class is drawn on
                  top.
                </p>
              ) : null}
            </div>

            {n <= 5 ? (
              <div className="space-y-1">
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-primary"
                    checked={settings.showLabels}
                    onChange={(e) => setS("showLabels", e.target.checked)}
                  />
                  <span>Index labels</span>
                </label>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Number each vertex by its position i on the ring (0…n!−1) —
                  the value ρ and ω act on. Only for n ≤ 5.
                </p>
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
                        parity={gen.parity}
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
                  average arc between the points each generator connects.{" "}
                  <span style={{ color: "#0ea5e9" }}>blue</span> = even-parity
                  generator,{" "}
                  <span style={{ color: "#f43f5e" }}>red</span> = odd-parity.
                </p>
                <DistanceHistogram
                  bins={selectedDistanceHistogram}
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
          className="relative h-[calc(100vh-9rem)] min-h-[680px] w-full bg-white"
        >
          {running || (activeRenderer === "quotient" && quotientLoading) ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-white">
              <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
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
                symmetryLite ? (
                  <canvas ref={canvasRef} className="block h-full w-full" />
                ) : (
                  <div
                    ref={svgHostRef}
                    className="block h-full w-full [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
                  />
                )}
              </div>
              {isRendering ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-3 bg-white/55 backdrop-blur-[1px]">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="text-sm font-medium text-muted-foreground">
                    Rendering…
                  </span>
                </div>
              ) : null}
              <div className="absolute left-3 top-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur">
                <span className="font-mono">n = {n}</span>
                {isRendering || graph ? (
                  <>
                    <span>·</span>
                    <span
                      className={`inline-flex items-center gap-1 ${
                        isRendering ? "text-amber-600" : "text-emerald-600"
                      }`}
                      title={
                        isRendering
                          ? "Generating and drawing the figure"
                          : "Figure is fully drawn"
                      }
                    >
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          isRendering
                            ? "animate-pulse bg-amber-500"
                            : "bg-emerald-500"
                        }`}
                      />
                      {isRendering ? "Rendering" : "Done"}
                    </span>
                  </>
                ) : null}
                <span>·</span>
                <span className="rounded border bg-muted px-1 py-px font-mono text-[10px] uppercase">
                  {activeRenderer}
                </span>
                <span>·</span>
                <span className="rounded border bg-muted px-1 py-px font-mono text-[10px] uppercase">
                  {graphPresetLabel(preset)}
                </span>
                {metrics ? (
                  <>
                    <span>·</span>
                    <span
                      className="inline-flex items-center gap-1 font-mono"
                      title="Parity-preserving edges (same-parity endpoints)"
                    >
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: "#0ea5e9" }}
                      />
                      {NUMBER_FORMAT.format(metrics.evenEdges)} even
                    </span>
                    <span
                      className="inline-flex items-center gap-1 font-mono"
                      title="Parity-changing edges (opposite-parity endpoints)"
                    >
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: "#f43f5e" }}
                      />
                      {NUMBER_FORMAT.format(metrics.oddEdges)} odd
                    </span>
                  </>
                ) : null}
                <span>·</span>
                <span>{status}</span>
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
                  disabled={zoom >= MAX_ZOOM}
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
            </>
          )}
        </div>
      </Card>
      {showOrbitTable ? <OrbitTable orbits={orbitTable} n={n} /> : null}
      </div>
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
          {NUMBER_FORMAT.format(factorial(n) - 1)} in Zaks order.
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
  hint,
  checked,
  disabled,
}: {
  value: Renderer;
  label: string;
  hint: string;
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
      <div className="flex flex-col">
        <span className="font-medium">{label}</span>
        <span className="text-[10px] font-normal text-muted-foreground">
          {hint}
        </span>
      </div>
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
            ? NUMBER_FORMAT.format(value)
            : value}
      </dd>
    </div>
  );
}

function GeneratorChip({
  label,
  avgArcDegrees,
  parity,
  hidden,
  onClick,
}: {
  label: string;
  avgArcDegrees?: number;
  parity: 0 | 1;
  hidden: boolean;
  onClick: () => void;
}) {
  const colorClass =
    parity === 0
      ? "border-sky-500/40 text-sky-700 dark:text-sky-300"
      : "border-rose-500/40 text-rose-700 dark:text-rose-300";
  const arcLabel =
    avgArcDegrees === undefined ? undefined : `${Math.round(avgArcDegrees)}°`;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} · ${parity === 0 ? "even" : "odd"} parity${
        arcLabel ? ` · avg arc ${avgArcDegrees!.toFixed(1)}°` : ""
      }${hidden ? " · hidden" : ""}`}
      className={`flex min-w-7 flex-col items-center rounded-md border bg-background px-2 py-0.5 text-center font-mono text-xs leading-5 transition-opacity hover:opacity-100 ${colorClass} ${
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
          {selectedGeneratorCount} gen · {NUMBER_FORMAT.format(totalEdges)} edges
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
            return (
              <div
                key={bin.minDegrees}
                className="grid grid-cols-[4.5rem_minmax(0,1fr)_4rem] items-center gap-2 text-[10px]"
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
                  {NUMBER_FORMAT.format(bin.count)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ParityCount({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number | undefined;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1">
      <span
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="font-mono text-sm">
          {value === undefined ? "—" : NUMBER_FORMAT.format(value)}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
    </div>
  );
}

function HeavyWarning({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="space-y-0.5">
        <p className="font-medium">{title}</p>
        <p className="leading-snug">{body}</p>
      </div>
    </div>
  );
}

