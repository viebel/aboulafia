"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { factorial, zaksSigma, zaksUnrank } from "@/lib/pancake";
import { readIntParam, writeUrlParams } from "@/lib/url-state";
import { formatUiNumber } from "@/lib/utils";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const N_OPTIONS = [3, 4, 5, 6, 7] as const;
type NValue = (typeof N_OPTIONS)[number];
const DEFAULT_N: NValue = 4;

interface Row {
  i: number;
  perm: string;
  sigma: number;
  delta: number;
}

interface Analysis {
  total: number;
  blockSize: number;
  rows: Row[];
  distinctDeltas: number;
  affine: boolean;
  deltaPeriod: number;
  blockEquivariant: boolean;
}

function analyze(n: number): Analysis {
  const total = factorial(n);
  const blockSize = factorial(n - 1);
  const sigma = new Array<number>(total);
  const rows: Row[] = new Array(total);
  const deltas = new Set<number>();

  for (let i = 0; i < total; i++) sigma[i] = zaksSigma(n, i);

  for (let i = 0; i < total; i++) {
    const p = zaksUnrank(n, i);
    let perm = "";
    for (let t = 0; t < n; t++) perm += String(p[t]);
    // Cyclic finite difference on ℤ/n!: index i−1 wraps to n!−1, so row 0 is
    // σ(0) − σ(n!−1).
    const prev = sigma[(i - 1 + total) % total];
    const delta = (((sigma[i] - prev) % total) + total) % total;
    deltas.add(delta);
    rows[i] = { i, perm, sigma: sigma[i], delta };
  }

  // Smallest period p of the cyclic finite-difference sequence Δ(i).
  let deltaPeriod = total;
  for (let p = 1; p < total; p++) {
    if (total % p !== 0) continue;
    let ok = true;
    for (let i = 0; i < total; i++) {
      if (rows[i].delta !== rows[(i + p) % total].delta) {
        ok = false;
        break;
      }
    }
    if (ok) {
      deltaPeriod = p;
      break;
    }
  }

  // Block equivariance: σ(i + B) ≡ σ(i) + B (mod n!).
  let blockEquivariant = true;
  for (let i = 0; i + blockSize < total; i++) {
    if (sigma[i + blockSize] !== ((sigma[i] + blockSize) % total)) {
      blockEquivariant = false;
      break;
    }
  }

  return {
    total,
    blockSize,
    rows,
    distinctDeltas: deltas.size,
    affine: deltas.size === 1,
    deltaPeriod,
    blockEquivariant,
  };
}

export function AnalysisView() {
  const searchParams = useSearchParams();
  const initialN = useMemo(
    () => readIntParam(searchParams, "n", N_OPTIONS, DEFAULT_N) as NValue,
    [searchParams]
  );
  const [n, setN] = useState<NValue>(initialN);

  useEffect(() => {
    writeUrlParams({ n: String(n) });
  }, [n]);

  const analysis = useMemo(() => analyze(n), [n]);

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="self-start lg:sticky lg:top-4 space-y-5">
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Word length
          </Label>
          <Select value={String(n)} onValueChange={(v) => setN(Number(v) as NValue)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {N_OPTIONS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  n = {option} — {formatUiNumber(factorial(option))} vertices
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
          <Stat label="n" value={n} />
          <Stat label="n!" value={analysis.total} />
          <Stat label="Block (n−1)!" value={analysis.blockSize} />
          <Stat label="Distinct slopes" value={analysis.distinctDeltas} />
          <Stat label="Δ period" value={analysis.deltaPeriod} />
          <Stat label="Affine" value={analysis.affine ? "yes" : "no"} />
        </dl>

        <p className="text-xs leading-relaxed text-muted-foreground">
          σₙ = rank ∘ reverse ∘ unrank sends vertex i to the far end of its rₙ
          chord. Affine would mean a constant slope Δ(i) = σ(i) − σ(i−1). It is
          not — but Δ is periodic with period (n−1)!, because σ is
          block-equivariant:{" "}
          <span className="font-mono text-foreground">
            σ(i + (n−1)!) ≡ σ(i) + (n−1)! (mod n!)
          </span>
          {analysis.blockEquivariant ? " ✓" : " ✗"}. A one-block shift is the
          rotation ρ of 2π/n — the Dₙ symmetry of the layout.
        </p>
      </aside>

      <SigmaTable analysis={analysis} />
    </div>
  );
}

function SigmaTable({ analysis }: { analysis: Analysis }) {
  const { rows, blockSize, deltaPeriod } = analysis;
  return (
    <div className="max-h-[78vh] overflow-auto rounded-lg border">
      <table className="w-full border-collapse font-mono text-sm tabular-nums">
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 font-medium">i</th>
            <th className="px-3 py-2 font-medium">perm(i)</th>
            <th className="px-3 py-2 font-medium">σ(i)</th>
            <th className="px-3 py-2 font-medium">Δ = σ(i) − σ(i−1) mod n!</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const blockEven = Math.floor(row.i / blockSize) % 2 === 0;
            const motifStart = row.i % deltaPeriod === 0;
            return (
              <tr
                key={row.i}
                className={`border-b border-border/40 ${
                  blockEven ? "" : "bg-muted/40"
                }`}
              >
                <td className="px-3 py-1 text-muted-foreground">{row.i}</td>
                <td className="px-3 py-1">[{row.perm}]</td>
                <td className="px-3 py-1">{row.sigma}</td>
                <td className="px-3 py-1">
                  <span
                    className={
                      motifStart && row.i >= deltaPeriod
                        ? "rounded bg-amber-500/15 px-1 text-amber-700 dark:text-amber-300"
                        : ""
                    }
                  >
                    {row.delta}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono text-xs">
        {typeof value === "number" ? formatUiNumber(value) : value}
      </dd>
    </div>
  );
}
