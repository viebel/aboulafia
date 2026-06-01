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
  buildPancakeGraph,
  buildQuotientGraph,
  EDGE_DISTANCE_BIN_DEGREES,
  graphEdgeCount,
  graphPresetDescription,
  graphPresetLabel,
  graphMaxN,
  graphVertexCount,
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
  edgeAlphaToSlider,
  edgeWidthToSlider,
  type EdgeRenderMode,
  supportsSymmetry,
  toSVG,
  toSymmetrySVG,
  type ParityMode,
  type RenderSettings,
} from "@/lib/pancake-render";
import { readEnumParam, readIntParam, writeUrlParams } from "@/lib/url-state";
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
  "cyclic-adjacent",
  "transposition",
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

  const [settings, setSettings] = useState<RenderSettings>({
    alpha: initial.alpha,
    width: initial.width,
    showCayley: true,
    showCycle: true,
    showVertices: true,
    showLabels: false,
    parityMode: initial.parityMode,
    hiddenGenerators: [],
  });
  const [svgExportSize, setSvgExportSize] = useState<number>(2400);
  const [quotientDepth, setQuotientDepth] = useState<number>(initial.quotientDepth);
  const [quotient, setQuotient] = useState<QuotientGraph | null>(null);
  const [quotientLoading, setQuotientLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);
  const panStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
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
      alpha: String(settings.alpha),
      width: String(settings.width),
      depth: String(quotientDepth),
    });
  }, [
    n,
    preset,
    renderer,
    settings.parityMode,
    settings.alpha,
    settings.width,
    quotientDepth,
  ]);

  useEffect(() => {
    const ac = new AbortController();
    const signal = ac.signal;

    const run = async () => {
      setRunning(true);
      setStatus(`Computing ${graphPresetLabel(preset)} for n = ${n}…`);
      const t0 = performance.now();
      try {
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
  }, [n, preset]);

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
    if (activeRenderer !== "svg" && activeRenderer !== "symmetry") return;
    const host = svgHostRef.current;
    if (!host || !graph) return;
    // Square SVG with a viewBox — CSS scales it to fill the stage. The symmetry
    // renderer falls back to the flat one if the graph lacks the n-fold layout.
    const useSymmetry = activeRenderer === "symmetry" && supportsSymmetry(graph);
    const svg = (useSymmetry ? toSymmetrySVG : toSVG)({
      graph,
      settings,
      size: SVG_VIEWBOX,
    });
    host.innerHTML = svg
      .replace(`width="${SVG_VIEWBOX}"`, 'width="100%"')
      .replace(`height="${SVG_VIEWBOX}"`, 'height="100%"');
  }, [activeRenderer, graph, settings]);

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
        const svg = (useSymmetry ? toSymmetrySVG : toSVG)({
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

        if (activeRenderer === "quotient") {
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
  }, [activeRenderer, graph, quotient, settings, svgExportSize]);

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
    if (event.button !== 0 || zoom <= 1) return;
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

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <Card className="self-start lg:sticky lg:top-4">
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
                  zoom > 1 ? (isPanning ? "cursor-grabbing" : "cursor-grab") : ""
                }`}
                onPointerDown={handlePanStart}
                onPointerMove={handlePanMove}
                onPointerUp={handlePanEnd}
                onPointerCancel={handlePanEnd}
                onWheel={handleWheelPan}
              >
                {activeRenderer === "canvas" ||
                activeRenderer === "density" ||
                activeRenderer === "quotient" ? (
                  <canvas ref={canvasRef} className="block h-full w-full" />
                ) : (
                  <div
                    ref={svgHostRef}
                    className="block h-full w-full [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
                  />
                )}
              </div>
              <div className="absolute left-3 top-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur">
                <span className="font-mono">n = {n}</span>
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

