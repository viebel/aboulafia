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
 * Color scheme for the Symmetry renderer, used to visualize the dihedral (Dₙ)
 * symmetry of the Zaks pancake layout (the two generators ρ: i ↦ i+(n-1)! and
 * ω: i ↦ (n!-1)-i acting on the index ring ℤ/n!):
 *   - "parity"  → the default edge coloring (by endpoint parity).
 *   - "orbit"   → one hue per Cₙ rotation orbit. The orbit of a chord {i,j} is
 *                 the n chords {i+kB, j+kB} (B = (n-1)!); the symmetry renderer
 *                 draws one representative per orbit and rotates it n times, so
 *                 giving each representative its own hue makes every color class
 *                 a clean rotated n-set — the decisive Cₙ test.
 *   - "blocks"  → band the n! dots into n arcs of (n-1)! by leading symbol (one
 *                 ρ-block / Pₙ₋₁ copy each) and split the chords into the two
 *                 superimposed families: short within-block reversals (r₂…rₙ₋₁)
 *                 and long between-block full reversals (rₙ).
 */
export type SymmetryColoring = "parity" | "orbit" | "blocks";

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
  /** Symmetry-renderer color scheme (defaults to "parity"). */
  symmetryColoring?: SymmetryColoring;
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

  ctx.save();
  ctx.setLineDash([]);

  // Shaded fundamental 360/n wedge (block 0 = one ρ-orbit fundamental domain).
  ctx.beginPath();
  ctx.moveTo(c, cy);
  ctx.arc(c, cy, r, off, off + step);
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

// Canonical-orbit-code → orbit index q, in the SAME order the Symmetry renderer
// assigns hues (forEachZaksFundamentalEdge enumeration). Sharing this map makes
// the flat Canvas/SVG orbit coloring, the Symmetry view, and the orbit table
// all agree on a hue per orbit. Cached per n (independent of any graph build).
const orbitQMapCache = new Map<number, Map<number, number>>();
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

// One color per edge (Cₙ-orbit hue), cached on the graph's edge array — a fresh
// build allocates a new Uint32Array, so identity is a safe, GC-friendly key.
// Recomputing on every zoom/pan would be wasteful (it is O(n · edges)).
const orbitColorCache = new WeakMap<Uint32Array, string[]>();

/**
 * Assign every (flat) edge the hue of its Cₙ rotation orbit, so all n members
 * get one color — the same "clean rotated n-set" the Symmetry renderer shows,
 * but for the full disk. For pancake-zaks the hue index comes from the shared
 * fundamental-edge map (so flat/symmetry/table colors match); other symmetric
 * layouts (e.g. the recursive Zaks order, whose index ring differs) fall back
 * to a first-seen ordering.
 */
function orbitColorsForGraph(graph: PancakeGraph): string[] {
  const cached = orbitColorCache.get(graph.edges);
  if (cached) return cached;
  const { n, edges, preset } = graph;
  const total = graph.path.length;
  const B = total / n;
  const numEdges = edges.length / 3;
  const colors = new Array<string>(numEdges);
  if (preset === "pancake-zaks") {
    const qmap = orbitQMapFor(n);
    for (let t = 0, e = 0; t < edges.length; t += 3, e++) {
      const code = canonicalOrbitCode(edges[t], edges[t + 1], n, total, B);
      colors[e] = orbitColor(qmap.get(code) ?? 0);
    }
  } else {
    const keyToOrbit = new Map<number, number>();
    let nextOrbit = 0;
    for (let t = 0, e = 0; t < edges.length; t += 3, e++) {
      const code = canonicalOrbitCode(edges[t], edges[t + 1], n, total, B);
      let orbit = keyToOrbit.get(code);
      if (orbit === undefined) {
        orbit = nextOrbit++;
        keyToOrbit.set(code, orbit);
      }
      colors[e] = orbitColor(orbit);
    }
  }
  orbitColorCache.set(graph.edges, colors);
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
  r: number
): ZaksSymmetryMask[] {
  const hidden = hiddenGeneratorSet(settings.hiddenGenerators);
  const halfTurns = n % 2 === 0 ? n / 2 : 0;
  const seg = (e: { i: number; j: number }): [number, number, number, number] => {
    const [ax, ay] = pointXY(e.i, total, c, cy, r);
    const [bx, by] = pointXY(e.j, total, c, cy, r);
    return [ax, ay, bx, by];
  };

  if (coloring === "orbit") {
    // One hue per orbit: each fundamental representative is its own color, and
    // the n (or n/2) rotated copies inherit it — so every color class is a
    // clean rotated n-set.
    const fullCoords: number[] = [];
    const fullColors: string[] = [];
    const halfCoords: number[] = [];
    const halfColors: string[] = [];
    let q = 0;
    forEachZaksFundamentalEdge(n, (e) => {
      const color = orbitColor(q);
      q++;
      if (hidden && hidden.has(e.gen)) return;
      const [ax, ay, bx, by] = seg(e);
      if (e.half) {
        halfCoords.push(ax, ay, bx, by);
        halfColors.push(color);
      } else {
        fullCoords.push(ax, ay, bx, by);
        fullColors.push(color);
      }
    });
    const masks: ZaksSymmetryMask[] = [
      { repeats: n, coords: Float32Array.from(fullCoords), color: null, colors: fullColors },
    ];
    if (halfTurns > 0 && halfCoords.length > 0) {
      masks.push({
        repeats: halfTurns,
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
      if (hidden && hidden.has(e.gen)) return;
      const [ax, ay, bx, by] = seg(e);
      if (e.gen < n) {
        withinFull.push(ax, ay, bx, by);
      } else if (e.half) {
        betweenHalf.push(ax, ay, bx, by);
      } else {
        betweenFull.push(ax, ay, bx, by);
      }
    });
    const masks: ZaksSymmetryMask[] = [];
    // Within-block chords first (light), then the rₙ skeleton on top (dark).
    if (withinFull.length > 0) {
      masks.push({
        repeats: n,
        coords: Float32Array.from(withinFull),
        color: palette.blockWithinStroke,
        colors: null,
      });
    }
    if (betweenFull.length > 0) {
      masks.push({
        repeats: n,
        coords: Float32Array.from(betweenFull),
        color: palette.blockBetweenStroke,
        colors: null,
      });
    }
    if (halfTurns > 0 && betweenHalf.length > 0) {
      masks.push({
        repeats: halfTurns,
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
    const [ax, ay, bx, by] = seg(e);
    if (e.half) half.push(ax, ay, bx, by);
    else full.push(ax, ay, bx, by);
  });
  const mk = (color: string, f: number[], hh: number[]): ZaksSymmetryMask[] => {
    const out: ZaksSymmetryMask[] = [];
    if (f.length > 0) out.push({ repeats: n, coords: Float32Array.from(f), color, colors: null });
    if (halfTurns > 0 && hh.length > 0) {
      out.push({ repeats: halfTurns, coords: Float32Array.from(hh), color, colors: null });
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
  const parts: string[] = [];

  const wx0 = c + r * Math.cos(off);
  const wy0 = c + r * Math.sin(off);
  const wx1 = c + r * Math.cos(off + step);
  const wy1 = c + r * Math.sin(off + step);
  const large = step > Math.PI ? 1 : 0;
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
  // Orbit/blocks coloring applies only to the Zaks layouts and only in line
  // mode (the density binning has no per-edge identity to color).
  const coloring =
    settings.edgeMode === "density" ? null : dihedralColoring(graph, settings);

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
    } else if (coloring) {
      // Group edges by color and stroke one path per color, so overlaps within
      // a color composite once (no darkening) and the orbit count never makes
      // this a per-edge stroke storm.
      const groups = new Map<string, number[]>();
      const orbitColors = coloring === "orbit" ? orbitColorsForGraph(graph) : null;
      for (let t = 0, e = 0; t < edges.length; t += 3, e++) {
        if (hidden && hidden.has(edges[t + 2])) continue;
        const color =
          coloring === "orbit"
            ? orbitColors![e]
            : edges[t + 2] < graph.n
              ? palette.blockWithinStroke
              : palette.blockBetweenStroke;
        let arr = groups.get(color);
        if (!arr) {
          arr = [];
          groups.set(color, arr);
        }
        const [ax, ay] = pointXY(edges[t], total, c, cy, r);
        const [bx, by] = pointXY(edges[t + 1], total, c, cy, r);
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
    const dotRadius = Math.max(0.5, k.vertexRadius);
    const labelMode = settings.showLabels && n <= 5;
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
        const [x, y] = pointXY(i, total, c, cy, r);
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
        const [x, y] = pointXY(i, total, c, cy, r);
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
  }

  if (settings.showLabels && n <= 5) {
    // Index labels: the position i on the Zaks ring (what ρ and ω act on).
    ctx.fillStyle = palette.labelFill;
    ctx.font = `${(total <= 24 ? 12 : 6) * dpr}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < total; i++) {
      const [x, y] = pointXY(i, total, c, cy, r);
      ctx.fillText(String(i), x, y);
    }
  }

  if (settings.edgeMode !== "density" && supportsSymmetry(graph)) {
    const geom = { n: graph.n, total, c, cy, r, scale };
    if (settings.showFundamentalDomain)
      drawFundamentalDomainToCanvas(ctx, geom, settings, palette);
    if (settings.showSymmetryAxes) drawSymmetryAxesToCanvas(ctx, geom, palette);
    if (settings.showDihedralAxes) drawDihedralOverlayToCanvas(ctx, geom, palette);
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
  const cy = size / 2 + (h - size) / 2;
  const r = size * 0.405;
  const scale = size / 1000;
  const k = constantsFor(n, scale);
  const edgeAlpha = sliderToEdgeAlpha(settings.alpha);
  const edgeWidth = sliderToEdgeWidth(settings.width) * scale;
  const step = (2 * Math.PI) / n;
  ctx.lineCap = "round";

  if (settings.showCycle) {
    ctx.beginPath();
    ctx.arc(c, cy, r, 0, 2 * Math.PI);
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
  const key = `${n}|${w}x${h}|${coloring}|${settings.parityMode}|${hiddenKey}`;
  let sectors = cache?.current && cache.current.key === key ? cache.current : null;
  if (!sectors) {
    const masks = buildSectorMasks(n, coloring, settings, palette, total, c, cy, r);
    const vertices =
      settings.showVertices && total <= SYMMETRY_VERTEX_LIMIT
        ? (() => {
            const v = new Float32Array(B * 2);
            for (let i = 0; i < B; i++) {
              const [x, y] = pointXY(i, total, c, cy, r);
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

  if (settings.showVertices && sectors.vertices.length > 0) {
    const dotRadius = Math.max(0.5, k.vertexRadius);
    const verts = sectors.vertices;
    const labelMode = settings.showLabels && n <= 5;
    // Banded dots (blocks mode) need to read at any edge alpha, so they get a
    // boosted opacity floor; plain dots stay at the edge alpha.
    const bandAlpha = labelMode ? 0.95 : Math.max(0.4, Math.min(0.95, edgeAlpha * 1.8));
    const plainFill = labelMode
      ? withAlpha(palette.labelVertexFill, 0.95)
      : withAlpha(palette.cayleyStroke, edgeAlpha);
    for (let s = 0; s < n; s++) {
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
    settings.showFundamentalDomain ||
    settings.showSymmetryAxes ||
    settings.showDihedralAxes
  ) {
    const geom = { n, total, c, cy, r, scale };
    if (settings.showFundamentalDomain)
      drawFundamentalDomainToCanvas(ctx, geom, settings, palette);
    if (settings.showSymmetryAxes) drawSymmetryAxesToCanvas(ctx, geom, palette);
    if (settings.showDihedralAxes) drawDihedralOverlayToCanvas(ctx, geom, palette);
  }

  if (settings.showLabels && n <= 5) {
    // Index labels: the position i on the Zaks ring (what ρ and ω act on).
    ctx.fillStyle = palette.labelFill;
    ctx.font = `${(total <= 24 ? 12 : 6) * dpr}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < total; i++) {
      const [x, y] = pointXY(i, total, c, cy, r);
      ctx.fillText(String(i), x, y);
    }
  }

  ctx.restore();
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

  const coloring = dihedralColoring(graph, settings);

  if (settings.showCayley && edges.length > 0 && coloring) {
    // Group chords by color (one <path> per color) so overlaps within a color
    // composite once, mirroring the canvas renderer.
    const hidden = hiddenGeneratorSet(settings.hiddenGenerators);
    const orbitColors = coloring === "orbit" ? orbitColorsForGraph(graph) : null;
    const groups = new Map<string, string>();
    for (let t = 0, e = 0; t < edges.length; t += 3, e++) {
      if (hidden && hidden.has(edges[t + 2])) continue;
      const color =
        coloring === "orbit"
          ? orbitColors![e]
          : edges[t + 2] < graph.n
            ? palette.blockWithinStroke
            : palette.blockBetweenStroke;
      const [ax, ay] = point(edges[t], total, c, r);
      const [bx, by] = point(edges[t + 1], total, c, r);
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
    const labelMode = settings.showLabels && n <= 5;
    const bandAlpha = labelMode ? 0.95 : Math.max(0.4, Math.min(0.95, edgeAlpha * 1.8));
    const B = total / graph.n;
    for (let i = 0; i < total; i++) {
      const [x, y] = point(i, total, c, r);
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
    if (settings.showLabels && n <= 5) {
      const fs = total <= 24 ? 12 : 6;
      for (let i = 0; i < total; i++) {
        const [x, y] = point(i, total, c, r);
        parts.push(
          `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="${fs}" text-anchor="middle" dominant-baseline="middle" fill="${palette.labelFill}">${i}</text>`
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

  if (settings.showCayley && edges.length > 0 && coloring === "orbit") {
    const hidden = hiddenGeneratorSet(settings.hiddenGenerators);
    let q = 0;
    for (let t = 0; t < edges.length; t += 3) {
      const i = edges[t];
      const j = edges[t + 1];
      const cls = domainClass(i, j);
      if (!cls) continue;
      const color = orbitColor(q);
      q++;
      if (hidden && hidden.has(edges[t + 2])) continue;
      emitFragment(seg(i, j), color, cls === "half" ? halfTurns : n);
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
      const labelMode = settings.showLabels && n <= 5;
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
    settings.showDihedralAxes
  ) {
    const geom = { n, total, c, r, scale };
    if (settings.showFundamentalDomain)
      parts.push(fundamentalDomainSVG(geom, settings, palette));
    if (settings.showSymmetryAxes) parts.push(symmetryAxesSVG(geom, palette));
    if (settings.showDihedralAxes) parts.push(dihedralOverlaySVG(geom, palette));
  }

  // Index labels (only legible for tiny n): the position i on the Zaks ring.
  if (settings.showLabels && n <= 5) {
    const fs = total <= 24 ? 12 : 6;
    for (let i = 0; i < total; i++) {
      const [x, y] = point(i, total, c, r);
      parts.push(
        `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="${fs}" text-anchor="middle" dominant-baseline="middle" fill="${palette.labelFill}">${i}</text>`
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

  if (settings.showCayley && coloring === "orbit") {
    // One hue per Cₙ orbit: each fundamental representative is its own fragment,
    // and its n (or n/2) rotated copies inherit the hue.
    const hidden = hiddenGeneratorSet(settings.hiddenGenerators);
    let q = 0;
    forEachZaksFundamentalEdge(n, (e) => {
      const color = orbitColor(q);
      q++;
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
      const labelMode = settings.showLabels && n <= 5;
      if (coloring === "blocks") {
        // Band the dots: rotation s carries the ρ-block's hue.
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
    settings.showDihedralAxes
  ) {
    const geom = { n, total, c, r, scale };
    if (settings.showFundamentalDomain)
      parts.push(fundamentalDomainSVG(geom, settings, palette));
    if (settings.showSymmetryAxes) parts.push(symmetryAxesSVG(geom, palette));
    if (settings.showDihedralAxes) parts.push(dihedralOverlaySVG(geom, palette));
  }

  // Index labels (only emitted for tiny n): the position i on the Zaks ring,
  // i.e. the value the generators ρ and ω act on.
  if (settings.showLabels && n <= 5) {
    const fs = total <= 24 ? 12 : 6;
    for (let i = 0; i < total; i++) {
      const [x, y] = point(i, total, c, r);
      parts.push(
        `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="${fs}" text-anchor="middle" dominant-baseline="middle" fill="${palette.labelFill}">${i}</text>`
      );
    }
  }

  parts.push("</svg>");
  return parts.join("");
}
