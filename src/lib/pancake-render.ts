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

import { factorial, type PancakeGraph, type QuotientGraph } from "./pancake";

/**
 * Edge coloring mode:
 *   - "off"  → all edges share a single color (legacy behavior)
 *   - "both" → edges colored by parity of their endpoints (two-pass)
 *   - "even" → only parity-preserving (same-parity) edges are drawn
 *   - "odd"  → only parity-changing (cross-parity) edges are drawn
 */
export type ParityMode = "off" | "both" | "even" | "odd";
export type EdgeRenderMode = "line" | "density";

export interface RenderSettings {
  alpha: number;
  width: number;
  showCayley: boolean;
  showCycle: boolean;
  showVertices: boolean;
  showLabels: boolean;
  parityMode: ParityMode;
  edgeMode?: EdgeRenderMode;
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
    const hidden = hiddenGeneratorSet(settings.hiddenGenerators);
    const passes = parityPasses(settings.parityMode, graph, palette);

    if (settings.edgeMode === "density") {
      drawDensityEdges(ctx, {
        graph,
        passes,
        hidden,
        total,
        c,
        cy,
        r,
        size,
        edgeAlpha,
        edgeWidth,
      });
    } else {
      // Very large paths can be discarded by browser canvas implementations.
      // Stroke in batches so P9/P10 do not build a multi-million segment path.
      const batchSize = n >= 9 ? 15_000 : 60_000;

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

      for (const pass of passes) drawPass(pass.filter, pass.color);
    }
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

/* -------------------------------- quotient -------------------------------- */

interface QuotientDrawOpts {
  quotient: QuotientGraph;
  settings: RenderSettings;
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  zoom?: number;
  panX?: number;
  panY?: number;
  palette?: Palette;
}

/** Categorical hue for a block's leading symbol — one color per Pₙ₋₁ copy. */
function clusterColor(symbol: number, n: number, alpha: number): string {
  const hue = ((symbol - 1) / Math.max(1, n)) * 360;
  return `hsla(${hue.toFixed(1)}, 62%, 46%, ${clamp(alpha, 0, 1)})`;
}

/**
 * Draw the coarsened quotient graph: blocks on a circle (clustered by leading
 * symbol), inter-block super-edges as log-weighted chords, and intra-block
 * density encoded as the node radius. This is the "x-ray" of the recursive
 * structure that the saturated full graph hides.
 */
export function drawQuotientToCanvas(
  ctx: CanvasRenderingContext2D,
  opts: QuotientDrawOpts
): void {
  const {
    quotient,
    settings,
    cssWidth,
    cssHeight,
    dpr,
    zoom = 1,
    panX = 0,
    panY = 0,
    palette = DEFAULT_PALETTE,
  } = opts;
  const { n, depth, blockCount, blockKey, superEdges, selfWeight } = quotient;

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
  const edgeAlpha = sliderToEdgeAlpha(settings.alpha);
  const edgeWidth = sliderToEdgeWidth(settings.width) * scale;

  ctx.lineCap = "round";

  const blockPoint = (b: number): [number, number] => {
    const a = (2 * Math.PI * b) / blockCount;
    return [c + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const leadSymbol = (b: number): number => blockKey[b * depth];

  // Outer cluster arcs: contiguous runs of blocks sharing a leading symbol —
  // each run is one recursive Pₙ₋₁ copy. Skipped at depth 1 (every block is
  // its own cluster, so the colored nodes already convey it).
  if (depth >= 2 && blockCount > 1) {
    const arcR = r * 1.07;
    ctx.lineWidth = Math.max(2 * scale, 5 * scale);
    let runStart = 0;
    for (let b = 1; b <= blockCount; b++) {
      if (b === blockCount || leadSymbol(b) !== leadSymbol(runStart)) {
        const a0 = (2 * Math.PI * (runStart - 0.42)) / blockCount;
        const a1 = (2 * Math.PI * (b - 1 + 0.42)) / blockCount;
        ctx.beginPath();
        ctx.strokeStyle = clusterColor(leadSymbol(runStart), n, 0.85);
        ctx.arc(c, cy, arcR, a0, a1);
        ctx.stroke();
        runStart = b;
      }
    }
  }

  // Inter-block super-edges, already sorted ascending by weight so the
  // heaviest connections paint on top.
  const maxSuperLog = Math.log1p(quotient.maxSuperWeight);
  if (maxSuperLog > 0) {
    for (let e = 0; e < superEdges.length; e += 3) {
      const a = superEdges[e];
      const b = superEdges[e + 1];
      const tone = Math.log1p(superEdges[e + 2]) / maxSuperLog;
      const [ax, ay] = blockPoint(a);
      const [bx, by] = blockPoint(b);
      ctx.beginPath();
      ctx.strokeStyle = withAlpha(
        palette.cayleyStroke,
        Math.min(0.95, edgeAlpha * (0.05 + 0.95 * tone))
      );
      ctx.lineWidth = Math.max(0.35 * scale, edgeWidth * (0.3 + 4 * tone));
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
  }

  // Block nodes: radius encodes intra-block (recursive) edge density.
  const maxSelfLog = Math.log1p(quotient.maxSelfWeight);
  const baseRadius =
    (blockCount <= 16 ? 11 : blockCount <= 48 ? 7 : blockCount <= 130 ? 4.4 : 2.4) *
    scale;
  for (let b = 0; b < blockCount; b++) {
    const selfTone =
      maxSelfLog > 0 ? Math.log1p(selfWeight[b]) / maxSelfLog : 1;
    const radius = baseRadius * (0.42 + 1.35 * selfTone);
    const [x, y] = blockPoint(b);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = clusterColor(leadSymbol(b), n, 0.92);
    ctx.fill();
    if (radius > 2.2 * scale) {
      ctx.lineWidth = Math.max(0.4 * scale, 0.6 * scale);
      ctx.strokeStyle = withAlpha(palette.background, 0.85);
      ctx.stroke();
    }
  }

  // Leading-symbol labels for small quotients only — they overlap otherwise.
  if (settings.showLabels && blockCount <= 60) {
    ctx.fillStyle = palette.labelFill;
    ctx.font = `${(blockCount <= 16 ? 13 : 9) * scale}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let b = 0; b < blockCount; b++) {
      const a = (2 * Math.PI * b) / blockCount;
      const lx = c + r * 1.16 * Math.cos(a);
      const ly = cy + r * 1.16 * Math.sin(a);
      let label = "";
      for (let t = 0; t < depth; t++) label += blockKey[b * depth + t];
      ctx.fillText(label, lx, ly);
    }
  }

  ctx.restore();
}

interface DensityDrawOpts {
  graph: PancakeGraph;
  passes: Array<{ filter: -1 | 0 | 1; color: string }>;
  hidden: Set<number> | null;
  total: number;
  c: number;
  cy: number;
  r: number;
  size: number;
  edgeAlpha: number;
  edgeWidth: number;
}

function drawDensityEdges(ctx: CanvasRenderingContext2D, opts: DensityDrawOpts): void {
  const { graph, passes, hidden, total, c, cy, r, size, edgeAlpha, edgeWidth } = opts;
  const { edges } = graph;
  const sectors = clamp(Math.round(size / 4), 128, 320);
  const vertexToSector = (i: number) => Math.min(sectors - 1, Math.floor((i / total) * sectors));

  ctx.lineCap = "round";

  for (const pass of passes) {
    const buckets = new Map<number, number>();
    let maxCount = 0;

    for (let t = 0; t < edges.length; t += 3) {
      const i = edges[t];
      const j = edges[t + 1];
      if (hidden && hidden.has(edges[t + 2])) continue;
      if (pass.filter >= 0) {
        const p = graph.vertexParity[i] ^ graph.vertexParity[j];
        if (p !== pass.filter) continue;
      }

      const a = vertexToSector(i);
      const b = vertexToSector(j);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = lo * sectors + hi;
      const count = (buckets.get(key) ?? 0) + 1;
      buckets.set(key, count);
      if (count > maxCount) maxCount = count;
    }

    if (maxCount === 0) continue;

    const maxLog = Math.log1p(maxCount);
    for (const [key, count] of buckets) {
      const lo = Math.floor(key / sectors);
      const hi = key % sectors;
      const tone = Math.log1p(count) / maxLog;
      const [ax, ay] = sectorPoint(lo, sectors, c, cy, r);
      const [bx, by] = sectorPoint(hi, sectors, c, cy, r);

      ctx.beginPath();
      ctx.strokeStyle = withAlpha(pass.color, edgeAlpha * (0.08 + 0.92 * tone));
      ctx.lineWidth = Math.max(edgeWidth, edgeWidth * (0.5 + 3 * tone));
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
  }
}

function sectorPoint(
  sector: number,
  sectors: number,
  cx: number,
  cy: number,
  r: number
): [number, number] {
  const a = (2 * Math.PI * (sector + 0.5)) / sectors;
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

/* ------------------------------- symmetry --------------------------------- */

/**
 * Presets whose layout has an exact n-fold rotational symmetry that the
 * Symmetry renderer can exploit. Both Zaks orderings (the greedy smallest-flip
 * walk and the explicit recursion) split into n consecutive blocks of (n-1)!
 * permutations sharing a leading symbol, and the whole edge set is invariant
 * under a shift of one block — i.e. a 360/n rotation. (Verified empirically for
 * every generator rₖ and for the edge parity, so hidden-generator and parity
 * filtering stay exact.)
 */
export function supportsSymmetry(graph: Pick<PancakeGraph, "preset">): boolean {
  return (
    graph.preset === "pancake-zaks" ||
    graph.preset === "pancake-zaks-recursive"
  );
}

/**
 * Resolution-independent SVG of a Zaks pancake graph that draws only the
 * fundamental angular sector (one orbit representative per edge) and reuses it
 * via n rotated `<use>` elements.
 *
 * Why it is exact: place vertices on the circle in path order, so vertex i sits
 * at angle 2π·i/n!. A 360/n rotation == shifting every index by B = (n-1)!
 * (one block). The drawn edge set is invariant under that shift, so rotating a
 * single representative reproduces its whole orbit. We pick representatives with
 * an O(edges) rule that needs no orbit search:
 *   - short reversals rₖ (k<n) keep the leading symbol fixed, so both endpoints
 *     of an edge live in the same block: keep it iff that block is block 0
 *     (smaller endpoint i < B and the other j < B), rotate n times.
 *   - the full reversal rₙ crosses blocks: for an edge with i < B and j ≥ B let
 *     v = j mod B (the block-0 endpoint of the orbit's sibling edge). Keep iff
 *     i < v (generic orbit, rotate n times) or i == v (antipodal "diameter"
 *     chord, orbit size n/2, rotate n/2 times); skip the non-canonical sibling
 *     i > v.
 *
 * The result is byte-for-byte the same geometry as `toSVG` but ~n× smaller, so
 * it stays exportable where the flat renderer would produce a multi-megabyte
 * (or browser-freezing) file.
 */
export function toSymmetrySVG(opts: SvgOpts): string {
  const { graph, settings, size, palette = DEFAULT_PALETTE } = opts;
  const { path, edges } = graph;
  const n = graph.n;
  const total = path.length;
  const B = factorial(n - 1);
  const c = size / 2;
  const r = size * 0.405;
  const scale = size / 1000;

  const k = constantsFor(n, scale);
  const edgeAlpha = sliderToEdgeAlpha(settings.alpha);
  const edgeWidth = sliderToEdgeWidth(settings.width) * scale;

  const rotate = (steps: number): string =>
    steps === 0
      ? ""
      : ` transform="rotate(${((360 / n) * steps).toFixed(4)} ${c} ${c})"`;
  const seg = (i: number, j: number): string => {
    const [ax, ay] = point(i, total, c, r);
    const [bx, by] = point(j, total, c, r);
    return `M${ax.toFixed(2)},${ay.toFixed(2)}L${bx.toFixed(2)},${by.toFixed(2)}`;
  };

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`
  );
  parts.push(`<rect width="100%" height="100%" fill="${palette.background}"/>`);

  // The cycle circle is trivially rotation-invariant — draw it once.
  if (settings.showCycle) {
    parts.push(
      `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${palette.cayleyStroke}" stroke-width="${k.cycleWidth}" stroke-opacity="${edgeAlpha}"/>`
    );
  }

  const defs: string[] = [];
  const uses: string[] = [];
  let fragId = 0;
  const emitFragment = (d: string, color: string, repeats: number): void => {
    if (d.length === 0 || repeats <= 0) return;
    const id = `s${fragId++}`;
    defs.push(
      `<path id="${id}" d="${d}" fill="none" stroke="${color}" stroke-width="${edgeWidth}" stroke-opacity="${edgeAlpha}" stroke-linecap="round"/>`
    );
    for (let s = 0; s < repeats; s++) uses.push(`<use href="#${id}"${rotate(s)}/>`);
  };

  if (settings.showCayley && edges.length > 0) {
    const passes = parityPasses(settings.parityMode, graph, palette);
    const hidden = hiddenGeneratorSet(settings.hiddenGenerators);
    const halfTurns = n % 2 === 0 ? n / 2 : 0;

    for (const pass of passes) {
      let dFull = ""; // orbit size n
      let dHalf = ""; // antipodal orbit size n/2 (even n only)
      for (let t = 0; t < edges.length; t += 3) {
        const i = edges[t];
        const j = edges[t + 1];
        if (hidden && hidden.has(edges[t + 2])) continue;
        if (pass.filter >= 0) {
          const p = graph.vertexParity[i] ^ graph.vertexParity[j];
          if (p !== pass.filter) continue;
        }
        // Fundamental-domain rule (edges are stored with i < j).
        if (i >= B) continue;
        if (j < B) {
          dFull += seg(i, j);
        } else {
          const v = j % B;
          if (i < v) dFull += seg(i, j);
          else if (i === v && halfTurns) dHalf += seg(i, j);
        }
      }
      emitFragment(dFull, pass.color, n);
      emitFragment(dHalf, pass.color, halfTurns);
    }
  }

  // Vertices: block-0 dots reused via rotation, same as the edges.
  if (settings.showVertices) {
    const dotRadius = Math.max(0.5, k.vertexRadius);
    let dots = "";
    for (let i = 0; i < B; i++) {
      const [x, y] = point(i, total, c, r);
      dots += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${dotRadius.toFixed(
        2
      )}" fill="${palette.cayleyStroke}" fill-opacity="${edgeAlpha}"/>`;
    }
    if (dots.length > 0) {
      const id = `s${fragId++}`;
      defs.push(`<g id="${id}">${dots}</g>`);
      for (let s = 0; s < n; s++) uses.push(`<use href="#${id}"${rotate(s)}/>`);
    }
  }

  if (defs.length > 0) {
    parts.push(`<defs>${defs.join("")}</defs>`);
    parts.push(uses.join(""));
  }

  // Labels are only legible for tiny n, where the full set is cheap anyway.
  if (settings.showLabels && n <= 5) {
    const fs = total <= 24 ? 12 : 6;
    for (let i = 0; i < total; i++) {
      const [x, y] = point(i, total, c, r);
      parts.push(
        `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="${fs}" text-anchor="middle" dominant-baseline="middle" fill="${palette.labelFill}">${permLabel(path[i])}</text>`
      );
    }
  }

  parts.push("</svg>");
  return parts.join("");
}
