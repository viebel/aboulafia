"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { factorial, key, type Perm } from "@/lib/pancake";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const NUMBER_FORMAT = new Intl.NumberFormat("en-US");
const N_OPTIONS = [1, 2, 3, 4, 5, 6, 7] as const;
const WORDS_PER_LINE = 6;
type NValue = (typeof N_OPTIONS)[number];

interface ZaksWord {
  word: string;
  flip?: number;
}

export function TseroufView() {
  const [n, setN] = useState<NValue>(3);
  const [words, setWords] = useState<ZaksWord[]>([]);
  const [status, setStatus] = useState("Ready.");
  const [running, setRunning] = useState(false);

  const baseWord = useMemo(
    () => Array.from({ length: n }, (_, i) => String.fromCharCode(97 + i)).join(""),
    [n]
  );
  const wordBlocks = useMemo(() => blockWords(words, n), [n, words]);

  useEffect(() => {
    const ac = new AbortController();
    const signal = ac.signal;

    const run = async () => {
      setRunning(true);
      setStatus(`Generating suffix Zaks order for ${baseWord}...`);
      try {
        const cycle = await suffixZaksCycle(n, signal);
        if (signal.aborted) return;
        setWords(
          cycle.path.map((perm, index) => ({
            word: lettersForPermutation(perm),
            flip: cycle.flips[index],
          }))
        );
        setStatus(
          `${NUMBER_FORMAT.format(cycle.path.length)} permutations generated.`
        );
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
  }, [baseWord, n]);

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <Card className="self-start lg:sticky lg:top-4">
        <CardHeader className="space-y-1">
          <CardTitle className="text-lg">Tsérouf</CardTitle>
          <CardDescription>
            All permutations of the word <span className="font-mono">{baseWord}</span>,
            listed in Zaks suffix-reversal order; each number k reverses the
            last k letters.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Word length
            </Label>
            <Select
              value={String(n)}
              onValueChange={(value) => setN(Number(value) as NValue)}
              disabled={running}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {N_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    n = {option} — {NUMBER_FORMAT.format(factorial(option))} permutations
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
            <Stat label="Word" value={baseWord} />
            <Stat label="Permutations" value={factorial(n)} />
            <Stat label="Algorithm" value="Zaks suffix" />
            <Stat label="Status" value={status} full />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {running ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm">{status}</p>
            </div>
          ) : (
            <div className="rounded-lg border bg-muted/10 p-5 font-mono text-sm">
              {wordBlocks.map((block, blockIndex) => (
                <WordBlock key={blockIndex} block={block} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function WordBlock({ block }: { block: ZaksWord[] }) {
  if (block.length === 0) return <p className="h-5" />;

  const stable = stablePositions(block);

  return (
    <p className="flex flex-wrap gap-x-4 gap-y-4">
      {block.map((item, itemIndex) => (
        <span
          key={`${itemIndex}-${item.word}`}
          className="inline-flex min-w-14 flex-col items-center leading-none"
        >
          <span className="h-4 text-[11px] leading-4 text-muted-foreground">
            {item.flip ?? ""}
          </span>
          <span className="font-[var(--font-mystic)] text-2xl leading-8 text-foreground">
            {Array.from(item.word).map((letter, index) => (
              <span
                key={index}
                className={
                  stable[index]
                    ? "rounded bg-primary/15 px-1 text-primary"
                    : undefined
                }
              >
                {letter}
              </span>
            ))}
          </span>
        </span>
      ))}
    </p>
  );
}

function stablePositions(block: ZaksWord[]): boolean[] {
  const first = block[0]?.word ?? "";
  return Array.from(first).map((letter, index) =>
    block.every((item) => item.word[index] === letter)
  );
}

async function suffixZaksCycle(
  n: number,
  signal?: AbortSignal
): Promise<{ path: Perm[]; flips: number[] }> {
  const total = factorial(n);
  const start = new Uint8Array(n);
  for (let i = 0; i < n; i++) start[i] = i + 1;

  const seen = new Set<string>([key(start)]);
  const path: Perm[] = [start];
  const flips: number[] = [];
  let p = start;

  for (let s = 0; s < total - 1; s++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    let moved = false;
    for (let k = 2; k <= n; k++) {
      const q = suffixReverse(p, k);
      const qk = key(q);
      if (!seen.has(qk)) {
        flips.push(k);
        p = q;
        seen.add(qk);
        path.push(p);
        moved = true;
        break;
      }
    }

    if (!moved) {
      throw new Error("Suffix Zaks walk got stuck.");
    }
  }

  return { path, flips };
}

function suffixReverse(p: Perm, k: number): Perm {
  const q = new Uint8Array(p);
  for (let i = q.length - k, j = q.length - 1; i < j; i++, j--) {
    const t = q[i];
    q[i] = q[j];
    q[j] = t;
  }
  return q;
}

function lettersForPermutation(perm: Perm): string {
  let s = "";
  for (let i = 0; i < perm.length; i++) {
    s += String.fromCharCode(96 + perm[i]);
  }
  return s;
}

function blockWords(words: ZaksWord[], n: number): ZaksWord[][] {
  const blocks: ZaksWord[][] = [];
  let current: ZaksWord[] = [];

  for (const item of words) {
    if (current.length === WORDS_PER_LINE) {
      blocks.push(current);
      current = [];
    }

    current.push(item);

    if (item.flip === n || (item.flip !== undefined && item.flip > 3)) {
      blocks.push(current);
      if (item.flip > 3) {
        for (let i = 0; i < item.flip - 2; i++) blocks.push([]);
      }
      current = [];
    }
  }

  if (current.length > 0) blocks.push(current);
  return blocks;
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
    <div className={`flex items-center justify-between gap-3 ${full ? "col-span-2" : ""}`}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-right font-mono text-xs">
        {value === undefined
          ? "-"
          : typeof value === "number"
            ? NUMBER_FORMAT.format(value)
            : value}
      </dd>
    </div>
  );
}
