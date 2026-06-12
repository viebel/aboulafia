"use client";

import { Button } from "@/components/ui/button";
import {
  readNonNegIntParam,
  writeUrlParams,
} from "@/lib/url-state";
import {
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Shuffle,
  SkipForward,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

// Harper's stabilization (Steiner symmetrization on a graph) demonstrated on the
// cycle Z_n — Harper's own canonical example. Vertices 0…n−1 sit on a circle; the
// dihedral group D_n acts by the n reflections R_c : i ↦ (c − i) mod n. Picking a
// generic Fricke–Klein point p, each Stab_{R_c,p} folds the membership of every
// mirror pair toward p's side, never increasing the boundary |∂S|. Iterating over
// all mirrors (Stab^∞) drives any starting set S to a contiguous arc — the
// edge-isoperimetric optimum on the cycle. See docs/harper-coxeter-kaleidoscope.md.

const N_MIN = 4;
const N_MAX = 24;
const N_DEFAULT = 12;

const CX = 350;
const CY = 350;
const SVG_SIZE = 700;
const R = 290;
const P_RADIUS = R * 0.66;

const COLOR = {
  ring: "var(--border)",
  cycle: "#94a3b8",
  boundary: "#f97316",
  inSet: "#4f46e5",
  inSetStroke: "#312e81",
  outStroke: "#94a3b8",
  vertexFill: "#ffffff",
  mirrorIdle: "#cbd5e1",
  mirrorActive: "#0891b2",
  arrow: "#10b981",
  fricke: "#e11d48",
  label: "#64748b",
} as const;

interface Frame {
  set: number[];
  mirror: number | null;
  arrows: Array<{ from: number; to: number }>;
  boundary: number;
}

function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

// A pseudo-random, reasonably scattered starting set so the folding is visible.
function defaultSet(n: number, seed: number): number[] {
  const rand = seededRandom(seed * 2654435761 + n * 40503);
  const target = Math.max(2, Math.round(n / 3));
  const set = new Set<number>();
  let guard = 0;
  while (set.size < target && guard < n * 20) {
    set.add(Math.floor(rand() * n));
    guard++;
  }
  return [...set].sort((a, b) => a - b);
}

// Fricke–Klein point angle (degrees): sits a quarter-step past vertex `gap`, so it
// never lands on a vertex (even multiples of 180/n) nor on a mirror axis (integer
// multiples of 180/n). The nearest vertex — where the arc condenses — is `gap`.
function frickeAngleDeg(n: number, gap: number): number {
  return (90 * (4 * gap + 1)) / n;
}

function sideSign(x: number): number {
  if (x > 1e-9) return 1;
  if (x < -1e-9) return -1;
  return 0;
}

// One pass of Stab_{R_c, p}: push each mirror pair's membership to p's side.
function applyStab(
  set: Set<number>,
  n: number,
  c: number,
  pAngleDeg: number
): { next: Set<number>; arrows: Array<{ from: number; to: number }> } {
  const sp = sideSign(Math.sin((Math.PI * (pAngleDeg - (180 * c) / n)) / 180));
  const next = new Set<number>();

  for (let v = 0; v < n; v++) {
    const w = (((c - v) % n) + n) % n;
    if (w === v) {
      if (set.has(v)) next.add(v);
      continue;
    }
    const sv = sideSign(Math.sin((Math.PI * (2 * v - c)) / n));
    if (sv === sp) {
      // v is on p's side: it keeps the pair if either member was in S.
      if (set.has(v) || set.has(w)) next.add(v);
    } else {
      // v is on the far side: it survives only if both members were in S.
      if (set.has(v) && set.has(w)) next.add(v);
    }
  }

  const arrows: Array<{ from: number; to: number }> = [];
  for (let v = 0; v < n; v++) {
    if (set.has(v) && !next.has(v)) {
      const a = (((c - v) % n) + n) % n;
      if (next.has(a) && !set.has(a)) arrows.push({ from: v, to: a });
    }
  }
  return { next, arrows };
}

function boundaryOf(set: Set<number>, n: number): number {
  let b = 0;
  for (let v = 0; v < n; v++) {
    if (set.has(v) !== set.has((v + 1) % n)) b++;
  }
  return b;
}

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function buildFrames(n: number, initial: number[], pAngleDeg: number): Frame[] {
  let cur = new Set(initial.filter((v) => v >= 0 && v < n));
  const frames: Frame[] = [
    {
      set: [...cur].sort((a, b) => a - b),
      mirror: null,
      arrows: [],
      boundary: boundaryOf(cur, n),
    },
  ];

  let c = 0;
  let noop = 0;
  let guard = 0;
  const maxGuard = n * n * 4 + 32;

  while (noop < n && guard < maxGuard) {
    const { next, arrows } = applyStab(cur, n, c, pAngleDeg);
    if (!setsEqual(next, cur)) {
      frames.push({
        set: [...next].sort((a, b) => a - b),
        mirror: c,
        arrows,
        boundary: boundaryOf(next, n),
      });
      cur = next;
      noop = 0;
    } else {
      noop++;
    }
    c = (c + 1) % n;
    guard++;
  }
  return frames;
}

function isArc(setArr: number[], n: number): boolean {
  if (setArr.length === 0 || setArr.length === n) return true;
  return boundaryOf(new Set(setArr), n) <= 2;
}

function polar(angleDeg: number, radius = R): [number, number] {
  const r = (angleDeg * Math.PI) / 180;
  return [
    round(CX + radius * Math.cos(r)),
    round(CY - radius * Math.sin(r)),
  ];
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function vertexAngleDeg(i: number, n: number): number {
  return (360 * i) / n;
}

function vertexRadius(n: number): number {
  if (n >= 20) return 5;
  if (n >= 14) return 6;
  return 7.5;
}

function fmtAngle(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

export function StabilizationView() {
  const searchParams = useSearchParams();

  const initialN = useMemo(() => {
    const v = readNonNegIntParam(searchParams, "n", N_DEFAULT);
    return Math.min(N_MAX, Math.max(N_MIN, v));
  }, [searchParams]);
  const initialSeed = useMemo(
    () => readNonNegIntParam(searchParams, "seed", 1),
    [searchParams]
  );
  const initialFk = useMemo(
    () => readNonNegIntParam(searchParams, "fk", 0),
    [searchParams]
  );
  const initialStep = useMemo(
    () => readNonNegIntParam(searchParams, "st", 0),
    [searchParams]
  );
  const initialSet = useMemo(() => {
    const raw = searchParams?.get("set");
    if (!raw) return null;
    const parsed = raw
      .split(",")
      .map((s) => Number(s))
      .filter((v) => Number.isInteger(v) && v >= 0 && v < initialN);
    return parsed.length > 0 ? Array.from(new Set(parsed)).sort((a, b) => a - b) : null;
  }, [searchParams, initialN]);

  const [n, setN] = useState(initialN);
  const [seed, setSeed] = useState(initialSeed);
  const [fkGap, setFkGap] = useState(initialFk % Math.max(1, initialN));
  const [customSet, setCustomSet] = useState<number[] | null>(initialSet);
  const [index, setIndex] = useState(initialStep);
  const [playing, setPlaying] = useState(false);

  const pAngleDeg = useMemo(() => frickeAngleDeg(n, fkGap % n), [n, fkGap]);

  const startSet = useMemo(
    () => customSet ?? defaultSet(n, seed),
    [customSet, n, seed]
  );

  const frames = useMemo(
    () => buildFrames(n, startSet, pAngleDeg),
    [n, startSet, pAngleDeg]
  );

  const clampedIndex = Math.min(index, frames.length - 1);
  const frame = frames[clampedIndex];
  const atEnd = clampedIndex >= frames.length - 1;

  const setMembers = useMemo(() => new Set(frame.set), [frame.set]);
  const converged = atEnd && isArc(frame.set, n);

  // Deep linking.
  useEffect(() => {
    writeUrlParams({
      n: n === N_DEFAULT ? null : String(n),
      seed: customSet ? null : seed === 1 ? null : String(seed),
      set: customSet ? customSet.join(",") : null,
      fk: fkGap === 0 ? null : String(fkGap),
      st: clampedIndex === 0 ? null : String(clampedIndex),
    });
  }, [n, seed, customSet, fkGap, clampedIndex]);

  const isPlaying = playing && !atEnd;

  // Auto-play through the folding. The loop ends naturally once `atEnd` flips,
  // so no synchronous setState is needed inside the effect.
  useEffect(() => {
    if (!playing || atEnd) return;
    const id = window.setTimeout(
      () => setIndex((i) => Math.min(frames.length - 1, i + 1)),
      850
    );
    return () => window.clearTimeout(id);
  }, [playing, atEnd, clampedIndex, frames.length]);

  const next = useCallback(() => setIndex((i) => i + 1), []);
  const prev = useCallback(() => {
    setPlaying(false);
    setIndex((i) => Math.max(0, i - 1));
  }, []);
  const restart = useCallback(() => {
    setPlaying(false);
    setIndex(0);
  }, []);
  const skipToEnd = useCallback(() => {
    setPlaying(false);
    setIndex(frames.length - 1);
  }, [frames.length]);
  const togglePlay = useCallback(() => {
    if (atEnd) {
      setIndex(0);
      setPlaying(true);
      return;
    }
    setPlaying((p) => !p);
  }, [atEnd]);

  const randomize = useCallback(() => {
    setPlaying(false);
    setCustomSet(null);
    setSeed((s) => s + 1);
    setIndex(0);
  }, []);

  const changeN = useCallback((delta: number) => {
    setPlaying(false);
    setCustomSet(null);
    setIndex(0);
    setN((value) => Math.min(N_MAX, Math.max(N_MIN, value + delta)));
  }, []);

  const rotateFricke = useCallback(
    (delta: number) => {
      setPlaying(false);
      setIndex(0);
      setFkGap((g) => (((g + delta) % n) + n) % n);
    },
    [n]
  );

  // Clicking a vertex edits the starting set and resets the animation.
  const toggleVertex = useCallback(
    (v: number) => {
      setPlaying(false);
      setIndex(0);
      setCustomSet((prevSet) => {
        const base = new Set(prevSet ?? startSet);
        if (base.has(v)) base.delete(v);
        else base.add(v);
        return [...base].sort((a, b) => a - b);
      });
    },
    [startSet]
  );

  const radius = vertexRadius(n);
  const showLabels = n <= 16;
  const activeMirror = frame.mirror;
  const [px, py] = polar(pAngleDeg, P_RADIUS);

  return (
    <div className="mx-auto flex max-w-[960px] flex-col items-center gap-5">
      <p className="w-full text-sm text-muted-foreground">
        Harper&apos;s stabilization on the cycle Z<sub>{n}</sub>. Each step folds a
        set across one of the D<sub>{n}</sub> mirrors toward the Fricke–Klein point{" "}
        <span className="font-semibold" style={{ color: COLOR.fricke }}>
          p
        </span>
        , never raising the boundary. Iterating drives any set to a contiguous arc —
        the isoperimetric optimum.
      </p>

      <div className="relative w-full rounded-xl border bg-card p-3">
        <svg viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`} className="w-full" role="img">
          <defs>
            <marker
              id="stab-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={COLOR.arrow} />
            </marker>
          </defs>

          <circle
            cx={CX}
            cy={CY}
            r={R}
            fill="none"
            stroke={COLOR.ring}
            strokeWidth={0.8}
          />

          {/* All D_n mirror axes (faint), the active one highlighted. */}
          {Array.from({ length: n }, (_, c) => {
            const axisDeg = (180 * c) / n;
            const [x1, y1] = polar(axisDeg);
            const [x2, y2] = polar(axisDeg + 180);
            const active = c === activeMirror;
            return (
              <line
                key={`mirror-${c}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={active ? COLOR.mirrorActive : COLOR.mirrorIdle}
                strokeWidth={active ? 2.4 : 0.6}
                strokeDasharray={active ? "7 5" : "2 6"}
                opacity={active ? 0.9 : 0.35}
                style={{ transition: "all 500ms cubic-bezier(0.4,0,0.2,1)" }}
              />
            );
          })}

          {/* Cycle edges, boundary edges of S highlighted. */}
          {Array.from({ length: n }, (_, v) => {
            const w = (v + 1) % n;
            const [x1, y1] = polar(vertexAngleDeg(v, n));
            const [x2, y2] = polar(vertexAngleDeg(w, n));
            const isBoundary = setMembers.has(v) !== setMembers.has(w);
            return (
              <line
                key={`cycle-${v}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={isBoundary ? COLOR.boundary : COLOR.cycle}
                strokeWidth={isBoundary ? 3.2 : 1}
                opacity={isBoundary ? 0.95 : 0.45}
                style={{ transition: "all 500ms cubic-bezier(0.4,0,0.2,1)" }}
              />
            );
          })}

          {/* Arrows for membership transferred this step. */}
          {frame.arrows.map((a, i) => {
            const [x1, y1] = polar(vertexAngleDeg(a.from, n), R - radius - 4);
            const [x2, y2] = polar(vertexAngleDeg(a.to, n), R - radius - 4);
            return (
              <line
                key={`arrow-${i}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={COLOR.arrow}
                strokeWidth={2}
                opacity={0.85}
                markerEnd="url(#stab-arrow)"
              />
            );
          })}

          {/* Vertices. */}
          {Array.from({ length: n }, (_, v) => {
            const [x, y] = polar(vertexAngleDeg(v, n));
            const inSet = setMembers.has(v);
            return (
              <circle
                key={`vertex-${v}`}
                cx={x}
                cy={y}
                r={radius}
                fill={inSet ? COLOR.inSet : COLOR.vertexFill}
                stroke={inSet ? COLOR.inSetStroke : COLOR.outStroke}
                strokeWidth={1.5}
                className="cursor-pointer"
                onClick={() => toggleVertex(v)}
                style={{ transition: "fill 350ms ease, stroke 350ms ease" }}
              />
            );
          })}

          {/* Vertex labels for small n. */}
          {showLabels &&
            Array.from({ length: n }, (_, v) => {
              const [x, y] = polar(vertexAngleDeg(v, n), R + 18);
              return (
                <text
                  key={`label-${v}`}
                  x={x}
                  y={y}
                  fontSize={12}
                  fill={COLOR.label}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="pointer-events-none select-none font-mono"
                >
                  {v}
                </text>
              );
            })}

          {/* Fricke–Klein point p. */}
          <g
            transform={`translate(${px} ${py})`}
            style={{ transition: "all 500ms cubic-bezier(0.4,0,0.2,1)" }}
          >
            <rect
              x={-6}
              y={-6}
              width={12}
              height={12}
              transform="rotate(45)"
              fill={COLOR.fricke}
              stroke="#ffffff"
              strokeWidth={1.5}
            />
            <text
              x={0}
              y={-14}
              fontSize={14}
              fill={COLOR.fricke}
              textAnchor="middle"
              className="pointer-events-none select-none font-semibold italic"
            >
              p
            </text>
          </g>
        </svg>
      </div>

      {/* Readout. */}
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-sm text-foreground">
          {frame.mirror === null
            ? `Start · |S| = ${frame.set.length}`
            : `Mirror R_${frame.mirror} (axis ${fmtAngle(
                (180 * frame.mirror) / n
              )}°) · |S| = ${frame.set.length}`}
          {" · "}
          <span style={{ color: COLOR.boundary }}>|∂S| = {frame.boundary}</span>
          {converged && (
            <span className="ml-2 text-emerald-600">→ contiguous arc</span>
          )}
        </p>
        <span className="text-xs text-muted-foreground tabular-nums">
          step {clampedIndex} / {frames.length - 1}
        </span>
      </div>

      {/* Step controls. */}
      <div className="flex w-full flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={prev} disabled={clampedIndex === 0}>
          Prev
        </Button>
        <Button size="sm" className="flex-1" onClick={next} disabled={atEnd}>
          Next
        </Button>
        <Button variant="outline" size="icon-sm" onClick={togglePlay} aria-label="Play / pause">
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={skipToEnd}
          disabled={atEnd}
          aria-label="Skip to result"
        >
          <SkipForward className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={restart}>
          Reset
        </Button>
      </div>

      {/* Configuration. */}
      <div className="flex w-full flex-wrap items-center justify-between gap-3 rounded-lg border bg-background/60 p-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">n</span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => changeN(-1)}
            disabled={n <= N_MIN}
            aria-label="Decrease n"
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <span className="w-6 text-center font-mono tabular-nums">{n}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => changeN(1)}
            disabled={n >= N_MAX}
            aria-label="Increase n"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">point p</span>
          <Button variant="ghost" size="icon-sm" onClick={() => rotateFricke(-1)} aria-label="Rotate p back">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <span className="w-12 text-center font-mono tabular-nums">
            {fmtAngle(pAngleDeg)}°
          </span>
          <Button variant="ghost" size="icon-sm" onClick={() => rotateFricke(1)} aria-label="Rotate p forward">
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        <Button variant="outline" size="sm" onClick={randomize}>
          <Shuffle className="mr-1.5 h-3.5 w-3.5" />
          Random set
        </Button>
      </div>

      <p className="w-full text-xs text-muted-foreground">
        Click any vertex to add or remove it from the starting set.
      </p>
    </div>
  );
}
