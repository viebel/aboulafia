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
  graphEdgeCount,
  graphPresetDescription,
  graphPresetLabel,
  graphVertexCount,
  type PancakeGraph,
  type GraphPreset,
} from "@/lib/pancake";
import {
  drawToCanvas,
  toSVG,
  type RenderSettings,
} from "@/lib/pancake-render";
import { AlertTriangle, Download, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const NUMBER_FORMAT = new Intl.NumberFormat("en-US");

const N_OPTIONS = [3, 4, 5, 6, 7, 8, 9, 10] as const;
type NValue = (typeof N_OPTIONS)[number];

const GRAPH_PRESETS: GraphPreset[] = [
  "pancake-zaks",
  "pancake-williams",
  "star",
  "permutohedron",
  "cyclic-adjacent",
  "hypercube",
];

type Renderer = "svg" | "canvas";
const MAX_INTERACTIVE_SVG_N = 8;

interface RunMetrics {
  vertices: number;
  cayleyEdges: number;
  cycleEdges: number;
  rnEdges: number;
  elapsedMs: number;
}

export function PancakeGraphView() {
  const [n, setN] = useState<NValue>(6);
  const [preset, setPreset] = useState<GraphPreset>("pancake-zaks");
  const [renderer, setRenderer] = useState<Renderer>("svg");
  const [graph, setGraph] = useState<PancakeGraph | null>(null);
  const [metrics, setMetrics] = useState<RunMetrics | null>(null);
  const [status, setStatus] = useState<string>("Ready.");
  const [running, setRunning] = useState(false);

  const [settings, setSettings] = useState<RenderSettings>({
    alpha: 40,
    width: 36,
    showCayley: true,
    showCycle: true,
    showVertices: true,
    showLabels: false,
  });
  const [svgExportSize, setSvgExportSize] = useState<number>(2400);

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  const estimatedVertices = graphVertexCount(n, preset);
  const estimatedEdges = graphEdgeCount(n, preset);
  const isHeavy = estimatedVertices >= 300_000 || estimatedEdges >= 1_000_000;
  const isVeryHeavy = estimatedVertices > 1_000_000 || estimatedEdges > 10_000_000;
  const canUseInteractiveSvg = n <= MAX_INTERACTIVE_SVG_N;
  const activeRenderer: Renderer = canUseInteractiveSvg ? renderer : "canvas";

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
                  : phase;
            setStatus(label);
          },
          signal
        );
        if (signal.aborted) return;
        setGraph(g);
        const elapsed = Math.round(performance.now() - t0);
        setMetrics({
          vertices: g.path.length,
          cayleyEdges: g.edges.length / 3,
          cycleEdges: g.flips.length,
          rnEdges: g.rn.length,
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
    if (activeRenderer !== "canvas") return;
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
    drawToCanvas(ctx, {
      graph,
      settings,
      cssWidth: width,
      cssHeight: height,
      dpr,
    });
  }, [
    activeRenderer,
    graph,
    settings,
    settings.alpha,
    settings.width,
    settings.showCayley,
    settings.showCycle,
    settings.showVertices,
    settings.showLabels,
    stageSize,
    stageSize.width,
    stageSize.height,
  ]);

  useEffect(() => {
    if (activeRenderer !== "svg") return;
    const host = svgHostRef.current;
    if (!host || !graph) return;
    // Square SVG with a viewBox — CSS scales it to fill the stage.
    const svg = toSVG({ graph, settings, size: 1200 });
    host.innerHTML = svg
      .replace('width="1200"', 'width="100%"')
      .replace('height="1200"', 'height="100%"');
  }, [
    activeRenderer,
    graph,
    settings,
    settings.alpha,
    settings.width,
    settings.showCayley,
    settings.showCycle,
    settings.showVertices,
    settings.showLabels,
  ]);

  const downloadSVG = useCallback(() => {
    if (!graph) return;
    setStatus("Generating SVG…");
    setTimeout(() => {
      try {
        const svg = toSVG({ graph, settings, size: svgExportSize });
        const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${graph.preset}_n${graph.n}.svg`;
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
  }, [graph, settings, svgExportSize]);

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

        drawToCanvas(ctx, {
          graph,
          settings,
          cssWidth: svgExportSize,
          cssHeight: svgExportSize,
          dpr: 1,
        });

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
  }, [graph, settings, svgExportSize]);

  const svgDownloadDisabled = useMemo(() => {
    if (!graph) return true;
    return graph.kind !== "hypercube" && graph.n >= 9;
  }, [graph]);

  const imageDownloadDisabled = !graph;

  const setS = <K extends keyof RenderSettings>(
    key: K,
    value: RenderSettings[K]
  ) => setSettings((s) => ({ ...s, [key]: value }));

  const selectN = (value: string) => {
    const nextN = Number(value) as NValue;
    setN(nextN);
    if (nextN > MAX_INTERACTIVE_SVG_N) {
      setRenderer("canvas");
    }
  };

  const selectPreset = (value: string) => {
    setPreset(value as GraphPreset);
  };

  const selectedPresetLabel = graphPresetLabel(preset);
  const selectedPresetDescription = graphPresetDescription(preset);

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
                <SelectContent>
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
                <SelectContent>
                  {N_OPTIONS.map((opt) => (
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
                  body={`${NUMBER_FORMAT.format(estimatedVertices)} vertices and about ${NUMBER_FORMAT.format(estimatedEdges)} edges. Canvas is used on-screen because SVG can freeze the browser.`}
                />
              ) : isHeavy ? (
                <HeavyWarning
                  title="Heavy computation"
                  body={`${NUMBER_FORMAT.format(estimatedVertices)} vertices and about ${NUMBER_FORMAT.format(estimatedEdges)} edges. Building the graph takes a few seconds; Canvas is used on-screen.`}
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
              </RadioGroup>
            </div>

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
                    ? "SVG export is unavailable above P8 for this graph"
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
          {running ? (
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
              {activeRenderer === "canvas" ? (
                <canvas ref={canvasRef} className="block h-full w-full" />
              ) : (
                <div
                  ref={svgHostRef}
                  className="block h-full w-full [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
                />
              )}
              <div className="absolute left-3 top-3 flex items-center gap-2 rounded-md border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur">
                <span className="font-mono">n = {n}</span>
                <span>·</span>
                <span className="rounded border bg-muted px-1 py-px font-mono text-[10px] uppercase">
                  {activeRenderer}
                </span>
                <span>·</span>
                <span className="rounded border bg-muted px-1 py-px font-mono text-[10px] uppercase">
                  {graphPresetLabel(preset)}
                </span>
                <span>·</span>
                <span>{status}</span>
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

