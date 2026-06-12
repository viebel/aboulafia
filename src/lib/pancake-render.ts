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

import {
  factorial,
  forEachZaksFundamentalEdge,
  zaksBlock0,
  zaksRank,
  zaksSigma,
  zaksUnrank,
  type PancakeGraph,
  type QuotientGraph,
} from "./pancake";

/**
 * Edge coloring mode:
 *   - "off"  → all edges share a single color (legacy behavior)
 *   - "both" → edges colored by parity of their endpoints (two-pass)
 *   - "even" → only parity-preserving (same-parity) edges are drawn
 *   - "odd"  → only parity-changing (cross-parity) edges are drawn
 */
export type ParityMode = "off" | "both" | "even" | "odd";
export type EdgeRenderMode = "line" | "density";

/**
 * Tone-mapping for the Yankelovich density field:
 *   - "log"      → log1p + percentile white point + gamma (fixed global curve).
 *   - "equalize" → histogram equalization: scale-free, depends only on the
 *                  density *rank*, so it uses the full range at any n and reveals
 *                  the caustic/void web the log curve crushes at large n.
 *   - "clahe"    → contrast-limited adaptive (local) equalization: per-tile
 *                  equalization bilinearly blended, so dense centre and sparse
 *                  rim both keep local contrast.
 */
export type YankelovichTone = "log" | "equalize" | "clahe";
/** Color ramp applied to the normalized Yankelovich tone. */
export type YankelovichColormap =
  | "gray"
  | "viridis"
  | "magma"
  | "inferno"
  | "stained";

/**
 * Color scheme for the Symmetry renderer, used to visualize the dihedral (Dₙ)
 * symmetry of the Zaks pancake layout (the two generators ρ: i ↦ i+(n-1)! and
 * ω: i ↦ (n!-1)-i acting on the index ring ℤ/n!):
 *   - "parity"  → the default edge coloring (by endpoint parity).
 *   - "orbit"   → one hue per Cₙ rotation orbit. The orbit of a chord {i,j} is
 *                 the n chords {i+kB, j+kB} (B = (n-1)!); the symmetry renderer
 *                 draws one representative per orbit and rotates it n times, so
 *                 giving each representative its own hue makes every color class
 *                 a clean rotated n-set — the decisive Cₙ test.
 *   - "dihedral" → one hue per full Dₙ orbit: like "orbit" but also merging each
 *                 Cₙ orbit with its mirror under ω: i ↦ (n!−1)−i, so a chord and
 *                 its reflection share a color (the reflection test).
 *   - "blocks"  → band the n! dots into n arcs of (n-1)! by leading symbol (one
 *                 ρ-block / Pₙ₋₁ copy each) and split the chords into the two
 *                 superimposed families: short within-block reversals (r₂…rₙ₋₁)
 *                 and long between-block full reversals (rₙ).
 */
export type SymmetryColoring = "parity" | "orbit" | "dihedral" | "blocks";
export type ZaksFundamentalView = "wedge" | "circle" | "flat";

/** Which images to show in the vertex-orbit overlay. */
export type OrbitParts = "both" | "rotations" | "reflections";

export interface RenderSettings {
  alpha: number;
  width: number;
  showCayley: boolean;
  showCycle: boolean;
  showVertices: boolean;
  showLabels: boolean;
  parityMode: ParityMode;
  edgeMode?: EdgeRenderMode;
  /**
   * Tone-mapping exponent control for the Yankelovich density-field renderer,
   * as a 1..100 slider (50 ≈ neutral γ = 1). Lower values reveal the faint
   * chord envelopes; higher values keep only the brightest caustics.
   */
  yankelovichGamma?: number;
  /** Accumulator grid size for Yankelovich, in cells per side. Defaults to 1200. */
  yankelovichFieldSize?: number;
  /** Drop low-density cells below this positive-value percentile before tone mapping. */
  yankelovichNoiseFloor?: number;
  /** Render post-floor density as a binary mask instead of a graded field. */
  yankelovichBinary?: boolean;
  /**
   * Invert the Yankelovich grayscale: default is bright chords on a black field
   * (additive "long exposure"); when true it draws dark chords on white (an ink
   * / pen look that matches the app's light theme). Defaults to false.
   */
  yankelovichInvert?: boolean;
  /** Yankelovich tone-mapping mode (defaults to "clahe"). */
  yankelovichTone?: YankelovichTone;
  /** Yankelovich color ramp (defaults to "gray"). */
  yankelovichColormap?: YankelovichColormap;
  /** Number of random Zaks vertices sampled by the Yankelovich renderer. */
  yankelovichSampleCount?: number;
  /** Seed for random Yankelovich sampling; 0 keeps the exact renderer when possible. */
  yankelovichSampleSeed?: number;
  /**
   * Number of representatives the sampled-lines renderer accepts — exactly like
   * the Yankelovich "Random vertices" count. Each representative is drawn with
   * its n rotations and ω mirrors, so the number of *lines* is up to 2n× this
   * (fewer when a zoom window culls some copies). Far smaller than the
   * Yankelovich density sample count: alpha-blended lines saturate the disk once
   * a pixel is crossed by too many of them.
   */
  sampledRepCount?: number;
  /**
   * Tone-mapping contrast for the sampled-lines renderer (0..100, 0 = off).
   * Drives an SVG `<feComponentTransfer>` gamma on the line layer's *alpha*
   * (coverage) channel: it crushes the sparse background and keeps the dense
   * overlaps, so the caustic envelopes pop out of an otherwise uniform wash —
   * the vector-line analogue of the Yankelovich density tone-map.
   */
  sampledContrast?: number;
  /** Generator ids whose edges should be skipped at render time. */
  hiddenGenerators: number[];
  /** Symmetry-renderer color scheme (defaults to "parity"). */
  symmetryColoring?: SymmetryColoring;
  /** For pancake-zaks symmetry rendering, show only the enlarged seed sector. */
  zaksFundamentalOnly?: boolean;
  /** Projection used when the pancake-zaks fundamental scope is active. */
  zaksFundamentalView?: ZaksFundamentalView;
  /**
   * Draw the Dₙ overlay on the Symmetry renderer: the n radial sector lines at
   * the ρ-block boundaries, a shaded fundamental 360/n wedge, and the ω mirror
   * axis (through the midpoints of the edges fixed by the reflection). This is
   * the only annotation that confirms the full dihedral group rather than just
   * the rotation Cₙ.
   */
  showDihedralAxes?: boolean;
  /**
   * Draw all n reflection axes of the dihedral group as a light overlay — the
   * mirror lines of ρᵏ∘ω, at angles −π/n! + k·π/n. Complements showDihedralAxes
   * (which emphasizes the single decisive ω axis plus the wedge).
   */
  showSymmetryAxes?: boolean;
  /**
   * Highlight a single dihedral fundamental domain and tile the disk with its
   * images under the group. The user picks the piece granularity, which piece,
   * and which reflection axis to emphasize.
   */
  showFundamentalDomain?: boolean;
  /** Index of the highlighted 360/n sector (0…n−1). */
  domainPiece?: number;
  /** Index of the highlighted reflection axis (0…n−1). */
  domainAxis?: number;
  /**
   * Highlight the orbit of a single chosen vertex: the n rotation images
   * {i+kB} in one color and the reflection images {ω(i)+kB} in another, so the
   * group's action on one point (its full Dₙ orbit) is visible.
   */
  showVertexOrbit?: boolean;
  /** Index of the chosen vertex (0…n!−1). */
  vertexOrbitIndex?: number;
  /** Which images of the seed edge(s) to draw (defaults to "both"). */
  vertexOrbitParts?: OrbitParts;
  /** Restrict the vertex-orbit overlay to the long full-reversal rₙ edges. */
  vertexOrbitLongOnly?: boolean;
  /**
   * Recursion level m of the dihedral tower D₃ ⊂ … ⊂ Dₙ to draw the orbit at
   * (3…n). m = n is the global Dₙ orbit (the whole disk); smaller m shows the
   * intra-block Dₘ orbit, which lives inside an ever-smaller Zaks sub-block.
   * Defaults to n.
   */
  vertexOrbitLevel?: number;
  /**
   * Draw every level from n down to {@link vertexOrbitLevel} at once, each
   * colored by its recursion depth — the whole nested tower in one figure.
   */
  vertexOrbitStack?: boolean;
  /**
   * A single chosen edge {orbitEdgeA, orbitEdgeB} to seed the orbit from
   * (clicking a chord). When set (both ≥ 0) it overrides the vertex's incident
   * edges, so only this edge's orbit is shown.
   */
  orbitEdgeA?: number;
  orbitEdgeB?: number;
}

export const VERTEX_LABEL_MAX_N = 6;

export interface Palette {
  background: string;
  vertexFill: string;
  vertexStroke: string;
  cayleyStroke: string;
  cayleyEvenStroke: string;
  cayleyOddStroke: string;
  cycleStroke: string;
  labelFill: string;
  /** Bright fill for vertex dots when index labels are shown (legibility). */
  labelVertexFill: string;
  /** ω mirror axis (the decisive reflection line). */
  dihedralAxis: string;
  /** Alternating color for neighboring reflection axes (so adjacent axes are
   *  distinguishable; also marks the two reflection classes for even n). */
  dihedralAxisAlt: string;
  /** Third axis color, used only for the one wrap-around axis when n is odd
   *  (an odd cycle is not 2-colorable), so every neighbor still differs. */
  dihedralAxisAlt2: string;
  /** ρ-block boundary / sector lines. */
  dihedralSector: string;
  /** Fundamental 360/n wedge shading. */
  dihedralWedge: string;
  /** Cₙ rotation indicator (the arc arrow + label). */
  dihedralRotation: string;
  /** ω mirror axis in the vertex-orbit overlay (a neutral guide line). */
  dihedralMirror: string;
  /** Short within-block reversals (r₂…rₙ₋₁) in the "blocks" color scheme. */
  blockWithinStroke: string;
  /** Long between-block full reversals (rₙ) in the "blocks" color scheme. */
  blockBetweenStroke: string;
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
  // Bright dot behind index labels so the dark digits stay readable (the normal
  // near-black dots make label text illegible).
  labelVertexFill: "#cbd5e1", // slate-300
  dihedralAxis: "#7c3aed", // violet-600
  dihedralAxisAlt: "#ea580c", // orange-600 (alternates with the violet)
  dihedralAxisAlt2: "#db2777", // pink-600 (odd-n wrap axis)
  dihedralSector: "#94a3b8", // slate-400
  dihedralWedge: "#7c3aed", // violet-600 (low alpha when filled)
  dihedralRotation: "#059669", // emerald-600
  dihedralMirror: "#475569", // slate-600 (reflection axis guide)
  blockWithinStroke: "#0ea5e9", // sky-500 — short, local chords
  blockBetweenStroke: "#111827", // gray-900 — long rₙ skeleton
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

/**
 * Map the Yankelovich gamma slider (1..100) to a tone-mapping exponent applied
 * after the log-normalized density. Slider 50 is the neutral γ = 1; below it the
 * exponent drops toward ~0.13 (faint envelopes bloom up), above it it climbs to
 * ~8 (only the brightest caustics survive).
 */
export function sliderToYankelovichGamma(slider: number): number {
  const s = clamp(slider, 1, 100);
  return Math.pow(8, (s - 50) / 50);
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

export function supportsVertexLabels(
  graph: Pick<PancakeGraph, "kind" | "n">
): boolean {
  return (
    graph.n <= VERTEX_LABEL_MAX_N &&
    graph.kind !== "sliding-puzzle" &&
    graph.kind !== "sierpinski" &&
    graph.kind !== "kaleidoscope"
  );
}

function vertexLabel(p: ArrayLike<number>): string {
  let s = "";
  for (let i = 0; i < p.length; i++) s += String(p[i]);
  return s;
}

function vertexLabelFontSize(total: number): number {
  return total <= 24 ? 12 : total <= 120 ? 6 : 4;
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
  if (graph.kind === "sliding-puzzle") return 2 * graph.n;
  // |Bₙ| = 2ⁿ·n! grows much faster than n!; size it like the permutation graph
  // whose order is closest from below (m! ≤ 2ⁿ·n!).
  if (graph.kind === "hyperoctahedral") {
    const v = 2 ** graph.n * factorial(graph.n);
    let m = 1;
    let f = 1;
    while (f * (m + 1) <= v) {
      m++;
      f *= m;
    }
    return Math.max(3, m);
  }
  // The Sierpiński graph has 3ⁿ vertices, far fewer than n! at large n, so size
  // it like the permutation graph whose order is closest from below (m! ≤ 3ⁿ).
  if (graph.kind === "sierpinski") {
    const v = 3 ** graph.n;
    let m = 1;
    let f = 1;
    while (f * (m + 1) <= v) {
      m++;
      f *= m;
    }
    return Math.max(3, m);
  }
  return graph.n;
}

/* --------------------------- dihedral symmetry ---------------------------- */

/** Opaque HSL stroke color (alpha is applied separately when compositing). */
function hsl(hue: number, sat = 72, light = 50): string {
  return `hsl(${hue.toFixed(1)}, ${sat}%, ${light}%)`;
}

/**
 * Hue for the q-th Cₙ orbit (0 ≤ q < count). One color per rotation orbit, so
 * a clean rotated n-set proves the rotation. The golden-angle stride keeps
 * adjacent representatives visually distinct even when count is large.
 */
function orbitColor(q: number): string {
  // Golden-angle hopping decorrelates neighbors; the modulo keeps it in [0,360).
  const hue = (q * 137.508) % 360;
  return hsl(hue, 70, 48);
}


/** Color of the k-th reflection axis (of n), chosen so adjacent axes always
 *  differ without a full rainbow. Two colors alternate (matching the two
 *  reflection classes for even n); for odd n the single wrap-around axis takes
 *  a third color, since an odd cycle is not 2-colorable. */
function axisColor(k: number, n: number, palette: Palette): string {
  if (n % 2 === 1 && k === n - 1) return palette.dihedralAxisAlt2;
  return k % 2 === 0 ? palette.dihedralAxis : palette.dihedralAxisAlt;
}

/** Hue for a ρ-block (leading-symbol arc), 0 ≤ block < n. `light` brightens it
 * (used for banded vertex dots under index labels so dark digits stay legible). */
function blockColor(block: number, n: number, light = false): string {
  return hsl((block / Math.max(1, n)) * 360, light ? 72 : 65, light ? 78 : 47);
}

/**
 * The angular offset of the ρ-block boundaries (and of the ω axis). A boundary
 * sits between vertex bB-1 and bB, i.e. at angle 2πb/n - π/n!. The reflection
 * ω: i ↦ (n!-1)-i maps angle θ ↦ -2π/n! - θ, whose axis is the b = 0 boundary
 * line at -π/n! (through the midpoint of the fixed v_{n!-1}-v₀ edge).
 */
function dihedralOffset(total: number): number {
  return -Math.PI / total;
}

interface DihedralOverlayGeom {
  n: number;
  total: number;
  c: number;
  cy: number;
  r: number;
  scale: number;
}

/**
 * Draw the Dₙ overlay onto a canvas: a shaded fundamental wedge, the n radial
 * ρ-block boundary lines, and the dashed ω mirror axis (a full diameter).
 */
function drawDihedralOverlayToCanvas(
  ctx: CanvasRenderingContext2D,
  geom: DihedralOverlayGeom,
  palette: Palette
): void {
  const { n, total, c, cy, r, scale } = geom;
  const off = dihedralOffset(total);
  const step = (2 * Math.PI) / n;
  const chamber = Math.PI / n;

  ctx.save();
  ctx.setLineDash([]);

  // Shaded Dₙ fundamental chamber: half of one ρ-sector, angle π/n.
  ctx.beginPath();
  ctx.moveTo(c, cy);
  ctx.arc(c, cy, r, off, off + chamber);
  ctx.closePath();
  ctx.fillStyle = withAlpha(palette.dihedralWedge, 0.1);
  ctx.fill();

  // Radial ρ-block boundary lines (the n sector spokes).
  ctx.lineWidth = Math.max(1.4, 1.8 * scale);
  ctx.strokeStyle = withAlpha(palette.dihedralSector, 0.95);
  for (let b = 0; b < n; b++) {
    const a = off + step * b;
    ctx.beginPath();
    ctx.moveTo(c, cy);
    ctx.lineTo(c + r * Math.cos(a), cy + r * Math.sin(a));
    ctx.stroke();
  }

  // ω mirror axis: a dashed diameter through the two fixed edge-midpoints.
  ctx.lineWidth = Math.max(1.4, 1.9 * scale);
  ctx.strokeStyle = withAlpha(palette.dihedralAxis, 0.95);
  ctx.setLineDash([8 * scale, 6 * scale]);
  const ext = r * 1.04;
  ctx.beginPath();
  ctx.moveTo(c + ext * Math.cos(off), cy + ext * Math.sin(off));
  ctx.lineTo(c + ext * Math.cos(off + Math.PI), cy + ext * Math.sin(off + Math.PI));
  ctx.stroke();
  ctx.setLineDash([]);

  // Cₙ rotation indicator: an arc arrow spanning one wedge just outside the
  // perimeter, showing the 360/n rotation ρ that tiles the wedge n times.
  ctx.strokeStyle = withAlpha(palette.dihedralRotation, 0.95);
  ctx.fillStyle = withAlpha(palette.dihedralRotation, 0.95);
  ctx.lineWidth = Math.max(2, 2.2 * scale);
  ctx.lineCap = "round";
  const ra = r * 1.1;
  ctx.beginPath();
  ctx.arc(c, cy, ra, off, off + step);
  ctx.stroke();
  // Arrowhead at the leading end (increasing-angle travel direction).
  const tipx = c + ra * Math.cos(off + step);
  const tipy = cy + ra * Math.sin(off + step);
  const dir = off + step + Math.PI / 2;
  const ah = Math.max(7, 10 * scale);
  ctx.beginPath();
  ctx.moveTo(tipx, tipy);
  ctx.lineTo(tipx + ah * Math.cos(dir + Math.PI - 0.45), tipy + ah * Math.sin(dir + Math.PI - 0.45));
  ctx.moveTo(tipx, tipy);
  ctx.lineTo(tipx + ah * Math.cos(dir + Math.PI + 0.45), tipy + ah * Math.sin(dir + Math.PI + 0.45));
  ctx.stroke();
  // Label the rotation amount at the arc midpoint.
  const am = off + step / 2;
  const lr = r * 1.19;
  ctx.font = `${Math.max(11, 13 * scale)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`ρ ${Math.round(360 / n)}°`, c + lr * Math.cos(am), cy + lr * Math.sin(am));

  ctx.restore();
}

/** Apply an alpha to a hex (#rrggbb) or `hsl(...)` color string. */
function applyAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  if (color.startsWith("hsl(")) {
    return color.replace("hsl(", "hsla(").replace(/\)\s*$/, `, ${a})`);
  }
  return withAlpha(color, a);
}

/**
 * The active dihedral color scheme for a graph, or null when it does not apply
 * (non-Zaks preset, or the default "parity" scheme). Used by the flat Canvas /
 * SVG renderers, which only honor orbit/blocks coloring on the rotationally
 * symmetric Zaks layouts.
 */
function dihedralColoring(
  graph: Pick<PancakeGraph, "preset">,
  settings: RenderSettings
): Exclude<SymmetryColoring, "parity"> | null {
  const c = settings.symmetryColoring ?? "parity";
  if (c === "parity") return null;
  return supportsSymmetry(graph) ? c : null;
}

/**
 * Canonical id of a chord's Cₙ orbit: the lexicographically smallest rotated
 * index pair, encoded lo·total+hi. Two chords share an orbit iff one maps to
 * the other under a shift i ↦ i+kB (B = (n-1)!), so this is rotation-invariant.
 */
function canonicalOrbitCode(
  i: number,
  j: number,
  n: number,
  total: number,
  B: number
): number {
  let best = Infinity;
  for (let k = 0; k < n; k++) {
    const a = (i + k * B) % total;
    const b = (j + k * B) % total;
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const code = lo * total + hi;
    if (code < best) best = code;
  }
  return best;
}

/**
 * Canonical id of a chord's full dihedral (Dₙ) orbit: the smaller of its own
 * Cₙ canonical code and that of its reflection ω: i ↦ (n!−1)−i. Two chords
 * share a Dₙ orbit iff one maps to the other under a rotation and/or ω, so this
 * merges each Cₙ orbit with its mirror image.
 */
function canonicalDihedralCode(
  i: number,
  j: number,
  n: number,
  total: number,
  B: number
): number {
  const direct = canonicalOrbitCode(i, j, n, total, B);
  const mirror = canonicalOrbitCode(total - 1 - i, total - 1 - j, n, total, B);
  return direct < mirror ? direct : mirror;
}

// Cₙ-canonical-code → orbit index, in the SAME order the Symmetry renderer
// enumerates fundamental edges. Sharing these maps makes the flat Canvas/SVG
// coloring, the Symmetry view, and the orbit table all agree on a hue per
// orbit. Two variants: "orbit" gives one index per Cₙ orbit; "dihedral" merges
// ω-related Cₙ orbits so a reflection pair shares a color. Cached per n.
const orbitQMapCache = new Map<number, Map<number, number>>();
const dihedralQMapCache = new Map<number, Map<number, number>>();

function orbitQMapFor(n: number): Map<number, number> {
  const cached = orbitQMapCache.get(n);
  if (cached) return cached;
  const total = factorial(n);
  const B = factorial(n - 1);
  const map = new Map<number, number>();
  let q = 0;
  forEachZaksFundamentalEdge(n, (e) => {
    map.set(canonicalOrbitCode(e.i, e.j, n, total, B), q);
    q++;
  });
  orbitQMapCache.set(n, map);
  return map;
}

function dihedralQMapFor(n: number): Map<number, number> {
  const cached = dihedralQMapCache.get(n);
  if (cached) return cached;
  const total = factorial(n);
  const B = factorial(n - 1);
  const map = new Map<number, number>(); // Cₙ code → Dₙ orbit index
  const dCodeToIndex = new Map<number, number>();
  let next = 0;
  forEachZaksFundamentalEdge(n, (e) => {
    const cn = canonicalOrbitCode(e.i, e.j, n, total, B);
    const dCode = canonicalDihedralCode(e.i, e.j, n, total, B);
    let idx = dCodeToIndex.get(dCode);
    if (idx === undefined) {
      idx = next++;
      dCodeToIndex.set(dCode, idx);
    }
    map.set(cn, idx);
  });
  dihedralQMapCache.set(n, map);
  return map;
}

/** The Cₙ-code → hue-index map for the chosen orbit coloring. */
function orbitIndexMap(n: number, coloring: SymmetryColoring): Map<number, number> {
  return coloring === "dihedral" ? dihedralQMapFor(n) : orbitQMapFor(n);
}

// One color per edge (orbit hue), cached on the graph's edge array (a fresh
// build allocates a new Uint32Array, so identity is a safe, GC-friendly key)
// keyed also by the orbit coloring. Recomputing on every zoom/pan would be
// wasteful (it is O(n · edges)).
const orbitColorCache = new WeakMap<
  Uint32Array,
  Partial<Record<SymmetryColoring, string[]>>
>();

/**
 * Assign every (flat) edge the hue of its rotation orbit ("orbit") or full
 * dihedral orbit ("dihedral", which merges each Cₙ orbit with its ω mirror), so
 * the members of an orbit share one color across the whole disk. For
 * pancake-zaks the hue index comes from the shared fundamental-edge map (so
 * flat/symmetry/table colors match); other symmetric layouts (e.g. the
 * recursive Zaks order, whose index ring differs) fall back to first-seen.
 */
function orbitColorsForGraph(
  graph: PancakeGraph,
  coloring: SymmetryColoring
): string[] {
  const bucket = orbitColorCache.get(graph.edges);
  const cached = bucket?.[coloring];
  if (cached) return cached;
  const { n, edges, preset } = graph;
  const total = graph.path.length;
  const B = total / n;
  const numEdges = edges.length / 3;
  const colors = new Array<string>(numEdges);
  const canon = (i: number, j: number) =>
    coloring === "dihedral"
      ? canonicalDihedralCode(i, j, n, total, B)
      : canonicalOrbitCode(i, j, n, total, B);
  if (preset === "pancake-zaks") {
    const qmap = orbitIndexMap(n, coloring);
    for (let t = 0, e = 0; t < edges.length; t += 3, e++) {
      // Map keys are Cₙ codes; for dihedral the code resolves through the
      // mirror-merged index map below, so look up via the Cₙ code.
      const cn = canonicalOrbitCode(edges[t], edges[t + 1], n, total, B);
      colors[e] = orbitColor(qmap.get(cn) ?? 0);
    }
  } else {
    const keyToOrbit = new Map<number, number>();
    let nextOrbit = 0;
    for (let t = 0, e = 0; t < edges.length; t += 3, e++) {
      const code = canon(edges[t], edges[t + 1]);
      let orbit = keyToOrbit.get(code);
      if (orbit === undefined) {
        orbit = nextOrbit++;
        keyToOrbit.set(code, orbit);
      }
      colors[e] = orbitColor(orbit);
    }
  }
  orbitColorCache.set(graph.edges, { ...(bucket ?? {}), [coloring]: colors });
  return colors;
}

/** One Cₙ orbit of chords for the orbit table: its hue, generator, and the
 *  n (or n/2 for antipodal "diameter" chords) index pairs that make it up. */
export interface OrbitInfo {
  /** Hue matching the rendered orbit coloring (opaque). */
  color: string;
  /** Suffix-reversal length rₖ shared by every chord in the orbit. */
  gen: number;
  /** Antipodal diameter orbit (size n/2) vs a generic orbit (size n). */
  half: boolean;
  /** The orbit's index pairs {i, j}, each sorted, then sorted as a list. */
  pairs: Array<[number, number]>;
}

/**
 * Build the Cₙ orbit table for the pancake-zaks layout straight from the
 * recursive fundamental sector — one orbit per representative, expanded to its
 * full set of rotated index pairs {i+kB, j+kB} mod n!. O((n-1)!), so it never
 * needs the materialized n! graph. Hues match the Symmetry / flat renderers.
 */
export function computeZaksOrbits(n: number): OrbitInfo[] {
  const total = factorial(n);
  const B = factorial(n - 1);
  const orbits: OrbitInfo[] = [];
  let q = 0;
  forEachZaksFundamentalEdge(n, (e) => {
    const color = orbitColor(q);
    q++;
    const repeats = e.half ? n / 2 : n;
    const pairs: Array<[number, number]> = [];
    for (let k = 0; k < repeats; k++) {
      const a = (e.i + k * B) % total;
      const b = (e.j + k * B) % total;
      pairs.push(a < b ? [a, b] : [b, a]);
    }
    pairs.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    orbits.push({ color, gen: e.gen, half: e.half, pairs });
  });
  orbits.sort((a, b) => a.gen - b.gen || a.pairs[0][0] - b.pairs[0][0]);
  return orbits;
}

/**
 * Enumerate the fundamental sector of the Zaks layout once and split it into
 * paintable masks according to the chosen color scheme. Each mask is rotated
 * `repeats` times by the canvas compositor, reproducing the full n!-vertex disk
 * from the O((n-1)!) fundamental domain.
 */
function buildSectorMasks(
  n: number,
  coloring: SymmetryColoring,
  settings: RenderSettings,
  palette: Palette,
  total: number,
  c: number,
  cy: number,
  r: number,
  fundamentalOnly = false,
  fundamentalView: ZaksFundamentalView = "wedge"
): ZaksSymmetryMask[] {
  const hidden = hiddenGeneratorSet(settings.hiddenGenerators);
  const halfTurns = n % 2 === 0 ? n / 2 : 0;
  const mappedFundamental = fundamentalOnly && fundamentalView !== "wedge";
  const seg = (e: { i: number; j: number }): [number, number, number, number] => {
    const [ax, ay] = pointXY(e.i, total, c, cy, r);
    const [bx, by] = pointXY(e.j, total, c, cy, r);
    return [ax, ay, bx, by];
  };
  const segments = (e: { i: number; j: number; half?: boolean }) => {
    if (!mappedFundamental) return [seg(e)];
    const repeats = e.half ? halfTurns : n;
    const block = total / n;
    const out: Array<[number, number, number, number]> = [];
    for (let s = 0; s < repeats; s++) {
      const a = (e.i + s * block) % total;
      const b = (e.j + s * block) % total;
      const clipped = zaksFundamentalSegmentXY(
        a,
        b,
        total,
        n,
        c,
        cy,
        r,
        fundamentalView
      );
      if (clipped) out.push(clipped);
    }
    return out;
  };
  const fullRepeats = mappedFundamental ? 1 : n;
  const halfRepeats = mappedFundamental ? 1 : halfTurns;

  if (coloring === "orbit" || coloring === "dihedral") {
    // One hue per orbit. For "orbit" each fundamental representative is its own
    // Cₙ class; for "dihedral" ω-related classes share a hue. The n (or n/2)
    // rotated copies inherit the color, so every class is a clean rotated set.
    const B = total / n;
    const qmap = orbitIndexMap(n, coloring);
    const fullCoords: number[] = [];
    const fullColors: string[] = [];
    const halfCoords: number[] = [];
    const halfColors: string[] = [];
    forEachZaksFundamentalEdge(n, (e) => {
      if (fundamentalOnly && e.gen < n) return;
      const color = orbitColor(qmap.get(canonicalOrbitCode(e.i, e.j, n, total, B)) ?? 0);
      if (hidden && hidden.has(e.gen)) return;
      for (const [ax, ay, bx, by] of segments(e)) {
        if (e.half && !mappedFundamental) {
          halfCoords.push(ax, ay, bx, by);
          halfColors.push(color);
        } else {
          fullCoords.push(ax, ay, bx, by);
          fullColors.push(color);
        }
      }
    });
    const masks: ZaksSymmetryMask[] = [
      {
        repeats: fullRepeats,
        coords: Float32Array.from(fullCoords),
        color: null,
        colors: fullColors,
      },
    ];
    if (halfRepeats > 0 && halfCoords.length > 0) {
      masks.push({
        repeats: halfRepeats,
        coords: Float32Array.from(halfCoords),
        color: null,
        colors: halfColors,
      });
    }
    return masks;
  }

  if (coloring === "blocks") {
    // Split the two superimposed chord families: short within-block reversals
    // (r₂…rₙ₋₁, which keep the leading symbol) vs the long between-block full
    // reversal rₙ that forms the near-diametral n-gon/n-gram skeleton.
    const withinFull: number[] = [];
    const betweenFull: number[] = [];
    const betweenHalf: number[] = [];
    forEachZaksFundamentalEdge(n, (e) => {
      if (fundamentalOnly && e.gen < n) return;
      if (hidden && hidden.has(e.gen)) return;
      for (const [ax, ay, bx, by] of segments(e)) {
        if (e.gen < n) {
          withinFull.push(ax, ay, bx, by);
        } else if (e.half && !mappedFundamental) {
          betweenHalf.push(ax, ay, bx, by);
        } else {
          betweenFull.push(ax, ay, bx, by);
        }
      }
    });
    const masks: ZaksSymmetryMask[] = [];
    // Within-block chords first (light), then the rₙ skeleton on top (dark).
    if (withinFull.length > 0) {
      masks.push({
        repeats: fullRepeats,
        coords: Float32Array.from(withinFull),
        color: palette.blockWithinStroke,
        colors: null,
      });
    }
    if (betweenFull.length > 0) {
      masks.push({
        repeats: fullRepeats,
        coords: Float32Array.from(betweenFull),
        color: palette.blockBetweenStroke,
        colors: null,
      });
    }
    if (halfRepeats > 0 && betweenHalf.length > 0) {
      masks.push({
        repeats: halfRepeats,
        coords: Float32Array.from(betweenHalf),
        color: palette.blockBetweenStroke,
        colors: null,
      });
    }
    return masks;
  }

  // Default: parity coloring (mirrors parityPasses / the legacy buckets).
  const mode = settings.parityMode;
  const neutralF: number[] = [];
  const neutralH: number[] = [];
  const evenF: number[] = [];
  const evenH: number[] = [];
  const oddF: number[] = [];
  const oddH: number[] = [];
  let evenWeight = 0;
  let oddWeight = 0;
  forEachZaksFundamentalEdge(n, (e) => {
    if (fundamentalOnly && e.gen < n) return;
    const orbit = e.half ? n / 2 : n;
    if (e.parityXor === 0) evenWeight += orbit;
    else oddWeight += orbit;
    if (hidden && hidden.has(e.gen)) return;
    let full: number[];
    let half: number[];
    if (mode === "off") {
      full = neutralF;
      half = neutralH;
    } else if (mode === "even") {
      if (e.parityXor !== 0) return;
      full = evenF;
      half = evenH;
    } else if (mode === "odd") {
      if (e.parityXor !== 1) return;
      full = oddF;
      half = oddH;
    } else if (e.parityXor === 0) {
      full = evenF;
      half = evenH;
    } else {
      full = oddF;
      half = oddH;
    }
    for (const [ax, ay, bx, by] of segments(e)) {
      if (e.half && !mappedFundamental) half.push(ax, ay, bx, by);
      else full.push(ax, ay, bx, by);
    }
  });
  const mk = (color: string, f: number[], hh: number[]): ZaksSymmetryMask[] => {
    const out: ZaksSymmetryMask[] = [];
    if (f.length > 0) {
      out.push({
        repeats: fullRepeats,
        coords: Float32Array.from(f),
        color,
        colors: null,
      });
    }
    if (halfRepeats > 0 && hh.length > 0) {
      out.push({
        repeats: halfRepeats,
        coords: Float32Array.from(hh),
        color,
        colors: null,
      });
    }
    return out;
  };
  if (mode === "off") return mk(palette.cayleyStroke, neutralF, neutralH);
  if (mode === "even") return mk(palette.cayleyEvenStroke, evenF, evenH);
  if (mode === "odd") return mk(palette.cayleyOddStroke, oddF, oddH);
  return evenWeight >= oddWeight
    ? [...mk(palette.cayleyEvenStroke, evenF, evenH), ...mk(palette.cayleyOddStroke, oddF, oddH)]
    : [...mk(palette.cayleyOddStroke, oddF, oddH), ...mk(palette.cayleyEvenStroke, evenF, evenH)];
}

/**
 * Draw all n reflection axes of the dihedral group as light diameters. The
 * reflections ρᵏ∘ω map angle θ ↦ (−2π/n! + 2πk/n) − θ, so their axes sit at
 * −π/n! + k·π/n for k = 0…n−1 (n distinct mirror lines).
 */
function drawSymmetryAxesToCanvas(
  ctx: CanvasRenderingContext2D,
  geom: DihedralOverlayGeom,
  palette: Palette
): void {
  const { n, total, c, cy, r, scale } = geom;
  const off = dihedralOffset(total);
  const ext = r * 1.02;
  ctx.save();
  ctx.setLineDash([]);
  ctx.lineCap = "round";
  // Bold and opaque so the axes read over the edge tangle; colors alternate so
  // neighboring axes stay distinguishable.
  ctx.lineWidth = Math.max(2, 2.4 * scale);
  for (let k = 0; k < n; k++) {
    const a = off + (k * Math.PI) / n;
    ctx.strokeStyle = applyAlpha(axisColor(k, n, palette), 0.95);
    ctx.beginPath();
    ctx.moveTo(c + ext * Math.cos(a), cy + ext * Math.sin(a));
    ctx.lineTo(c + ext * Math.cos(a + Math.PI), cy + ext * Math.sin(a + Math.PI));
    ctx.stroke();
  }
  ctx.restore();
}

/** SVG fragment for the n light reflection axes (same geometry as the canvas). */
function symmetryAxesSVG(
  geom: { n: number; total: number; c: number; r: number; scale: number },
  palette: Palette
): string {
  const { n, total, c, r, scale } = geom;
  const off = dihedralOffset(total);
  const ext = r * 1.02;
  const sw = Math.max(2, 2.4 * scale);
  const parts: string[] = [];
  for (let k = 0; k < n; k++) {
    const a = off + (k * Math.PI) / n;
    const x0 = c + ext * Math.cos(a);
    const y0 = c + ext * Math.sin(a);
    const x1 = c + ext * Math.cos(a + Math.PI);
    const y1 = c + ext * Math.sin(a + Math.PI);
    parts.push(
      `<line x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(
        2
      )}" y2="${y1.toFixed(2)}" stroke="${axisColor(k, n, palette)}" stroke-width="${sw}" stroke-opacity="0.95" stroke-linecap="round"/>`
    );
  }
  return parts.join("");
}

/** SVG fragment for the Dₙ overlay (same geometry as the canvas version). */
function dihedralOverlaySVG(
  geom: { n: number; total: number; c: number; r: number; scale: number },
  palette: Palette
): string {
  const { n, total, c, r, scale } = geom;
  const off = dihedralOffset(total);
  const step = (2 * Math.PI) / n;
  const chamber = Math.PI / n;
  const parts: string[] = [];

  const wx0 = c + r * Math.cos(off);
  const wy0 = c + r * Math.sin(off);
  const wx1 = c + r * Math.cos(off + chamber);
  const wy1 = c + r * Math.sin(off + chamber);
  const large = chamber > Math.PI ? 1 : 0;
  parts.push(
    `<path d="M${c},${c}L${wx0.toFixed(2)},${wy0.toFixed(2)}A${r.toFixed(2)},${r.toFixed(
      2
    )} 0 ${large} 1 ${wx1.toFixed(2)},${wy1.toFixed(2)}Z" fill="${palette.dihedralWedge}" fill-opacity="0.1"/>`
  );

  for (let b = 0; b < n; b++) {
    const a = off + step * b;
    const x = c + r * Math.cos(a);
    const y = c + r * Math.sin(a);
    parts.push(
      `<line x1="${c}" y1="${c}" x2="${x.toFixed(2)}" y2="${y.toFixed(
        2
      )}" stroke="${palette.dihedralSector}" stroke-width="${Math.max(
        1.4,
        1.8 * scale
      )}" stroke-opacity="0.95"/>`
    );
  }

  const ext = r * 1.04;
  const ax0 = c + ext * Math.cos(off);
  const ay0 = c + ext * Math.sin(off);
  const ax1 = c + ext * Math.cos(off + Math.PI);
  const ay1 = c + ext * Math.sin(off + Math.PI);
  parts.push(
    `<line x1="${ax0.toFixed(2)}" y1="${ay0.toFixed(2)}" x2="${ax1.toFixed(
      2
    )}" y2="${ay1.toFixed(2)}" stroke="${palette.dihedralAxis}" stroke-width="${Math.max(
      1.4,
      1.9 * scale
    )}" stroke-opacity="0.95" stroke-dasharray="${(8 * scale).toFixed(2)},${(
      6 * scale
    ).toFixed(2)}"/>`
  );

  // Cₙ rotation indicator: arc arrow over one wedge + a 360/n label.
  const ra = r * 1.1;
  const rx0 = c + ra * Math.cos(off);
  const ry0 = c + ra * Math.sin(off);
  const rx1 = c + ra * Math.cos(off + step);
  const ry1 = c + ra * Math.sin(off + step);
  const rsw = Math.max(2, 2.2 * scale);
  parts.push(
    `<path d="M${rx0.toFixed(2)},${ry0.toFixed(2)}A${ra.toFixed(2)},${ra.toFixed(
      2
    )} 0 0 1 ${rx1.toFixed(2)},${ry1.toFixed(2)}" fill="none" stroke="${palette.dihedralRotation}" stroke-width="${rsw}" stroke-opacity="0.95" stroke-linecap="round"/>`
  );
  const dir = off + step + Math.PI / 2;
  const ah = Math.max(7, 10 * scale);
  const b1x = rx1 + ah * Math.cos(dir + Math.PI - 0.45);
  const b1y = ry1 + ah * Math.sin(dir + Math.PI - 0.45);
  const b2x = rx1 + ah * Math.cos(dir + Math.PI + 0.45);
  const b2y = ry1 + ah * Math.sin(dir + Math.PI + 0.45);
  parts.push(
    `<path d="M${b1x.toFixed(2)},${b1y.toFixed(2)}L${rx1.toFixed(2)},${ry1.toFixed(
      2
    )}L${b2x.toFixed(2)},${b2y.toFixed(2)}" fill="none" stroke="${palette.dihedralRotation}" stroke-width="${rsw}" stroke-opacity="0.95" stroke-linecap="round" stroke-linejoin="round"/>`
  );
  const am = off + step / 2;
  const lr = r * 1.19;
  const fs = Math.max(11, 13 * scale);
  parts.push(
    `<text x="${(c + lr * Math.cos(am)).toFixed(2)}" y="${(c + lr * Math.sin(am)).toFixed(
      2
    )}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="${fs.toFixed(
      1
    )}" text-anchor="middle" dominant-baseline="middle" fill="${palette.dihedralRotation}">ρ ${Math.round(
      360 / n
    )}°</text>`
  );

  return parts.join("");
}

interface DomainSelection {
  count: number;
  wedge: number;
  piece: number;
  axis: number;
}

/** Resolve the (clamped) sector count, wedge angle, piece and axis indices. */
function domainSelection(n: number, settings: RenderSettings): DomainSelection {
  const count = n;
  const wedge = (2 * Math.PI) / n;
  const piece = (((settings.domainPiece ?? 0) % count) + count) % count;
  const axis = (((settings.domainAxis ?? 0) % n) + n) % n;
  return { count, wedge, piece, axis };
}

/**
 * Highlight one Cₙ sector (a 360/n fundamental domain) and tile the disk with
 * its n rotation images. The chosen sector is shaded strongly and outlined; the
 * rest are lightly tinted, so it reads as "this seed generates everything". The
 * chosen reflection axis is drawn as a bold emerald diameter.
 */
function drawFundamentalDomainToCanvas(
  ctx: CanvasRenderingContext2D,
  geom: DihedralOverlayGeom,
  settings: RenderSettings,
  palette: Palette
): void {
  const { n, total, c, cy, r, scale } = geom;
  const off = dihedralOffset(total);
  const { count, wedge, piece, axis } = domainSelection(n, settings);

  ctx.save();
  ctx.setLineDash([]);

  const fillWedge = (t: number, style: string) => {
    const a0 = off + t * wedge;
    ctx.beginPath();
    ctx.moveTo(c, cy);
    ctx.arc(c, cy, r, a0, a0 + wedge);
    ctx.closePath();
    ctx.fillStyle = style;
    ctx.fill();
  };

  // Tile: every sector is a rotation image of the chosen one.
  for (let t = 0; t < count; t++) {
    if (t === piece) continue;
    fillWedge(t, withAlpha(palette.dihedralAxis, 0.07));
  }

  // Chosen piece: strong fill + outline.
  fillWedge(piece, withAlpha(palette.dihedralAxis, 0.3));
  const pa0 = off + piece * wedge;
  ctx.beginPath();
  ctx.moveTo(c, cy);
  ctx.arc(c, cy, r, pa0, pa0 + wedge);
  ctx.closePath();
  ctx.lineWidth = Math.max(1.5, 2 * scale);
  ctx.strokeStyle = withAlpha(palette.dihedralAxis, 0.95);
  ctx.stroke();

  // Chosen reflection axis: a bold diameter.
  const ext = r * 1.04;
  const ang = off + (axis * Math.PI) / n;
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(2, 2.4 * scale);
  ctx.strokeStyle = withAlpha(palette.dihedralRotation, 0.95);
  ctx.beginPath();
  ctx.moveTo(c + ext * Math.cos(ang), cy + ext * Math.sin(ang));
  ctx.lineTo(c + ext * Math.cos(ang + Math.PI), cy + ext * Math.sin(ang + Math.PI));
  ctx.stroke();

  // Grab handles at the axis endpoints (drag the rim to move the axis).
  const hr = Math.max(4, 5.5 * scale);
  for (const aa of [ang, ang + Math.PI]) {
    ctx.beginPath();
    ctx.arc(c + ext * Math.cos(aa), cy + ext * Math.sin(aa), hr, 0, 2 * Math.PI);
    ctx.fillStyle = withAlpha(palette.dihedralRotation, 0.95);
    ctx.fill();
    ctx.lineWidth = Math.max(1, 1.4 * scale);
    ctx.strokeStyle = withAlpha(palette.background, 0.9);
    ctx.stroke();
  }

  // Small tangential chevrons flanking each handle, hinting "drag around here".
  const chev = Math.max(4, 5 * scale);
  const reach = hr + 2 * scale + chev;
  ctx.lineWidth = Math.max(1.5, 2 * scale);
  ctx.strokeStyle = withAlpha(palette.dihedralRotation, 0.95);
  ctx.lineJoin = "round";
  const chevron = (px: number, py: number, dir: number) => {
    ctx.beginPath();
    ctx.moveTo(px + chev * Math.cos(dir + Math.PI - 0.55), py + chev * Math.sin(dir + Math.PI - 0.55));
    ctx.lineTo(px, py);
    ctx.lineTo(px + chev * Math.cos(dir + Math.PI + 0.55), py + chev * Math.sin(dir + Math.PI + 0.55));
    ctx.stroke();
  };
  for (const aa of [ang, ang + Math.PI]) {
    const hx = c + ext * Math.cos(aa);
    const hy = cy + ext * Math.sin(aa);
    const tx = -Math.sin(aa);
    const ty = Math.cos(aa);
    chevron(hx + tx * reach, hy + ty * reach, aa + Math.PI / 2);
    chevron(hx - tx * reach, hy - ty * reach, aa - Math.PI / 2);
  }

  ctx.restore();
}

/** SVG fragment for the fundamental-domain overlay (mirrors the canvas one). */
function fundamentalDomainSVG(
  geom: { n: number; total: number; c: number; r: number; scale: number },
  settings: RenderSettings,
  palette: Palette
): string {
  const { n, total, c, r, scale } = geom;
  const off = dihedralOffset(total);
  const { count, wedge, piece, axis } = domainSelection(n, settings);
  const parts: string[] = [];

  const wedgePath = (t: number): string => {
    const a0 = off + t * wedge;
    const a1 = a0 + wedge;
    const x0 = c + r * Math.cos(a0);
    const y0 = c + r * Math.sin(a0);
    const x1 = c + r * Math.cos(a1);
    const y1 = c + r * Math.sin(a1);
    const large = wedge > Math.PI ? 1 : 0;
    return `M${c},${c}L${x0.toFixed(2)},${y0.toFixed(2)}A${r.toFixed(2)},${r.toFixed(
      2
    )} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}Z`;
  };

  for (let t = 0; t < count; t++) {
    if (t === piece) continue;
    parts.push(
      `<path d="${wedgePath(t)}" fill="${palette.dihedralAxis}" fill-opacity="0.07"/>`
    );
  }

  parts.push(
    `<path d="${wedgePath(piece)}" fill="${palette.dihedralAxis}" fill-opacity="0.3" stroke="${palette.dihedralAxis}" stroke-opacity="0.95" stroke-width="${Math.max(
      1.5,
      2 * scale
    )}"/>`
  );

  const ext = r * 1.04;
  const ang = off + (axis * Math.PI) / n;
  const ax0 = c + ext * Math.cos(ang);
  const ay0 = c + ext * Math.sin(ang);
  const ax1 = c + ext * Math.cos(ang + Math.PI);
  const ay1 = c + ext * Math.sin(ang + Math.PI);
  parts.push(
    `<line x1="${ax0.toFixed(2)}" y1="${ay0.toFixed(2)}" x2="${ax1.toFixed(
      2
    )}" y2="${ay1.toFixed(2)}" stroke="${palette.dihedralRotation}" stroke-width="${Math.max(
      2,
      2.4 * scale
    )}" stroke-opacity="0.95" stroke-linecap="round"/>`
  );

  // Grab handles at the axis endpoints.
  const hr = Math.max(4, 5.5 * scale);
  for (const aa of [ang, ang + Math.PI]) {
    parts.push(
      `<circle cx="${(c + ext * Math.cos(aa)).toFixed(2)}" cy="${(
        c +
        ext * Math.sin(aa)
      ).toFixed(2)}" r="${hr.toFixed(2)}" fill="${palette.dihedralRotation}" fill-opacity="0.95" stroke="${palette.background}" stroke-opacity="0.9" stroke-width="${Math.max(
        1,
        1.4 * scale
      )}"/>`
    );
  }

  // Small tangential chevrons flanking each handle, hinting "drag around here".
  const chev = Math.max(4, 5 * scale);
  const reach = hr + 2 * scale + chev;
  const csw = Math.max(1.5, 2 * scale);
  const chevron = (px: number, py: number, dir: number): string => {
    const b1x = px + chev * Math.cos(dir + Math.PI - 0.55);
    const b1y = py + chev * Math.sin(dir + Math.PI - 0.55);
    const b2x = px + chev * Math.cos(dir + Math.PI + 0.55);
    const b2y = py + chev * Math.sin(dir + Math.PI + 0.55);
    return `<path d="M${b1x.toFixed(2)},${b1y.toFixed(2)}L${px.toFixed(2)},${py.toFixed(
      2
    )}L${b2x.toFixed(2)},${b2y.toFixed(2)}" fill="none" stroke="${palette.dihedralRotation}" stroke-width="${csw}" stroke-opacity="0.95" stroke-linecap="round" stroke-linejoin="round"/>`;
  };
  for (const aa of [ang, ang + Math.PI]) {
    const hx = c + ext * Math.cos(aa);
    const hy = c + ext * Math.sin(aa);
    const tx = -Math.sin(aa);
    const ty = Math.cos(aa);
    parts.push(chevron(hx + tx * reach, hy + ty * reach, aa + Math.PI / 2));
    parts.push(chevron(hx - tx * reach, hy - ty * reach, aa - Math.PI / 2));
  }

  return parts.join("");
}

/** A chord incident to the chosen vertex: [v, neighbor, generatorId]. */
type IncidentEdge = [number, number, number];

/** The chords incident to vertex v, found by scanning the materialized edge
 *  list; the third entry is the generator id (suffix-reversal length). */
function incidentEdges(edges: Uint32Array, v: number): IncidentEdge[] {
  const res: IncidentEdge[] = [];
  for (let t = 0; t < edges.length; t += 3) {
    const a = edges[t];
    const b = edges[t + 1];
    if (a === v) res.push([v, b, edges[t + 2]]);
    else if (b === v) res.push([v, a, edges[t + 2]]);
  }
  return res;
}

/** The chords incident to vertex v for the pancake-zaks layout, derived from
 *  the recursive fundamental sector (no materialized edge list needed). Each
 *  edge orbit's rotations are {i+mB}; v is incident when its offset (v mod B)
 *  matches an endpoint's, at the rotation that lands the endpoint in v's block. */
function incidentEdgesZaks(n: number, v: number): IncidentEdge[] {
  const total = factorial(n);
  const B = factorial(n - 1);
  const off = v % B;
  const kv = Math.floor(v / B);
  const res: IncidentEdge[] = [];
  forEachZaksFundamentalEdge(n, (e) => {
    if (e.i === off) res.push([v, (e.j + kv * B) % total, e.gen]);
    const oj = e.j % B;
    if (oj === off) {
      const bj0 = Math.floor(e.j / B);
      const m = (((kv - bj0) % n) + n) % n;
      res.push([v, (e.i + m * B) % total, e.gen]);
    }
  });
  return res;
}

/** Permutation as letters (symbol v → 'a'+v−1), so every symbol is one
 *  character even for n ≥ 10. */
function permLetters(p: ArrayLike<number>): string {
  let s = "";
  for (let i = 0; i < p.length; i++) s += String.fromCharCode(96 + p[i]);
  return s;
}

/** Word (as letters) at a Zaks index, reconstructed from block 0 via the cyclic
 *  relabeling φ — for renderers without a materialized path. */
function makeZaksWordOf(n: number): (idx: number) => string {
  const B = factorial(n - 1);
  const block0 = zaksBlock0(n);
  return (idx) => {
    const b = Math.floor(idx / B);
    const o = idx % B;
    const p = new Uint8Array(block0[o]);
    for (let t = 0; t < b; t++) {
      for (let s = 0; s < p.length; s++) p[s] = (p[s] % n) + 1;
    }
    return permLetters(p);
  };
}

function makeZaksLabelOf(n: number): (idx: number) => string {
  const B = factorial(n - 1);
  const block0 = zaksBlock0(n);
  return (idx) => {
    const b = Math.floor(idx / B);
    const o = idx % B;
    const p = new Uint8Array(block0[o]);
    for (let t = 0; t < b; t++) {
      for (let s = 0; s < p.length; s++) p[s] = (p[s] % n) + 1;
    }
    return vertexLabel(p);
  };
}

// Above this many at-play vertices the index+word labels would overlap into
// noise, so they are suppressed (use "long edges only" to thin them out).
const VERTEX_ORBIT_LABEL_LIMIT = 80;
// Flip (rₖ) tags are only drawn when there are at most this many orbit edges,
// so they stay legible (mainly the "long edges only" view).
const VERTEX_ORBIT_TAG_LIMIT = 16;

// Highlight color for the "dramatic" cases (near-zero chord / self-mirror).
const ORBIT_NOTE_COLOR = "#d97706"; // amber-600

/** True when a chord's two endpoints are (near) circular neighbours, so it
 *  draws as an almost-invisible sliver — e.g. a full reversal that lands next
 *  to its source in Zaks order (a ρ-block boundary). */
function orbitChordTiny(a: number, b: number, total: number): boolean {
  const d = Math.abs(a - b);
  return Math.min(d, total - d) <= 2;
}

/** True when the reflection images of the seed edges all coincide with their
 *  rotation images — the orbit is its own mirror, so "Both" looks like
 *  "Rotations". Only meaningful when both layers are shown. */
function orbitSelfMirror(
  seed: IncidentEdge[],
  n: number,
  total: number,
  showRot: boolean,
  showRef: boolean
): boolean {
  if (!showRot || !showRef) return false;
  const B = total / n;
  const ek = (a: number, b: number) => (a < b ? a * total + b : b * total + a);
  const rot = new Set<number>();
  for (const [a, b] of seed) {
    for (let m = 0; m < n; m++) rot.add(ek((a + m * B) % total, (b + m * B) % total));
  }
  return seed.every(([a, b]) => {
    for (let m = 0; m < n; m++) {
      if (!rot.has(ek((total - 1 - a + m * B) % total, (total - 1 - b + m * B) % total))) {
        return false;
      }
    }
    return true;
  });
}

/**
 * The suffix-reversal length k (2…n) that turns word `wa` into `wb`, or 0 if
 * none. A pancake-graph edge is exactly such a suffix reversal, so a nonzero k
 * proves the two endpoints are genuinely adjacent in the graph.
 */
function suffixFlipBetween(wa: string, wb: string, n: number): number {
  if (wa.length !== wb.length) return 0;
  for (let k = 2; k <= n; k++) {
    const cut = wa.length - k;
    const rev = wa.slice(cut).split("").reverse().join("");
    if (wa.slice(0, cut) + rev === wb) return k;
  }
  return 0;
}

/** Incident chords of the chosen vertex (from the edge list if present, else
 *  analytically for the Zaks layout), optionally restricted to the long full
 *  reversal rₙ. */
function vertexSeedEdges(
  n: number,
  total: number,
  v: number,
  edges: Uint32Array | undefined,
  longOnly: boolean
): IncidentEdge[] {
  const all = edges && edges.length > 0 ? incidentEdges(edges, v) : incidentEdgesZaks(n, v);
  return longOnly ? all.filter((e) => e[2] === n) : all;
}

// Hue per recursion level m of the dihedral tower (depth = n − m). The top
// level keeps the violet of the single-level orbit; deeper levels cycle a
// distinct palette so adjacent levels read apart. Hex (not hsl) so withAlpha /
// lightenHex apply.
const LEVEL_COLORS: readonly string[] = [
  "#7c3aed", // depth 0 (m = n) — violet-600, matches the classic vertex orbit
  "#ea580c", // orange-600
  "#0891b2", // cyan-600
  "#16a34a", // green-600
  "#db2777", // pink-600
  "#ca8a04", // yellow-600
  "#2563eb", // blue-600
  "#dc2626", // red-600
  "#0d9488", // teal-600
];

/** Color for a chord generated at recursion level m (Dₘ); the mirror image is
 *  drawn in a lighter tint of the same hue. */
export function levelColor(m: number, n: number, mirror = false): string {
  const depth = Math.max(0, Math.min(LEVEL_COLORS.length - 1, n - m));
  const base = LEVEL_COLORS[depth];
  return mirror ? lightenHex(base, 0.5) : base;
}

/** Active recursion levels for the vertex-orbit overlay: a single chosen level
 *  m, or — when stacking — the whole chain n, n−1, …, m. */
function orbitLevels(settings: RenderSettings, n: number): number[] {
  const level = clamp(Math.round(settings.vertexOrbitLevel ?? n), 3, n);
  if (!(settings.vertexOrbitStack ?? false)) return [level];
  const out: number[] = [];
  for (let m = n; m >= level; m--) out.push(m);
  return out;
}

/** A single chord drawn by the vertex-orbit overlay, tagged with the recursion
 *  level it was generated at, its rotation step within that level, and whether
 *  it is the reflection (mirror) image. */
interface OrbitSegment {
  a: number;
  b: number;
  level: number;
  step: number;
  mirror: boolean;
}

/**
 * Orbit of the seed chords under the nested dihedral tower D₃ ⊂ … ⊂ Dₙ of the
 * Zaks layout. For each requested level m, a chord lying inside a single
 * size-m! block is rotated within that block (offset ↦ offset + (m−1)! mod m!,
 * the Cₘ action) and, when reflections are on, mirrored inside it
 * (offset ↦ m!−1−offset). Level m = n is the global Dₙ orbit (block = whole
 * disk, the classic single-level view). A chord that straddles a size-m! block
 * is skipped at that level — it is an rₖ connector that glues sub-blocks
 * (k > m), so it belongs to a coarser level.
 */
function nestedOrbitSegments(
  seed: IncidentEdge[],
  n: number,
  total: number,
  levels: number[],
  showRot: boolean,
  showRef: boolean
): OrbitSegment[] {
  const out: OrbitSegment[] = [];
  for (const m of levels) {
    const S = factorial(m);
    const sub = S / m; // (m−1)!
    for (const [a, b] of seed) {
      const block = Math.floor(a / S);
      if (block !== Math.floor(b / S)) continue; // cross-block at this level
      const start = block * S;
      const oa = a - start;
      const ob = b - start;
      for (let t = 0; t < m; t++) {
        const ra = (oa + t * sub) % S;
        const rb = (ob + t * sub) % S;
        if (showRot) {
          out.push({ a: start + ra, b: start + rb, level: m, step: t, mirror: false });
        }
        if (showRef) {
          out.push({
            a: start + (S - 1 - ra),
            b: start + (S - 1 - rb),
            level: m,
            step: t,
            mirror: true,
          });
        }
      }
    }
  }
  return out;
}

/**
 * Highlight the orbit of the chosen vertex's edges on the canvas: the chords
 * incident to it (emerald), all their rotation images {i+mB} (violet), and all
 * their reflection images {ω(i)+mB} (orange) — the full Dₙ orbit of that
 * vertex's star. The chosen vertex is ringed.
 */
function drawVertexOrbitToCanvas(
  ctx: CanvasRenderingContext2D,
  geom: DihedralOverlayGeom,
  settings: RenderSettings,
  palette: Palette,
  edges?: Uint32Array,
  wordOf?: (idx: number) => string
): void {
  const { n, total, c, cy, r, scale } = geom;
  const B = total / n;
  const ea = settings.orbitEdgeA ?? -1;
  const eb = settings.orbitEdgeB ?? -1;
  const edgeMode = ea >= 0 && eb >= 0 && ea < total && eb < total;
  const v = (((settings.vertexOrbitIndex ?? 0) % total) + total) % total;
  const seed: IncidentEdge[] = edgeMode
    ? [[ea, eb, 0]]
    : vertexSeedEdges(n, total, v, edges, settings.vertexOrbitLongOnly ?? false);
  const markers = edgeMode ? [ea, eb] : [v];
  const lw = Math.max(2, 2.6 * scale);
  const parts = settings.vertexOrbitParts ?? "both";
  const showRot = parts !== "reflections";
  const showRef = parts !== "rotations";
  const tinyEdge = seed.some(([a, b]) => orbitChordTiny(a, b, total));
  const selfMirror = orbitSelfMirror(seed, n, total, showRot, showRef);

  ctx.save();
  ctx.setLineDash([]);
  ctx.lineCap = "round";
  const drawSeg = (a: number, b: number, color: string, width: number) => {
    const [ax, ay] = pointXY(a, total, c, cy, r);
    const [bx, by] = pointXY(b, total, c, cy, r);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  };
  // Each chord is colored by the recursion level m (Dₘ) it belongs to: level n
  // is the global orbit (long chords), deeper levels live inside ever-smaller
  // Zaks sub-blocks (short chords). Coarse levels paint first so the deep, short
  // chords stay on top; the lighter reflection twin sits under its rotation.
  const levels = orbitLevels(settings, n);
  const drawn: Array<[number, number, number]> = [];
  const segs = nestedOrbitSegments(seed, n, total, levels, showRot, showRef);
  segs.sort((p, q) => q.level - p.level || Number(p.mirror) - Number(q.mirror));
  for (const s of segs) {
    const color = levelColor(s.level, n, s.mirror);
    drawSeg(s.a, s.b, withAlpha(color, s.mirror ? 0.95 : 0.92), lw);
    drawn.push([s.a, s.b, s.step]);
  }

  // Mark the seed endpoint(s) — the chosen vertex, or both ends of a chosen
  // edge. A near-invisible (tiny) seed chord is flagged amber.
  const dotR = Math.max(4, 6 * scale) * (tinyEdge ? 1.4 : 1);
  const markerColor = tinyEdge ? ORBIT_NOTE_COLOR : palette.dihedralAxis;
  for (const mk of markers) {
    const [mx, my] = pointXY(mk, total, c, cy, r);
    ctx.beginPath();
    ctx.arc(mx, my, dotR, 0, 2 * Math.PI);
    ctx.fillStyle = withAlpha(markerColor, 0.98);
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, 2 * scale);
    ctx.strokeStyle = withAlpha(palette.background, 0.95);
    ctx.stroke();
  }

  // ω reflection axis (i ↦ N-1-i): the mirror that maps the violet family onto
  // the orange one. Only meaningful when reflections are shown.
  if (showRef) {
    const off = dihedralOffset(total);
    const ext = r * 1.04;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1.5, 2 * scale);
    ctx.strokeStyle = withAlpha(palette.dihedralMirror, 0.9);
    ctx.setLineDash([8 * scale, 6 * scale]);
    ctx.beginPath();
    ctx.moveTo(c + ext * Math.cos(off), cy + ext * Math.sin(off));
    ctx.lineTo(c + ext * Math.cos(off + Math.PI), cy + ext * Math.sin(off + Math.PI));
    ctx.stroke();
    ctx.setLineDash([]);
    const lfs = Math.max(12, 14 * scale);
    ctx.font = `600 ${lfs}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lx = c + r * 1.13 * Math.cos(off);
    const ly = cy + r * 1.13 * Math.sin(off);
    ctx.lineWidth = Math.max(2, 3 * scale);
    ctx.strokeStyle = withAlpha(palette.background, 0.95);
    ctx.strokeText("ω", lx, ly);
    ctx.fillStyle = withAlpha(palette.dihedralMirror, 0.95);
    ctx.fillText("ω", lx, ly);
  }

  // Flip tag rₖ on each orbit edge (few-edges views only): proves the two
  // endpoints are one suffix reversal apart, i.e. a genuine graph edge.
  if (wordOf && drawn.length > 0 && drawn.length <= VERTEX_ORBIT_TAG_LIMIT) {
    const tfs = Math.max(9, 11 * scale);
    ctx.font = `${tfs}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    for (const [a, b, m] of drawn) {
      const k = suffixFlipBetween(wordOf(a), wordOf(b), n);
      const [ax, ay] = pointXY(a, total, c, cy, r);
      const [bx, by] = pointXY(b, total, c, cy, r);
      const tx = ax + 0.28 * (bx - ax);
      const ty = ay + 0.28 * (by - ay);
      const tag = k ? `${m + 1}` : "✗";
      ctx.lineWidth = Math.max(2, 3 * scale);
      ctx.strokeStyle = withAlpha(palette.background, 0.95);
      ctx.strokeText(tag, tx, ty);
      ctx.fillStyle = k ? palette.labelFill : palette.cayleyOddStroke;
      ctx.fillText(tag, tx, ty);
    }
  }

  // Label every vertex at play: index (plain) with the word in a badge below.
  if (wordOf) {
    const labelSet = new Set<number>(markers);
    for (const [a, b] of drawn) {
      labelSet.add(a);
      labelSet.add(b);
    }
    const labels = [...labelSet];
    if (labels.length <= VERTEX_ORBIT_LABEL_LIMIT) {
      const fs = Math.max(9, 11 * scale);
      const wfs = Math.max(8.5, 10 * scale);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      const off = Math.max(26, 32 * scale);
      for (const idx of labels) {
        const a = (2 * Math.PI * idx) / total;
        const ix = c + (r + off) * Math.cos(a);
        const iy = cy + (r + off) * Math.sin(a);
        ctx.font = `600 ${fs}px ui-sans-serif, system-ui, sans-serif`;
        ctx.lineWidth = Math.max(2, 3 * scale);
        ctx.strokeStyle = withAlpha(palette.background, 0.9);
        ctx.strokeText(String(idx), ix, iy);
        ctx.fillStyle = palette.labelFill;
        ctx.fillText(String(idx), ix, iy);

        // index mod (n-1)! (0 or (n-1)!-1 marks a ρ-block boundary / big flip).
        const res = idx % B;
        const boundary = res === 0 || res === B - 1;
        const my = iy + fs * 0.95;
        ctx.font = `${wfs}px ui-monospace, Menlo, monospace`;
        const modTxt = `≡${res}`;
        ctx.lineWidth = Math.max(2, 3 * scale);
        ctx.strokeStyle = withAlpha(palette.background, 0.9);
        ctx.strokeText(modTxt, ix, my);
        ctx.fillStyle = boundary ? ORBIT_NOTE_COLOR : withAlpha(palette.labelFill, 0.55);
        ctx.fillText(modTxt, ix, my);

        const word = wordOf(idx);
        ctx.font = `${wfs}px ui-monospace, Menlo, monospace`;
        const tw = ctx.measureText(word).width;
        const padX = Math.max(2, 3 * scale);
        const bw = tw + 2 * padX;
        const bh = wfs + Math.max(3, 4 * scale);
        const wyc = iy + fs * 2.05;
        const bx = ix - bw / 2;
        const byTop = wyc - bh / 2;
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(bx, byTop, bw, bh, Math.max(2, 2.5 * scale));
        } else {
          ctx.rect(bx, byTop, bw, bh);
        }
        ctx.fillStyle = withAlpha(palette.dihedralAxis, 0.14);
        ctx.fill();
        ctx.lineWidth = Math.max(0.75, scale);
        ctx.strokeStyle = withAlpha(palette.dihedralAxis, 0.55);
        ctx.stroke();
        ctx.fillStyle = palette.labelFill;
        ctx.fillText(word, ix, wyc);
      }
    }
  }

  // Notes for the "dramatic" cases, near the top of the disk.
  const notes: string[] = [];
  if (tinyEdge) notes.push("full reversal lands on a neighbour — chord ≈ 0");
  if (selfMirror) notes.push("reflection coincides with rotation (self-mirror orbit)");
  if (notes.length > 0) {
    const nfs = Math.max(11, 13 * scale);
    ctx.font = `600 ${nfs}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    for (let i = 0; i < notes.length; i++) {
      const ny = cy - r + Math.max(16, 20 * scale) + i * nfs * 1.4;
      ctx.lineWidth = Math.max(3, 4 * scale);
      ctx.strokeStyle = withAlpha(palette.background, 0.95);
      ctx.strokeText(notes[i], c, ny);
      ctx.fillStyle = ORBIT_NOTE_COLOR;
      ctx.fillText(notes[i], c, ny);
    }
  }

  // Legend (stacked levels only): one swatch per recursion level Dₘ, top-left.
  if (levels.length > 1) {
    const sw = Math.max(11, 13 * scale);
    const gap = Math.max(4, 5 * scale);
    const lfs = Math.max(11, 13 * scale);
    ctx.font = `600 ${lfs}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const lx = c - r + Math.max(14, 18 * scale);
    let ly = cy - r + Math.max(14, 18 * scale) + sw / 2;
    for (const m of levels) {
      ctx.fillStyle = levelColor(m, n, false);
      ctx.fillRect(lx, ly - sw / 2, sw, sw);
      ctx.lineWidth = Math.max(1, scale);
      ctx.strokeStyle = withAlpha(palette.background, 0.9);
      ctx.strokeRect(lx, ly - sw / 2, sw, sw);
      const txt = `D${toSubscript(m)}`;
      const tx = lx + sw + gap;
      ctx.lineWidth = Math.max(2, 3 * scale);
      ctx.strokeStyle = withAlpha(palette.background, 0.9);
      ctx.strokeText(txt, tx, ly);
      ctx.fillStyle = palette.labelFill;
      ctx.fillText(txt, tx, ly);
      ly += sw + gap;
    }
  }
  ctx.restore();
}

/** Render an integer as Unicode subscript digits (for Dₘ labels). */
function toSubscript(value: number): string {
  const subs = "₀₁₂₃₄₅₆₇₈₉";
  return String(value)
    .split("")
    .map((ch) => subs[ch.charCodeAt(0) - 48] ?? ch)
    .join("");
}

/** SVG fragment for the vertex-orbit-edges overlay (mirrors the canvas one). */
function vertexOrbitSVG(
  geom: { n: number; total: number; c: number; r: number; scale: number },
  settings: RenderSettings,
  palette: Palette,
  edges?: Uint32Array,
  wordOf?: (idx: number) => string
): string {
  const { n, total, c, r, scale } = geom;
  const B = total / n;
  const ea = settings.orbitEdgeA ?? -1;
  const eb = settings.orbitEdgeB ?? -1;
  const edgeMode = ea >= 0 && eb >= 0 && ea < total && eb < total;
  const v = (((settings.vertexOrbitIndex ?? 0) % total) + total) % total;
  const seed: IncidentEdge[] = edgeMode
    ? [[ea, eb, 0]]
    : vertexSeedEdges(n, total, v, edges, settings.vertexOrbitLongOnly ?? false);
  const markers = edgeMode ? [ea, eb] : [v];
  const lw = Math.max(2, 2.6 * scale);
  const which = settings.vertexOrbitParts ?? "both";
  const showRot = which !== "reflections";
  const showRef = which !== "rotations";
  const tinyEdge = seed.some(([a, b]) => orbitChordTiny(a, b, total));
  const selfMirror = orbitSelfMirror(seed, n, total, showRot, showRef);
  const parts: string[] = [];
  const segSvg = (a: number, b: number, color: string, width: number): string => {
    const [ax, ay] = point(a, total, c, r);
    const [bx, by] = point(b, total, c, r);
    return `<line x1="${ax.toFixed(2)}" y1="${ay.toFixed(2)}" x2="${bx.toFixed(
      2
    )}" y2="${by.toFixed(2)}" stroke="${color}" stroke-width="${width}" stroke-opacity="0.92" stroke-linecap="round"/>`;
  };
  // Color each chord by its recursion level m (Dₘ); coarse levels first so the
  // short deep-level chords stay on top, the lighter reflection under rotation.
  const levels = orbitLevels(settings, n);
  const drawn: Array<[number, number, number]> = [];
  const segs = nestedOrbitSegments(seed, n, total, levels, showRot, showRef);
  segs.sort((p, q) => q.level - p.level || Number(p.mirror) - Number(q.mirror));
  for (const s of segs) {
    parts.push(segSvg(s.a, s.b, levelColor(s.level, n, s.mirror), lw));
    drawn.push([s.a, s.b, s.step]);
  }

  const dot = Math.max(4, 6 * scale) * (tinyEdge ? 1.4 : 1);
  const markerColor = tinyEdge ? ORBIT_NOTE_COLOR : palette.dihedralAxis;
  for (const mk of markers) {
    const [mx, my] = point(mk, total, c, r);
    parts.push(
      `<circle cx="${mx.toFixed(2)}" cy="${my.toFixed(2)}" r="${dot.toFixed(
        2
      )}" fill="${markerColor}" fill-opacity="0.98" stroke="${palette.background}" stroke-opacity="0.95" stroke-width="${Math.max(
        1.5,
        2 * scale
      )}"/>`
    );
  }

  // ω reflection axis (mirrors violet → orange), shown when reflections are on.
  if (showRef) {
    const off = dihedralOffset(total);
    const ext = r * 1.04;
    const dash = `${(8 * scale).toFixed(2)},${(6 * scale).toFixed(2)}`;
    parts.push(
      `<line x1="${(c + ext * Math.cos(off)).toFixed(2)}" y1="${(c + ext * Math.sin(off)).toFixed(
        2
      )}" x2="${(c + ext * Math.cos(off + Math.PI)).toFixed(2)}" y2="${(
        c +
        ext * Math.sin(off + Math.PI)
      ).toFixed(2)}" stroke="${palette.dihedralMirror}" stroke-width="${Math.max(
        1.5,
        2 * scale
      )}" stroke-opacity="0.9" stroke-linecap="round" stroke-dasharray="${dash}"/>`
    );
    const lfs = Math.max(12, 14 * scale);
    parts.push(
      `<text x="${(c + r * 1.13 * Math.cos(off)).toFixed(2)}" y="${(
        c +
        r * 1.13 * Math.sin(off)
      ).toFixed(2)}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="${lfs.toFixed(
        1
      )}" font-weight="600" text-anchor="middle" dominant-baseline="middle" fill="${palette.dihedralMirror}" stroke="${palette.background}" stroke-width="${Math.max(
        2,
        3 * scale
      ).toFixed(2)}" stroke-opacity="0.95" paint-order="stroke">ω</text>`
    );
  }

  // Flip tag rₖ on each orbit edge (few-edges views only).
  if (wordOf && drawn.length > 0 && drawn.length <= VERTEX_ORBIT_TAG_LIMIT) {
    const tfs = Math.max(9, 11 * scale);
    for (const [a, b, m] of drawn) {
      const k = suffixFlipBetween(wordOf(a), wordOf(b), n);
      const [ax, ay] = point(a, total, c, r);
      const [bx, by] = point(b, total, c, r);
      const tx = ax + 0.28 * (bx - ax);
      const ty = ay + 0.28 * (by - ay);
      parts.push(
        `<text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="${tfs.toFixed(
          1
        )}" text-anchor="middle" dominant-baseline="middle" fill="${
          k ? palette.labelFill : palette.cayleyOddStroke
        }" stroke="${palette.background}" stroke-width="${Math.max(2, 3 * scale).toFixed(
          2
        )}" stroke-opacity="0.95" paint-order="stroke">${k ? `${m + 1}` : "✗"}</text>`
      );
    }
  }

  // Vertex labels: index (plain) + word in a badge below.
  if (wordOf) {
    const labelSet = new Set<number>(markers);
    for (const [a, b] of drawn) {
      labelSet.add(a);
      labelSet.add(b);
    }
    const labels = [...labelSet];
    if (labels.length <= VERTEX_ORBIT_LABEL_LIMIT) {
      const fs = Math.max(9, 11 * scale);
      const wfs = Math.max(8.5, 10 * scale);
      const off = Math.max(26, 32 * scale);
      const halo = Math.max(2, 3 * scale).toFixed(2);
      for (const idx of labels) {
        const a = (2 * Math.PI * idx) / total;
        const ix = c + (r + off) * Math.cos(a);
        const iy = c + (r + off) * Math.sin(a);
        parts.push(
          `<text x="${ix.toFixed(2)}" y="${iy.toFixed(2)}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="${fs.toFixed(
            1
          )}" font-weight="600" text-anchor="middle" dominant-baseline="middle" fill="${palette.labelFill}" stroke="${palette.background}" stroke-width="${halo}" stroke-opacity="0.9" paint-order="stroke">${idx}</text>`
        );
        const res = idx % B;
        const boundary = res === 0 || res === B - 1;
        parts.push(
          `<text x="${ix.toFixed(2)}" y="${(iy + fs * 0.95).toFixed(
            2
          )}" font-family="ui-monospace,Menlo,monospace" font-size="${wfs.toFixed(
            1
          )}" text-anchor="middle" dominant-baseline="middle" fill="${
            boundary ? ORBIT_NOTE_COLOR : palette.labelFill
          }" fill-opacity="${boundary ? 1 : 0.55}" stroke="${palette.background}" stroke-width="${halo}" stroke-opacity="0.9" paint-order="stroke">≡${res}</text>`
        );
        const word = wordOf(idx);
        const padX = Math.max(2, 3 * scale);
        const bw = word.length * wfs * 0.62 + 2 * padX;
        const bh = wfs + Math.max(3, 4 * scale);
        const wyc = iy + fs * 2.05;
        parts.push(
          `<rect x="${(ix - bw / 2).toFixed(2)}" y="${(wyc - bh / 2).toFixed(
            2
          )}" width="${bw.toFixed(2)}" height="${bh.toFixed(2)}" rx="${Math.max(
            2,
            2.5 * scale
          ).toFixed(2)}" fill="${palette.dihedralAxis}" fill-opacity="0.14" stroke="${palette.dihedralAxis}" stroke-opacity="0.55" stroke-width="${Math.max(
            0.75,
            scale
          ).toFixed(2)}"/>`
        );
        parts.push(
          `<text x="${ix.toFixed(2)}" y="${wyc.toFixed(2)}" font-family="ui-monospace,Menlo,monospace" font-size="${wfs.toFixed(
            1
          )}" text-anchor="middle" dominant-baseline="middle" fill="${palette.labelFill}">${word}</text>`
        );
      }
    }
  }

  const notes: string[] = [];
  if (tinyEdge) notes.push("full reversal lands on a neighbour — chord ≈ 0");
  if (selfMirror) notes.push("reflection coincides with rotation (self-mirror orbit)");
  const nfs = Math.max(11, 13 * scale);
  for (let i = 0; i < notes.length; i++) {
    const ny = c - r + Math.max(16, 20 * scale) + i * nfs * 1.4;
    parts.push(
      `<text x="${c}" y="${ny.toFixed(2)}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="${nfs.toFixed(
        1
      )}" font-weight="600" text-anchor="middle" dominant-baseline="middle" fill="${ORBIT_NOTE_COLOR}" stroke="${palette.background}" stroke-width="${Math.max(
        3,
        4 * scale
      ).toFixed(2)}" stroke-opacity="0.95" paint-order="stroke">${notes[i]}</text>`
    );
  }

  // Legend (stacked levels only): one swatch per recursion level Dₘ, top-left.
  if (levels.length > 1) {
    const sw = Math.max(11, 13 * scale);
    const gap = Math.max(4, 5 * scale);
    const lfs = Math.max(11, 13 * scale);
    const lx = c - r + Math.max(14, 18 * scale);
    let ly = c - r + Math.max(14, 18 * scale) + sw / 2;
    for (const m of levels) {
      parts.push(
        `<rect x="${lx.toFixed(2)}" y="${(ly - sw / 2).toFixed(2)}" width="${sw.toFixed(
          2
        )}" height="${sw.toFixed(2)}" fill="${levelColor(m, n, false)}" stroke="${
          palette.background
        }" stroke-opacity="0.9" stroke-width="${Math.max(1, scale).toFixed(2)}"/>`
      );
      parts.push(
        `<text x="${(lx + sw + gap).toFixed(2)}" y="${ly.toFixed(
          2
        )}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="${lfs.toFixed(
          1
        )}" font-weight="600" dominant-baseline="middle" fill="${palette.labelFill}" stroke="${
          palette.background
        }" stroke-width="${Math.max(2, 3 * scale).toFixed(
          2
        )}" stroke-opacity="0.9" paint-order="stroke">D${toSubscript(m)}</text>`
      );
      ly += sw + gap;
    }
  }
  return parts.join("");
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
  const { path, edges, coords } = graph;
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
  const coxeterPlane =
    graph.preset === "coxeter-a" ||
    graph.preset === "coxeter-b" ||
    graph.preset === "coxeter-d" ||
    graph.preset === "coxeter-h4-600-cell";
  const edgeAlpha = coxeterPlane
    ? Math.max(0.82, sliderToEdgeAlpha(settings.alpha))
    : sliderToEdgeAlpha(settings.alpha);
  const edgeWidth = coxeterPlane
    ? Math.max(0.95 * scale, sliderToEdgeWidth(settings.width) * scale)
    : sliderToEdgeWidth(settings.width) * scale;
  // Explicit 2-D layout (the Sierpiński gasket) when present; otherwise the
  // vertex sits on the circle at angle 2πi/total.
  const posXY = (i: number): [number, number] =>
    coords
      ? [c + coords[2 * i] * r, cy + coords[2 * i + 1] * r]
      : pointXY(i, total, c, cy, r);
  // Orbit/blocks coloring applies only to Pancake Zaks and only in line
  // mode (the density binning has no per-edge identity to color).
  const coloring =
    settings.edgeMode === "density" ? null : dihedralColoring(graph, settings);

  ctx.lineCap = "round";

  // Draw the cycle first so edges paint over it. Many Cayley generators
  // produce short chords that hug the perimeter; if the cycle were on top
  // it would completely occlude them (the cycle stroke is wider than the
  // chord deviation from the arc).
  if (settings.showCycle) {
    ctx.strokeStyle = withAlpha(palette.cayleyStroke, edgeAlpha);
    ctx.lineWidth = k.cycleWidth;
    ctx.beginPath();
    if (coords) {
      // Trace the Hamiltonian cycle as a closed polyline through the layout.
      for (let i = 0; i < total; i++) {
        const [x, y] = posXY(i);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    } else {
      ctx.arc(c, cy, r, 0, 2 * Math.PI);
    }
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
    } else if (coloring) {
      // Group edges by color and stroke one path per color, so overlaps within
      // a color composite once (no darkening) and the orbit count never makes
      // this a per-edge stroke storm.
      const groups = new Map<string, number[]>();
      const orbitColors =
        coloring === "orbit" || coloring === "dihedral"
          ? orbitColorsForGraph(graph, coloring)
          : null;
      for (let t = 0, e = 0; t < edges.length; t += 3, e++) {
        if (hidden && hidden.has(edges[t + 2])) continue;
        const color =
          orbitColors
            ? orbitColors[e]
            : edges[t + 2] < graph.n
              ? palette.blockWithinStroke
              : palette.blockBetweenStroke;
        let arr = groups.get(color);
        if (!arr) {
          arr = [];
          groups.set(color, arr);
        }
        const [ax, ay] = posXY(edges[t]);
        const [bx, by] = posXY(edges[t + 1]);
        arr.push(ax, ay, bx, by);
      }
      // For blocks, draw the short within-block chords first so the long rₙ
      // skeleton paints on top; orbit hues have no meaningful z-order.
      const order =
        coloring === "blocks"
          ? [palette.blockWithinStroke, palette.blockBetweenStroke].filter((co) =>
              groups.has(co)
            )
          : [...groups.keys()];
      for (const color of order) {
        const arr = groups.get(color)!;
        ctx.strokeStyle = applyAlpha(color, edgeAlpha);
        ctx.beginPath();
        for (let m = 0; m < arr.length; m += 4) {
          ctx.moveTo(arr[m], arr[m + 1]);
          ctx.lineTo(arr[m + 2], arr[m + 3]);
        }
        ctx.stroke();
      }
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
            const [ax, ay] = posXY(i);
            const [bx, by] = posXY(j);
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
          }
          ctx.stroke();
        }
      };

      for (const pass of passes) drawPass(pass.filter, pass.color);
    }
  }

  const labelMode = settings.showLabels && supportsVertexLabels(graph);

  if (settings.showVertices) {
    const dotRadius = coxeterPlane ? Math.max(1.2 * scale, 0.7) : Math.max(0.5, k.vertexRadius);
    if (coloring === "blocks") {
      // Band the dots into n arcs by leading symbol (one ρ-block per arc).
      const B = total / graph.n;
      const bandAlpha = labelMode ? 0.95 : Math.max(0.4, Math.min(0.95, edgeAlpha * 1.8));
      let curBlock = -1;
      for (let i = 0; i < total; i++) {
        const block = Math.floor(i / B);
        if (block !== curBlock) {
          curBlock = block;
          ctx.fillStyle = applyAlpha(blockColor(block, graph.n, labelMode), bandAlpha);
        }
        const [x, y] = posXY(i);
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, 2 * Math.PI);
        ctx.fill();
      }
    } else {
      // Plain dots: faint gray like the edges, but a bright disc under labels.
      ctx.fillStyle = labelMode
        ? withAlpha(palette.labelVertexFill, 0.95)
        : withAlpha(palette.cayleyStroke, edgeAlpha);
      for (let i = 0; i < total; i++) {
        const [x, y] = posXY(i);
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
  }

  if (labelMode) {
    ctx.fillStyle = palette.labelFill;
    ctx.font = `${vertexLabelFontSize(total) * dpr}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < total; i++) {
      const [x, y] = posXY(i);
      ctx.fillText(vertexLabel(path[i]), x, y);
    }
  }

  if (settings.edgeMode !== "density" && supportsSymmetry(graph)) {
    const geom = { n: graph.n, total, c, cy, r, scale };
    if (settings.showFundamentalDomain)
      drawFundamentalDomainToCanvas(ctx, geom, settings, palette);
    if (settings.showSymmetryAxes) drawSymmetryAxesToCanvas(ctx, geom, palette);
    if (settings.showDihedralAxes) drawDihedralOverlayToCanvas(ctx, geom, palette);
    if (settings.showVertexOrbit)
      drawVertexOrbitToCanvas(
        ctx,
        geom,
        settings,
        palette,
        edges,
        (i) => permLetters(path[i])
      );
  }

  ctx.restore();
}

function pointXY(i: number, total: number, cx: number, cy: number, r: number): [number, number] {
  const a = (2 * Math.PI * i) / total;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/**
 * Cached fundamental-sector geometry for the canvas symmetry renderer. Edge
 * segments are stored as flat [ax,ay,bx,by,…] in device pixels at zoom = 1;
 * zoom/pan are applied via the canvas transform, so this survives those without
 * recomputation. Only n, canvas size, parity mode and hidden generators affect
 * it (captured in `key`).
 */
/**
 * One paintable layer of the fundamental sector: a flat [ax,ay,bx,by,…] coord
 * list, rotated `repeats` times (n for generic orbits, n/2 for antipodal "half"
 * orbits). `color` strokes the whole layer in one tone; when it is null the
 * per-segment `colors` are used instead (one entry per coords/4 segment — used
 * by the Cₙ-orbit rainbow so each orbit keeps its own hue across rotations).
 */
export interface ZaksSymmetryMask {
  repeats: number;
  coords: Float32Array;
  color: string | null;
  colors: string[] | null;
}

export interface ZaksSymmetrySectors {
  key: string;
  masks: ZaksSymmetryMask[];
  vertices: Float32Array;
  /** Band the dots per-rotation by ρ-block hue (the "blocks" color scheme). */
  bandVertices: boolean;
}

interface ZaksSymmetryCanvasOpts {
  n: number;
  settings: RenderSettings;
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  zoom?: number;
  panX?: number;
  panY?: number;
  palette?: Palette;
  /** Mutable cache (e.g. a React ref); reused across zoom/pan/alpha/width. */
  cache?: { current: ZaksSymmetrySectors | null };
}

// Reusable offscreen canvas for the symmetry compositor (one per page, resized
// on demand) so we don't allocate a full-frame buffer on every zoom/pan redraw.
let symmetryScratch: HTMLCanvasElement | null = null;
function getScratchCanvas(w: number, h: number): HTMLCanvasElement {
  if (!symmetryScratch) symmetryScratch = document.createElement("canvas");
  if (symmetryScratch.width !== w) symmetryScratch.width = w;
  if (symmetryScratch.height !== h) symmetryScratch.height = h;
  return symmetryScratch;
}

// Above this vertex count the per-dot circles are sub-pixel and invisible, but
// cost millions of fills per frame — so the canvas renderer omits them (the
// perimeter cycle already conveys the ring). The flat SVG export is unaffected.
const SYMMETRY_VERTEX_LIMIT = 50_000;

function zaksFundamentalPointXY(
  i: number,
  total: number,
  n: number,
  cx: number,
  cy: number,
  r: number,
  view: ZaksFundamentalView = "wedge"
): [number, number] {
  const sourceStart = dihedralOffset(total);
  const sourceWedge = Math.PI / n;
  const sourceTheta = (2 * Math.PI * i) / total;
  if (view === "wedge") {
    return [cx + r * Math.cos(sourceTheta), cy + r * Math.sin(sourceTheta)];
  }
  const u = (sourceTheta - sourceStart) / sourceWedge;
  if (view === "circle") {
    const a = -Math.PI / 2 + u * 2 * Math.PI;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }
  return [cx + (u - 0.5) * 1.5 * r, cy - 0.42 * r];
}

function zaksFundamentalSegmentXY(
  i: number,
  j: number,
  total: number,
  n: number,
  cx: number,
  cy: number,
  r: number,
  view: ZaksFundamentalView = "wedge"
): [number, number, number, number] | null {
  const sourceStart = dihedralOffset(total);
  const sourceEnd = sourceStart + Math.PI / n;
  if (view === "circle") {
    const foldedPoint = (index: number): [number, number] => {
      const period = (2 * Math.PI) / n;
      const chamber = Math.PI / n;
      const theta = (2 * Math.PI * index) / total;
      const t = ((theta - sourceStart) % period + period) % period;
      const folded = t <= chamber ? t : period - t;
      const a = -Math.PI / 2 + (folded / chamber) * 2 * Math.PI;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    };
    const [ax, ay] = foldedPoint(i);
    const [bx, by] = foldedPoint(j);
    return [ax, ay, bx, by];
  }
  const ai = (2 * Math.PI * i) / total;
  const aj = (2 * Math.PI * j) / total;
  let x0 = Math.cos(ai);
  let y0 = Math.sin(ai);
  let x1 = Math.cos(aj);
  let y1 = Math.sin(aj);
  let t0 = 0;
  let t1 = 1;
  const clip = (f0: number, f1: number): boolean => {
    const df = f1 - f0;
    if (Math.abs(df) < 1e-12) return f0 >= 0;
    const t = -f0 / df;
    if (df > 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    return t0 <= t1;
  };
  const sx = Math.cos(sourceStart);
  const sy = Math.sin(sourceStart);
  const ex = Math.cos(sourceEnd);
  const ey = Math.sin(sourceEnd);
  // Inside the wedge: left of the first ray and right of the second ray.
  if (!clip(sx * y0 - sy * x0, sx * y1 - sy * x1)) return null;
  if (!clip(-(ex * y0 - ey * x0), -(ex * y1 - ey * x1))) return null;
  const ox0 = x0;
  const oy0 = y0;
  const ox1 = x1;
  const oy1 = y1;
  x0 = ox0 + (ox1 - ox0) * t0;
  y0 = oy0 + (oy1 - oy0) * t0;
  x1 = ox0 + (ox1 - ox0) * t1;
  y1 = oy0 + (oy1 - oy0) * t1;
  const map = (x: number, y: number): [number, number] => {
    const rr = Math.hypot(x, y);
    let theta = Math.atan2(y, x);
    while (theta < sourceStart) theta += 2 * Math.PI;
    const u = (theta - sourceStart) / (sourceEnd - sourceStart);
    if (view === "wedge") {
      return [cx + r * rr * Math.cos(theta), cy + r * rr * Math.sin(theta)];
    }
    return [cx + (u - 0.5) * 1.5 * r, cy + (0.62 - rr) * 1.35 * r];
  };
  const [ax, ay] = map(x0, y0);
  const [bx, by] = map(x1, y1);
  return [ax, ay, bx, by];
}

function drawZaksFundamentalFrame(
  ctx: CanvasRenderingContext2D,
  geom: { n: number; total: number; c: number; cy: number; r: number; scale: number },
  palette: Palette,
  view: ZaksFundamentalView = "wedge"
): void {
  const { n, total, c, cy, r, scale } = geom;
  if (view === "circle") {
    ctx.save();
    ctx.lineWidth = Math.max(1.2, 1.4 * scale);
    ctx.strokeStyle = withAlpha(palette.dihedralSector, 0.9);
    ctx.beginPath();
    ctx.arc(c, cy, r, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (view === "flat") {
    ctx.save();
    ctx.lineWidth = Math.max(1.2, 1.4 * scale);
    ctx.strokeStyle = withAlpha(palette.dihedralSector, 0.9);
    ctx.strokeRect(c - 0.75 * r, cy - 0.73 * r, 1.5 * r, 1.35 * r);
    ctx.restore();
    return;
  }
  const a0 = dihedralOffset(total);
  const a1 = a0 + Math.PI / n;
  ctx.save();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(c, cy);
  ctx.lineTo(c + r * Math.cos(a0), cy + r * Math.sin(a0));
  ctx.arc(c, cy, r, a0, a1);
  ctx.lineTo(c, cy);
  ctx.closePath();
  ctx.fillStyle = withAlpha(palette.dihedralWedge, 0.08);
  ctx.fill();
  ctx.lineWidth = Math.max(1.2, 1.4 * scale);
  ctx.strokeStyle = withAlpha(palette.dihedralSector, 0.9);
  ctx.beginPath();
  ctx.moveTo(c, cy);
  ctx.lineTo(c + r * Math.cos(a0), cy + r * Math.sin(a0));
  ctx.arc(c, cy, r, a0, a1);
  ctx.lineTo(c, cy);
  ctx.stroke();
  ctx.restore();
}

function drawReflectionQuotientCircleToCanvas(
  ctx: CanvasRenderingContext2D,
  opts: {
    n: number;
    c: number;
    cy: number;
    r: number;
    scale: number;
    edgeAlpha: number;
    edgeWidth: number;
    palette: Palette;
  }
): void {
  const { n, c, cy, r, scale, edgeAlpha, edgeWidth, palette } = opts;
  if (n < 3) return;
  const total = factorial(n);
  const block = factorial(n - 1);
  const quotient = total / 2;
  const halfTurns = n % 2 === 0 ? n / 2 : 0;
  const foldedPoint = (index: number): [number, number] => {
    const folded = Math.min(index, total - 1 - index);
    const a = -Math.PI / 2 + (folded / quotient) * 2 * Math.PI;
    return [c + r * Math.cos(a), cy + r * Math.sin(a)];
  };

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(0.55 * scale, edgeWidth * 0.85);
  ctx.strokeStyle = withAlpha(palette.cayleyStroke, Math.min(0.75, edgeAlpha));
  forEachZaksFundamentalEdge(n, (e) => {
    if (e.gen < n) return;
    const repeats = e.half ? halfTurns : n;
    for (let s = 0; s < repeats; s++) {
      const a = (e.i + s * block) % total;
      const b = (e.j + s * block) % total;
      const [x0, y0] = foldedPoint(a);
      const [x1, y1] = foldedPoint(b);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  });

  ctx.lineWidth = Math.max(1.2, 1.4 * scale);
  ctx.strokeStyle = withAlpha(palette.dihedralSector, 0.9);
  ctx.beginPath();
  ctx.arc(c, cy, r, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.restore();
}

/**
 * On-screen symmetry renderer for the pancake-zaks layout. Draws only the
 * fundamental sector (block 0) and composites n rotated copies with canvas
 * transforms — visually identical to the SVG symmetry view but with constant,
 * pixel-bound memory instead of the multi-million-node SVG render tree that the
 * `<use>`-expanded DOM produces at large n.
 */
export function drawZaksSymmetryToCanvas(
  ctx: CanvasRenderingContext2D,
  opts: ZaksSymmetryCanvasOpts
): void {
  const {
    n,
    settings,
    cssWidth,
    cssHeight,
    dpr,
    zoom = 1,
    panX = 0,
    panY = 0,
    palette = DEFAULT_PALETTE,
    cache,
  } = opts;
  const total = factorial(n);
  const B = factorial(n - 1);
  // Floor to match the integer canvas backing-store size set by the caller, so
  // the geometry cache key (which includes w×h) is stable across redraws.
  const w = Math.floor(cssWidth * dpr);
  const h = Math.floor(cssHeight * dpr);

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
  const compareReflectionQuotient =
    (settings.zaksFundamentalOnly ?? false) &&
    (settings.zaksFundamentalView ?? "wedge") === "circle" &&
    n > 3;
  const cy = compareReflectionQuotient
    ? size * 0.24 + (h - size) / 2
    : size / 2 + (h - size) / 2;
  const r = size * (compareReflectionQuotient ? 0.22 : 0.405);
  const scale = size / 1000;
  const k = constantsFor(n, scale);
  const edgeAlpha = sliderToEdgeAlpha(settings.alpha);
  const edgeWidth = sliderToEdgeWidth(settings.width) * scale;
  const step = (2 * Math.PI) / n;
  const fundamentalOnly = settings.zaksFundamentalOnly ?? false;
  const fundamentalView = settings.zaksFundamentalView ?? "wedge";
  ctx.lineCap = "round";

  if (fundamentalOnly && fundamentalView === "wedge") {
    const a0 = dihedralOffset(total);
    const a1 = a0 + Math.PI / n;
    ctx.beginPath();
    ctx.moveTo(c, cy);
    ctx.lineTo(c + r * Math.cos(a0), cy + r * Math.sin(a0));
    ctx.arc(c, cy, r, a0, a1);
    ctx.lineTo(c, cy);
    ctx.closePath();
    ctx.clip();
  }

  if (settings.showCycle) {
    ctx.beginPath();
    if (fundamentalOnly) {
      if (fundamentalView === "wedge") {
        const a0 = dihedralOffset(total);
        ctx.arc(c, cy, r, a0, a0 + Math.PI / n);
      } else if (fundamentalView === "circle") {
        ctx.arc(c, cy, r, 0, 2 * Math.PI);
      } else {
        ctx.rect(c - 0.75 * r, cy - 0.73 * r, 1.5 * r, 1.35 * r);
      }
    } else {
      ctx.arc(c, cy, r, 0, 2 * Math.PI);
    }
    ctx.strokeStyle = withAlpha(palette.cayleyStroke, edgeAlpha);
    ctx.lineWidth = k.cycleWidth;
    ctx.stroke();
  }

  // Recompute the sector only when geometry, coloring or hidden set changes;
  // zoom/pan/alpha/width reuse the cache, keeping interaction enumeration-free.
  const coloring: SymmetryColoring = settings.symmetryColoring ?? "parity";
  const hiddenKey = [...new Set(settings.hiddenGenerators)]
    .sort((a, b) => a - b)
    .join(",");
  const key = `${n}|${w}x${h}|${coloring}|${settings.parityMode}|${hiddenKey}|${
    fundamentalOnly ? `fund-${fundamentalView}` : "full"
  }`;
  let sectors = cache?.current && cache.current.key === key ? cache.current : null;
  if (!sectors) {
    const vertexSeedCount =
      fundamentalOnly && fundamentalView !== "wedge"
        ? Math.max(1, Math.floor(B / 2))
        : B;
    const masks = buildSectorMasks(
      n,
      coloring,
      settings,
      palette,
      total,
      c,
      cy,
      r,
      fundamentalOnly,
      fundamentalView
    );
    const vertices =
      settings.showVertices && total <= SYMMETRY_VERTEX_LIMIT
        ? (() => {
            const v = new Float32Array(vertexSeedCount * 2);
            for (let i = 0; i < vertexSeedCount; i++) {
              const [x, y] = fundamentalOnly
                ? zaksFundamentalPointXY(i, total, n, c, cy, r, fundamentalView)
                : pointXY(i, total, c, cy, r);
              v[2 * i] = x;
              v[2 * i + 1] = y;
            }
            return v;
          })()
        : new Float32Array(0);
    sectors = { key, masks, vertices, bandVertices: coloring === "blocks" };
    if (cache) cache.current = sectors;
  }

  if (settings.showCayley) {
    // Reproduce the SVG `<use>` opacity semantics: paint each sector mask ONCE
    // (opaque) onto an offscreen canvas, then composite n rotated copies at the
    // edge alpha. Stroking the sector directly in many batches would composite
    // each batch separately and accumulate opacity into a solid black disk.
    const scratch = getScratchCanvas(w, h);
    const sctx = scratch.getContext("2d");
    if (sctx) {
      // Stroke the offscreen in batches (opaque, so batching does not darken),
      // keeping any single path well under the size some canvases will drop.
      const batch = n >= 9 ? 15_000 : 60_000;
      const compositeMask = (mask: ZaksSymmetryMask) => {
        const { coords, color, colors, repeats } = mask;
        if (coords.length === 0 || repeats <= 0) return;
        sctx.setTransform(1, 0, 0, 1, 0, 0);
        sctx.clearRect(0, 0, w, h);
        sctx.lineCap = "round";
        sctx.lineWidth = edgeWidth;
        if (color) {
          sctx.strokeStyle = color;
          for (let start = 0; start < coords.length; start += batch * 4) {
            const end = Math.min(coords.length, start + batch * 4);
            sctx.beginPath();
            for (let t = start; t < end; t += 4) {
              sctx.moveTo(coords[t], coords[t + 1]);
              sctx.lineTo(coords[t + 2], coords[t + 3]);
            }
            sctx.stroke();
          }
        } else if (colors) {
          // Per-orbit hue: each segment strokes in its own color.
          for (let t = 0, s = 0; t < coords.length; t += 4, s++) {
            sctx.strokeStyle = colors[s];
            sctx.beginPath();
            sctx.moveTo(coords[t], coords[t + 1]);
            sctx.lineTo(coords[t + 2], coords[t + 3]);
            sctx.stroke();
          }
        }
        for (let s = 0; s < repeats; s++) {
          ctx.save();
          ctx.globalAlpha = edgeAlpha;
          ctx.translate(c, cy);
          ctx.rotate(step * s);
          ctx.translate(-c, -cy);
          ctx.drawImage(scratch, 0, 0);
          ctx.restore();
        }
      };
      for (const mask of sectors.masks) compositeMask(mask);
    }
  }

  const labelMode = settings.showLabels && n <= VERTEX_LABEL_MAX_N;

  if (settings.showVertices && sectors.vertices.length > 0) {
    const dotRadius = Math.max(0.5, k.vertexRadius);
    const verts = sectors.vertices;
    // Banded dots (blocks mode) need to read at any edge alpha, so they get a
    // boosted opacity floor; plain dots stay at the edge alpha.
    const bandAlpha = labelMode ? 0.95 : Math.max(0.4, Math.min(0.95, edgeAlpha * 1.8));
    const plainFill = labelMode
      ? withAlpha(palette.labelVertexFill, 0.95)
      : withAlpha(palette.cayleyStroke, edgeAlpha);
    const vertexCopies =
      fundamentalOnly && fundamentalView !== "wedge" ? 1 : n;
    for (let s = 0; s < vertexCopies; s++) {
      ctx.save();
      ctx.translate(c, cy);
      ctx.rotate(step * s);
      ctx.translate(-c, -cy);
      ctx.fillStyle = sectors.bandVertices
        ? applyAlpha(blockColor(s, n, labelMode), bandAlpha)
        : plainFill;
      ctx.beginPath();
      for (let i = 0; i < verts.length; i += 2) {
        ctx.moveTo(verts[i] + dotRadius, verts[i + 1]);
        ctx.arc(verts[i], verts[i + 1], dotRadius, 0, 2 * Math.PI);
      }
      ctx.fill();
      ctx.restore();
    }
  }

  if (
    (!fundamentalOnly && settings.showFundamentalDomain) ||
    (!fundamentalOnly && settings.showSymmetryAxes) ||
    (!fundamentalOnly && settings.showDihedralAxes) ||
    settings.showVertexOrbit
  ) {
    const geom = { n, total, c, cy, r, scale };
    if (!fundamentalOnly && settings.showFundamentalDomain)
      drawFundamentalDomainToCanvas(ctx, geom, settings, palette);
    if (!fundamentalOnly && settings.showSymmetryAxes)
      drawSymmetryAxesToCanvas(ctx, geom, palette);
    if (!fundamentalOnly && settings.showDihedralAxes)
      drawDihedralOverlayToCanvas(ctx, geom, palette);
    if (settings.showVertexOrbit)
      drawVertexOrbitToCanvas(
        ctx,
        geom,
        settings,
        palette,
        undefined,
        makeZaksWordOf(n)
      );
  }

  drawZaksFundamentalFrame(
    ctx,
    { n, total, c, cy, r, scale },
    palette,
    fundamentalOnly ? fundamentalView : "wedge"
  );

  if (compareReflectionQuotient) {
    drawReflectionQuotientCircleToCanvas(ctx, {
      n: n - 1,
      c,
      cy: size * 0.76 + (h - size) / 2,
      r,
      scale,
      edgeAlpha,
      edgeWidth,
      palette,
    });
  }

  if (labelMode) {
    const labelOf = makeZaksLabelOf(n);
    ctx.fillStyle = palette.labelFill;
    ctx.font = `${vertexLabelFontSize(total) * dpr}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const labelCount =
      fundamentalOnly && fundamentalView !== "wedge"
        ? Math.max(1, Math.floor(B / 2))
        : total;
    for (let i = 0; i < labelCount; i++) {
      const [x, y] =
        fundamentalOnly && fundamentalView !== "wedge"
          ? zaksFundamentalPointXY(i, total, n, c, cy, r, fundamentalView)
          : pointXY(i, total, c, cy, r);
      ctx.fillText(labelOf(i), x, y);
    }
  }

  ctx.restore();
}

/* ------------------------------ yankelovich ------------------------------ */

/**
 * Cached state for the Yankelovich density-field renderer. The symmetrized
 * float field is the expensive part (it rasterizes the (n-1)! fundamental
 * chords and composites n rotations), so we keep it across zoom/pan and even
 * across gamma tweaks — only the cheap grayscale bitmap is rebuilt when gamma
 * changes.
 */
export interface YankelovichFieldCache {
  /** Identity of the float field, including sampling and viewport choices. */
  key: string;
  field: number;
  /** Region of the full Zaks disk covered by this matrix. */
  viewport: YankelovichFieldViewport;
  /** Symmetrized per-pixel chord density, length field·field. */
  out: Float32Array;
  /** Normalization value (high percentile of the density). */
  norm: number;
  /** Number of representative chords deposited into the accumulator. */
  matrixEdges: number;
  /** Number of angular-sector vertices/chords contributing to this viewport. */
  visibleVertices: number;
  /** Distribution of the per-cell density values across the whole matrix. */
  histogram: YankelovichHistogram;
  /** Cached per-cell tone in [0,1] for {@link toneKey}; reused across gamma/
   *  invert/colormap tweaks so only a tone-*mode* change recomputes it. */
  toneField?: Float32Array;
  /** Tone settings baked into {@link toneField}. */
  toneKey?: string;
  /** Tone settings (mode+gamma+invert+colormap) baked into {@link bitmap}. */
  paintKey: string;
  /** Grayscale field×field image ready to blit onto the display canvas. */
  bitmap: HTMLCanvasElement;
}

export interface YankelovichFieldViewport {
  /** Center in normalized full-disk square coordinates, where the full view is 0. */
  centerX: number;
  centerY: number;
  /** Half side length in normalized full-disk square coordinates. */
  scale: number;
}

/** Histogram of the density values stored in the N×N matrix. */
export interface YankelovichHistogram {
  /**
   * Counts of non-empty cells per equal-width bin over (0, max]. Empty (zero)
   * cells are excluded — they are just the background, and would otherwise
   * dwarf every other bar.
   */
  bins: number[];
  /** Upper end of the value range (the matrix maximum). */
  max: number;
  /** Tone-map normalization value (the high percentile / white point). */
  norm: number;
  /** Number of cells with a non-zero value (chord-touched). */
  nonZero: number;
  /** Cells inside the inscribed disk (the figure's actual area, not field²). */
  total: number;
}

interface YankelovichCanvasOpts {
  n: number;
  graph?: PancakeGraph;
  settings: RenderSettings;
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  zoom?: number;
  panX?: number;
  panY?: number;
  topInset?: number;
  fieldViewport?: YankelovichFieldViewport | null;
  palette?: Palette;
  cache?: { current: YankelovichFieldCache | null };
  onFieldTimings?: (timings: YankelovichFieldTimings) => void;
}

export interface YankelovichFieldTimings {
  matrixMs: number;
  symmetryMs: number;
  matrixEdges: number;
  viewportMs: number;
  visibleVertices: number;
}

/**
 * Largest (n-1)! for which the fundamental sector is enumerated exactly. Above
 * it the field is built by Monte-Carlo sampling instead (10! ≈ 3.6M is the last
 * exact n = 11; n ≥ 12 samples).
 */
const YANKELOVICH_ENUM_LIMIT = 4_000_000;
const YANKELOVICH_VISIBLE_SAMPLE_MAX_ATTEMPT_FACTOR = 20;
const YANKELOVICH_VISIBLE_SAMPLE_MAX_ATTEMPTS = 1_000_000;

/** Default accumulator grid size (memory: 2 × Float32 × field² during compute). */
const YANKELOVICH_DEFAULT_FIELD_SIZE = 1200;
/** Base sampled-chord budget at resolution = 1. */
const YANKELOVICH_SAMPLE_BUDGET = 2_500_000;
const YANKELOVICH_DEFAULT_SAMPLE_COUNT = 100_000;

/** Accumulator resolution. Kept fixed so quality is comparable across n. */
function yankelovichFieldSize(settings: RenderSettings): number {
  const size = settings.yankelovichFieldSize ?? YANKELOVICH_DEFAULT_FIELD_SIZE;
  return Math.max(100, Math.round(size / 100) * 100);
}

function yankelovichDihedralSectorVertexCount(n: number): number {
  return Math.max(1, Math.floor(factorial(n - 1) / 2));
}

function yankelovichSampleCount(settings: RenderSettings, n: number): number {
  const fallback = Math.max(1, Math.round(YANKELOVICH_SAMPLE_BUDGET / (2 * n)));
  const count = settings.yankelovichSampleCount ?? YANKELOVICH_DEFAULT_SAMPLE_COUNT;
  const sectorVertices = yankelovichDihedralSectorVertexCount(n);
  return Math.max(
    1,
    Math.min(
      sectorVertices,
      Math.round(Number.isFinite(count) ? count : fallback)
    )
  );
}

function yankelovichSampleSeed(settings: RenderSettings): number {
  const seed = settings.yankelovichSampleSeed ?? 0;
  return seed > 0 ? seed : 1;
}

function yankelovichUsesSampling(n: number, settings: RenderSettings): boolean {
  return (
    (settings.yankelovichSampleSeed ?? 0) > 0 ||
    factorial(n - 1) > YANKELOVICH_ENUM_LIMIT
  );
}

function makeYankelovichRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

function defaultYankelovichViewport(): YankelovichFieldViewport {
  return { centerX: 0, centerY: 0, scale: 1 };
}

function normalizeYankelovichViewport(
  viewport?: YankelovichFieldViewport | null
): YankelovichFieldViewport {
  if (!viewport) return defaultYankelovichViewport();
  const centerX = Number.isFinite(viewport.centerX) ? viewport.centerX : 0;
  const centerY = Number.isFinite(viewport.centerY) ? viewport.centerY : 0;
  const scale =
    Number.isFinite(viewport.scale) && viewport.scale > 0 ? viewport.scale : 1;
  return {
    centerX,
    centerY,
    scale: Math.min(1, scale),
  };
}

function yankelovichViewportCoordKey(value: number): string {
  return value === 0 ? "0" : value.toPrecision(12);
}

function yankelovichViewportKey(viewport: YankelovichFieldViewport): string {
  return `${yankelovichViewportCoordKey(viewport.centerX)},${yankelovichViewportCoordKey(viewport.centerY)},${yankelovichViewportCoordKey(viewport.scale)}`;
}

function isFullYankelovichViewport(viewport: YankelovichFieldViewport): boolean {
  return (
    Math.abs(viewport.centerX) < 1e-9 &&
    Math.abs(viewport.centerY) < 1e-9 &&
    Math.abs(viewport.scale - 1) < 1e-9
  );
}

function mapYankelovichUnitToField(
  field: number,
  viewport: YankelovichFieldViewport,
  ux: number,
  uy: number
): { x: number; y: number } {
  const cf = field / 2;
  const rf = field / 2 - 1.5;
  const zoom = 1 / viewport.scale;
  return {
    x: cf + rf * (ux - viewport.centerX) * zoom,
    y: cf + rf * (uy - viewport.centerY) * zoom,
  };
}

function fieldToYankelovichUnit(
  field: number,
  viewport: YankelovichFieldViewport,
  x: number,
  y: number
): { ux: number; uy: number } {
  const cf = field / 2;
  const rf = field / 2 - 1.5;
  return {
    ux: viewport.centerX + ((x - cf) * viewport.scale) / rf,
    uy: viewport.centerY + ((y - cf) * viewport.scale) / rf,
  };
}

function segmentIntersectsYankelovichViewport(
  viewport: YankelovichFieldViewport,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): boolean {
  const minX = viewport.centerX - viewport.scale;
  const maxX = viewport.centerX + viewport.scale;
  const minY = viewport.centerY - viewport.scale;
  const maxY = viewport.centerY + viewport.scale;
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return (
    clip(-dx, x1 - minX) &&
    clip(dx, maxX - x1) &&
    clip(-dy, y1 - minY) &&
    clip(dy, maxY - y1) &&
    t1 >= t0
  );
}

function chordIntersectsYankelovichViewport(
  viewport: YankelovichFieldViewport,
  total: number,
  i: number,
  j: number
): boolean {
  const ai = (2 * Math.PI * i) / total;
  const aj = (2 * Math.PI * j) / total;
  return segmentIntersectsYankelovichViewport(
    viewport,
    Math.cos(ai),
    Math.sin(ai),
    Math.cos(aj),
    Math.sin(aj)
  );
}

function dihedralChordIntersectsYankelovichViewport(
  viewport: YankelovichFieldViewport,
  n: number,
  total: number,
  block: number,
  i: number,
  j: number
): boolean {
  for (let k = 0; k < n; k++) {
    const a = (i + k * block) % total;
    const b = (j + k * block) % total;
    if (chordIntersectsYankelovichViewport(viewport, total, a, b)) return true;
    if (
      chordIntersectsYankelovichViewport(
        viewport,
        total,
        total - 1 - a,
        total - 1 - b
      )
    ) {
      return true;
    }
  }
  return false;
}

function cyclicChordIntersectsYankelovichViewport(
  viewport: YankelovichFieldViewport,
  n: number,
  total: number,
  block: number,
  i: number,
  j: number
): boolean {
  for (let k = 0; k < n; k++) {
    const a = (i + k * block) % total;
    const b = (j + k * block) % total;
    if (chordIntersectsYankelovichViewport(viewport, total, a, b)) return true;
  }
  return false;
}

/**
 * Israel Yankelovich's density-field visualization of a circular graph drawing.
 *
 * Idea: inscribe the n! cycle vertices on a circle, then for every chord
 * accumulate +1 into each cell of an N×N grid the chord passes through, and
 * display the grid as grayscale. Where many chords overlap the pixel saturates
 * to white, so the chord *envelopes* (caustics) emerge — structure the plain
 * alpha-blended disk hides once it saturates to black.
 *
 * Analytic Cₙ / Dₙ presets exploit the fundamental angular sector: sample one
 * sector, then composite its rotations (and Dₙ mirrored copies) over the disk.
 * Other presets sample their materialized edge list directly.
 */
export function drawYankelovichToCanvas(
  ctx: CanvasRenderingContext2D,
  opts: YankelovichCanvasOpts
): void {
  const {
    settings,
    cssWidth,
    cssHeight,
    dpr,
    zoom = 1,
    panX = 0,
    panY = 0,
    topInset = 0,
  } = opts;

  const w = Math.floor(cssWidth * dpr);
  const h = Math.floor(cssHeight * dpr);
  const gammaSlider = settings.yankelovichGamma ?? 50;
  const noiseFloor = settings.yankelovichNoiseFloor ?? 0;
  const binary = settings.yankelovichBinary ?? false;
  const invert = settings.yankelovichInvert ?? false;
  const tone = settings.yankelovichTone ?? "clahe";
  const colormap = settings.yankelovichColormap ?? "gray";
  const paintKey = `${tone}|${noiseFloor}|${binary ? 1 : 0}|${gammaSlider}|${invert ? 1 : 0}|${colormap}`;

  // The expensive density field is built (or cache-reused) here; callers that
  // want to surface a separate "computing" phase can prime it via
  // ensureYankelovichField before drawing.
  const entry = ensureYankelovichField(opts);
  if (!entry) return;

  if (!entry.bitmap.width || entry.paintKey !== paintKey) {
    paintYankelovichBitmap(
      entry,
      gammaSlider,
      noiseFloor,
      binary,
      invert,
      tone,
      colormap
    );
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  // Letterbox matches the field's empty-cell color so it blends seamlessly: the
  // empty tone is 0, flipped to (invert ? 1 : 0), through the chosen ramp.
  const [br, bg, bb] = evalColormap(colormap, invert ? 1 : 0);
  ctx.fillStyle = `rgb(${br}, ${bg}, ${bb})`;
  ctx.fillRect(0, 0, w, h);

  const inset = Math.max(0, Math.min(h - 1, topInset * dpr));
  const availableH = Math.max(1, h - inset);
  const size = Math.min(w, availableH);
  const dx = (w - size) / 2;
  const dy = inset + (availableH - size) / 2;
  const cx = w / 2;
  const cy = inset + availableH / 2;
  const viewport = entry.viewport;
  const viewportSize = size * viewport.scale;
  const viewportX = dx + size * ((viewport.centerX - viewport.scale + 1) / 2);
  const viewportY = dy + size * ((viewport.centerY - viewport.scale + 1) / 2);

  ctx.save();
  ctx.translate(cx + panX * dpr, cy + panY * dpr);
  ctx.scale(zoom, zoom);
  ctx.translate(-cx, -cy);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(entry.bitmap, viewportX, viewportY, viewportSize, viewportSize);
  ctx.restore();
}

/**
 * Build (or cache-reuse) the symmetrized density field for the given options
 * without painting or blitting. Lets callers run the heavy field computation as
 * its own phase (showing a distinct "computing" indicator) before the cheap
 * draw. Returns the cache entry, or null if the target has zero size.
 */
export function ensureYankelovichField(
  opts: YankelovichCanvasOpts
): YankelovichFieldCache | null {
  const { n, settings, cssWidth, cssHeight, dpr, cache } = opts;
  const w = Math.floor(cssWidth * dpr);
  const h = Math.floor(cssHeight * dpr);
  if (w <= 0 || h <= 0) return null;
  const field = yankelovichFieldSize(settings);
  const fieldKey = yankelovichFieldKey(opts);
  const existing =
    cache?.current && cache.current.key === fieldKey ? cache.current : null;
  if (existing) return existing;
  const entry = buildYankelovichField(
    n,
    opts.graph,
    field,
    settings,
    fieldKey,
    normalizeYankelovichViewport(opts.fieldViewport),
    opts.onFieldTimings
  );
  if (cache) cache.current = entry;
  return entry;
}

/**
 * The cache identity of the density field for these options. Exposed so the UI
 * can tell a cache hit (instant redraw — zoom/pan/gamma) from a miss (heavy
 * recompute — n/hidden change) and show the right phase indicator.
 */
export function yankelovichFieldKey(opts: YankelovichCanvasOpts): string {
  const { n, graph, settings } = opts;
  const field = yankelovichFieldSize(settings);
  const sampled = yankelovichUsesSampling(n, settings);
  const hiddenKey = [...new Set(settings.hiddenGenerators)]
    .sort((a, b) => a - b)
    .join(",");
  const analyticDn =
    !graph ||
    graph.preset === "pancake-zaks" ||
    graph.preset === "random-cyclic" ||
    graph.preset === "random-dihedral" ||
    graph.preset === "wedge-clipped-dihedral";
  const genericSampleCount =
    settings.yankelovichSampleCount ?? YANKELOVICH_DEFAULT_SAMPLE_COUNT;
  const sampleKey = !analyticDn
    ? `${genericSampleCount}|${yankelovichSampleSeed(settings)}`
    : graph?.preset === "random-cyclic" ||
        graph?.preset === "random-dihedral" ||
        graph?.preset === "wedge-clipped-dihedral"
    ? `${yankelovichSampleCount(settings, n)}|${yankelovichSampleSeed(settings)}`
    : sampled
    ? `${yankelovichSampleCount(settings, n)}|${yankelovichSampleSeed(settings)}`
    : "exact";
  const viewportKey = yankelovichViewportKey(
    normalizeYankelovichViewport(opts.fieldViewport)
  );
  const graphKey = graph ? `${graph.preset}|${graph.edges.length}` : "zaks";
  return `${graphKey}|${n}|${field}|${hiddenKey}|${sampleKey}|${viewportKey}`;
}

/**
 * Rasterize one representative per dihedral orbit into an accumulator and
 * composite the n rotated + n mirrored copies into the symmetrized density field.
 * Returns a cache entry with an empty (0×0) bitmap; the grayscale image is
 * painted lazily.
 */
function buildYankelovichField(
  n: number,
  graph: PancakeGraph | undefined,
  field: number,
  settings: RenderSettings,
  key: string,
  viewport: YankelovichFieldViewport,
  onFieldTimings?: (timings: YankelovichFieldTimings) => void
): YankelovichFieldCache {
  const timings: YankelovichFieldTimings = {
    matrixMs: 0,
    symmetryMs: 0,
    matrixEdges: 0,
    viewportMs: 0,
    visibleVertices: 0,
  };
  const out =
    graph?.preset === "random-cyclic"
      ? yankelovichFieldRandomCyclic(
          n,
          field,
          settings.hiddenGenerators,
          yankelovichSampleCount(settings, n),
          yankelovichSampleSeed(settings),
          viewport,
          timings
        )
      : graph?.preset === "random-dihedral"
      ? yankelovichFieldRandomDihedral(
          n,
          field,
          settings.hiddenGenerators,
          yankelovichSampleCount(settings, n),
          yankelovichSampleSeed(settings),
          viewport,
          timings
        )
      : graph?.preset === "wedge-clipped-dihedral"
        ? yankelovichFieldWedgeClippedDihedral(
            n,
            field,
            settings.hiddenGenerators,
            yankelovichSampleCount(settings, n),
            yankelovichSampleSeed(settings),
            viewport,
            timings
          )
      : graph?.preset === "simplex" && graph.edges.length === 0
        ? yankelovichFieldSimplex(
            n,
            field,
            settings,
            settings.yankelovichSampleCount ?? YANKELOVICH_DEFAULT_SAMPLE_COUNT,
            yankelovichSampleSeed(settings),
            viewport,
            timings
          )
      : graph && graph.preset !== "pancake-zaks"
      ? yankelovichFieldFromGraph(
          graph,
          field,
          settings,
          settings.yankelovichSampleCount ?? YANKELOVICH_DEFAULT_SAMPLE_COUNT,
          yankelovichSampleSeed(settings),
          viewport,
          timings
        )
      : yankelovichUsesSampling(n, settings)
      ? yankelovichFieldSampled(
          n,
          field,
          settings.hiddenGenerators,
          yankelovichSampleCount(settings, n),
          yankelovichSampleSeed(settings),
          viewport,
          timings
        )
      : yankelovichFieldExact(
          n,
          field,
          settings.hiddenGenerators,
          viewport,
          timings
        );
  onFieldTimings?.(timings);

  let maxv = 0;
  for (let i = 0; i < out.length; i++) if (out[i] > maxv) maxv = out[i];
  // Normalize on a high percentile, not the raw max, so a single bright
  // intersection pixel does not wash the whole field out.
  const norm = percentile(out, maxv, 0.999);
  const histogram = buildYankelovichHistogram(
    out,
    maxv,
    Math.max(norm, 1e-9),
    field,
    viewport
  );

  const bitmap =
    typeof document !== "undefined"
      ? document.createElement("canvas")
      : ({ width: 0, height: 0 } as HTMLCanvasElement);

  return {
    key,
    field,
    viewport,
    out,
    norm: Math.max(norm, 1e-9),
    matrixEdges: timings.matrixEdges,
    visibleVertices: timings.visibleVertices,
    histogram,
    paintKey: "",
    bitmap,
  };
}

function graphYankelovichPoint(
  graph: PancakeGraph,
  i: number
): { x: number; y: number } {
  if (graph.coords) {
    return { x: graph.coords[2 * i], y: graph.coords[2 * i + 1] };
  }
  const total = graph.path.length;
  const a = (2 * Math.PI * i) / total;
  return { x: Math.cos(a), y: Math.sin(a) };
}

function graphEdgeIntersectsYankelovichViewport(
  graph: PancakeGraph,
  viewport: YankelovichFieldViewport,
  i: number,
  j: number
): boolean {
  const a = graphYankelovichPoint(graph, i);
  const b = graphYankelovichPoint(graph, j);
  return segmentIntersectsYankelovichViewport(
    viewport,
    a.x,
    a.y,
    b.x,
    b.y
  );
}

/**
 * Analytic Yankelovich field for a simplex viewed as the complete graph on n!
 * vertices in circular order. Only sampled chords are drawn; no vertices or
 * complete edge list are materialized.
 */
function yankelovichFieldSimplex(
  n: number,
  field: number,
  settings: RenderSettings,
  sampleCount: number,
  sampleSeed: number,
  viewport: YankelovichFieldViewport,
  timings?: YankelovichFieldTimings
): Float32Array {
  const acc = new Float32Array(field * field);
  const hidden = hiddenGeneratorSet(settings.hiddenGenerators);
  if (hidden && hidden.has(1)) return acc;

  const total = factorial(n);
  if (total < 2) return acc;
  const edgeCount = (total * (total - 1)) / 2;
  const direct = !isFullYankelovichViewport(viewport);
  const rng = makeYankelovichRng(sampleSeed);
  const target = Math.max(1, Math.min(edgeCount, Math.round(sampleCount)));
  const enumerate = edgeCount <= target && total <= 10_000;
  const maxAttempts = enumerate
    ? edgeCount
    : Math.min(edgeCount * 4, Math.max(target, target * 20));

  const matrixT0 = performance.now();
  let matrixEdges = 0;
  let attempts = 0;
  const sampledEdges = new Set<string>();
  const drawChord = (i: number, j: number): boolean => {
    if (i === j) return false;
    const a = (2 * Math.PI * i) / total;
    const b = (2 * Math.PI * j) / total;
    const x1 = Math.cos(a);
    const y1 = Math.sin(a);
    const x2 = Math.cos(b);
    const y2 = Math.sin(b);
    if (
      direct &&
      !segmentIntersectsYankelovichViewport(viewport, x1, y1, x2, y2)
    ) {
      return false;
    }
    depositUnitSegment(acc, field, viewport, x1, y1, x2, y2, 1);
    matrixEdges++;
    return true;
  };

  if (enumerate) {
    for (let i = 0; i < total; i++) {
      for (let j = i + 1; j < total; j++) drawChord(i, j);
    }
  } else {
    while (matrixEdges < target && attempts < maxAttempts) {
      attempts++;
      const i = Math.floor(rng() * total);
      let j = Math.floor(rng() * total);
      if (j === i) j = (j + 1) % total;
      const a = Math.min(i, j);
      const b = Math.max(i, j);
      const key = `${a},${b}`;
      if (sampledEdges.has(key)) continue;
      if (drawChord(a, b)) sampledEdges.add(key);
    }
  }

  if (timings) {
    timings.matrixMs = performance.now() - matrixT0;
    timings.symmetryMs = 0;
    timings.matrixEdges = matrixEdges;
    timings.viewportMs = 0;
    timings.visibleVertices = total;
  }
  return acc;
}

/**
 * Generic Yankelovich field: sample this graph's actual edge set directly.
 * Unlike the Zaks pancake branch, this applies no Dₙ rotations or reflections.
 */
function yankelovichFieldFromGraph(
  graph: PancakeGraph,
  field: number,
  settings: RenderSettings,
  sampleCount: number,
  sampleSeed: number,
  viewport: YankelovichFieldViewport,
  timings?: YankelovichFieldTimings
): Float32Array {
  const acc = new Float32Array(field * field);
  const { edges } = graph;
  const edgeCount = edges.length / 3;
  if (edgeCount === 0) return acc;
  const hidden = hiddenGeneratorSet(settings.hiddenGenerators);
  const direct = !isFullYankelovichViewport(viewport);
  const rng = makeYankelovichRng(sampleSeed);
  const target = Math.max(1, Math.min(edgeCount, Math.round(sampleCount)));
  // The kaleidoscope is a small deterministic vector graph: always draw every
  // segment so the Dₙ symmetry is exact (no sampling / no edge-count limit).
  const enumerate = graph.preset === "kaleidoscope" || target >= edgeCount;
  const maxAttempts = enumerate ? edgeCount : Math.min(edgeCount * 4, target * 20);

  const matrixT0 = performance.now();
  let matrixEdges = 0;
  let attempts = 0;
  const drawEdge = (edgeIndex: number): boolean => {
    const t = edgeIndex * 3;
    if (hidden && hidden.has(edges[t + 2])) return false;
    const i = edges[t];
    const j = edges[t + 1];
    if (direct && !graphEdgeIntersectsYankelovichViewport(graph, viewport, i, j)) {
      return false;
    }
    const a = graphYankelovichPoint(graph, i);
    const b = graphYankelovichPoint(graph, j);
    depositUnitSegment(acc, field, viewport, a.x, a.y, b.x, b.y, 1);
    matrixEdges++;
    return true;
  };

  if (enumerate) {
    for (let e = 0; e < edgeCount; e++) drawEdge(e);
  } else {
    while (matrixEdges < target && attempts < maxAttempts) {
      attempts++;
      drawEdge(Math.floor(rng() * edgeCount));
    }
  }

  if (timings) {
    timings.matrixMs = performance.now() - matrixT0;
    timings.symmetryMs = 0;
    timings.matrixEdges = matrixEdges;
    timings.viewportMs = 0;
    timings.visibleVertices = graph.path.length;
  }
  return acc;
}

function depositUnitSegment(
  buf: Float32Array,
  field: number,
  viewport: YankelovichFieldViewport,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  wgt: number
): void {
  const p1 = mapYankelovichUnitToField(field, viewport, x1, y1);
  const p2 = mapYankelovichUnitToField(field, viewport, x2, y2);
  x1 = p1.x;
  y1 = p1.y;
  x2 = p2.x;
  y2 = p2.y;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len <= 0) return;

  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  const maxCell = field - 1e-6;
  if (
    !clip(-dx, x1) ||
    !clip(dx, maxCell - x1) ||
    !clip(-dy, y1) ||
    !clip(dy, maxCell - y1)
  ) {
    return;
  }
  if (t1 <= t0) return;
  const clippedX1 = x1 + dx * t0;
  const clippedY1 = y1 + dy * t0;
  const clippedX2 = x1 + dx * t1;
  const clippedY2 = y1 + dy * t1;
  const clippedLen = len * (t1 - t0);
  x1 = clippedX1;
  y1 = clippedY1;
  x2 = clippedX2;
  y2 = clippedY2;
  const cdx = x2 - x1;
  const cdy = y2 - y1;

  // Exact grid traversal: each crossed cell receives the chord length inside it.
  // This avoids the blur/energy spread caused by point-sampling plus bilinear splats.
  let x = Math.floor(x1);
  let y = Math.floor(y1);
  const endX = Math.floor(x2);
  const endY = Math.floor(y2);
  const stepX = cdx > 0 ? 1 : cdx < 0 ? -1 : 0;
  const stepY = cdy > 0 ? 1 : cdy < 0 ? -1 : 0;
  const tDeltaX = stepX === 0 ? Infinity : Math.abs(1 / cdx);
  const tDeltaY = stepY === 0 ? Infinity : Math.abs(1 / cdy);
  let tMaxX =
    stepX === 0 ? Infinity : ((stepX > 0 ? x + 1 : x) - x1) / cdx;
  let tMaxY =
    stepY === 0 ? Infinity : ((stepY > 0 ? y + 1 : y) - y1) / cdy;
  let t = 0;

  while (true) {
    const nextT = Math.min(1, tMaxX, tMaxY);
    if (x >= 0 && y >= 0 && x < field && y < field && nextT > t) {
      buf[y * field + x] += wgt * clippedLen * (nextT - t);
    }
    if (nextT >= 1 || (x === endX && y === endY)) break;

    const hitX = tMaxX <= nextT;
    const hitY = tMaxY <= nextT;
    if (hitX) {
      x += stepX;
      tMaxX += tDeltaX;
    }
    if (hitY) {
      y += stepY;
      tMaxY += tDeltaY;
    }
    t = nextT;
  }
}

/** Rasterize the chord between cycle positions i and j (angles 2π·/total). */
function depositChord(
  buf: Float32Array,
  field: number,
  viewport: YankelovichFieldViewport,
  total: number,
  i: number,
  j: number,
  wgt: number
): void {
  const ai = (2 * Math.PI * i) / total;
  const aj = (2 * Math.PI * j) / total;
  depositUnitSegment(
    buf,
    field,
    viewport,
    Math.cos(ai),
    Math.sin(ai),
    Math.cos(aj),
    Math.sin(aj),
    wgt
  );
}

function symmetrizeYankelovichAccumulator(
  n: number,
  total: number,
  field: number,
  acc: Float32Array,
  viewport: YankelovichFieldViewport,
  timings?: YankelovichFieldTimings
): Float32Array {
  // Symmetrize: out(p) = Σₖ acc(R₋ₖ p) + acc(ω R₋ₖ p). The reflection
  // ω: i ↦ (n!−1)−i maps angle θ to -θ - 2π/total.
  const symmetryT0 = performance.now();
  const out = new Float32Array(field * field);
  const cos = new Float64Array(n);
  const sin = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n;
    cos[k] = Math.cos(a);
    sin[k] = Math.sin(a);
  }
  const delta = (2 * Math.PI) / total;
  const mirrorCos = Math.cos(delta);
  const mirrorSin = Math.sin(delta);
  const sampleAcc = (ux: number, uy: number): number => {
    const { x, y } = mapYankelovichUnitToField(field, viewport, ux, uy);
    if (x < 0 || y < 0 || x >= field - 1 || y >= field - 1) return 0;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const i = y0 * field + x0;
    return (
      acc[i] * (1 - fx) * (1 - fy) +
      acc[i + 1] * fx * (1 - fy) +
      acc[i + field] * (1 - fx) * fy +
      acc[i + field + 1] * fx * fy
    );
  };

  for (let oy = 0; oy < field; oy++) {
    for (let ox = 0; ox < field; ox++) {
      const { ux: rx, uy: ry } = fieldToYankelovichUnit(
        field,
        viewport,
        ox + 0.5,
        oy + 0.5
      );
      let v = 0;
      for (let k = 0; k < n; k++) {
        const ux = rx * cos[k] + ry * sin[k];
        const uy = -rx * sin[k] + ry * cos[k];
        v += sampleAcc(ux, uy);
        v += sampleAcc(
          ux * mirrorCos - uy * mirrorSin,
          -ux * mirrorSin - uy * mirrorCos
        );
      }
      out[oy * field + ox] = v;
    }
  }
  if (timings) timings.symmetryMs = performance.now() - symmetryT0;
  return out;
}

function symmetrizeCyclicYankelovichAccumulator(
  n: number,
  field: number,
  acc: Float32Array,
  viewport: YankelovichFieldViewport,
  timings?: YankelovichFieldTimings
): Float32Array {
  const symmetryT0 = performance.now();
  const out = new Float32Array(field * field);
  const cos = new Float64Array(n);
  const sin = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n;
    cos[k] = Math.cos(a);
    sin[k] = Math.sin(a);
  }
  const sampleAcc = (ux: number, uy: number): number => {
    const { x, y } = mapYankelovichUnitToField(field, viewport, ux, uy);
    if (x < 0 || y < 0 || x >= field - 1 || y >= field - 1) return 0;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const i = y0 * field + x0;
    return (
      acc[i] * (1 - fx) * (1 - fy) +
      acc[i + 1] * fx * (1 - fy) +
      acc[i + field] * (1 - fx) * fy +
      acc[i + field + 1] * fx * fy
    );
  };

  for (let oy = 0; oy < field; oy++) {
    for (let ox = 0; ox < field; ox++) {
      const { ux: rx, uy: ry } = fieldToYankelovichUnit(
        field,
        viewport,
        ox + 0.5,
        oy + 0.5
      );
      let v = 0;
      for (let k = 0; k < n; k++) {
        const ux = rx * cos[k] + ry * sin[k];
        const uy = -rx * sin[k] + ry * cos[k];
        v += sampleAcc(ux, uy);
      }
      out[oy * field + ox] = v;
    }
  }
  if (timings) timings.symmetryMs = performance.now() - symmetryT0;
  return out;
}

function depositDihedralChordCopies(
  buf: Float32Array,
  field: number,
  viewport: YankelovichFieldViewport,
  n: number,
  total: number,
  block: number,
  i: number,
  j: number,
  weight: number
): void {
  for (let k = 0; k < n; k++) {
    const a = (i + k * block) % total;
    const b = (j + k * block) % total;
    depositChord(buf, field, viewport, total, a, b, weight);
    depositChord(buf, field, viewport, total, total - 1 - a, total - 1 - b, weight);
  }
}

function depositCyclicChordCopies(
  buf: Float32Array,
  field: number,
  viewport: YankelovichFieldViewport,
  n: number,
  total: number,
  block: number,
  i: number,
  j: number,
  weight: number
): void {
  for (let k = 0; k < n; k++) {
    const a = (i + k * block) % total;
    const b = (j + k * block) % total;
    depositChord(buf, field, viewport, total, a, b, weight);
  }
}

interface UnitSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function clipUnitSegmentToDihedralWedge(
  n: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): UnitSegment | null {
  const wedge = Math.PI / n;
  const sin = Math.sin(wedge);
  const cos = Math.cos(wedge);
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;

  const clip = (h0: number, dh: number): boolean => {
    if (Math.abs(dh) < 1e-15) return h0 >= 0;
    const t = -h0 / dh;
    if (dh > 0) {
      if (t > t0) t0 = t;
    } else if (t < t1) {
      t1 = t;
    }
    return t0 < t1;
  };

  if (!clip(y1, dy)) return null;
  if (!clip(sin * x1 - cos * y1, sin * dx - cos * dy)) return null;

  return {
    x1: x1 + dx * t0,
    y1: y1 + dy * t0,
    x2: x1 + dx * t1,
    y2: y1 + dy * t1,
  };
}

function wedgeClippedChordSegment(
  n: number,
  total: number,
  i: number,
  j: number
): UnitSegment | null {
  const ai = (2 * Math.PI * i) / total;
  const aj = (2 * Math.PI * j) / total;
  return clipUnitSegmentToDihedralWedge(
    n,
    Math.cos(ai),
    Math.sin(ai),
    Math.cos(aj),
    Math.sin(aj)
  );
}

function depositWedgeClippedChord(
  buf: Float32Array,
  field: number,
  viewport: YankelovichFieldViewport,
  n: number,
  total: number,
  i: number,
  j: number,
  weight: number
): boolean {
  const segment = wedgeClippedChordSegment(n, total, i, j);
  if (!segment) return false;
  depositUnitSegment(
    buf,
    field,
    viewport,
    segment.x1,
    segment.y1,
    segment.x2,
    segment.y2,
    weight
  );
  return true;
}

function transformDihedralPoint(
  x: number,
  y: number,
  rotCos: number,
  rotSin: number,
  mirrorCos: number,
  mirrorSin: number,
  reflected: boolean
): { x: number; y: number } {
  const rx = x * rotCos - y * rotSin;
  const ry = x * rotSin + y * rotCos;
  if (!reflected) return { x: rx, y: ry };
  return {
    x: rx * mirrorCos - ry * mirrorSin,
    y: -rx * mirrorSin - ry * mirrorCos,
  };
}

function depositDihedralWedgeClippedChordCopies(
  buf: Float32Array,
  field: number,
  viewport: YankelovichFieldViewport,
  n: number,
  total: number,
  i: number,
  j: number,
  weight: number
): void {
  const segment = wedgeClippedChordSegment(n, total, i, j);
  if (!segment) return;
  const delta = (2 * Math.PI) / total;
  const mirrorCos = Math.cos(delta);
  const mirrorSin = Math.sin(delta);
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n;
    const rotCos = Math.cos(a);
    const rotSin = Math.sin(a);
    for (const reflected of [false, true]) {
      const p = transformDihedralPoint(
        segment.x1,
        segment.y1,
        rotCos,
        rotSin,
        mirrorCos,
        mirrorSin,
        reflected
      );
      const q = transformDihedralPoint(
        segment.x2,
        segment.y2,
        rotCos,
        rotSin,
        mirrorCos,
        mirrorSin,
        reflected
      );
      depositUnitSegment(buf, field, viewport, p.x, p.y, q.x, q.y, weight);
    }
  }
}

function dihedralWedgeClippedChordIntersectsYankelovichViewport(
  viewport: YankelovichFieldViewport,
  n: number,
  total: number,
  i: number,
  j: number
): boolean {
  const segment = wedgeClippedChordSegment(n, total, i, j);
  if (!segment) return false;
  const delta = (2 * Math.PI) / total;
  const mirrorCos = Math.cos(delta);
  const mirrorSin = Math.sin(delta);
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n;
    const rotCos = Math.cos(a);
    const rotSin = Math.sin(a);
    for (const reflected of [false, true]) {
      const p = transformDihedralPoint(
        segment.x1,
        segment.y1,
        rotCos,
        rotSin,
        mirrorCos,
        mirrorSin,
        reflected
      );
      const q = transformDihedralPoint(
        segment.x2,
        segment.y2,
        rotCos,
        rotSin,
        mirrorCos,
        mirrorSin,
        reflected
      );
      if (segmentIntersectsYankelovichViewport(viewport, p.x, p.y, q.x, q.y)) {
        return true;
      }
    }
  }
  return false;
}

interface YankelovichChordCandidate {
  i: number;
  j: number;
  weight: number;
}

/**
 * Exact density field for small n: rasterize one representative per Dₙ orbit
 * into an accumulator, then composite rotations and axial reflections.
 */
function yankelovichFieldExact(
  n: number,
  field: number,
  hiddenGenerators: number[],
  viewport: YankelovichFieldViewport,
  timings?: YankelovichFieldTimings
): Float32Array {
  const total = factorial(n);
  const B = factorial(n - 1);
  const sectorVertices = yankelovichDihedralSectorVertexCount(n);
  const acc = new Float32Array(field * field);
  const direct = !isFullYankelovichViewport(viewport);
  const hidden = hiddenGeneratorSet(hiddenGenerators);
  const candidates: YankelovichChordCandidate[] = [];
  const seenDihedral = new Set<number>();

  const findT0 = performance.now();
  let matrixEdges = 0;
  forEachZaksFundamentalEdge(n, (e) => {
    if (hidden && hidden.has(e.gen)) return;
    if (e.i >= sectorVertices) return;
    const cCode = canonicalOrbitCode(e.i, e.j, n, total, B);
    const dCode = canonicalDihedralCode(e.i, e.j, n, total, B);
    if (seenDihedral.has(dCode)) return;
    seenDihedral.add(dCode);
    // Generic orbits (size n) deposit at weight 1; antipodal "diameter" chords
    // map to themselves after n/2 rotations, so the n-fold composite would visit
    // them twice. If the Cₙ orbit is also its own mirror, the Dₙ composite visits
    // it twice too. Each symmetry stabilizer halves the representative's weight.
    const mirrorInvariant =
      cCode === canonicalOrbitCode(total - 1 - e.i, total - 1 - e.j, n, total, B);
    const weight = (e.half ? 0.5 : 1) * (mirrorInvariant ? 0.5 : 1);
    if (direct) {
      if (
        !dihedralChordIntersectsYankelovichViewport(
          viewport,
          n,
          total,
          B,
          e.i,
          e.j
        )
      ) {
        return;
      }
      candidates.push({ i: e.i, j: e.j, weight });
    } else {
      depositChord(acc, field, viewport, total, e.i, e.j, weight);
    }
    matrixEdges++;
  });
  if (timings) {
    timings.viewportMs = direct ? performance.now() - findT0 : 0;
    timings.visibleVertices = direct ? candidates.length : sectorVertices;
  }

  const matrixT0 = performance.now();
  if (direct) {
    for (const candidate of candidates) {
      depositDihedralChordCopies(
        acc,
        field,
        viewport,
        n,
        total,
        B,
        candidate.i,
        candidate.j,
        candidate.weight
      );
    }
  }
  if (timings) {
    timings.matrixMs = direct
      ? performance.now() - matrixT0
      : performance.now() - findT0;
    timings.matrixEdges = matrixEdges;
  }

  if (direct) return acc;
  return symmetrizeYankelovichAccumulator(n, total, field, acc, viewport, timings);
}

/**
 * Random Cₙ / Dₙ-symmetric matching controls: sample source representatives
 * from the fundamental sector and pair them with distinct random endpoints.
 */
function yankelovichFieldRandomCyclic(
  n: number,
  field: number,
  hiddenGenerators: number[],
  sampleCount: number,
  sampleSeed: number,
  viewport: YankelovichFieldViewport,
  timings?: YankelovichFieldTimings
): Float32Array {
  return yankelovichFieldRandomSymmetricBase(
    n,
    field,
    hiddenGenerators,
    "cyclic",
    false,
    sampleCount,
    sampleSeed,
    viewport,
    timings
  );
}

function yankelovichFieldRandomDihedral(
  n: number,
  field: number,
  hiddenGenerators: number[],
  sampleCount: number,
  sampleSeed: number,
  viewport: YankelovichFieldViewport,
  timings?: YankelovichFieldTimings
): Float32Array {
  return yankelovichFieldRandomSymmetricBase(
    n,
    field,
    hiddenGenerators,
    "dihedral",
    false,
    sampleCount,
    sampleSeed,
    viewport,
    timings
  );
}

function yankelovichFieldWedgeClippedDihedral(
  n: number,
  field: number,
  hiddenGenerators: number[],
  sampleCount: number,
  sampleSeed: number,
  viewport: YankelovichFieldViewport,
  timings?: YankelovichFieldTimings
): Float32Array {
  return yankelovichFieldRandomSymmetricBase(
    n,
    field,
    hiddenGenerators,
    "dihedral",
    true,
    sampleCount,
    sampleSeed,
    viewport,
    timings
  );
}

function yankelovichFieldRandomSymmetricBase(
  n: number,
  field: number,
  hiddenGenerators: number[],
  symmetry: "cyclic" | "dihedral",
  wedgeClipped: boolean,
  sampleCount: number,
  sampleSeed: number,
  viewport: YankelovichFieldViewport,
  timings?: YankelovichFieldTimings
): Float32Array {
  const acc = new Float32Array(field * field);
  const hidden = hiddenGeneratorSet(hiddenGenerators);
  if (hidden && hidden.has(1)) {
    if (timings) {
      timings.matrixMs = 0;
      timings.matrixEdges = 0;
      timings.viewportMs = 0;
      timings.visibleVertices = 0;
    }
    return acc;
  }

  const total = factorial(n);
  const B = factorial(n - 1);
  const sectorVertices = yankelovichDihedralSectorVertexCount(n);
  const direct = !isFullYankelovichViewport(viewport);
  const rng = makeYankelovichRng(sampleSeed);
  const samples = Math.max(1, Math.round(sampleCount));
  const maxAttempts = direct
    ? Math.min(
        YANKELOVICH_VISIBLE_SAMPLE_MAX_ATTEMPTS,
        Math.max(samples, samples * YANKELOVICH_VISIBLE_SAMPLE_MAX_ATTEMPT_FACTOR)
      )
    : samples * 4;
  const usedSources = new Set<number>();
  const usedVertices = new Set<number>();
  const candidates: YankelovichChordCandidate[] = [];

  const findT0 = performance.now();
  let matrixEdges = 0;
  let attempts = 0;
  while (matrixEdges < samples && attempts < maxAttempts) {
    attempts++;
    const i = Math.floor(rng() * sectorVertices);
    if (usedSources.has(i) || usedVertices.has(i)) continue;

    let j = Math.floor(rng() * total);
    let targetAttempts = 0;
    while ((j === i || usedVertices.has(j)) && targetAttempts < 20) {
      j = Math.floor(rng() * total);
      targetAttempts++;
    }
    if (j === i || usedVertices.has(j)) continue;
    if (wedgeClipped && !wedgeClippedChordSegment(n, total, i, j)) continue;

    if (direct) {
      const visible = wedgeClipped
        ? dihedralWedgeClippedChordIntersectsYankelovichViewport(
            viewport,
            n,
            total,
            i,
            j
          )
        : symmetry === "cyclic"
          ? cyclicChordIntersectsYankelovichViewport(
              viewport,
              n,
              total,
              B,
              i,
              j
            )
          : dihedralChordIntersectsYankelovichViewport(
              viewport,
              n,
              total,
              B,
              i,
              j
            );
      if (!visible) continue;
    }

    usedSources.add(i);
    usedVertices.add(i);
    usedVertices.add(j);
    if (direct) {
      candidates.push({ i, j, weight: 1 });
    } else if (wedgeClipped) {
      depositWedgeClippedChord(acc, field, viewport, n, total, i, j, 1);
    } else {
      depositChord(acc, field, viewport, total, i, j, 1);
    }
    matrixEdges++;
  }

  if (timings) {
    timings.viewportMs = direct ? performance.now() - findT0 : 0;
    timings.visibleVertices = direct ? candidates.length : sectorVertices;
  }

  const matrixT0 = performance.now();
  if (direct) {
    for (const candidate of candidates) {
      if (wedgeClipped) {
        depositDihedralWedgeClippedChordCopies(
          acc,
          field,
          viewport,
          n,
          total,
          candidate.i,
          candidate.j,
          candidate.weight
        );
      } else if (symmetry === "cyclic") {
        depositCyclicChordCopies(
          acc,
          field,
          viewport,
          n,
          total,
          B,
          candidate.i,
          candidate.j,
          candidate.weight
        );
      } else {
        depositDihedralChordCopies(
          acc,
          field,
          viewport,
          n,
          total,
          B,
          candidate.i,
          candidate.j,
          candidate.weight
        );
      }
    }
  }
  if (timings) {
    timings.matrixMs = direct
      ? performance.now() - matrixT0
      : performance.now() - findT0;
    timings.matrixEdges = matrixEdges;
  }
  if (direct) return acc;
  return symmetry === "cyclic"
    ? symmetrizeCyclicYankelovichAccumulator(n, field, acc, viewport, timings)
    : symmetrizeYankelovichAccumulator(n, total, field, acc, viewport, timings);
}

/**
 * Monte-Carlo density field for large n, where neither the n! cycle nor the
 * (n-1)! fundamental sector can be enumerated. We sample the dihedral angular
 * sector, rasterize those chords into an unsymmetrized accumulator, then apply
 * the full Dₙ symmetry in the field-composite step. Zoomed viewports use
 * rejection sampling so accepted random vertices all contribute visible edges.
 */
function yankelovichFieldSampled(
  n: number,
  field: number,
  hiddenGenerators: number[],
  sampleCount: number,
  sampleSeed: number,
  viewport: YankelovichFieldViewport,
  timings?: YankelovichFieldTimings
): Float32Array {
  const acc = new Float32Array(field * field);
  const direct = !isFullYankelovichViewport(viewport);
  const hidden = hiddenGeneratorSet(hiddenGenerators);
  if (hidden && hidden.has(n)) {
    if (timings) {
      timings.matrixMs = 0;
      timings.matrixEdges = 0;
      timings.viewportMs = 0;
      timings.visibleVertices = 0;
    }
    return acc;
  } // rₙ hidden ⇒ nothing to draw

  const total = factorial(n);
  const B = factorial(n - 1);
  const sectorVertices = yankelovichDihedralSectorVertexCount(n);

  const rng = makeYankelovichRng(sampleSeed);
  const samples = Math.max(1, Math.round(sampleCount));
  const candidates: YankelovichChordCandidate[] = [];

  const findT0 = performance.now();
  let matrixEdges = 0;
  const maxAttempts = direct
    ? Math.min(
        YANKELOVICH_VISIBLE_SAMPLE_MAX_ATTEMPTS,
        Math.max(samples, samples * YANKELOVICH_VISIBLE_SAMPLE_MAX_ATTEMPT_FACTOR)
      )
    : samples;
  let attempts = 0;
  while ((!direct && attempts < samples) || (direct && candidates.length < samples)) {
    if (attempts >= maxAttempts) break;
    attempts++;
    const i = Math.floor(rng() * sectorVertices);
    // rₙ neighbor = σₙ(i) = rank ∘ reverse ∘ unrank.
    const j = zaksSigma(n, i);
    if (direct) {
      if (
        !dihedralChordIntersectsYankelovichViewport(
          viewport,
          n,
          total,
          B,
          i,
          j
        )
      ) {
        continue;
      }
      candidates.push({ i, j, weight: 1 });
    } else {
      depositChord(acc, field, viewport, total, i, j, 1);
    }
    matrixEdges++;
  }
  if (timings) {
    timings.viewportMs = direct ? performance.now() - findT0 : 0;
    timings.visibleVertices = direct ? candidates.length : sectorVertices;
  }

  const matrixT0 = performance.now();
  if (direct) {
    for (const candidate of candidates) {
      depositDihedralChordCopies(
        acc,
        field,
        viewport,
        n,
        total,
        B,
        candidate.i,
        candidate.j,
        candidate.weight
      );
    }
  }
  if (timings) {
    timings.matrixMs = direct
      ? performance.now() - matrixT0
      : performance.now() - findT0;
    timings.matrixEdges = matrixEdges;
  }
  if (direct) return acc;
  return symmetrizeYankelovichAccumulator(n, total, field, acc, viewport, timings);
}

/**
 * Distribution of the non-empty matrix cells across equal-width value bins.
 * `total` counts only cells inside the inscribed disk (the figure is a disk, so
 * the square's corners are empty by construction and must not count as "unfilled").
 */
function buildYankelovichHistogram(
  data: Float32Array,
  max: number,
  norm: number,
  field: number,
  viewport: YankelovichFieldViewport
): YankelovichHistogram {
  const BINS = 40;
  const bins = new Array<number>(BINS).fill(0);
  let nonZero = 0;
  let diskCells = 0;
  for (let y = 0; y < field; y++) {
    for (let x = 0; x < field; x++) {
      const { ux, uy } = fieldToYankelovichUnit(
        field,
        viewport,
        x + 0.5,
        y + 0.5
      );
      if (ux * ux + uy * uy > 1) continue; // outside the inscribed disk
      diskCells++;
      const v = data[y * field + x];
      if (v <= 0) continue;
      nonZero++;
      if (max > 0) bins[Math.min(BINS - 1, Math.floor((v / max) * BINS))]++;
    }
  }
  return { bins, max, norm, nonZero, total: diskCells };
}

/** Histogram-based percentile of the positive entries of `data` over [0, max]. */
function percentile(data: Float32Array, max: number, q: number): number {
  if (max <= 0) return 0;
  const BINS = 2048;
  const hist = new Uint32Array(BINS);
  let count = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v <= 0) continue;
    const b = Math.min(BINS - 1, Math.floor((v / max) * BINS));
    hist[b]++;
    count++;
  }
  if (count === 0) return max;
  const target = q * count;
  let cum = 0;
  for (let b = 0; b < BINS; b++) {
    cum += hist[b];
    if (cum >= target) return ((b + 1) / BINS) * max;
  }
  return max;
}

/**
 * Render the cached float field to a bitmap. The per-cell density is mapped to a
 * normalized tone in [0,1] (log / equalize / clahe), shaped by gamma, optionally
 * inverted, then colored through the chosen ramp.
 */
function paintYankelovichBitmap(
  entry: YankelovichFieldCache,
  gammaSlider: number,
  noiseFloor: number,
  binary: boolean,
  invert: boolean,
  tone: YankelovichTone,
  colormap: YankelovichColormap
): void {
  const { field, out, norm, histogram, bitmap } = entry;
  if (typeof document === "undefined") return;
  bitmap.width = field;
  bitmap.height = field;
  const bctx = bitmap.getContext("2d");
  if (!bctx) return;
  const img = bctx.createImageData(field, field);
  const data = img.data;

  // The tone field (log/equalize/clahe) is the costly part; cache it by mode so
  // gamma/invert/colormap tweaks only redo the cheap final mapping below.
  const toneKey = `${tone}|${noiseFloor}|${binary ? 1 : 0}`;
  if (entry.toneKey !== toneKey || !entry.toneField) {
    entry.toneField = yankelovichToneField(
      out,
      field,
      tone,
      histogram.max,
      norm,
      noiseFloor,
      binary
    );
    entry.toneKey = toneKey;
  }
  const t = entry.toneField;
  const gamma = sliderToYankelovichGamma(gammaSlider);
  for (let i = 0; i < out.length; i++) {
    const shade = Math.pow(t[i], gamma);
    const u = invert ? 1 - shade : shade;
    const [r, g, b] = evalColormap(colormap, u);
    const p = i * 4;
    data[p] = r;
    data[p + 1] = g;
    data[p + 2] = b;
    data[p + 3] = 255;
  }
  bctx.putImageData(img, 0, 0);
  entry.paintKey = `${tone}|${noiseFloor}|${binary ? 1 : 0}|${gammaSlider}|${invert ? 1 : 0}|${colormap}`;
}

/** Per-cell normalized tone in [0,1] for the chosen tone-mapping mode. */
function yankelovichToneField(
  out: Float32Array,
  field: number,
  tone: YankelovichTone,
  max: number,
  norm: number,
  noiseFloor: number,
  binary: boolean
): Float32Array {
  const t = new Float32Array(out.length);
  const floor =
    noiseFloor > 0 ? percentile(out, max, Math.min(0.95, noiseFloor / 100)) : 0;
  if (binary) {
    for (let i = 0; i < out.length; i++) t[i] = out[i] > floor ? 1 : 0;
    return t;
  }
  const adjustedMax = Math.max(0, max - floor);
  const adjustedNorm = Math.max(1e-9, norm - floor);
  if (tone === "log") {
    const denom = Math.log1p(adjustedNorm);
    for (let i = 0; i < out.length; i++) {
      const v = Math.max(0, out[i] - floor);
      const x = denom > 0 ? Math.log1p(v) / denom : 0;
      t[i] = x > 1 ? 1 : x < 0 ? 0 : x;
    }
    return t;
  }
  if (tone === "equalize") {
    const B = 4096;
    const hist = new Float64Array(B);
    let c = 0;
    if (adjustedMax > 0) {
      for (let i = 0; i < out.length; i++) {
        const v = Math.max(0, out[i] - floor);
        if (v <= 0) continue;
        hist[Math.min(B - 1, Math.floor((v / adjustedMax) * B))]++;
        c++;
      }
    }
    let cum = 0;
    for (let b = 0; b < B; b++) {
      cum += hist[b];
      hist[b] = c > 0 ? cum / c : 0;
    }
    for (let i = 0; i < out.length; i++) {
      const v = Math.max(0, out[i] - floor);
      t[i] =
        v > 0 && adjustedMax > 0
          ? hist[Math.min(B - 1, Math.floor((v / adjustedMax) * B))]
          : 0;
    }
    return t;
  }
  // clahe
  if (floor <= 0) {
    claheToneField(out, field, max, t);
  } else {
    const adjusted = new Float32Array(out.length);
    for (let i = 0; i < out.length; i++) adjusted[i] = Math.max(0, out[i] - floor);
    claheToneField(adjusted, field, adjustedMax, t);
  }
  return t;
}

/**
 * Contrast-limited adaptive histogram equalization: equalize per tile (over the
 * tile's non-empty cells, with a clip limit), then bilinearly blend the four
 * surrounding tile mappings per pixel so tile seams disappear. Empty cells stay 0.
 */
function claheToneField(
  out: Float32Array,
  field: number,
  max: number,
  t: Float32Array
): void {
  if (max <= 0) return;
  const TILES = 8;
  const B = 256;
  const tw = field / TILES;
  const hist = new Float64Array(TILES * TILES * B);
  const cnt = new Float64Array(TILES * TILES);
  const binOf = (v: number) => Math.min(B - 1, Math.floor((v / max) * B));

  for (let y = 0; y < field; y++) {
    const ty = Math.min(TILES - 1, Math.floor(y / tw));
    for (let x = 0; x < field; x++) {
      const v = out[y * field + x];
      if (v <= 0) continue;
      const tx = Math.min(TILES - 1, Math.floor(x / tw));
      hist[(ty * TILES + tx) * B + binOf(v)]++;
      cnt[ty * TILES + tx]++;
    }
  }

  // Clip-limit each tile histogram, redistribute the excess, then make a CDF.
  for (let tile = 0; tile < TILES * TILES; tile++) {
    const total = cnt[tile];
    const base = tile * B;
    if (total <= 0) continue;
    const limit = (10 * total) / B; // contrast clip
    let excess = 0;
    for (let b = 0; b < B; b++) {
      if (hist[base + b] > limit) {
        excess += hist[base + b] - limit;
        hist[base + b] = limit;
      }
    }
    const add = excess / B;
    let cum = 0;
    for (let b = 0; b < B; b++) {
      cum += hist[base + b] + add;
      hist[base + b] = cum / total;
    }
  }

  for (let y = 0; y < field; y++) {
    const fy = y / tw - 0.5;
    const ty0 = Math.floor(fy);
    const ay = fy - ty0;
    for (let x = 0; x < field; x++) {
      const i = y * field + x;
      const v = out[i];
      if (v <= 0) {
        t[i] = 0;
        continue;
      }
      const bin = binOf(v);
      const fx = x / tw - 0.5;
      const tx0 = Math.floor(fx);
      const ax = fx - tx0;
      let acc = 0;
      let wsum = 0;
      for (let cy = 0; cy <= 1; cy++) {
        const wy = cy ? ay : 1 - ay;
        const tcy = Math.min(TILES - 1, Math.max(0, ty0 + cy));
        for (let cx = 0; cx <= 1; cx++) {
          const wx = cx ? ax : 1 - ax;
          const tcx = Math.min(TILES - 1, Math.max(0, tx0 + cx));
          const tile = tcy * TILES + tcx;
          if (cnt[tile] <= 0) continue;
          const w = wx * wy;
          acc += w * hist[tile * B + bin];
          wsum += w;
        }
      }
      t[i] = wsum > 0 ? acc / wsum : 0;
    }
  }
}

/** Evaluate a color ramp at t∈[0,1], returning [r,g,b] in 0..255. */
function evalColormap(
  name: YankelovichColormap,
  t: number
): [number, number, number] {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  if (name === "gray") {
    const g = Math.round(255 * x);
    return [g, g, g];
  }
  const stops = COLORMAPS[name];
  const seg = x * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(seg));
  const f = seg - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

const COLORMAPS: Record<
  Exclude<YankelovichColormap, "gray">,
  ReadonlyArray<readonly [number, number, number]>
> = {
  viridis: [
    [68, 1, 84], [71, 44, 122], [59, 81, 139], [44, 113, 142], [33, 144, 141],
    [39, 173, 129], [92, 200, 99], [170, 220, 50], [253, 231, 37],
  ],
  magma: [
    [0, 0, 4], [28, 16, 68], [79, 18, 123], [129, 37, 129], [181, 54, 122],
    [229, 80, 100], [251, 135, 97], [254, 194, 135], [252, 253, 191],
  ],
  inferno: [
    [0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66],
    [245, 125, 21], [250, 193, 39], [252, 255, 164], [252, 255, 164],
  ],
  // Stained-glass rainbow: violet → blue → teal → green → gold → orange →
  // crimson, capped by a bright highlight where many panes overlap.
  stained: [
    [26, 0, 51], [40, 30, 150], [20, 110, 190], [10, 170, 160],
    [60, 190, 80], [210, 200, 40], [240, 130, 30], [215, 40, 70],
    [255, 240, 210],
  ],
};

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

/** Mix a #rrggbb color toward white by fraction t (0 = same, 1 = white). */
function lightenHex(hex: string, t: number): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const mix = (ch: number) => Math.round(ch + (255 - ch) * t);
  const r = mix((v >> 16) & 0xff);
  const g = mix((v >> 8) & 0xff);
  const b = mix(v & 0xff);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
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
  const { path, edges, coords } = graph;
  const n = sizingN(graph);
  const total = path.length;
  const c = size / 2;
  const r = size * 0.405;
  const scale = size / 1000;
  // Explicit 2-D layout (the Sierpiński gasket) when present; otherwise the
  // vertex sits on the circle at angle 2πi/total.
  const pos = (i: number): [number, number] =>
    coords
      ? [c + coords[2 * i] * r, c + coords[2 * i + 1] * r]
      : point(i, total, c, r);

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
    if (coords) {
      // Trace the Hamiltonian cycle as a closed polyline through the layout, so
      // the cycle is visible on top of the gasket instead of as a bare circle.
      let d = "";
      for (let i = 0; i < total; i++) {
        const [x, y] = pos(i);
        d += `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      }
      d += "Z";
      parts.push(
        `<path d="${d}" fill="none" stroke="${palette.cayleyStroke}" stroke-width="${k.cycleWidth}" stroke-opacity="${edgeAlpha}" stroke-linejoin="round" stroke-linecap="round"/>`
      );
    } else {
      parts.push(
        `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${palette.cayleyStroke}" stroke-width="${k.cycleWidth}" stroke-opacity="${edgeAlpha}"/>`
      );
    }
  }

  const coloring = dihedralColoring(graph, settings);

  if (settings.showCayley && edges.length > 0 && coloring) {
    // Group chords by color (one <path> per color) so overlaps within a color
    // composite once, mirroring the canvas renderer.
    const hidden = hiddenGeneratorSet(settings.hiddenGenerators);
    const orbitColors =
      coloring === "orbit" || coloring === "dihedral"
        ? orbitColorsForGraph(graph, coloring)
        : null;
    const groups = new Map<string, string>();
    for (let t = 0, e = 0; t < edges.length; t += 3, e++) {
      if (hidden && hidden.has(edges[t + 2])) continue;
      const color =
        orbitColors
          ? orbitColors[e]
          : edges[t + 2] < graph.n
            ? palette.blockWithinStroke
            : palette.blockBetweenStroke;
      const [ax, ay] = pos(edges[t]);
      const [bx, by] = pos(edges[t + 1]);
      groups.set(
        color,
        (groups.get(color) ?? "") +
          `M${ax.toFixed(2)},${ay.toFixed(2)}L${bx.toFixed(2)},${by.toFixed(2)}`
      );
    }
    const order =
      coloring === "blocks"
        ? [palette.blockWithinStroke, palette.blockBetweenStroke].filter((co) =>
            groups.has(co)
          )
        : [...groups.keys()];
    for (const color of order) {
      parts.push(
        `<path d="${groups.get(color)!}" fill="none" stroke="${color}" stroke-width="${edgeWidth}" stroke-opacity="${edgeAlpha}" stroke-linecap="round"/>`
      );
    }
  } else if (settings.showCayley && edges.length > 0) {
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
          const [ax, ay] = pos(i);
          const [bx, by] = pos(j);
          d += `M${ax.toFixed(2)},${ay.toFixed(2)}L${bx.toFixed(2)},${by.toFixed(2)}`;
        }
        if (d.length === 0) continue;
        parts.push(
          `<path d="${d}" fill="none" stroke="${pass.color}" stroke-width="${edgeWidth}" stroke-opacity="${edgeAlpha}" stroke-linecap="round"/>`
        );
      }
    }
  }

  const labelMode = settings.showLabels && supportsVertexLabels(graph);

  if (settings.showVertices) {
    const dotRadius = Math.max(0.5, k.vertexRadius);
    const bandAlpha = labelMode ? 0.95 : Math.max(0.4, Math.min(0.95, edgeAlpha * 1.8));
    const B = total / graph.n;
    for (let i = 0; i < total; i++) {
      const [x, y] = pos(i);
      const fill =
        coloring === "blocks"
          ? blockColor(Math.floor(i / B), graph.n, labelMode)
          : labelMode
            ? palette.labelVertexFill
            : palette.cayleyStroke;
      const fillOpacity = coloring === "blocks" ? bandAlpha : labelMode ? 0.95 : edgeAlpha;
      parts.push(
        `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${dotRadius.toFixed(
          2
        )}" fill="${fill}" fill-opacity="${fillOpacity}"/>`
      );
    }
    if (labelMode) {
      const fs = vertexLabelFontSize(total);
      for (let i = 0; i < total; i++) {
        const [x, y] = pos(i);
        parts.push(
          `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="${fs}" text-anchor="middle" dominant-baseline="middle" fill="${palette.labelFill}">${vertexLabel(path[i])}</text>`
        );
      }
    }
  }

  if (supportsSymmetry(graph)) {
    const geom = { n: graph.n, total, c, r, scale };
    if (settings.showFundamentalDomain)
      parts.push(fundamentalDomainSVG(geom, settings, palette));
    if (settings.showSymmetryAxes) parts.push(symmetryAxesSVG(geom, palette));
    if (settings.showDihedralAxes) parts.push(dihedralOverlaySVG(geom, palette));
    if (settings.showVertexOrbit)
      parts.push(
        vertexOrbitSVG(
          geom,
          settings,
          palette,
          graph.edges,
          graph.path.length > 0 ? (i) => permLetters(graph.path[i]) : makeZaksWordOf(n)
        )
      );
  }

  parts.push("</svg>");
  return parts.join("");
}

/* ------------------------------- symmetry --------------------------------- */

/**
 * Presets whose layout has the exact Dₙ symmetry that the Symmetry renderer can
 * exploit. This is intentionally limited to the greedy Pancake Zaks layout.
 */
export function supportsSymmetry(graph: Pick<PancakeGraph, "preset">): boolean {
  return graph.preset === "pancake-zaks";
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

  const coloring: SymmetryColoring = settings.symmetryColoring ?? "parity";
  const halfTurns = n % 2 === 0 ? n / 2 : 0;
  // Fundamental-domain classification of an edge (i < j, i < B): returns
  // "full" (rotate n), "half" (antipodal diameter, rotate n/2) or null (the
  // non-canonical sibling / outside block 0, skipped).
  const domainClass = (i: number, j: number): "full" | "half" | null => {
    if (i >= B) return null;
    if (j < B) return "full";
    const v = j % B;
    if (i < v) return "full";
    if (i === v && halfTurns) return "half";
    return null;
  };

  if (
    settings.showCayley &&
    edges.length > 0 &&
    (coloring === "orbit" || coloring === "dihedral")
  ) {
    const hidden = hiddenGeneratorSet(settings.hiddenGenerators);
    const keyToIdx = new Map<number, number>();
    let next = 0;
    for (let t = 0; t < edges.length; t += 3) {
      const i = edges[t];
      const j = edges[t + 1];
      const cls = domainClass(i, j);
      if (!cls) continue;
      const code =
        coloring === "dihedral"
          ? canonicalDihedralCode(i, j, n, total, B)
          : canonicalOrbitCode(i, j, n, total, B);
      let idx = keyToIdx.get(code);
      if (idx === undefined) {
        idx = next++;
        keyToIdx.set(code, idx);
      }
      if (hidden && hidden.has(edges[t + 2])) continue;
      emitFragment(seg(i, j), orbitColor(idx), cls === "half" ? halfTurns : n);
    }
  } else if (settings.showCayley && edges.length > 0 && coloring === "blocks") {
    const hidden = hiddenGeneratorSet(settings.hiddenGenerators);
    let within = "";
    let betweenFull = "";
    let betweenHalf = "";
    for (let t = 0; t < edges.length; t += 3) {
      const i = edges[t];
      const j = edges[t + 1];
      const cls = domainClass(i, j);
      if (!cls) continue;
      if (hidden && hidden.has(edges[t + 2])) continue;
      if (edges[t + 2] < n) within += seg(i, j);
      else if (cls === "half") betweenHalf += seg(i, j);
      else betweenFull += seg(i, j);
    }
    emitFragment(within, palette.blockWithinStroke, n);
    emitFragment(betweenFull, palette.blockBetweenStroke, n);
    emitFragment(betweenHalf, palette.blockBetweenStroke, halfTurns);
  } else if (settings.showCayley && edges.length > 0) {
    const passes = parityPasses(settings.parityMode, graph, palette);
    const hidden = hiddenGeneratorSet(settings.hiddenGenerators);

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
        const cls = domainClass(i, j);
        if (cls === "full") dFull += seg(i, j);
        else if (cls === "half") dHalf += seg(i, j);
      }
      emitFragment(dFull, pass.color, n);
      emitFragment(dHalf, pass.color, halfTurns);
    }
  }

  const labelMode = settings.showLabels && supportsVertexLabels(graph);

  // Vertices: block-0 dots reused via rotation, same as the edges.
  if (settings.showVertices) {
    const dotRadius = Math.max(0.5, k.vertexRadius);
    let dots = "";
    for (let i = 0; i < B; i++) {
      const [x, y] = point(i, total, c, r);
      dots += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${dotRadius.toFixed(
        2
      )}"/>`;
    }
    if (dots.length > 0) {
      const id = `s${fragId++}`;
      defs.push(`<g id="${id}">${dots}</g>`);
      if (coloring === "blocks") {
        const bandAlpha = labelMode ? 0.95 : Math.max(0.4, Math.min(0.95, edgeAlpha * 1.8));
        for (let s = 0; s < n; s++) {
          uses.push(
            `<use href="#${id}" fill="${blockColor(s, n, labelMode)}" fill-opacity="${bandAlpha}"${rotate(s)}/>`
          );
        }
      } else {
        const dotFill = labelMode ? palette.labelVertexFill : palette.cayleyStroke;
        const dotOpacity = labelMode ? 0.95 : edgeAlpha;
        for (let s = 0; s < n; s++) {
          uses.push(
            `<use href="#${id}" fill="${dotFill}" fill-opacity="${dotOpacity}"${rotate(s)}/>`
          );
        }
      }
    }
  }

  if (defs.length > 0) {
    parts.push(`<defs>${defs.join("")}</defs>`);
    parts.push(uses.join(""));
  }

  if (
    settings.showFundamentalDomain ||
    settings.showSymmetryAxes ||
    settings.showDihedralAxes ||
    settings.showVertexOrbit
  ) {
    const geom = { n, total, c, r, scale };
    if (settings.showFundamentalDomain)
      parts.push(fundamentalDomainSVG(geom, settings, palette));
    if (settings.showSymmetryAxes) parts.push(symmetryAxesSVG(geom, palette));
    if (settings.showDihedralAxes) parts.push(dihedralOverlaySVG(geom, palette));
    if (settings.showVertexOrbit)
      parts.push(
        vertexOrbitSVG(
          geom,
          settings,
          palette,
          graph.edges,
          graph.path.length > 0 ? (i) => permLetters(graph.path[i]) : makeZaksWordOf(n)
        )
      );
  }

  if (labelMode) {
    const fs = vertexLabelFontSize(total);
    const labelOf =
      graph.path.length > 0 ? (i: number) => vertexLabel(graph.path[i]) : makeZaksLabelOf(n);
    for (let i = 0; i < total; i++) {
      const [x, y] = point(i, total, c, r);
      parts.push(
        `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="${fs}" text-anchor="middle" dominant-baseline="middle" fill="${palette.labelFill}">${labelOf(i)}</text>`
      );
    }
  }

  parts.push("</svg>");
  return parts.join("");
}

/**
 * Symmetry SVG for the pancake-zaks layout generated straight from the
 * recursive / rotational structure — no full O(n!) graph required. It reads
 * only `graph.n`: the fundamental sector (block 0, (n-1)! vertices) and its
 * edges are enumerated via `forEachZaksFundamentalEdge`, then folded with n
 * rotated `<use>` elements, exactly as `toSymmetrySVG` does, but in O((n-1)!)
 * instead of scanning every edge.
 *
 * The emitted geometry is byte-for-byte identical to `toSymmetrySVG` for the
 * pancake-zaks preset (same edge order, same fundamental-domain rule), so it is
 * a drop-in replacement that simply avoids materializing the n! graph.
 */
export function toZaksSymmetrySVG(opts: SvgOpts): string {
  const { graph, settings, size, palette = DEFAULT_PALETTE } = opts;
  const n = graph.n;
  const total = factorial(n);
  const B = factorial(n - 1);
  const c = size / 2;
  const r = size * 0.405;
  const scale = size / 1000;

  const k = constantsFor(n, scale);
  const edgeAlpha = sliderToEdgeAlpha(settings.alpha);
  const edgeWidth = sliderToEdgeWidth(settings.width) * scale;
  const halfTurns = n % 2 === 0 ? n / 2 : 0;
  const fundamentalOnly = settings.zaksFundamentalOnly ?? false;
  const fundamentalVertexCount = fundamentalOnly ? Math.max(1, Math.floor(B / 2)) : B;

  const rotate = (steps: number): string =>
    steps === 0
      ? ""
      : ` transform="rotate(${((360 / n) * steps).toFixed(4)} ${c} ${c})"`;
  const seg = (i: number, j: number): string => {
    if (fundamentalOnly) {
      const clipped = zaksFundamentalSegmentXY(i, j, total, n, c, c, r);
      if (!clipped) return "";
      const [ax, ay, bx, by] = clipped;
      return `M${ax.toFixed(2)},${ay.toFixed(2)}L${bx.toFixed(2)},${by.toFixed(2)}`;
    }
    const [ax, ay] = point(i, total, c, r);
    const [bx, by] = point(j, total, c, r);
    return `M${ax.toFixed(2)},${ay.toFixed(2)}L${bx.toFixed(2)},${by.toFixed(2)}`;
  };

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`
  );
  parts.push(`<rect width="100%" height="100%" fill="${palette.background}"/>`);

  if (settings.showCycle) {
    const cyclePath = fundamentalOnly
      ? (() => {
          const a0 = dihedralOffset(total);
          const a1 = a0 + Math.PI / n;
          const x0 = c + r * Math.cos(a0);
          const y0 = c + r * Math.sin(a0);
          const x1 = c + r * Math.cos(a1);
          const y1 = c + r * Math.sin(a1);
          return `<path d="M${x0.toFixed(2)},${y0.toFixed(2)}A${r.toFixed(
            2
          )},${r.toFixed(2)} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(
            2
          )}" fill="none" stroke="${palette.cayleyStroke}" stroke-width="${k.cycleWidth}" stroke-opacity="${edgeAlpha}"/>`;
        })()
      : null;
    parts.push(
      cyclePath ??
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
    const copies = fundamentalOnly ? 1 : repeats;
    for (let s = 0; s < copies; s++) uses.push(`<use href="#${id}"${rotate(s)}/>`);
  };

  const coloring: SymmetryColoring = settings.symmetryColoring ?? "parity";

  if (settings.showCayley && (coloring === "orbit" || coloring === "dihedral")) {
    // One hue per orbit. "orbit": each Cₙ class its own fragment; "dihedral":
    // ω-related classes share a hue. Each fragment's n (or n/2) rotated copies
    // inherit the color.
    const hidden = hiddenGeneratorSet(settings.hiddenGenerators);
    const qmap = orbitIndexMap(n, coloring);
    forEachZaksFundamentalEdge(n, (e) => {
      if (fundamentalOnly && e.gen < n) return;
      const color = orbitColor(qmap.get(canonicalOrbitCode(e.i, e.j, n, total, B)) ?? 0);
      if (hidden && hidden.has(e.gen)) return;
      emitFragment(seg(e.i, e.j), color, e.half ? halfTurns : n);
    });
  } else if (settings.showCayley && coloring === "blocks") {
    // Two chord families: short within-block reversals vs the long rₙ skeleton.
    const hidden = hiddenGeneratorSet(settings.hiddenGenerators);
    let within = "";
    let betweenFull = "";
    let betweenHalf = "";
    forEachZaksFundamentalEdge(n, (e) => {
      if (fundamentalOnly && e.gen < n) return;
      if (hidden && hidden.has(e.gen)) return;
      if (e.gen < n) within += seg(e.i, e.j);
      else if (e.half) betweenHalf += seg(e.i, e.j);
      else betweenFull += seg(e.i, e.j);
    });
    emitFragment(within, palette.blockWithinStroke, n);
    emitFragment(betweenFull, palette.blockBetweenStroke, n);
    emitFragment(betweenHalf, palette.blockBetweenStroke, halfTurns);
  } else if (settings.showCayley) {
    const hidden = hiddenGeneratorSet(settings.hiddenGenerators);
    // Parity buckets mirror parityPasses: "off" → one neutral bucket; "even"/
    // "odd" → that bucket only; "both" → both, ordered by total edge count so
    // the majority parity is drawn first (matching the scan-based renderer).
    type Bucket = { color: string; full: string; half: string };
    const mode = settings.parityMode;
    const neutral: Bucket = { color: palette.cayleyStroke, full: "", half: "" };
    const evenB: Bucket = { color: palette.cayleyEvenStroke, full: "", half: "" };
    const oddB: Bucket = { color: palette.cayleyOddStroke, full: "", half: "" };
    let evenWeight = 0;
    let oddWeight = 0;

    forEachZaksFundamentalEdge(n, (e) => {
      if (fundamentalOnly && e.gen < n) return;
      // Pass-order weights track every edge (hidden or not), matching how the
      // full build's even/odd counts are computed before render-time hiding.
      const orbit = e.half ? n / 2 : n;
      if (e.parityXor === 0) evenWeight += orbit;
      else oddWeight += orbit;
      if (hidden && hidden.has(e.gen)) return;
      let bucket: Bucket | null;
      if (mode === "off") bucket = neutral;
      else if (mode === "even") bucket = e.parityXor === 0 ? evenB : null;
      else if (mode === "odd") bucket = e.parityXor === 1 ? oddB : null;
      else bucket = e.parityXor === 0 ? evenB : oddB;
      if (!bucket) return;
      if (e.half) bucket.half += seg(e.i, e.j);
      else bucket.full += seg(e.i, e.j);
    });

    const order: Bucket[] =
      mode === "off"
        ? [neutral]
        : mode === "even"
          ? [evenB]
          : mode === "odd"
            ? [oddB]
            : evenWeight >= oddWeight
              ? [evenB, oddB]
              : [oddB, evenB];
    for (const bucket of order) {
      emitFragment(bucket.full, bucket.color, n);
      emitFragment(bucket.half, bucket.color, halfTurns);
    }
  }

  const labelMode = settings.showLabels && n <= VERTEX_LABEL_MAX_N;

  if (settings.showVertices) {
    const dotRadius = Math.max(0.5, k.vertexRadius);
    let dots = "";
    for (let i = 0; i < fundamentalVertexCount; i++) {
      const [x, y] = fundamentalOnly
        ? zaksFundamentalPointXY(i, total, n, c, c, r)
        : point(i, total, c, r);
      dots += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${dotRadius.toFixed(
        2
      )}"/>`;
    }
    if (dots.length > 0) {
      const id = `s${fragId++}`;
      defs.push(`<g id="${id}">${dots}</g>`);
      if (coloring === "blocks") {
        // Band the dots: rotation s carries the ρ-block's hue.
        const bandAlpha = labelMode ? 0.95 : Math.max(0.4, Math.min(0.95, edgeAlpha * 1.8));
        const copies = fundamentalOnly ? 1 : n;
        for (let s = 0; s < copies; s++) {
          uses.push(
            `<use href="#${id}" fill="${blockColor(s, n, labelMode)}" fill-opacity="${bandAlpha}"${rotate(s)}/>`
          );
        }
      } else {
        const dotFill = labelMode ? palette.labelVertexFill : palette.cayleyStroke;
        const dotOpacity = labelMode ? 0.95 : edgeAlpha;
        const copies = fundamentalOnly ? 1 : n;
        for (let s = 0; s < copies; s++) {
          uses.push(
            `<use href="#${id}" fill="${dotFill}" fill-opacity="${dotOpacity}"${rotate(s)}/>`
          );
        }
      }
    }
  }

  if (defs.length > 0) {
    parts.push(`<defs>${defs.join("")}</defs>`);
    parts.push(uses.join(""));
  }

  if (
    (!fundamentalOnly && settings.showFundamentalDomain) ||
    (!fundamentalOnly && settings.showSymmetryAxes) ||
    (!fundamentalOnly && settings.showDihedralAxes) ||
    settings.showVertexOrbit
  ) {
    const geom = { n, total, c, r, scale };
    if (!fundamentalOnly && settings.showFundamentalDomain)
      parts.push(fundamentalDomainSVG(geom, settings, palette));
    if (!fundamentalOnly && settings.showSymmetryAxes)
      parts.push(symmetryAxesSVG(geom, palette));
    if (!fundamentalOnly && settings.showDihedralAxes)
      parts.push(dihedralOverlaySVG(geom, palette));
    if (settings.showVertexOrbit)
      parts.push(
        vertexOrbitSVG(
          geom,
          settings,
          palette,
          graph.edges,
          graph.path.length > 0 ? (i) => permLetters(graph.path[i]) : makeZaksWordOf(n)
        )
      );
  }

  if (fundamentalOnly) {
    const a0 = dihedralOffset(total);
    const a1 = a0 + Math.PI / n;
    const x0 = c + r * Math.cos(a0);
    const y0 = c + r * Math.sin(a0);
    const x1 = c + r * Math.cos(a1);
    const y1 = c + r * Math.sin(a1);
    parts.push(
      `<path d="M${c},${c}L${x0.toFixed(2)},${y0.toFixed(2)}A${r.toFixed(
        2
      )},${r.toFixed(2)} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(
        2
      )}Z" fill="none" stroke="${palette.dihedralSector}" stroke-width="${Math.max(
        1.2,
        1.4 * scale
      )}" stroke-opacity="0.9"/>`
    );
  }

  if (labelMode) {
    const fs = vertexLabelFontSize(total);
    const labelOf = makeZaksLabelOf(n);
    const labelCount = fundamentalOnly ? fundamentalVertexCount : total;
    for (let i = 0; i < labelCount; i++) {
      const [x, y] = fundamentalOnly
        ? zaksFundamentalPointXY(i, total, n, c, c, r)
        : point(i, total, c, r);
      parts.push(
        `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="${fs}" text-anchor="middle" dominant-baseline="middle" fill="${palette.labelFill}">${labelOf(i)}</text>`
      );
    }
  }

  parts.push("</svg>");
  return parts.join("");
}

/* ------------------------------ sampled lines ----------------------------- */

export interface SampledLinesResult {
  svg: string;
  /** Number of line segments actually drawn (after any viewport culling). */
  lines: number;
  /** Number of accepted representative draws (with replacement, may repeat). */
  representatives: number;
  /** Number of *distinct* representatives obtained (deduplicated). */
  distinctRepresentatives: number;
  /** True when a zoom window filtered the sample (rejection sampling). */
  culled: boolean;
}

export interface SampledLinesSvgOpts {
  n: number;
  settings: RenderSettings;
  size: number;
  palette?: Palette;
  /**
   * Captured zoom/pan window (unit-disk coords), exactly like the Yankelovich
   * field viewport. When set to a non-full window, sampling is rejection-based:
   * only chords whose dihedral copies fall inside the window are drawn, so the
   * line budget concentrates on the visible region instead of magnifying a
   * sparse global sample.
   */
  viewport?: YankelovichFieldViewport | null;
}

/**
 * Line-drawing counterpart of the Yankelovich density field: instead of
 * accumulating chord density into a grid, it draws the rₙ matching as actual
 * line segments, crisp at any zoom (vector output).
 *
 * It uses the exact same scheme as the Yankelovich sampler so the picture has
 * the same Dₙ-symmetric coverage and structure: it samples representatives from
 * the fundamental angular sector ([0, (n-1)!/2), the precision-safe index range)
 * and draws each sampled chord together with its n rotations and their ω
 * mirrors — so the rotational symmetry stays crisp even though, past n ≈ 18, the
 * factorial constants exceed 2⁵³ and the per-chord endpoints carry some
 * floating-point noise (the same limit the density field lives with).
 *
 * `yankelovichSampleCount` is interpreted as the target number of *drawn* lines;
 * representatives = count / (2n). The whole sample is one `<path>` (a single DOM
 * node), so even large counts stay light and scale through the viewBox.
 */
export function toSampledLinesSVG(opts: SampledLinesSvgOpts): SampledLinesResult {
  const { n, settings, size, palette = DEFAULT_PALETTE } = opts;
  const total = factorial(n);
  const c = size / 2;
  const r = size * 0.405;
  const scale = size / 1000;
  const edgeAlpha = sliderToEdgeAlpha(settings.alpha);
  const edgeWidth = sliderToEdgeWidth(settings.width) * scale;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`
  );
  parts.push(`<rect width="100%" height="100%" fill="${palette.background}"/>`);
  if (settings.showCycle) {
    parts.push(
      `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${palette.cayleyStroke}" stroke-width="${scale.toFixed(2)}" stroke-opacity="${edgeAlpha}"/>`
    );
  }

  const hidden = hiddenGeneratorSet(settings.hiddenGenerators);
  let lines = 0;
  let representatives = 0;
  let distinctRepresentatives = 0;
  let culled = false;
  // The full reversal rₙ is the only generator drawn by the sample; if the user
  // hid it there are no chords to render.
  if (!(hidden && hidden.has(n))) {
    const sectorVertices = Math.max(1, Math.floor(factorial(n - 1) / 2));
    const targetReps = Math.max(
      1,
      Math.min(sectorVertices, Math.round(settings.sampledRepCount ?? 1000))
    );
    const vp = normalizeYankelovichViewport(opts.viewport);
    const full = isFullYankelovichViewport(vp);
    culled = !full;
    // Sampling is WITHOUT replacement (a Set rejects repeats), so the requested
    // number of *distinct* representatives is actually reached — with replacement
    // and only `targetReps` draws, the coupon-collector effect leaves ~1−1/e ≈
    // 63% distinct. When the target reaches the whole sector we enumerate it
    // deterministically (every representative, stable across redraws).
    const enumerateAll = targetReps >= sectorVertices;
    // When culling to a zoom window, some representatives have no visible copy,
    // so allow extra attempts to reach the target count (capped).
    const maxAttempts = enumerateAll
      ? sectorVertices
      : full
        ? Math.min(2_000_000, Math.max(targetReps, targetReps * 20))
        : Math.min(2_000_000, Math.max(targetReps, sectorVertices, targetReps * 200));
    const seed = (settings.yankelovichSampleSeed ?? 0) || 1;
    const rng = makeYankelovichRng(seed);
    const q = new Uint8Array(n);
    const delta = (2 * Math.PI) / total;
    const isVisible = (a: number, b: number): boolean =>
      full ||
      segmentIntersectsYankelovichViewport(
        vp,
        Math.cos(a),
        Math.sin(a),
        Math.cos(b),
        Math.sin(b)
      );
    // Each chord is a SEPARATE <line> element (not one merged <path>): a single
    // path strokes its union once at a flat opacity, so overlaps would NOT
    // accumulate and the disk would read as a uniform wash. Separate elements
    // composite over one another, so dense overlaps darken — that accumulation
    // is the density the caustics live in.
    const seg = (a: number, b: number): string =>
      `<line x1="${(c + r * Math.cos(a)).toFixed(2)}" y1="${(c + r * Math.sin(a)).toFixed(2)}" x2="${(c + r * Math.cos(b)).toFixed(2)}" y2="${(c + r * Math.sin(b)).toFixed(2)}"/>`;
    let d = "";
    let accepted = 0;
    let emitted = 0;
    const seen = new Set<number>();
    for (let attempts = 0; attempts < maxAttempts && accepted < targetReps; attempts++) {
      const i = enumerateAll ? attempts : Math.floor(rng() * sectorVertices);
      if (!enumerateAll) {
        if (seen.has(i)) continue; // without replacement: skip repeats
        seen.add(i);
      }
      const p = zaksUnrank(n, i);
      for (let t = 0; t < n; t++) q[t] = p[n - 1 - t];
      const j = zaksRank(n, q as typeof p);
      const ai = (2 * Math.PI * i) / total;
      const aj = (2 * Math.PI * j) / total;
      // The reflection ω: idx ↦ (n!-1)-idx maps an angle θ to -θ-δ.
      const mi = -ai - delta;
      const mj = -aj - delta;
      // Collect this representative's visible copies (its n rotations and their
      // ω mirrors); accept the representative only if at least one copy shows.
      let repDraw = "";
      let repCopies = 0;
      for (let k = 0; k < n; k++) {
        const rot = (2 * Math.PI * k) / n;
        const a0 = ai + rot;
        const b0 = aj + rot;
        if (isVisible(a0, b0)) {
          repDraw += seg(a0, b0);
          repCopies++;
        }
        const a1 = mi + rot;
        const b1 = mj + rot;
        if (isVisible(a1, b1)) {
          repDraw += seg(a1, b1);
          repCopies++;
        }
      }
      if (repCopies > 0) {
        d += repDraw;
        emitted += repCopies;
        accepted++;
      }
    }
    lines = emitted;
    // Indices are unique (without replacement / enumeration), so every accepted
    // representative is distinct.
    representatives = accepted;
    distinctRepresentatives = accepted;
    // Constant-exposure normalization: past a reference line count, fade the
    // stroke so the *total* ink stays roughly constant. Adding lines then
    // reveals more structure instead of saturating the disk to solid gray
    // (the Edge-strength slider still sets the overall level via edgeAlpha).
    const REF_LINES = 6000;
    const strokeOpacity =
      emitted > REF_LINES
        ? Math.max(0.004, edgeAlpha * (REF_LINES / emitted))
        : edgeAlpha;
    // Tone-map the coverage with an SVG alpha-gamma filter: exponent > 1 crushes
    // the faint, sparse background and keeps the dense overlaps, amplifying the
    // caustic contrast the way the Yankelovich density tone-map does — but on
    // the crisp vector layer, on the GPU, resolution-independently.
    const contrast = Math.max(0, Math.min(100, settings.sampledContrast ?? 0));
    const gammaA = 1 + (contrast / 100) * 6; // 1 (off) … 7
    const useTone = gammaA > 1.001;
    if (useTone) {
      parts.push(
        `<defs><filter id="scTone" x="-2%" y="-2%" width="104%" height="104%" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncA type="gamma" amplitude="1" exponent="${gammaA.toFixed(3)}" offset="0"/></feComponentTransfer></filter></defs>`
      );
    }
    // One <g> carries the shared stroke style; each child <line> composites
    // separately so overlaps accumulate into a density, then the alpha-gamma
    // filter tone-maps that density to bring out the caustics.
    parts.push(
      `<g fill="none" stroke="${palette.cayleyStroke}" stroke-width="${edgeWidth}" stroke-opacity="${strokeOpacity.toFixed(4)}" stroke-linecap="round"${useTone ? ' filter="url(#scTone)"' : ""}>${d}</g>`
    );
  }

  parts.push("</svg>");
  return {
    svg: parts.join(""),
    lines,
    representatives,
    distinctRepresentatives,
    culled,
  };
}
