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

type TseroufLine =
  | { type: "words"; words: ZaksWord[] }
  | { type: "spacer" };

type TseroufRenderUnit =
  | { type: "subblock"; index: number; lines: TseroufLine[] }
  | { type: "spacer" };

interface TseroufBlock {
  index: number;
  lines: TseroufLine[];
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
      <Card className="self-start border-none bg-transparent py-0 shadow-none ring-0 lg:sticky lg:top-4">
        <CardHeader className="space-y-1 px-0">
          <CardTitle className="text-lg">Tsérouf</CardTitle>
          <CardDescription>
            All permutations of the word <span className="font-mono">{baseWord}</span>,
            listed in Zaks suffix-reversal order; each number k reverses the
            last k letters.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-0">
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

      <Card className="border-none bg-transparent py-0 pl-8 shadow-none ring-0 lg:pl-12">
        <CardContent className="p-0">
          {running ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm">{status}</p>
            </div>
          ) : (
            <div className="flex flex-col items-start gap-5 font-mono text-sm">
              {wordBlocks.map((block, blockIndex) => {
                const toneStart = toneStartForBlock(wordBlocks, blockIndex, n);
                return (
                  <TseroufBlockView
                    key={blockIndex}
                    block={block}
                    n={n}
                    toneStart={toneStart}
                  />
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TseroufBlockView({
  block,
  n,
  toneStart,
}: {
  block: TseroufBlock;
  n: number;
  toneStart: number;
}) {
  return (
    <section
      className="inline-block rounded-xl p-4"
      style={{
        backgroundColor: tintFor(toneStart, 0.035),
      }}
    >
      {n >= 6 ? (
        <div className="flex flex-col items-start gap-3">
          {subblockUnits(block.lines).map((unit, unitIndex) =>
            unit.type === "spacer" ? (
              <p key={unitIndex} className="h-5" />
            ) : (
              <section
                key={unitIndex}
                className="inline-block rounded-lg p-3"
                style={{
                  backgroundColor: tintFor(toneStart + unit.index - 1, 0.075),
                }}
              >
                <div className="space-y-3">
                  {unit.lines.map((line, lineIndex) =>
                    line.type === "spacer" ? (
                      <p key={lineIndex} className="h-5" />
                    ) : (
                      <WordLine key={lineIndex} line={line.words} />
                    )
                  )}
                </div>
              </section>
            )
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {block.lines.map((line, lineIndex) =>
            line.type === "spacer" ? (
              <p key={lineIndex} className="h-5" />
            ) : (
              <WordLine key={lineIndex} line={line.words} />
            )
          )}
        </div>
      )}
    </section>
  );
}

function WordLine({ line }: { line: ZaksWord[] }) {
  const stable = stablePositions(line);

  return (
    <p className="flex flex-wrap gap-x-4 gap-y-4">
      {line.map((item, itemIndex) => (
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

function tintFor(index: number, base: number): string {
  return `rgba(180, 120, 24, ${Math.min(base + index * 0.035, 0.38)})`;
}

function toneStartForBlock(
  blocks: TseroufBlock[],
  blockIndex: number,
  n: number
): number {
  let tone = 1;
  for (let i = 0; i < blockIndex; i++) {
    tone += n >= 6 ? subblockUnits(blocks[i].lines).filter((unit) => unit.type === "subblock").length : 1;
  }
  return tone;
}

function subblockUnits(lines: TseroufLine[]): TseroufRenderUnit[] {
  const units: TseroufRenderUnit[] = [];
  let current: TseroufLine[] = [];
  let wordLineCount = 0;
  let subblockIndex = 1;

  const flush = () => {
    if (current.length === 0) return;
    units.push({ type: "subblock", index: subblockIndex, lines: current });
    subblockIndex++;
    current = [];
    wordLineCount = 0;
  };

  for (const line of lines) {
    if (line.type === "spacer") {
      if (current.length === 0) {
        units.push({ type: "spacer" });
      } else {
        current.push(line);
      }
      continue;
    }

    current.push(line);
    wordLineCount++;
    if (wordLineCount === 4) flush();
  }

  flush();
  return units;
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

function blockWords(words: ZaksWord[], n: number): TseroufBlock[] {
  const blockSize = factorial(Math.max(0, n - 1));
  const blocks: TseroufBlock[] = [];

  for (let start = 0; start < words.length; start += blockSize) {
    const chunk = words.slice(start, start + blockSize);
    const lines: TseroufLine[] = [];
    let current: ZaksWord[] = [];

    for (let offset = 0; offset < chunk.length; offset++) {
      const item = chunk[offset];
      current.push(item);

      if (current.length === WORDS_PER_LINE) {
        lines.push({ type: "words", words: current });
        current = [];

        const completedWords = start + offset + 1;
        for (let i = 0; i < spacerCountAfter(completedWords, n); i++) {
          lines.push({ type: "spacer" });
        }
      }
    }

    if (current.length > 0) lines.push({ type: "words", words: current });

    blocks.push({
      index: blocks.length + 1,
      lines,
    });
  }

  return blocks;
}

function spacerCountAfter(completedWords: number, n: number): number {
  let count = 0;
  for (let k = 4; k <= n; k++) {
    if (completedWords % factorial(k - 1) === 0) {
      count = k - 2;
    }
  }
  return count;
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
