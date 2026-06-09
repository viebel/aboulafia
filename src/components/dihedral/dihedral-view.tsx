"use client";

import { Button } from "@/components/ui/button";
import { factorial, zaksSigma } from "@/lib/pancake";
import { readEnumParam, readNonNegIntParam, writeUrlParams } from "@/lib/url-state";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const N_MIN = 4;
const MIN_ZOOM = 0.5;
const ZOOM_FACTOR = 1.5;

type Mode =
  | "full"
  | "wedge"
  | "rotate"
  | "choose"
  | "isolate"
  | "reflect"
  | "connect";
interface Step {
  n: number;
  mode: Mode;
  rotationStep?: number;
}

type ChoiceMode = "zaks" | "random";
const CHOICE_MODES = ["zaks", "random"] as const;

// Unbounded sequence: index 0 is the starting circle, then for each n >= N_MIN:
// make one block, rotate it n times, choose one Zaks edge per dihedral orbit,
// add its mirror, then add the remaining rotations.
function stepAt(index: number): Step {
  if (index <= 0) return { n: N_MIN, mode: "full" };
  let remaining = index - 1;
  let n = N_MIN;

  for (;;) {
    const stepsForN = n + 4; // 5 fixed steps + (n - 1) rotation steps.
    if (remaining < stepsForN) break;
    remaining -= stepsForN;
    n++;
  }

  if (remaining === 0) return { n, mode: "wedge" };
  if (remaining === 1) return { n, mode: "rotate" };
  if (remaining === 2) return { n, mode: "choose" };
  if (remaining === 3) return { n, mode: "isolate" };
  if (remaining === 4) return { n, mode: "reflect" };

  return { n, mode: "connect", rotationStep: remaining - 4 };
}

const CX = 350;
const CY = 350;
const SVG_SIZE = 700;
const R = 320;
const WEDGE_DISPLAY_START_DEG = -30;
const WEDGE_DISPLAY_ARC_DEG = 240;

const COLOR = {
  cycle: "#64748b",
  primaryCycle: "#4f46e5",
  zaksChoice: "#f97316",
  zaksReflection: "#10b981",
  zaksRotation: "#a855f7",
  vertex: "#ffffff",
  vertexStroke: "#334155",
  primaryVertexStroke: "#4f46e5",
  zaksChoiceVertexStroke: "#f97316",
  zaksReflectionVertexStroke: "#10b981",
  zaksRotationVertexStroke: "#a855f7",
  axis: "#0891b2",
  guide: "var(--border)",
} as const;

type EdgeKind =
  | "base"
  | "boundary"
  | "zaks"
  | "zaks-choice"
  | "zaks-reflection"
  | "zaks-rotation";

interface Edge {
  a: number;
  b: number;
  kind: EdgeKind;
}

interface Graph {
  vertexCount: number;
  edges: Edge[];
}

interface DrawnGraph {
  points: Array<[number, number]>;
  blockAngles: number[];
  edges: Edge[];
  blockSize: number;
}

function baseGraphFor(n: number): Graph {
  return zaksDemoGraph(n - 1);
}

function zaksDemoGraph(n: number): Graph {
  const total = factorial(n);
  if (n <= 3) {
    const edges: Edge[] = [];
    for (let i = 0; i < total; i++) {
      edges.push({ a: i, b: (i + 1) % total, kind: "boundary" });
    }
    return { vertexCount: total, edges: uniqueEdges(edges) };
  }

  return graphFromBlocks(zaksDemoGraph(n - 1), n, true);
}

function graphFromBlocks(
  graph: Graph,
  n: number,
  includeZaksLayer: boolean
): Graph {
  const block = graph.vertexCount;
  const total = block * n;
  const edges: Edge[] = [];

  for (let j = 0; j < n; j++) {
    const offset = j * block;
    for (const edge of graph.edges) {
      edges.push({
        a: offset + edge.a,
        b: offset + edge.b,
        kind: edge.kind,
      });
    }
    edges.push({
      a: offset + block - 1,
      b: ((j + 1) % n) * block,
      kind: "boundary",
    });
  }

  if (includeZaksLayer) {
    for (let i = 0; i < total; i++) {
      const z = zaksSigma(n, i);
      if (i < z) edges.push({ a: i, b: z, kind: "zaks" });
    }
  }

  return { vertexCount: total, edges: uniqueEdges(edges) };
}

function fullCircleGraph(): DrawnGraph {
  const graph = zaksDemoGraph(3);
  const angles = Array.from(
    { length: graph.vertexCount },
    (_, i) => (i * 360) / graph.vertexCount
  );

  return {
    points: angles.map(polar),
    blockAngles: angles,
    edges: graph.edges,
    blockSize: graph.vertexCount,
  };
}

function wedgeAngles(vertexCount: number, n: number): number[] {
  const W = 360 / n;
  return Array.from(
    { length: vertexCount },
    (_, i) => ((i + 0.5) * W) / vertexCount
  );
}

function wedgeGraph(n: number): DrawnGraph {
  const graph = baseGraphFor(n);
  const angles = wedgeAngles(graph.vertexCount, n);

  return {
    points: angles.map((a) => polar(wedgeDisplayAngle(a, n))),
    blockAngles: angles,
    edges: graph.edges,
    blockSize: graph.vertexCount,
  };
}

function rotatedGraph(n: number): DrawnGraph {
  return graphFromRotated(baseGraphFor(n), n, "none");
}

function chosenGraph(n: number, choices?: Edge[]): DrawnGraph {
  return graphFromRotated(baseGraphFor(n), n, "choice", choices);
}

function reflectedGraph(n: number, choices?: Edge[]): DrawnGraph {
  return graphFromRotated(baseGraphFor(n), n, "reflection", choices);
}

function connectedGraph(n: number, choices?: Edge[]): DrawnGraph {
  return graphFromRotated(baseGraphFor(n), n, "all", choices);
}

function graphFromRotated(
  graph: Graph,
  n: number,
  zaksLayer: "none" | "choice" | "reflection" | "all",
  choices?: Edge[]
): DrawnGraph {
  const blockAngles = wedgeAngles(graph.vertexCount, n);
  const points: Array<[number, number]> = [];
  const angles: number[] = [];
  const edges: Edge[] = [];
  const block = graph.vertexCount;
  const W = 360 / n;

  for (let j = 0; j < n; j++) {
    const offset = j * block;
    for (let i = 0; i < block; i++) {
      const angle = blockAngles[i] + j * W;
      angles.push(blockAngles[i]);
      points.push(polar(angle));
    }
    for (const edge of graph.edges) {
      edges.push({
        a: offset + edge.a,
        b: offset + edge.b,
        kind: edge.kind,
      });
    }
    edges.push({
      a: offset + block - 1,
      b: ((j + 1) % n) * block,
      kind: "boundary",
    });
  }

  if (zaksLayer !== "none") {
    edges.push(...zaksLayerEdges(n, zaksLayer, choices));
  }

  return {
    points,
    blockAngles: angles,
    edges: uniqueEdges(edges),
    blockSize: block,
  };
}

function graphFor(
  step: Step,
  choices?: Edge[]
): DrawnGraph {
  if (step.mode === "full") return fullCircleGraph();
  if (step.mode === "wedge") return wedgeGraph(step.n);
  if (step.mode === "rotate") return rotatedGraph(step.n);
  if (
    step.mode === "choose" ||
    step.mode === "isolate" ||
    step.mode === "reflect" ||
    step.mode === "connect"
  ) {
    return chosenGraph(step.n, choices);
  }
  if (step.mode === "reflect") return reflectedGraph(step.n, choices);
  return connectedGraph(step.n, choices);
}

function zaksLayerEdges(
  n: number,
  layer: "choice" | "reflection" | "all",
  choicesArg?: Edge[]
): Edge[] {
  const total = factorial(n);
  const block = factorial(n - 1);
  const matching: Edge[] = [];

  for (let i = 0; i < total; i++) {
    const z = zaksSigma(n, i);
    if (i < z) matching.push({ a: i, b: z, kind: "zaks" });
  }

  const choices = new Set((choicesArg ?? zaksChoiceEdges(n)).map((edge) => edgeKey(edge.a, edge.b)));

  const reflections = new Set<string>();
  for (const key of choices) {
    const { a, b } = parseEdgeKey(key);
    const mirror = mirrorEdgeAcrossBaseAxis(a, b, total, block);
    const mirrorKey = edgeKey(mirror.a, mirror.b);
    if (mirrorKey !== key) reflections.add(mirrorKey);
  }

  const edges: Edge[] = matching.flatMap((edge): Edge[] => {
    const key = edgeKey(edge.a, edge.b);
    if (choices.has(key)) {
      return [{ a: edge.a, b: edge.b, kind: "zaks-choice" }];
    }
    if ((layer === "reflection" || layer === "all") && reflections.has(key)) {
      return [{ a: edge.a, b: edge.b, kind: "zaks-reflection" }];
    }
    if (layer === "all") {
      return [{ a: edge.a, b: edge.b, kind: "zaks-rotation" }];
    }
    return [];
  });

  const matchingKeys = new Set(matching.map((edge) => edgeKey(edge.a, edge.b)));
  for (const edge of choicesArg ?? []) {
    const key = edgeKey(edge.a, edge.b);
    if (!matchingKeys.has(key)) {
      edges.push({ a: edge.a, b: edge.b, kind: "zaks-choice" });
    }
  }

  return uniqueEdges(edges);
}

function existingEdgeKeys(edges: Edge[]): Set<string> {
  return new Set(edges.map((edge) => edgeKey(edge.a, edge.b)));
}

function zaksChoiceEdges(n: number): Edge[] {
  const block = factorial(n - 1);
  const choiceSectorSize = block / 2;
  const edges: Edge[] = [];
  for (let i = 0; i < choiceSectorSize; i++) {
    edges.push({ a: i, b: zaksSigma(n, i), kind: "zaks-choice" });
  }
  return uniqueEdges(edges);
}

function mirrorEdgeAcrossBaseAxis(
  a: number,
  b: number,
  total: number,
  block: number
): { a: number; b: number } {
  return {
    a: mirrorIndexAcrossBaseAxis(a, total, block),
    b: mirrorIndexAcrossBaseAxis(b, total, block),
  };
}

function mirrorIndexAcrossBaseAxis(i: number, total: number, block: number): number {
  return (((block - 1 - i) % total) + total) % total;
}

function randomChoiceEdges(n: number, seed: number, forbiddenKeys: Set<string>): Edge[] {
  const total = factorial(n);
  const block = factorial(n - 1);
  const count = (block - 2) / 2;
  const seenOrbits = new Set<string>();
  const candidatesBySource = new Map<
    number,
    Array<{
    edge: Edge;
    orbit: { edges: string[]; vertices: number[] };
    orbitKey: string;
    }>
  >();

  for (let source = 1; source <= count; source++) {
    const candidates: Array<{
      edge: Edge;
      orbit: { edges: string[]; vertices: number[] };
      orbitKey: string;
    }> = [];
    for (let target = 0; target < total; target++) {
      if (target === source) continue;
      const key = edgeKey(source, target);
      if (forbiddenKeys.has(key)) continue;

      const orbit = generatedOrbit(source, target, n, total, block);
      if (orbit.edges.some((edgeKeyValue) => forbiddenKeys.has(edgeKeyValue))) {
        continue;
      }

      const orbitKey = [...orbit.edges].sort().join("|");
      if (seenOrbits.has(orbitKey)) continue;
      seenOrbits.add(orbitKey);
      candidates.push({
        edge: { a: source, b: target, kind: "zaks-choice" },
        orbit,
        orbitKey,
      });
    }
    candidatesBySource.set(source, candidates);
  }

  let best: Edge[] = [];
  const attempts = 300;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const rand = seededRandom(seed + n * 1009 + attempt * 7919);
    const edges: Edge[] = [];
    const usedOrbitEdges = new Set<string>();
    const usedChoiceVertices = new Set<number>();
    const sources = shuffle(Array.from(candidatesBySource.keys()), rand);

    for (const source of sources) {
      if (edges.length >= count) break;
      if (usedChoiceVertices.has(source)) continue;

      const candidates = shuffle(candidatesBySource.get(source) ?? [], rand);
      for (const candidate of candidates) {
        if (
          usedChoiceVertices.has(candidate.edge.a) ||
          usedChoiceVertices.has(candidate.edge.b)
        ) {
          continue;
        }
        if (candidate.orbit.edges.some((key) => usedOrbitEdges.has(key))) {
          continue;
        }

        usedChoiceVertices.add(candidate.edge.a);
        usedChoiceVertices.add(candidate.edge.b);
        for (const key of candidate.orbit.edges) usedOrbitEdges.add(key);
        edges.push(candidate.edge);
        break;
      }
    }

    if (edges.length > best.length) best = edges;
    if (best.length >= count) break;
  }

  return best;
}

function generatedOrbit(
  a: number,
  b: number,
  n: number,
  total: number,
  block: number
): { edges: string[]; vertices: number[] } {
  const edges = new Set<string>();
  const vertices = new Set<number>();
  const reflected = mirrorEdgeAcrossBaseAxis(a, b, total, block);
  const seeds = [
    { a, b },
    reflected,
  ];

  for (const seed of seeds) {
    for (let r = 0; r < n; r++) {
      const x = (seed.a + r * block) % total;
      const y = (seed.b + r * block) % total;
      edges.add(edgeKey(x, y));
      vertices.add(x);
      vertices.add(y);
    }
  }

  return { edges: [...edges], vertices: [...vertices] };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function edgeKey(a: number, b: number): string {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return `${lo}:${hi}`;
}

function parseEdgeKey(key: string): { a: number; b: number } {
  const [a, b] = key.split(":").map(Number);
  return { a, b };
}

function uniqueEdges(edges: Edge[]): Edge[] {
  const seen = new Set<string>();
  const out: Edge[] = [];

  for (const edge of edges) {
    const { a, b } = edge;
    const key = edgeKey(a, b);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ a: Math.min(a, b), b: Math.max(a, b), kind: edge.kind });
  }

  return out;
}

function edgeColor(step: Step, edge: Edge, primary: boolean): string {
  if (
    (step.mode === "choose" || step.mode === "isolate") &&
    edge.kind === "zaks-choice"
  ) {
    return COLOR.zaksChoice;
  }
  if (
    (step.mode === "reflect" || step.mode === "connect") &&
    edge.kind === "zaks-choice"
  ) {
    return COLOR.zaksChoice;
  }
  if (
    (step.mode === "reflect" || step.mode === "connect") &&
    edge.kind === "zaks-reflection"
  ) {
    return COLOR.zaksReflection;
  }
  if (step.mode === "connect" && edge.kind === "zaks-rotation") {
    return COLOR.zaksRotation;
  }
  return primary ? COLOR.primaryCycle : COLOR.cycle;
}

function isCurrentZaksEdge(step: Step, edge: Edge): boolean {
  return (
    ((step.mode === "choose" || step.mode === "isolate") &&
      edge.kind === "zaks-choice") ||
    (step.mode === "reflect" &&
      (edge.kind === "zaks-choice" || edge.kind === "zaks-reflection")) ||
    (step.mode === "connect" &&
      (edge.kind === "zaks-choice" ||
        edge.kind === "zaks-reflection" ||
        edge.kind === "zaks-rotation"))
  );
}

function isInBaseWedge(index: number, blockSize: number): boolean {
  return index >= 0 && index < blockSize;
}

function isBaseWedgeEdge(edge: Edge, blockSize: number): boolean {
  return isInBaseWedge(edge.a, blockSize) && isInBaseWedge(edge.b, blockSize);
}

function polar(angleDeg: number): [number, number] {
  const r = (angleDeg * Math.PI) / 180;
  return [roundCoord(CX + R * Math.cos(r)), roundCoord(CY - R * Math.sin(r))];
}

function rotatePoint([x, y]: [number, number], angleDeg: number): [number, number] {
  const r = (angleDeg * Math.PI) / 180;
  const dx = x - CX;
  const dy = CY - y;
  const xr = dx * Math.cos(r) - dy * Math.sin(r);
  const yr = dx * Math.sin(r) + dy * Math.cos(r);
  return [roundCoord(CX + xr), roundCoord(CY - yr)];
}

function reflectPoint([x, y]: [number, number], axisDeg: number): [number, number] {
  const r = (axisDeg * Math.PI) / 180;
  const ux = Math.cos(r);
  const uy = Math.sin(r);
  const dx = x - CX;
  const dy = CY - y;
  const dot = dx * ux + dy * uy;
  const xr = 2 * dot * ux - dx;
  const yr = 2 * dot * uy - dy;
  return [roundCoord(CX + xr), roundCoord(CY - yr)];
}

function sectorPath(startDeg: number, endDeg: number): string {
  const steps = Math.max(2, Math.ceil(Math.abs(endDeg - startDeg) / 8));
  const points: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push(polar(startDeg + (endDeg - startDeg) * t));
  }

  return `M ${CX} ${CY} L ${points.map(([x, y]) => `${x} ${y}`).join(" L ")} Z`;
}

function wedgeDisplayAngle(blockAngle: number, n: number): number {
  return WEDGE_DISPLAY_START_DEG + (blockAngle / (360 / n)) * WEDGE_DISPLAY_ARC_DEG;
}

function roundCoord(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function transitionStyle(ms = 650): React.CSSProperties {
  return {
    transition: `all ${ms}ms cubic-bezier(0.4, 0, 0.2, 1)`,
  };
}

function edgeWidth(vertexCount: number): number {
  if (vertexCount >= 1000) return 0.35;
  if (vertexCount >= 250) return 0.55;
  if (vertexCount >= 80) return 0.8;
  return 1.3;
}

function vertexRadius(vertexCount: number): number {
  if (vertexCount >= 1000) return 1.1;
  if (vertexCount >= 250) return 1.6;
  if (vertexCount >= 80) return 2.2;
  return 3.8;
}

function boundaryBridge(
  previousOriginal: Array<[number, number]>,
  nextOriginal: Array<[number, number]>,
  blockSize: number
) {
  const [x1, y1] = previousOriginal[blockSize - 1];
  const [x2, y2] = nextOriginal[0];
  return { x1, y1, x2, y2 };
}

function label(step: Step, graph: DrawnGraph): React.ReactNode {
  const { n, mode } = step;
  const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
  switch (mode) {
    case "full":
      return "Starting circle — 6 points";
    case "wedge":
      return `Wedge: 360/${n} = ${fmt(360 / n)}°`;
    case "rotate":
      return `${n} copies of the wedge`;
    case "choose":
      const found = countZaksChoices(graph);
      const expected = minimalEdgeCount(n);
      return (
        <span className="inline-flex items-center gap-2">
          <span
            className={found < expected ? "text-destructive" : undefined}
          >
            Choose {found} / {expected} minimal edges · avg{" "}
            {averageChoiceDistanceDeg(graph, n).toFixed(1)}°
            {found < expected ? " — not enough compatible edges found" : ""}:
          </span>
          <MathFraction numerator="(n−1)!−2" denominator="2" />
        </span>
      );
    case "isolate":
      return "Keep complete chosen edges";
    case "reflect":
      return "Apply 1 reflection";
    case "connect":
      return `Apply rotation ${step.rotationStep ?? n - 1}/${n - 1}`;
  }
}

function countZaksChoices(graph: DrawnGraph): number {
  return graph.edges.filter((edge) => edge.kind === "zaks-choice").length;
}

function minimalEdgeCount(n: number): number {
  return (factorial(n - 1) - 2) / 2;
}

function averageChoiceDistanceDeg(graph: DrawnGraph, n: number): number {
  const edges = graph.edges.filter((edge) => edge.kind === "zaks-choice");
  if (edges.length === 0) return 0;
  const totalVertices = factorial(n);

  let total = 0;
  for (const edge of edges) {
    const a = (360 * edge.a) / totalVertices;
    const b = (360 * edge.b) / totalVertices;
    const diff = Math.abs(a - b) % 360;
    total += Math.min(diff, 360 - diff);
  }

  return total / edges.length;
}

function MathFraction({
  numerator,
  denominator,
}: {
  numerator: string;
  denominator: string;
}) {
  return (
    <span className="inline-flex flex-col items-center align-middle leading-none">
      <span className="px-1 pb-0.5">{numerator}</span>
      <span className="h-px w-full bg-current" aria-hidden />
      <span className="px-1 pt-0.5">{denominator}</span>
    </span>
  );
}

export function DihedralView() {
  const searchParams = useSearchParams();
  const initialIndex = useMemo(
    () => readNonNegIntParam(searchParams, "st", 0),
    [searchParams]
  );
  const initialChoiceMode = useMemo(
    () => readEnumParam(searchParams, "cm", CHOICE_MODES, "zaks"),
    [searchParams]
  );
  const initialRandomSeed = useMemo(
    () => readNonNegIntParam(searchParams, "rs", 1),
    [searchParams]
  );
  const [index, setIndex] = useState(initialIndex);
  const [choiceMode, setChoiceMode] = useState<ChoiceMode>(initialChoiceMode);
  const [randomSeed, setRandomSeed] = useState(initialRandomSeed);
  const [zoom, setZoom] = useState(1);
  const choiceCacheRef = useRef(new Map<string, Edge[]>());
  const step = stepAt(index);

  const next = useCallback(() => setIndex((i) => i + 1), []);
  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const reset = useCallback(() => setIndex(0), []);
  const zoomIn = useCallback(() => setZoom((z) => z * ZOOM_FACTOR), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(MIN_ZOOM, z / ZOOM_FACTOR)), []);
  const resetView = useCallback(() => setZoom(1), []);
  const toggleChoiceMode = useCallback(() => {
    setChoiceMode((mode) => {
      if (mode === "zaks") {
        setRandomSeed((seed) => seed + 1);
        return "random";
      }
      return "zaks";
    });
  }, []);

  useEffect(() => {
    writeUrlParams({
      st: index === 0 ? null : String(index),
      cm: choiceMode === "zaks" ? null : choiceMode,
      rs: choiceMode === "random" ? String(randomSeed) : null,
    });
  }, [choiceMode, index, randomSeed]);

  const choiceCacheKey = `${choiceMode}:${step.n}:${randomSeed}`;
  const minimalChoices = useMemo(() => {
    const cached = choiceCacheRef.current.get(choiceCacheKey);
    if (cached) return cached;

    const base = baseGraphFor(step.n);
    const baseOnly = graphFromRotated(base, step.n, "none");
    const existingKeys = existingEdgeKeys(baseOnly.edges);
    const choices =
      choiceMode === "zaks"
        ? zaksChoiceEdges(step.n)
        : randomChoiceEdges(step.n, randomSeed, existingKeys);
    choiceCacheRef.current.set(choiceCacheKey, choices);
    return choices;
  }, [choiceCacheKey, choiceMode, randomSeed, step.n]);

  const graph = useMemo(
    () => graphFor(step, minimalChoices),
    [minimalChoices, step.mode, step.n, step.rotationStep]
  );
  const viewBox = useMemo(() => {
    const size = SVG_SIZE / zoom;
    const origin = (SVG_SIZE - size) / 2;
    return `${origin} ${origin} ${size} ${size}`;
  }, [zoom]);

  const guides = useMemo(() => {
    if (step.mode === "wedge") {
      const W = 360 / step.n;
      return [0, W].map((a) => {
        const [x, y] = polar(wedgeDisplayAngle(a, step.n));
        return { a, x, y, mirror: false };
      });
    }
    if (step.mode === "isolate") {
      const W = 360 / step.n;
      return [0, W].map((a) => {
        const [x, y] = polar(a);
        return { a, x, y, mirror: false };
      });
    }
    if (
      step.mode === "choose" ||
      step.mode === "reflect" ||
      (step.mode === "connect" && step.rotationStep !== step.n - 1)
    ) {
      const halfWedge = 180 / step.n;
      return Array.from({ length: 2 * step.n }, (_, j) => j * halfWedge).map((a) => {
        const [x, y] = polar(a);
        return { a, x, y, mirror: true };
      });
    }
    return [];
  }, [step]);

  const isPrimaryVertex = useCallback(
    (i: number) =>
      step.mode !== "rotate" || Math.floor(i / graph.blockSize) === 0,
    [graph.blockSize, step.mode]
  );
  const strokeWidth = edgeWidth(graph.points.length);
  const radius = vertexRadius(graph.points.length);
  const halfWedge = 180 / step.n;
  const clippedConstruction =
    step.mode === "isolate" || step.mode === "reflect" || step.mode === "connect";
  const zaksVertices = useMemo(() => {
    const set = new Set<number>();
    if (
      step.mode === "choose" ||
      step.mode === "isolate" ||
      step.mode === "reflect" ||
      step.mode === "connect"
    ) {
      for (const edge of graph.edges) {
        if (isCurrentZaksEdge(step, edge)) {
          set.add(edge.a);
          set.add(edge.b);
        }
      }
    }
    return set;
  }, [graph.edges, step.mode]);
  const zaksChoiceVertices = useMemo(() => {
    const set = new Set<number>();
    for (const edge of graph.edges) {
      if (edge.kind === "zaks-choice") {
        set.add(edge.a);
        set.add(edge.b);
      }
    }
    return set;
  }, [graph.edges]);

  const reflectedPoints = useMemo(
    () => graph.points.map((point) => reflectPoint(point, halfWedge)),
    [graph.points, halfWedge]
  );

  const rotatedPointSets = useMemo(() => {
    if (step.mode !== "connect") return [];
    const visibleRotations = Math.min(step.rotationStep ?? step.n - 1, step.n - 1);
    return Array.from({ length: visibleRotations + 1 }, (_, j) => {
      const angle = j * 2 * halfWedge;
      return {
        original: graph.points.map((point) => rotatePoint(point, angle)),
        reflected: reflectedPoints.map((point) => rotatePoint(point, angle)),
      };
    });
  }, [graph.points, halfWedge, reflectedPoints, step.mode, step.n, step.rotationStep]);
  const finalRotationApplied =
    step.mode === "connect" && (step.rotationStep ?? step.n - 1) >= step.n - 1;

  const renderGraphLayer = (
    points: Array<[number, number]>,
    clipIndex: number | null,
    zaksColor: string,
    keyPrefix: string
  ) => (
    <g
      key={keyPrefix}
      clipPath={clipIndex === null ? undefined : `url(#dihedral-clip-${clipIndex})`}
    >
      {graph.edges.map((edge, ei) => {
        if (
          clippedConstruction &&
          edge.kind !== "zaks-choice" &&
          !isBaseWedgeEdge(edge, graph.blockSize)
        ) {
          return null;
        }
        const { a, b } = edge;
        const [x1, y1] = points[a];
        const [x2, y2] = points[b];
        const sameBlock =
          Math.floor(a / graph.blockSize) === Math.floor(b / graph.blockSize);
        const primary = isPrimaryVertex(a) && isPrimaryVertex(b) && sameBlock;
        const isZaks = clippedConstruction
          ? edge.kind === "zaks-choice"
          : isCurrentZaksEdge(step, edge);
        const stroke = clippedConstruction
          ? isZaks
            ? zaksColor
            : primary
              ? COLOR.primaryCycle
              : COLOR.cycle
          : edgeColor(step, edge, primary);

        return (
          <line
            key={`${keyPrefix}-edge-${ei}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={stroke}
            strokeWidth={isZaks ? strokeWidth * 1.35 : strokeWidth}
            opacity={isZaks ? 0.95 : sameBlock ? 0.7 : 0.5}
            style={transitionStyle()}
          />
        );
      })}

      {points.map(([x, y], vi) => {
        if (
          clippedConstruction &&
          !isInBaseWedge(vi, graph.blockSize) &&
          !zaksChoiceVertices.has(vi)
        ) {
          return null;
        }
        const primary = isPrimaryVertex(vi);
        const stroke =
          clippedConstruction && zaksChoiceVertices.has(vi)
            ? zaksColor
            : !clippedConstruction &&
                zaksVertices.has(vi) &&
                (step.mode === "choose" || step.mode === "isolate")
              ? COLOR.zaksChoiceVertexStroke
              : !clippedConstruction && zaksVertices.has(vi) && step.mode === "reflect"
                ? COLOR.zaksReflectionVertexStroke
                : !clippedConstruction && zaksVertices.has(vi) && step.mode === "connect"
                  ? COLOR.zaksRotationVertexStroke
                  : primary
                    ? COLOR.primaryVertexStroke
                    : COLOR.vertexStroke;
        return (
          <circle
            key={`${keyPrefix}-vertex-${vi}`}
            cx={x}
            cy={y}
            r={radius}
            fill={COLOR.vertex}
            stroke={stroke}
            strokeWidth={Math.max(0.7, strokeWidth)}
            style={transitionStyle()}
          />
        );
      })}
    </g>
  );

  return (
    <div className="mx-auto flex max-w-[920px] flex-col items-center gap-5">
      <div className="relative w-full rounded-xl border bg-card p-3">
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-md border bg-background/90 p-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
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
            disabled={zoom === 1}
            aria-label="Reset zoom and pan"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
        <svg viewBox={viewBox} className="w-full" role="img">
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--border)" strokeWidth={0.8} />

          {guides.map((g) => (
            <line
              key={`guide-${g.a}`}
              x1={CX}
              y1={CY}
              x2={g.x}
              y2={g.y}
              stroke={g.mirror ? COLOR.axis : COLOR.guide}
              strokeWidth={g.mirror ? 1.2 : 0.8}
              strokeDasharray={g.mirror ? "5 4" : "2 4"}
              opacity={g.mirror ? 0.55 : 0.45}
              style={transitionStyle()}
            />
          ))}

          {!clippedConstruction &&
            renderGraphLayer(graph.points, null, COLOR.zaksChoice, "normal")}

          {step.mode === "isolate" &&
            renderGraphLayer(graph.points, null, COLOR.zaksChoice, "isolated")}

          {step.mode === "reflect" && (
            <>
              {renderGraphLayer(graph.points, null, COLOR.zaksChoice, "reflect-source")}
              {renderGraphLayer(
                reflectedPoints,
                null,
                COLOR.zaksReflection,
                "reflect-copy"
              )}
            </>
          )}

          {step.mode === "connect" &&
            rotatedPointSets.flatMap((sets, j) => {
              const layers = [
                renderGraphLayer(
                  sets.original,
                  null,
                  finalRotationApplied || j !== 0 ? COLOR.zaksRotation : COLOR.zaksChoice,
                  `rotate-source-${j}`
                ),
                renderGraphLayer(
                  sets.reflected,
                  null,
                  finalRotationApplied || j !== 0
                    ? COLOR.zaksRotation
                    : COLOR.zaksReflection,
                  `rotate-reflect-${j}`
                ),
              ];

              if (j === 0) return layers;

              const bridge = boundaryBridge(
                rotatedPointSets[j - 1].original,
                sets.original,
                graph.blockSize
              );

              return [
                <line
                  key={`rotate-bridge-${j}`}
                  x1={bridge.x1}
                  y1={bridge.y1}
                  x2={bridge.x2}
                  y2={bridge.y2}
                  stroke={COLOR.cycle}
                  strokeWidth={strokeWidth}
                  opacity={0.75}
                  style={transitionStyle()}
                />,
                ...layers,
              ];
            })}

          {step.mode === "connect" &&
            rotatedPointSets.length === step.n &&
            (() => {
              const bridge = boundaryBridge(
                rotatedPointSets[rotatedPointSets.length - 1].original,
                rotatedPointSets[0].original,
                graph.blockSize
              );
              return (
                <line
                  key="rotate-bridge-close"
                  x1={bridge.x1}
                  y1={bridge.y1}
                  x2={bridge.x2}
                  y2={bridge.y2}
                  stroke={COLOR.cycle}
                  strokeWidth={strokeWidth}
                  opacity={0.75}
                  style={transitionStyle()}
                />
              );
            })()}
        </svg>
      </div>

      <div className="flex w-full items-center justify-between gap-3">
        <p className="font-mono text-sm text-foreground">{label(step, graph)}</p>
        <span className="text-xs text-muted-foreground tabular-nums">n = {step.n}</span>
      </div>

      <div className="flex w-full items-center gap-2">
        <Button variant="outline" size="sm" onClick={prev} disabled={index === 0}>
          Prev
        </Button>
        <Button size="sm" className="flex-1" onClick={next}>
          Next
        </Button>
        {step.mode === "choose" && (
          <Button variant="outline" size="sm" onClick={toggleChoiceMode}>
            {choiceMode === "zaks" ? "Use random edges" : "Use Zaks edges"}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={reset}>
          Reset
        </Button>
      </div>
    </div>
  );
}
