/**
 * Rendering helpers for the pancake graph.
 *
 * Two backends share the same geometry / styling:
 *   - drawToCanvas: the on-screen renderer (HiDPI aware, hands millions
 *     of edges without breaking the DOM)
 *   - toSVG: an offline SVG string for download
 *
 * Geometry places vertices on a circle in the selected cycle order and
 * draws graph edges as straight chords. Per-n sizing constants keep
 * small graphs readable and large ones visible.
 */

import type { PancakeGraph } from "./pancake";

/**
 * Edge coloring mode:
 *   - "off"  → all edges share a single color (legacy behavior)
 *   - "both" → edges colored by parity of their endpoints (two-pass)
 *   - "even" → only parity-preserving (same-parity) edges are drawn
 *   - "odd"  → only parity-changing (cross-parity) edges are drawn
 */
export type ParityMode = "off" | "both" | "even" | "odd";

export interface RenderSettings {
  alpha: number;
  width: number;
  showCayley: boolean;
  showCycle: boolean;
  showVertices: boolean;
  showLabels: boolean;
  parityMode: ParityMode;
  /** Generator ids whose edges should be skipped at render time. */
  hiddenGenerators: number[];
}

export interface Palette {
  background: string;
  vertexFill: string;
  vertexStroke: string;
  cayleyStroke: string;
  cayleyEvenStroke: string;
  cayleyOddStroke: string;
  cycleStroke: string;
  labelFill: string;
}

export const DEFAULT_PALETTE: Palette = {
  background: "#ffffff",
  vertexFill: "#666666",
  vertexStroke: "#111111",
  cayleyStroke: "#000000",
  // sky-500 / rose-500 — match the Tserouf parity coloring
  cayleyEvenStroke: "#0ea5e9",
  cayleyOddStroke: "#f43f5e",
  cycleStroke: "#666666",
  labelFill: "#111111",
};

interface SizingConstants {
  cycleWidth: number;
  vertexRadius: number;
}

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/*
 * Edge strength / width are driven entirely by the UI sliders (1..100).
 * The mapping is exponential so a single slider spans the wide dynamic
 * range needed across n: a dense pancake graph at n=10 needs ~30× thinner,
 * far fainter strokes than a sparse graph at n=4. The component sets a
 * density-appropriate slider value on each n/graph change; the user can
 * then adjust from there.
 *
 * `*ToSlider` are the exact inverses of `sliderTo*`, so the recommended
 * value the component computes round-trips back to the same effective
 * style here.
 */
const EDGE_ALPHA_MIN = 0.05;
const EDGE_ALPHA_MAX = 0.6;
const EDGE_WIDTH_MIN = 0.04; // at scale = 1
const EDGE_WIDTH_MAX = 2.0;

export function sliderToEdgeAlpha(slider: number): number {
  const t = clamp(slider, 1, 100) / 100;
  return Math.min(
    0.95,
    EDGE_ALPHA_MIN * Math.pow(EDGE_ALPHA_MAX / EDGE_ALPHA_MIN, t)
  );
}

export function edgeAlphaToSlider(alpha: number): number {
  const a = clamp(alpha, EDGE_ALPHA_MIN, EDGE_ALPHA_MAX);
  const t = Math.log(a / EDGE_ALPHA_MIN) / Math.log(EDGE_ALPHA_MAX / EDGE_ALPHA_MIN);
  return clamp(Math.round(t * 100), 1, 100);
}

/** Returned width is at scale = 1; callers multiply by their render scale. */
export function sliderToEdgeWidth(slider: number): number {
  const t = clamp(slider, 1, 100) / 100;
  return EDGE_WIDTH_MIN * Math.pow(EDGE_WIDTH_MAX / EDGE_WIDTH_MIN, t);
}

export function edgeWidthToSlider(width: number): number {
  const w = clamp(width, EDGE_WIDTH_MIN, EDGE_WIDTH_MAX);
  const t = Math.log(w / EDGE_WIDTH_MIN) / Math.log(EDGE_WIDTH_MAX / EDGE_WIDTH_MIN);
  return clamp(Math.round(t * 100), 1, 100);
}

function constantsFor(n: number, scale: number): SizingConstants {
  // For n >= 8 the per-segment arc length on the cycle is tiny, so we
  // need a thicker stroke to actually see the perimeter at typical
  // canvas sizes (~800 px).
  const cycleWidth =
    (n <= 5 ? 2.3 : n === 6 ? 1.45 : n === 7 ? 0.8 : n === 8 ? 0.9 : n === 9 ? 1.8 : 1.2) * scale;
  const vertexRadius =
    (n <= 4 ? 10 : n === 5 ? 4.4 : n === 6 ? 1.7 : n === 7 ? 0.9 : n === 8 ? 0.5 : n === 9 ? 0.35 : 0.2) *
    scale;
  return { cycleWidth, vertexRadius };
}

function point(i: number, total: number, c: number, r: number): [number, number] {
  const a = (2 * Math.PI * i) / total;
  return [c + r * Math.cos(a), c + r * Math.sin(a)];
}

/**
 * The effective n for sizing/density heuristics. The sizing constants assume
 * roughly n! vertices, but the sliding puzzle on a 2 × n grid has (2n)! of
 * them, so it should be sized like a permutation graph of order 2n.
 */
function sizingN(graph: PancakeGraph): number {
  return graph.kind === "sliding-puzzle" ? 2 * graph.n : graph.n;
}

/* --------------------------------- canvas --------------------------------- */

interface CanvasDrawOpts {
  graph: PancakeGraph;
  settings: RenderSettings;
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  zoom?: number;
  panX?: number;
  panY?: number;
  palette?: Palette;
}

export function drawToCanvas(
  ctx: CanvasRenderingContext2D,
  opts: CanvasDrawOpts
): void {
  const {
    graph,
    settings,
    cssWidth,
    cssHeight,
    dpr,
    zoom = 1,
    panX = 0,
    panY = 0,
    palette = DEFAULT_PALETTE,
  } = opts;
  const { path, edges } = graph;
  const n = sizingN(graph);
  const total = path.length;

  const w = cssWidth * dpr;
  const h = cssHeight * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(w / 2 + panX * dpr, h / 2 + panY * dpr);
  ctx.scale(zoom, zoom);
  ctx.translate(-w / 2, -h / 2);

  const size = Math.min(w, h);
  const c = size / 2 + (w - size) / 2;
  const cy = size / 2 + (h - size) / 2;
  const r = size * 0.405;
  const scale = size / 1000;

  const k = constantsFor(n, scale);
  const edgeAlpha = sliderToEdgeAlpha(settings.alpha);
  const edgeWidth = sliderToEdgeWidth(settings.width) * scale;

  ctx.lineCap = "round";

  // Draw the cycle first so edges paint over it. Many Cayley generators
  // produce short chords that hug the perimeter; if the cycle were on top
  // it would completely occlude them (the cycle stroke is wider than the
  // chord deviation from the arc).
  if (settings.showCycle) {
    ctx.beginPath();
    ctx.arc(c, cy, r, 0, 2 * Math.PI);
    ctx.strokeStyle = withAlpha(palette.cayleyStroke, edgeAlpha);
    ctx.lineWidth = k.cycleWidth;
    ctx.stroke();
  }

  if (settings.showCayley && edges.length > 0) {
    ctx.lineWidth = edgeWidth;
    // Very large paths can be discarded by browser canvas implementations.
    // Stroke in batches so P9/P10 do not build a multi-million segment path.
    const batchSize = n >= 9 ? 15_000 : 60_000;
    const hidden = hiddenGeneratorSet(settings.hiddenGenerators);

    const drawPass = (parityFilter: -1 | 0 | 1, color: string) => {
      ctx.strokeStyle = withAlpha(color, edgeAlpha);
      for (let start = 0; start < edges.length; start += batchSize * 3) {
        const end = Math.min(edges.length, start + batchSize * 3);
        ctx.beginPath();
        for (let t = start; t < end; t += 3) {
          const i = edges[t];
          const j = edges[t + 1];
          if (hidden && hidden.has(edges[t + 2])) continue;
          if (parityFilter >= 0) {
            const p = graph.vertexParity[i] ^ graph.vertexParity[j];
            if (p !== parityFilter) continue;
          }
          const [ax, ay] = pointXY(i, total, c, cy, r);
          const [bx, by] = pointXY(j, total, c, cy, r);
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
        }
        ctx.stroke();
      }
    };

    const passes = parityPasses(settings.parityMode, graph, palette);
    for (const pass of passes) drawPass(pass.filter, pass.color);
  }

  if (settings.showVertices) {
    // Plain solid dots — same gray as the edges (color + alpha).
    ctx.fillStyle = withAlpha(palette.cayleyStroke, edgeAlpha);
    const dotRadius = Math.max(0.5, k.vertexRadius);
    for (let i = 0; i < total; i++) {
      const [x, y] = pointXY(i, total, c, cy, r);
      ctx.beginPath();
      ctx.arc(x, y, dotRadius, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  if (settings.showLabels && n <= 5) {
    ctx.fillStyle = palette.labelFill;
    ctx.font = `${(total <= 24 ? 12 : 6) * dpr}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < total; i++) {
      const [x, y] = pointXY(i, total, c, cy, r);
      ctx.fillText(permLabel(path[i]), x, y);
    }
  }

  ctx.restore();
}

function pointXY(i: number, total: number, cx: number, cy: number, r: number): [number, number] {
  const a = (2 * Math.PI * i) / total;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/**
 * Return the per-parity stroke passes to perform for the given mode.
 * Filter values: -1 = all edges, 0 = even (parity-preserving), 1 = odd.
 *
 * For the "both" mode we draw the majority class first and the minority on
 * top, so the rare class is never painted over by the dominant one.
 */
function hiddenGeneratorSet(ids: number[] | undefined): Set<number> | null {
  if (!ids || ids.length === 0) return null;
  return new Set(ids);
}

function parityPasses(
  mode: ParityMode,
  graph: PancakeGraph,
  palette: Palette
): Array<{ filter: -1 | 0 | 1; color: string }> {
  if (mode === "off") {
    return [{ filter: -1, color: palette.cayleyStroke }];
  }
  if (mode === "even") {
    return [{ filter: 0, color: palette.cayleyEvenStroke }];
  }
  if (mode === "odd") {
    return [{ filter: 1, color: palette.cayleyOddStroke }];
  }
  const evenPass = { filter: 0 as const, color: palette.cayleyEvenStroke };
  const oddPass = { filter: 1 as const, color: palette.cayleyOddStroke };
  return graph.evenEdgeCount >= graph.oddEdgeCount
    ? [evenPass, oddPass]
    : [oddPass, evenPass];
}

function withAlpha(hex: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function permLabel(p: Uint8Array): string {
  let s = "";
  for (let i = 0; i < p.length; i++) s += p[i];
  return s;
}

/* ----------------------------------- svg ---------------------------------- */

interface SvgOpts {
  graph: PancakeGraph;
  settings: RenderSettings;
  size: number;
  palette?: Palette;
}

/**
 * Build an SVG string suitable for download — same geometry as the
 * canvas renderer but resolution-independent. For very large n the
 * resulting string may be too big to keep in memory comfortably; the
 * caller should disable the action above some threshold.
 */
export function toSVG(opts: SvgOpts): string {
  const { graph, settings, size, palette = DEFAULT_PALETTE } = opts;
  const { path, edges } = graph;
  const n = sizingN(graph);
  const total = path.length;
  const c = size / 2;
  const r = size * 0.405;
  const scale = size / 1000;

  const k = constantsFor(n, scale);
  const edgeAlpha = sliderToEdgeAlpha(settings.alpha);
  const edgeWidth = sliderToEdgeWidth(settings.width) * scale;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`
  );
  parts.push(`<rect width="100%" height="100%" fill="${palette.background}"/>`);

  // Cycle first, then edges, so chord strokes are not occluded by the
  // wider cycle outline (especially important for short chords near the
  // perimeter, e.g. parity-preserving generators in pancake-Zaks).
  if (settings.showCycle) {
    parts.push(
      `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${palette.cayleyStroke}" stroke-width="${k.cycleWidth}" stroke-opacity="${edgeAlpha}"/>`
    );
  }

  if (settings.showCayley && edges.length > 0) {
    const passes = parityPasses(settings.parityMode, graph, palette);
    const hidden = hiddenGeneratorSet(settings.hiddenGenerators);
    // Match the canvas renderer: split chords into batched <path> elements
    // rather than one giant path. A single semi-transparent path composites
    // all its overlaps exactly once, flattening dense graphs into a solid
    // fill. Emitting many batches lets opacity accumulate between them, which
    // turns the overlap density into the same grayscale texture the canvas
    // shows. Batch size matches drawToCanvas so both backends look identical.
    const batchSize = n >= 9 ? 15_000 : 60_000;
    for (const pass of passes) {
      for (let start = 0; start < edges.length; start += batchSize * 3) {
        const end = Math.min(edges.length, start + batchSize * 3);
        let d = "";
        for (let t = start; t < end; t += 3) {
          const i = edges[t];
          const j = edges[t + 1];
          if (hidden && hidden.has(edges[t + 2])) continue;
          if (pass.filter >= 0) {
            const p = graph.vertexParity[i] ^ graph.vertexParity[j];
            if (p !== pass.filter) continue;
          }
          const [ax, ay] = point(i, total, c, r);
          const [bx, by] = point(j, total, c, r);
          d += `M${ax.toFixed(2)},${ay.toFixed(2)}L${bx.toFixed(2)},${by.toFixed(2)}`;
        }
        if (d.length === 0) continue;
        parts.push(
          `<path d="${d}" fill="none" stroke="${pass.color}" stroke-width="${edgeWidth}" stroke-opacity="${edgeAlpha}" stroke-linecap="round"/>`
        );
      }
    }
  }

  if (settings.showVertices) {
    const dotRadius = Math.max(0.5, k.vertexRadius);
    for (let i = 0; i < total; i++) {
      const [x, y] = point(i, total, c, r);
      parts.push(
        `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${dotRadius.toFixed(
          2
        )}" fill="${palette.cayleyStroke}" fill-opacity="${edgeAlpha}"/>`
      );
    }
    if (settings.showLabels && n <= 5) {
      const fs = total <= 24 ? 12 : 6;
      for (let i = 0; i < total; i++) {
        const [x, y] = point(i, total, c, r);
        parts.push(
          `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="${fs}" text-anchor="middle" dominant-baseline="middle" fill="${palette.labelFill}">${permLabel(path[i])}</text>`
        );
      }
    }
  }

  parts.push("</svg>");
  return parts.join("");
}
