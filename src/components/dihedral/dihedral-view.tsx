"use client";

import { Button } from "@/components/ui/button";
import { useCallback, useMemo, useState } from "react";

const N_MIN = 4;

type Mode = "full" | "wedge" | "rotate" | "connect";
interface Step {
  n: number;
  mode: Mode;
}

// Unbounded sequence: index 0 is the starting circle, then for each n >= N_MIN:
// make one wedge, rotate it n times, then add the cross-boundary symmetry edges.
function stepAt(index: number): Step {
  if (index <= 0) return { n: N_MIN, mode: "full" };
  const k = index - 1;
  const mode = (["wedge", "rotate", "connect"] as const)[k % 3];
  return { n: N_MIN + Math.floor(k / 3), mode };
}

const CX = 350;
const CY = 350;
const R = 320;
const BASE_VERTEX_COUNT = 6;
const BASE_PATH_EDGES: Array<[number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
];
const BASE_EDGES: Array<[number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
  [5, 0],
];

const COLOR = {
  origin: "var(--foreground)",
  wedge: "#6366f1",
  symmetry: "#f59e0b",
  rotation: "var(--muted-foreground)",
} as const;

interface Graph {
  vertexCount: number;
  edges: Array<[number, number]>;
}

interface DrawnGraph {
  points: Array<[number, number]>;
  blockAngles: number[];
  edges: Array<[number, number]>;
  blockSize: number;
}

function baseGraphFor(n: number): Graph {
  let graph: Graph = { vertexCount: BASE_VERTEX_COUNT, edges: BASE_PATH_EDGES };

  for (let k = N_MIN; k < n; k++) {
    graph = cutCircleClosure(rotateGraph(graph, k, true));
  }

  return graph;
}

function rotateGraph(graph: Graph, n: number, connectBoundaries: boolean): Graph {
  const edges: Array<[number, number]> = [];
  const block = graph.vertexCount;
  const total = block * n;

  for (let j = 0; j < n; j++) {
    const offset = j * block;
    for (const [a, b] of graph.edges) {
      edges.push([offset + a, offset + b]);
    }
    edges.push([offset + block - 1, ((j + 1) % n) * block]);
  }

  if (connectBoundaries) {
    const half = Math.floor(block / 2);
    const skip = Math.max(2, Math.floor(n / 2));
    for (let j = 0; j < n; j++) {
      const offset = j * block;
      const targetOffset = ((j + skip) % n) * block;
      for (let i = 0; i < half; i++) {
        edges.push([offset + i, targetOffset + longMateIndex(i, block)]);
      }
    }
  }

  return { vertexCount: total, edges: uniqueEdges(edges) };
}

function fullCircleGraph(): DrawnGraph {
  const graph: Graph = { vertexCount: BASE_VERTEX_COUNT, edges: BASE_EDGES };
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
    points: angles.map(polar),
    blockAngles: angles,
    edges: uniqueEdges([...graph.edges, [0, graph.vertexCount - 1]]),
    blockSize: graph.vertexCount,
  };
}

function rotatedGraph(n: number): DrawnGraph {
  return graphFromRotated(baseGraphFor(n), n, false);
}

function connectedGraph(n: number): DrawnGraph {
  return graphFromRotated(baseGraphFor(n), n, true);
}

function graphFromRotated(
  graph: Graph,
  n: number,
  connectBoundaries: boolean
): DrawnGraph {
  const blockAngles = wedgeAngles(graph.vertexCount, n);
  const points: Array<[number, number]> = [];
  const angles: number[] = [];
  const edges: Array<[number, number]> = [];
  const block = graph.vertexCount;
  const W = 360 / n;

  for (let j = 0; j < n; j++) {
    const offset = j * block;
    for (let i = 0; i < block; i++) {
      const angle = blockAngles[i] + j * W;
      angles.push(blockAngles[i]);
      points.push(polar(angle));
    }
    for (const [a, b] of graph.edges) {
      edges.push([offset + a, offset + b]);
    }
    edges.push([offset + block - 1, ((j + 1) % n) * block]);
  }

  if (connectBoundaries) {
    const half = Math.floor(block / 2);
    const skip = Math.max(2, Math.floor(n / 2));
    for (let j = 0; j < n; j++) {
      const offset = j * block;
      const targetOffset = ((j + skip) % n) * block;
      for (let i = 0; i < half; i++) {
        edges.push([offset + i, targetOffset + longMateIndex(i, block)]);
      }
    }
  }

  return {
    points,
    blockAngles: angles,
    edges: uniqueEdges(edges),
    blockSize: block,
  };
}

function graphFor(step: Step): DrawnGraph {
  if (step.mode === "full") return fullCircleGraph();
  if (step.mode === "wedge") return wedgeGraph(step.n);
  if (step.mode === "rotate") return rotatedGraph(step.n);
  return connectedGraph(step.n);
}

function uniqueEdges(edges: Array<[number, number]>): Array<[number, number]> {
  const seen = new Set<string>();
  const out: Array<[number, number]> = [];

  for (const [a, b] of edges) {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = `${lo}:${hi}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([lo, hi]);
  }

  return out;
}

function cutCircleClosure(graph: Graph): Graph {
  return {
    vertexCount: graph.vertexCount,
    edges: graph.edges.filter(
      ([a, b]) =>
        !(
          (a === 0 && b === graph.vertexCount - 1) ||
          (b === 0 && a === graph.vertexCount - 1)
        )
    ),
  };
}

function isCopyBoundaryEdge(a: number, b: number, blockSize: number): boolean {
  const ar = a % blockSize;
  const br = b % blockSize;
  return (
    (ar === blockSize - 1 && br === 0) ||
    (br === blockSize - 1 && ar === 0)
  );
}

function longMateIndex(localIndex: number, blockSize: number): number {
  const half = Math.floor(blockSize / 2);
  const step = coprimeStep(half);
  const offset = Math.floor(half / 3) + 1;
  return half + ((localIndex * step + offset) % half);
}

function coprimeStep(size: number): number {
  if (size <= 3) return 1;

  let candidate = Math.max(2, Math.floor(size * 0.618));
  for (let attempts = 0; attempts < size; attempts++) {
    const step = ((candidate + attempts - 1) % size) + 1;
    if (step !== 1 && step !== size - 1 && gcd(step, size) === 1) {
      return step;
    }
  }

  return 1;
}

function gcd(a: number, b: number): number {
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return Math.abs(a);
}

// Colour of an element sitting at the given within-block angle.
function colorAt(step: Step, blockAngle: number, primary: boolean): string {
  if (step.mode === "full") return COLOR.origin;
  if (!primary) return COLOR.rotation;
  if (step.mode === "connect") {
    const W = 360 / step.n;
    return blockAngle > W / 2 ? COLOR.symmetry : COLOR.wedge;
  }
  return COLOR.wedge;
}

function polar(angleDeg: number): [number, number] {
  const r = (angleDeg * Math.PI) / 180;
  return [roundCoord(CX + R * Math.cos(r)), roundCoord(CY - R * Math.sin(r))];
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

function label(step: Step): string {
  const { n, mode } = step;
  const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
  switch (mode) {
    case "full":
      return "Starting circle — 6 points";
    case "wedge":
      return `Wedge: 360/${n} = ${fmt(360 / n)}°`;
    case "rotate":
      return `${n} copies of the wedge`;
    case "connect":
      return "Add long symmetry edges";
  }
}

export function DihedralView() {
  const [index, setIndex] = useState(0);
  const step = stepAt(index);

  const next = useCallback(() => setIndex((i) => i + 1), []);
  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const reset = useCallback(() => setIndex(0), []);

  const graph = useMemo(() => graphFor(step), [step.mode, step.n]);

  const guides = useMemo(() => {
    if (step.mode === "wedge") {
      const W = 360 / step.n;
      return [0, W].map((a) => {
        const [x, y] = polar(a);
        return { a, x, y, mirror: false };
      });
    }
    if (step.mode === "connect") {
      const W = 360 / step.n;
      return Array.from({ length: step.n }, (_, j) => j * W).map((a) => {
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

  return (
    <div className="mx-auto flex max-w-[920px] flex-col items-center gap-5">
      <div className="w-full rounded-xl border bg-card p-3">
        <svg viewBox="0 0 700 700" className="w-full" role="img">
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--border)" strokeWidth={0.8} />

          {guides.map((g) => (
            <line
              key={`guide-${g.a}`}
              x1={CX}
              y1={CY}
              x2={g.x}
              y2={g.y}
              stroke={g.mirror ? COLOR.symmetry : "var(--border)"}
              strokeWidth={0.8}
              strokeDasharray={g.mirror ? "5 4" : "2 4"}
              opacity={g.mirror ? 0.8 : 0.6}
              style={transitionStyle()}
            />
          ))}

          {graph.edges.map(([a, b], ei) => {
            const [x1, y1] = graph.points[a];
            const [x2, y2] = graph.points[b];
            const sameBlock =
              Math.floor(a / graph.blockSize) === Math.floor(b / graph.blockSize);
            const primary = isPrimaryVertex(a) && isPrimaryVertex(b) && sameBlock;
            const newSymmetryEdge =
              step.mode === "connect" &&
              !sameBlock &&
              !isCopyBoundaryEdge(a, b, graph.blockSize);
            const stroke =
              newSymmetryEdge
                ? COLOR.symmetry
                : colorAt(
                    step,
                    (graph.blockAngles[a] + graph.blockAngles[b]) / 2,
                    primary
                  );
            return (
              <line
                key={`edge-${ei}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={stroke}
                strokeWidth={strokeWidth}
                opacity={sameBlock ? 1 : 0.85}
                style={transitionStyle()}
              />
            );
          })}

          {graph.points.map(([x, y], vi) => (
            <circle
              key={`vertex-${vi}`}
              cx={x}
              cy={y}
              r={radius}
              fill={colorAt(step, graph.blockAngles[vi], isPrimaryVertex(vi))}
              style={transitionStyle()}
            />
          ))}
        </svg>
      </div>

      <div className="flex w-full items-center justify-between gap-3">
        <p className="font-mono text-sm text-foreground">{label(step)}</p>
        <span className="text-xs text-muted-foreground tabular-nums">n = {step.n}</span>
      </div>

      <div className="flex w-full items-center gap-2">
        <Button variant="outline" size="sm" onClick={prev} disabled={index === 0}>
          Prev
        </Button>
        <Button size="sm" className="flex-1" onClick={next}>
          Next
        </Button>
        <Button variant="ghost" size="sm" onClick={reset}>
          Reset
        </Button>
      </div>
    </div>
  );
}
