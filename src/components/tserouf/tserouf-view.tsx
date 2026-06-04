"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { factorial, key, type Perm } from "@/lib/pancake";
import {
  INSTRUMENTS,
  renderTseroufWav,
  tseroufMelodicTone,
  TSEROUF_SCALE_OFFSETS,
  TseroufPlayer,
  type InstrumentId,
} from "@/lib/tserouf-audio";
import {
  renderTseroufDroneWav,
  tseroufDroneTone,
  TSEROUF_DRONE_HARMONICS,
  TseroufDronePlayer,
} from "@/lib/tserouf-drone";
import { readEnumParam, readIntParam, writeUrlParams } from "@/lib/url-state";
import { toPng } from "html-to-image";
import {
  Download,
  Loader2,
  Music,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import {
  createContext,
  Fragment,
  type CSSProperties,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const NUMBER_FORMAT = new Intl.NumberFormat("en-US");
const N_OPTIONS = [2, 3, 4, 5, 6, 7] as const;
const WORDS_PER_LINE = 6;
const HEBREW_LETTERS = ["א", "ב", "ג", "ד", "ה", "ו", "ז"] as const;
const ELOHIM_LETTERS = ["א", "ל", "ה", "י", "ם"] as const;
const ELOHIM_N = 5;
const AMASH_LETTERS = ["א", "מ", "ש"] as const;
const AMASH_N = 3;
const YHW_LETTERS = ["י", "ה", "ו"] as const;
const YHW_N = 3;
const SOURCE_HEBREW_ROWS = [
  ["שתי אבנים", "בונות", "שני בתים"],
  ["שלש", "בונות", "ששה בתים"],
  ["ארבע", "בונות", "עשרים וארבע בתים"],
  ["חמש", "בונות", "מאה ועשרים בתים"],
  ["שש", "בונות", "שבע מאות ועשרים בתים"],
  ["שבע", "בונות", "חמשת אלפים וארבעים"],
] as const;
const SOURCE_HEBREW_OUTRO =
  "מכאן ואילך צא וחשב מה שאין הפה יכלה לדבר  ואין האוזן יכלה לשמוע";
const SOURCE_TRANSLATION_ROWS = [
  ["two stones", "build", "two houses"],
  ["three", "build", "six"],
  ["four", "build", "twenty-four"],
  ["five", "build", "one hundred and twenty"],
  ["six", "build", "seven hundred and twenty"],
  ["seven", "build", "five thousand and forty"],
] as const;
const SOURCE_TRANSLATION_OUTRO =
  "From here on, go out and calculate what the mouth cannot speak\nand the ear cannot hear";
type NValue = (typeof N_OPTIONS)[number];
type Alphabet = "latin" | "hebrew";
type Layout = "flat" | "tree";
type LetterSet = "sequence" | "elohim" | "amash" | "yhw";

const DEFAULT_N: NValue = 3;
const ALPHABETS: readonly Alphabet[] = ["latin", "hebrew"];
const LAYOUTS: readonly Layout[] = ["flat", "tree"];
const LETTER_SETS: readonly LetterSet[] = ["sequence", "elohim", "amash", "yhw"];
const INSTRUMENT_IDS = INSTRUMENTS.map((i) => i.id) as readonly InstrumentId[];
const DEFAULT_INSTRUMENT: InstrumentId = "guitar";

// The drone is a different *engine*, not a timbre: instead of a melodic
// two-part invention it plays each permutation as a bloom of just-intonation
// overtones over a continuous drone (see lib/tserouf-drone.ts), for an
// ecstatic/meditative listening. It lives alongside the instruments in the
// same selector for convenience.
const DRONE_CHOICE = "drone" as const;
type SoundChoice = InstrumentId | typeof DRONE_CHOICE;
const SOUND_IDS = [...INSTRUMENT_IDS, DRONE_CHOICE] as readonly SoundChoice[];
type SoundKind = "invention" | "drone";
const soundKindFor = (choice: SoundChoice): SoundKind =>
  choice === DRONE_CHOICE ? "drone" : "invention";

// A single speed control, as a percentage of each engine's natural tempo (the
// two engines have very different default note lengths, so one *relative* knob
// scales both while keeping their character). 100% = default.
const SPEED_MIN = 50;
const SPEED_MAX = 200;
const SPEED_STEP = 10;
const SPEED_OPTIONS: readonly number[] = Array.from(
  { length: (SPEED_MAX - SPEED_MIN) / SPEED_STEP + 1 },
  (_, i) => SPEED_MIN + i * SPEED_STEP
);
const DEFAULT_SPEED = 100;
// The reference tempo (100%) is what used to be 80%: 0.18 / 0.8 = 0.225 and
// 0.66 / 0.8 = 0.825, i.e. a touch slower than the old default.
const BASE_STEP_SECONDS = 0.225; // invention: seconds per note at 100%
const BASE_NOTE_SECONDS = 0.825; // meditation/chant: seconds per note at 100%
const stepSecondsForSpeed = (speed: number) => BASE_STEP_SECONDS / (speed / 100);
const noteSecondsForSpeed = (speed: number) => BASE_NOTE_SECONDS / (speed / 100);

interface TseroufState {
  n: NValue;
  alphabet: Alphabet;
  layout: Layout;
  letterSet: LetterSet;
  instrument: SoundChoice;
  speed: number;
  loop: boolean;
}

function readTseroufState(params: URLSearchParams | null): TseroufState {
  const letterSet = readEnumParam(params, "set", LETTER_SETS, "sequence");
  const layout = readEnumParam(params, "layout", LAYOUTS, "flat");
  const instrument = readEnumParam(
    params,
    "instrument",
    SOUND_IDS,
    DEFAULT_INSTRUMENT
  );
  const speed = readIntParam(params, "speed", SPEED_OPTIONS, DEFAULT_SPEED);
  const loop = readEnumParam(params, "loop", ["0", "1"], "0") === "1";

  // The "elohim" set is a fixed 5-letter Hebrew word, so it pins n and alphabet.
  if (letterSet === "elohim") {
    return { n: ELOHIM_N, alphabet: "hebrew", layout, letterSet, instrument, speed, loop };
  }

  // The "amash" set is the three mother letters, a fixed 3-letter Hebrew word.
  if (letterSet === "amash") {
    return { n: AMASH_N, alphabet: "hebrew", layout, letterSet, instrument, speed, loop };
  }

  // The "yhw" set is a fixed 3-letter Hebrew word.
  if (letterSet === "yhw") {
    return { n: YHW_N, alphabet: "hebrew", layout, letterSet, instrument, speed, loop };
  }

  return {
    n: readIntParam(params, "n", N_OPTIONS, DEFAULT_N) as NValue,
    alphabet: readEnumParam(params, "alphabet", ALPHABETS, "latin"),
    layout,
    letterSet,
    instrument,
    speed,
    loop,
  };
}

function hebrewLettersFor(letterSet: LetterSet): readonly string[] {
  if (letterSet === "elohim") return ELOHIM_LETTERS;
  if (letterSet === "amash") return AMASH_LETTERS;
  if (letterSet === "yhw") return YHW_LETTERS;
  return HEBREW_LETTERS;
}

const HebrewLettersContext = createContext<readonly string[]>(HEBREW_LETTERS);

function useHebrewLetters(): readonly string[] {
  return useContext(HebrewLettersContext);
}

type TileRegister = (word: string, el: HTMLElement | null) => void;
const TileRegisterContext = createContext<TileRegister | null>(null);

// The permutation currently sounding during playback, so tiles can highlight.
const PlayingWordContext = createContext<string | null>(null);

// Clicking a word starts playback from it; tiles call this with their word.
const PlayWordContext = createContext<((word: string) => void) | null>(null);

interface TonePreviewSettings {
  kind: SoundKind;
  playState: "stopped" | "playing" | "paused";
}

const TonePreviewContext = createContext<TonePreviewSettings>({
  kind: "invention",
  playState: "stopped",
});

interface EdgeSpec {
  path: string;
  flip?: number;
  labelX: number;
  labelY: number;
  wrap: boolean;
}

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

type RecCell =
  | { kind: "pair"; words: ZaksWord[] }
  | { kind: "group"; level: number; children: RecCell[] };

export function TseroufView() {
  const searchParams = useSearchParams();
  const initial = useMemo(() => readTseroufState(searchParams), [searchParams]);
  const [n, setN] = useState<NValue>(initial.n);
  const [alphabet, setAlphabet] = useState<Alphabet>(initial.alphabet);
  const [layout, setLayout] = useState<Layout>(initial.layout);
  const [letterSet, setLetterSet] = useState<LetterSet>(initial.letterSet);
  const [instrument, setInstrument] = useState<SoundChoice>(initial.instrument);
  const [speed, setSpeed] = useState<number>(initial.speed);
  const [loopPlayback, setLoopPlayback] = useState<boolean>(initial.loop);
  const [words, setWords] = useState<ZaksWord[]>([]);
  const [status, setStatus] = useState("Ready.");
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [playState, setPlayState] = useState<"stopped" | "playing" | "paused">(
    "stopped"
  );
  const [playingWord, setPlayingWord] = useState<string | null>(null);
  const [renderingAudio, setRenderingAudio] = useState(false);
  const renderRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<TseroufPlayer | TseroufDronePlayer | null>(null);
  const playerKindRef = useRef<SoundKind | null>(null);

  const hebrewLetters = useMemo(() => hebrewLettersFor(letterSet), [letterSet]);
  const baseWord = useMemo(
    () => Array.from({ length: n }, (_, i) => String.fromCharCode(97 + i)).join(""),
    [n]
  );
  const displayBaseWord = displayWord(baseWord, alphabet, hebrewLetters);
  const recursiveCell = useMemo(
    () => (words.length > 0 ? buildRecursiveCells(words, n) : null),
    [n, words]
  );
  const clipboardText = useMemo(
    () =>
      recursiveCell
        ? enumerationClipboardText(recursiveCell, alphabet, hebrewLetters)
        : "",
    [alphabet, hebrewLetters, recursiveCell]
  );

  const handleLetterSetChange = (value: LetterSet) => {
    setLetterSet(value);
    if (value === "elohim") {
      setN(ELOHIM_N);
      setAlphabet("hebrew");
    } else if (value === "amash") {
      setN(AMASH_N);
      setAlphabet("hebrew");
    } else if (value === "yhw") {
      setN(YHW_N);
      setAlphabet("hebrew");
    }
  };

  // Reflect every control in the URL so the view can be shared/restored,
  // including default values.
  useEffect(() => {
    writeUrlParams({
      set: letterSet,
      n: String(n),
      alphabet,
      layout,
      instrument,
      speed: String(speed),
      loop: loopPlayback ? "1" : null,
    });
  }, [n, alphabet, layout, letterSet, instrument, speed, loopPlayback]);

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

  const copyEnumeration = async () => {
    if (!clipboardText) return;

    try {
      await copyTextToClipboard(clipboardText);
      setCopied(true);
      setStatus("Copied letters-only enumeration to clipboard.");
      window.setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      setStatus(`Copy failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const downloadPNG = async () => {
    const node = renderRef.current;
    if (!node || words.length === 0) return;

    setExporting(true);
    setStatus("Generating PNG…");
    const prevWidth = node.style.width;
    try {
      // Shrink the capture box to its content so each pre-chunked line stays on
      // one row (no flex wrapping) and the left/right margins match.
      node.style.width = "max-content";
      const rect = node.getBoundingClientRect();
      const background = getComputedStyle(document.body).backgroundColor;
      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height),
        backgroundColor:
          background && background !== "rgba(0, 0, 0, 0)" ? background : "#ffffff",
        skipFonts: false,
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `tserouf_${baseWord}_${alphabet}_${layout}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setStatus("Tserouf PNG downloaded.");
    } catch (e) {
      setStatus(
        `PNG export failed: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      node.style.width = prevWidth;
      setExporting(false);
    }
  };

  const stopPlayback = useCallback(() => {
    playerRef.current?.stop();
    setPlayState("stopped");
    setPlayingWord(null);
  }, []);

  const startPlayback = (startIndex = 0) => {
    if (words.length === 0) return;
    const kind = soundKindFor(instrument);
    // The drone and the invention are different engines; swap the player if the
    // selected kind no longer matches the one we built last time.
    if (!playerRef.current || playerKindRef.current !== kind) {
      playerRef.current?.dispose();
      playerRef.current =
        kind === "drone" ? new TseroufDronePlayer() : new TseroufPlayer();
      playerKindRef.current = kind;
    }
    setPlayState("playing");
    setStatus(
      kind === "drone"
        ? "Playing the zikr drone of Tserouf…"
        : "Playing the music of Tserouf…"
    );
    playerRef.current.play(words, {
      loop: loopPlayback,
      startIndex,
      instrument: kind === "invention" ? (instrument as InstrumentId) : undefined,
      stepSeconds: stepSecondsForSpeed(speed),
      noteSeconds: noteSecondsForSpeed(speed),
      onStep: (index) => setPlayingWord(words[index]?.word ?? null),
      onEnd: () => {
        setPlayState("stopped");
        setPlayingWord(null);
        setStatus("Tserouf playback finished.");
      },
    });
  };

  // Clicking a word (re)starts playback from that word — a quick way to jump
  // straight into any point of the piece. The current player is torn down and
  // rebuilt so it begins cleanly at the chosen index.
  const wordIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    words.forEach((item, index) => map.set(item.word, index));
    return map;
  }, [words]);

  const playFromWord = useCallback(
    (word: string) => {
      const index = wordIndexMap.get(word);
      if (index === undefined) return;
      playerRef.current?.stop();
      startPlayback(index);
    },
    // startPlayback closes over current controls but is stable enough here;
    // wordIndexMap changes whenever the sequence does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wordIndexMap, instrument, loopPlayback, speed, words]
  );

  const togglePlay = () => {
    if (playState === "playing") {
      playerRef.current?.pause();
      setPlayState("paused");
      setStatus("Paused.");
      return;
    }
    if (playState === "paused") {
      playerRef.current?.resume();
      setPlayState("playing");
      setStatus("Playing the music of Tserouf…");
      return;
    }
    startPlayback();
  };

  const resetPlayback = () => {
    stopPlayback();
    setStatus("Ready.");
  };

  const handleSpeedChange = (value: number) => {
    setSpeed(value);
    const player = playerRef.current;
    if (player instanceof TseroufPlayer) {
      player.setStepSeconds(stepSecondsForSpeed(value));
    } else if (player instanceof TseroufDronePlayer) {
      player.setNoteSeconds(noteSecondsForSpeed(value));
    }
  };

  const handleInstrumentChange = (value: SoundChoice) => {
    setInstrument(value);
    const kind = soundKindFor(value);
    // Live-swap the timbre when staying within the melodic engine; otherwise
    // the engine itself must change, so stop and let the next play rebuild it.
    if (kind === "invention" && playerRef.current instanceof TseroufPlayer) {
      playerRef.current.setInstrument(value as InstrumentId);
    } else if (playerKindRef.current !== null && kind !== playerKindRef.current) {
      stopPlayback();
    }
  };

  const setLoopPlaybackEnabled = (next: boolean) => {
    setLoopPlayback(next);
    playerRef.current?.setLoop(next);
    setStatus(next ? "Loop enabled." : "Loop disabled.");
  };

  const downloadAudio = async () => {
    if (words.length === 0) return;
    setRenderingAudio(true);
    setStatus("Rendering audio…");
    try {
      const blob =
        soundKindFor(instrument) === "drone"
          ? await renderTseroufDroneWav(words, {
              noteSeconds: noteSecondsForSpeed(speed),
            })
          : await renderTseroufWav(words, {
              instrument: instrument as InstrumentId,
              stepSeconds: stepSecondsForSpeed(speed),
            });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tserouf_${baseWord}_${instrument}.wav`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus("Audio file downloaded.");
    } catch (e) {
      setStatus(
        `Audio render failed: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      setRenderingAudio(false);
    }
  };

  // Stop any playback when the sequence changes or the view unmounts.
  useEffect(() => {
    const id = window.setTimeout(() => stopPlayback(), 0);
    return () => window.clearTimeout(id);
  }, [words, stopPlayback]);

  useEffect(() => {
    return () => playerRef.current?.dispose();
  }, []);

  return (
    <div className="space-y-6">
      <SourcePassage />

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <Card className="self-start border-none bg-transparent py-0 shadow-none ring-0 lg:sticky lg:top-4">
        <CardHeader className="space-y-1 px-0">
          <CardTitle className="text-lg">Tserouf</CardTitle>
          <CardDescription>
            All permutations of the word{" "}
            <span
              dir={alphabet === "hebrew" ? "rtl" : "ltr"}
              className={`inline-block ${
                alphabet === "hebrew"
                  ? "font-[family-name:var(--font-hebrew)]"
                  : "font-mono"
              }`}
            >
              {displayBaseWord}
            </span>,
            listed in Zaks suffix-reversal order; each number k reverses the
            last k letters.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-0">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Letter set
            </Label>
            <Select
              value={letterSet}
              onValueChange={(value) => handleLetterSetChange(value as LetterSet)}
              disabled={running}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sequence">א ב ג … (sequence)</SelectItem>
                <SelectItem value="elohim">
                  <span
                    dir="rtl"
                    className="font-[family-name:var(--font-hebrew)]"
                  >
                    אלהים
                  </span>
                </SelectItem>
                <SelectItem value="amash">
                  <span
                    dir="rtl"
                    className="font-[family-name:var(--font-hebrew)]"
                  >
                    אמש
                  </span>
                </SelectItem>
                <SelectItem value="yhw">
                  <span
                    dir="rtl"
                    className="font-[family-name:var(--font-hebrew)]"
                  >
                    יהו
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Word length
            </Label>
            <Select
              value={String(n)}
              onValueChange={(value) => setN(Number(value) as NValue)}
              disabled={
                running ||
                letterSet === "elohim" ||
                letterSet === "amash" ||
                letterSet === "yhw"
              }
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

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() =>
              setAlphabet((current) =>
                current === "latin" ? "hebrew" : "latin"
              )
            }
          >
            Show {alphabet === "latin" ? "Hebrew" : "Latin"} letters
          </Button>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Layout
            </Label>
            <div className="grid grid-cols-2 gap-1 rounded-md border p-1">
              <Button
                type="button"
                size="sm"
                variant={layout === "flat" ? "default" : "ghost"}
                className="h-8"
                onClick={() => setLayout("flat")}
              >
                Flat
              </Button>
              <Button
                type="button"
                size="sm"
                variant={layout === "tree" ? "default" : "ghost"}
                className="h-8"
                onClick={() => setLayout("tree")}
              >
                Tree
              </Button>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={copyEnumeration}
            disabled={running || words.length === 0}
          >
            {copied ? "Copied" : "copy tserouf to clipboard"}
          </Button>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={downloadPNG}
            disabled={running || exporting || words.length === 0}
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {exporting ? "Exporting…" : "download tserouf as PNG"}
          </Button>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Instrument
            </Label>
            <Select
              value={instrument}
              onValueChange={(value) =>
                handleInstrumentChange(value as SoundChoice)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INSTRUMENTS.map((inst) => (
                  <SelectItem key={inst.id} value={inst.id}>
                    {inst.label}
                  </SelectItem>
                ))}
                <SelectItem value={DRONE_CHOICE}>
                  Zikr drone (meditation)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Speed
              </Label>
              <span className="text-xs tabular-nums text-muted-foreground">
                {speed}%
              </span>
            </div>
            <input
              type="range"
              min={SPEED_MIN}
              max={SPEED_MAX}
              step={SPEED_STEP}
              value={speed}
              onChange={(e) => handleSpeedChange(Number(e.target.value))}
              className="w-full accent-primary"
              aria-label="Playback speed"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Playback
            </Label>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <Label
                htmlFor="tserouf-loop-toggle"
                className="cursor-pointer text-sm font-normal"
              >
                Loop after final arrival
              </Label>
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  {loopPlayback ? "On" : "Off"}
                </span>
                <Checkbox
                  id="tserouf-loop-toggle"
                  checked={loopPlayback}
                  disabled={running || words.length === 0}
                  onCheckedChange={(checked) =>
                    setLoopPlaybackEnabled(checked === true)
                  }
                  aria-label="Toggle playback loop"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant={playState !== "stopped" ? "default" : "outline"}
              className="flex-1"
              onClick={togglePlay}
              disabled={running || words.length === 0}
            >
              {playState === "playing" ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {playState === "playing"
                ? "pause"
                : playState === "paused"
                ? "resume"
                : "play the music of Tserouf"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Reset playback"
              title="Reset"
              onClick={resetPlayback}
              disabled={running || playState === "stopped"}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={downloadAudio}
            disabled={running || renderingAudio || words.length === 0}
          >
            {renderingAudio ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Music className="h-4 w-4" />
            )}
            {renderingAudio ? "Rendering…" : "download audio (WAV)"}
          </Button>

          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
            <Stat
              label="Word"
              value={displayBaseWord}
              dir={alphabet === "hebrew" ? "rtl" : "ltr"}
            />
            <Stat
              label="Letters"
              value={alphabet === "hebrew" ? "Hebrew" : "Latin"}
            />
            <Stat label="Permutations" value={factorial(n)} />
            <Stat
              label="Layout"
              value={layout === "tree" ? "Tree" : "Flat"}
            />
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
          ) : recursiveCell ? (
            <HebrewLettersContext.Provider value={hebrewLetters}>
              <PlayingWordContext.Provider value={playingWord}>
                <PlayWordContext.Provider value={playFromWord}>
                  <TonePreviewContext.Provider
                    value={{
                      kind: soundKindFor(instrument),
                      playState,
                    }}
                  >
                    <div ref={renderRef} className="p-2 font-mono text-sm">
                      {layout === "tree" ? (
                        <TreeView cell={recursiveCell} alphabet={alphabet} n={n} />
                      ) : (
                        <FlatWordsView words={words} alphabet={alphabet} n={n} />
                      )}
                    </div>
                  </TonePreviewContext.Provider>
                </PlayWordContext.Provider>
              </PlayingWordContext.Provider>
            </HebrewLettersContext.Provider>
          ) : null}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}

function SourcePassage() {
  return (
    <figure className="max-w-4xl space-y-6 rounded-xl border border-border/70 bg-card/55 p-5">
      <blockquote dir="rtl" className="space-y-4 font-[family-name:var(--font-hebrew)] text-2xl leading-9 text-foreground">
        <div className="grid w-fit grid-cols-[max-content_max-content_max-content] gap-x-4">
          {SOURCE_HEBREW_ROWS.map(([subject, verb, object]) => (
            <div key={subject} className="contents">
              <span>{subject}</span>
              <span>{verb}</span>
              <span>{object}</span>
            </div>
          ))}
        </div>
        <p>{SOURCE_HEBREW_OUTRO}</p>
      </blockquote>
      <figcaption className="max-w-3xl space-y-3 font-[family-name:var(--font-mystic)] text-xl leading-8 text-muted-foreground">
        <div className="grid w-fit grid-cols-[max-content_max-content_max-content] gap-x-3">
          {SOURCE_TRANSLATION_ROWS.map(([subject, verb, object]) => (
            <div key={subject} className="contents">
              <span>{subject}</span>
              <span>{verb}</span>
              <span>{object}</span>
            </div>
          ))}
        </div>
        <p className="whitespace-pre-line">{SOURCE_TRANSLATION_OUTRO}</p>
      </figcaption>
    </figure>
  );
}

function buildRecursiveCells(words: ZaksWord[], level: number): RecCell {
  if (level <= 2 || words.length <= 2) {
    return { kind: "pair", words };
  }
  const childSize = factorial(level - 1);
  const children: RecCell[] = [];
  for (let i = 0; i < words.length; i += childSize) {
    children.push(buildRecursiveCells(words.slice(i, i + childSize), level - 1));
  }
  return { kind: "group", level, children };
}

function TreeView({
  cell,
  alphabet,
  n,
}: {
  cell: RecCell;
  alphabet: Alphabet;
  n: number;
}) {
  return (
    <div className="tserouf-tree w-full overflow-x-auto pb-4">
      <ul>
        <TreeNode cell={cell} alphabet={alphabet} n={n} />
      </ul>
    </div>
  );
}

function TreeNode({
  cell,
  alphabet,
  n,
}: {
  cell: RecCell;
  alphabet: Alphabet;
  n: number;
}) {
  if (cell.kind === "pair") {
    return (
      <li>
        <TreeLeaf words={cell.words} alphabet={alphabet} />
      </li>
    );
  }

  if (cell.level <= 3) {
    return (
      <li>
        <TreeLeaf words={collectWords(cell)} alphabet={alphabet} />
      </li>
    );
  }

  const fixedLen = n - cell.level;
  const sample = firstWordOf(cell);
  const prefix = sample.slice(0, fixedLen);

  return (
    <li>
      <TreeBranchLabel
        prefix={prefix}
        level={cell.level}
        n={n}
        alphabet={alphabet}
      />
      <ul>
        {cell.children.map((child, i) => (
          <TreeNode key={i} cell={child} alphabet={alphabet} n={n} />
        ))}
      </ul>
    </li>
  );
}

function TreeBranchLabel({
  prefix,
  level,
  n,
  alphabet,
}: {
  prefix: string;
  level: number;
  n: number;
  alphabet: Alphabet;
}) {
  const isHebrew = alphabet === "hebrew";
  const hebrewLetters = useHebrewLetters();
  const depth = n - level;
  const alpha = Math.min(0.34, 0.07 + depth * 0.06);

  return (
    <span
      className="relative z-10 inline-flex flex-col items-center gap-0.5"
      title={prefix ? `Fixed prefix: ${displayWord(prefix, alphabet, hebrewLetters)}` : "Full set — no letter fixed yet"}
    >
      <span
        className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border px-2 text-lg leading-none"
        style={{
          backgroundColor: `rgba(180, 120, 24, ${alpha})`,
          borderColor: `rgba(120, 75, 15, ${Math.min(0.5, 0.15 + depth * 0.06)})`,
        }}
      >
        {prefix ? (
          <span
            dir={isHebrew ? "rtl" : "ltr"}
            className={`[unicode-bidi:isolate] ${
              isHebrew
                ? "font-[family-name:var(--font-hebrew)] font-medium"
                : "font-[family-name:var(--font-mystic)]"
            }`}
          >
            {displayWord(prefix, alphabet, hebrewLetters)}
          </span>
        ) : (
          <span className="text-muted-foreground">•</span>
        )}
      </span>
      <span className="font-mono text-[10px] text-muted-foreground">
        k={level}
      </span>
    </span>
  );
}

function TreeLeaf({
  words,
  alphabet,
}: {
  words: ZaksWord[];
  alphabet: Alphabet;
}) {
  const stable = stablePositions(words);
  const isHebrew = alphabet === "hebrew";

  return (
    <div
      dir={isHebrew ? "rtl" : "ltr"}
      className="relative z-10 inline-flex flex-col items-center gap-0.5 rounded-md p-1.5"
      style={{ backgroundColor: "rgba(180, 120, 24, 0.06)" }}
    >
      {words.map((item, i) => (
        <Fragment key={`${i}-${item.word}`}>
          <WordTile item={item} stable={stable} alphabet={alphabet} />
          <FlipConnector value={item.flip} />
        </Fragment>
      ))}
    </div>
  );
}

function firstWordOf(cell: RecCell): string {
  let current = cell;
  while (current.kind === "group") {
    current = current.children[0];
  }
  return current.words[0]?.word ?? "";
}

function collectWords(cell: RecCell): ZaksWord[] {
  if (cell.kind === "pair") return cell.words;
  const out: ZaksWord[] = [];
  for (const child of cell.children) out.push(...collectWords(child));
  return out;
}

function FlatWordsView({
  words,
  alphabet,
  n,
}: {
  words: ZaksWord[];
  alphabet: Alphabet;
  n: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tilesRef = useRef<Map<string, HTMLElement>>(new Map());
  const [edges, setEdges] = useState<EdgeSpec[]>([]);
  const [overlaySize, setOverlaySize] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });

  const register = useCallback<TileRegister>((word, el) => {
    if (el) tilesRef.current.set(word, el);
    else tilesRef.current.delete(word);
  }, []);

  const wordBlocks = useMemo(() => blockWords(words, n), [n, words]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const cRect = container.getBoundingClientRect();
      setOverlaySize({ w: cRect.width, h: cRect.height });
      const tiles = tilesRef.current;
      const specs: EdgeSpec[] = [];
      for (let i = 0; i < words.length - 1; i++) {
        const aEl = tiles.get(words[i].word);
        const bEl = tiles.get(words[i + 1].word);
        if (!aEl || !bEl) continue;
        specs.push(
          buildEdge(relRect(aEl, cRect), relRect(bEl, cRect), words[i].flip)
        );
      }
      setEdges(specs);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    let cancelled = false;
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (!cancelled) measure();
      });
    }
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [words, alphabet, n]);

  return (
    <TileRegisterContext.Provider value={register}>
      <div
        ref={containerRef}
        className="relative flex flex-col items-start gap-16 font-mono text-sm"
      >
        {wordBlocks.map((block, blockIndex) => {
          const toneStart = toneStartForBlock(wordBlocks, blockIndex, n);
          return (
            <TseroufBlockView
              key={blockIndex}
              block={block}
              n={n}
              alphabet={alphabet}
              toneStart={toneStart}
            />
          );
        })}
        <EdgeOverlay edges={edges} width={overlaySize.w} height={overlaySize.h} />
      </div>
    </TileRegisterContext.Provider>
  );
}

function TseroufBlockView({
  block,
  n,
  alphabet,
  toneStart,
}: {
  block: TseroufBlock;
  n: number;
  alphabet: Alphabet;
  toneStart: number;
}) {
  const lines = useMemo(() => trimTrailingSpacers(block.lines), [block]);
  return (
    <section
      className="inline-block rounded-xl p-4"
      style={{
        backgroundColor: tintFor(toneStart, 0.035),
      }}
    >
      {n >= 6 ? (
        <div className="flex flex-col items-start gap-5">
          {subblockUnits(lines).map((unit, unitIndex) =>
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
                <div className="space-y-6">
                  {unit.lines.map((line, lineIndex) =>
                    line.type === "spacer" ? (
                      <p key={lineIndex} className="h-5" />
                    ) : (
                      <WordLine
                        key={lineIndex}
                        line={line.words}
                        alphabet={alphabet}
                      />
                    )
                  )}
                </div>
              </section>
            )
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {lines.map((line, lineIndex) =>
            line.type === "spacer" ? (
              <p key={lineIndex} className="h-5" />
            ) : (
              <WordLine key={lineIndex} line={line.words} alphabet={alphabet} />
            )
          )}
        </div>
      )}
    </section>
  );
}

function trimTrailingSpacers(lines: TseroufLine[]): TseroufLine[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1].type === "spacer") end--;
  return lines.slice(0, end);
}

function EdgeOverlay({
  edges,
  width,
  height,
}: {
  edges: EdgeSpec[];
  width: number;
  height: number;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const solidStroke = isDark
    ? "rgba(252, 211, 77, 0.35)"
    : "rgba(217, 119, 6, 0.45)";
  const wrapStroke = isDark
    ? "rgba(252, 211, 77, 0.25)"
    : "rgba(245, 158, 11, 0.35)";
  const labelFill = isDark ? "#fcd34d" : "#b45309";

  if (edges.length === 0) return null;
  return (
    <svg
      aria-hidden
      width={width || undefined}
      height={height || undefined}
      className="pointer-events-none absolute inset-0 z-30 h-full w-full overflow-visible"
    >
      {edges.map((edge, i) => (
        <path
          key={`p-${i}`}
          d={edge.path}
          fill="none"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeDasharray={edge.wrap ? "4 3" : undefined}
          stroke={edge.wrap ? wrapStroke : solidStroke}
        />
      ))}
      {edges.map((edge, i) =>
        edge.flip ? (
          <text
            key={`t-${i}`}
            x={edge.labelX}
            y={edge.labelY}
            textAnchor="middle"
            dominantBaseline="central"
            fill={labelFill}
            style={{
              fontSize: 10,
              fontFamily: "var(--font-mono)",
            }}
          >
            {edge.flip}
          </text>
        ) : null
      )}
    </svg>
  );
}

function relRect(el: HTMLElement, container: DOMRect) {
  const r = el.getBoundingClientRect();
  const left = r.left - container.left;
  const right = r.right - container.left;
  const top = r.top - container.top;
  const bottom = r.bottom - container.top;
  return {
    left,
    right,
    top,
    bottom,
    cx: (left + right) / 2,
    cy: (top + bottom) / 2,
    height: r.height,
  };
}

type RelRect = ReturnType<typeof relRect>;

function buildEdge(a: RelRect, b: RelRect, flip?: number): EdgeSpec {
  const sameRow = Math.abs(a.cy - b.cy) < Math.min(a.height, b.height) * 0.6;
  let sx: number;
  let ex: number;
  const sy = a.cy;
  const ey = b.cy;
  let c1x: number;
  let c1y: number;
  let c2x: number;
  let c2y: number;

  if (sameRow) {
    const forward = b.cx >= a.cx;
    sx = forward ? a.right : a.left;
    ex = forward ? b.left : b.right;
    const mx = (sx + ex) / 2;
    c1x = mx;
    c1y = sy;
    c2x = mx;
    c2y = ey;
  } else {
    const wrapLeft = b.cx < a.cx;
    sx = wrapLeft ? a.right : a.left;
    ex = wrapLeft ? b.left : b.right;
    const out = wrapLeft ? 40 : -40;
    const my = (sy + ey) / 2;
    c1x = sx + out;
    c1y = my;
    c2x = ex - out;
    c2y = my;
  }

  const path = `M ${sx} ${sy} C ${c1x} ${c1y} ${c2x} ${c2y} ${ex} ${ey}`;
  const labelX = 0.125 * sx + 0.375 * c1x + 0.375 * c2x + 0.125 * ex;
  const labelY =
    0.125 * sy + 0.375 * c1y + 0.375 * c2y + 0.125 * ey - (sameRow ? 7 : 0);

  return { path, flip, labelX, labelY, wrap: !sameRow };
}

function WordLine({ line, alphabet }: { line: ZaksWord[]; alphabet: Alphabet }) {
  const stable = stablePositions(line);
  const isHebrew = alphabet === "hebrew";

  return (
    <p
      dir={isHebrew ? "rtl" : "ltr"}
      className="flex flex-wrap items-center gap-x-7 gap-y-7"
    >
      {line.map((item, itemIndex) => (
        <WordTile
          key={`${itemIndex}-${item.word}`}
          item={item}
          stable={stable}
          alphabet={alphabet}
        />
      ))}
    </p>
  );
}

function WordTile({
  item,
  stable,
  alphabet,
}: {
  item: ZaksWord;
  stable: boolean[];
  alphabet: Alphabet;
}) {
  const isHebrew = alphabet === "hebrew";
  const hebrewLetters = useHebrewLetters();
  const register = useContext(TileRegisterContext);
  const playingWord = useContext(PlayingWordContext);
  const playWord = useContext(PlayWordContext);
  const tonePreview = useContext(TonePreviewContext);
  const word = item.word;
  const isActive = playingWord === word;
  const elRef = useRef<HTMLSpanElement | null>(null);
  const setRef = useCallback(
    (el: HTMLSpanElement | null) => {
      elRef.current = el;
      register?.(word, el);
    },
    [register, word]
  );
  useEffect(() => {
    if (isActive) {
      elRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isActive]);
  return (
    <span
      ref={setRef}
      dir={isHebrew ? "rtl" : "ltr"}
      role={playWord ? "button" : undefined}
      tabIndex={playWord ? 0 : undefined}
      onClick={playWord ? () => playWord(word) : undefined}
      onKeyDown={
        playWord
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                playWord(word);
              }
            }
          : undefined
      }
      title={
        playWord
          ? `Play from here · ${tonePreviewTitle(item.word, tonePreview.kind)} · ${
              isEvenPermutationWord(item.word) ? "Even" : "Odd"
            } permutation`
          : `${tonePreviewTitle(item.word, tonePreview.kind)} · ${
              isEvenPermutationWord(item.word) ? "Even" : "Odd"
            } permutation`
      }
      className={`inline-flex flex-col items-stretch rounded-md border px-1.5 py-1 text-2xl leading-8 transition-shadow [unicode-bidi:isolate] ${
        playWord
          ? "cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-offset-background focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          : ""
      } ${parityClassName(item.word)} ${
        isActive
          ? `ring-2 ring-offset-1 ring-offset-background ${
              isEvenPermutationWord(item.word)
                ? "ring-sky-500 dark:ring-sky-300"
                : "ring-rose-500 dark:ring-rose-300"
            }`
          : ""
      } ${
        isHebrew
          ? "font-[family-name:var(--font-hebrew)] font-medium"
          : "font-[family-name:var(--font-mystic)]"
      }`}
    >
      <span className="inline-flex justify-center">
        {Array.from(item.word).map((letter, index) => (
          <span key={index} className={letterClassName(stable, index)}>
            {displayLetter(letter, alphabet, hebrewLetters)}
          </span>
        ))}
      </span>
      <TonalPreview
        word={word}
        kind={tonePreview.kind}
        active={isActive && tonePreview.playState === "playing"}
      />
    </span>
  );
}

function TonalPreview({
  word,
  kind,
  active,
}: {
  word: string;
  kind: SoundKind;
  active: boolean;
}) {
  const tones = tonePreviewTones(word, kind);
  if (tones.length === 0) return null;

  const width = Math.max(42, tones.length * 13);
  const height = 30;
  const xFor = (index: number) =>
    tones.length === 1 ? width / 2 : 5 + (index * (width - 10)) / (tones.length - 1);
  const points = tones.map((tone, index) => `${xFor(index)},${tone.y}`).join(" ");

  return (
    <span
      dir="ltr"
      aria-hidden
      className="relative mx-auto mt-0.5 block overflow-hidden rounded-sm bg-background/35"
      style={
        {
          width,
          height,
        } as CSSProperties
      }
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full overflow-visible"
        preserveAspectRatio="xMidYMid meet"
      >
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.45"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {tones.map((tone, index) => (
          <circle
            key={`${tone.label}-${index}`}
            cx={xFor(index)}
            cy={tone.y}
            r={active ? 2.2 : 1.7}
            fill="currentColor"
            opacity={active ? 0.95 : 0.55}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </span>
  );
}

function tonePreviewTones(
  word: string,
  kind: SoundKind
): { y: number; label: string }[] {
  const letters = Array.from(word);
  const maxLetterIndex = Math.max(
    0,
    ...letters.map((letter) => letter.charCodeAt(0) - 97)
  );
  const melodicMax =
    TSEROUF_SCALE_OFFSETS[maxLetterIndex] ?? maxLetterIndex * 2;
  const droneMax = Math.log2(
    TSEROUF_DRONE_HARMONICS[maxLetterIndex] ?? maxLetterIndex + 2
  );
  const range = kind === "drone" ? [Math.log2(2), droneMax] : [0, melodicMax];

  return letters.map((letter) => {
    const value =
      kind === "drone"
        ? Math.log2(tseroufDroneTone(letter).harmonic)
        : tseroufMelodicTone(letter).semitone;
    const [min, max] = range;
    const norm = max === min ? 0.5 : (value - min) / (max - min);
    return {
      y: 25 - norm * 20,
      label:
        kind === "drone"
          ? tseroufDroneTone(letter).label
          : tseroufMelodicTone(letter).label,
    };
  });
}

function tonePreviewTitle(word: string, kind: SoundKind): string {
  const labels = Array.from(word).map((letter) =>
    kind === "drone" ? tseroufDroneTone(letter).label : tseroufMelodicTone(letter).label
  );
  return kind === "drone"
    ? `Overtone contour: ${labels.join(" -> ")}`
    : `Tone contour: ${labels.join(" -> ")}`;
}

function FlipConnector({ value }: { value?: number }) {
  if (!value) return null;
  return (
    <span
      dir="ltr"
      aria-hidden
      title={`Reverses the last ${value} letters`}
      className="inline-flex items-center self-center px-0.5 font-mono text-[10px] leading-none text-amber-700/70 underline decoration-dotted underline-offset-2 dark:text-amber-300/60"
    >
      {value}
    </span>
  );
}

function parityClassName(word: string): string {
  return isEvenPermutationWord(word)
    ? "border-sky-300/50 bg-sky-500/12 text-sky-700 dark:border-sky-400/35 dark:bg-sky-400/15 dark:text-sky-200"
    : "border-rose-300/50 bg-rose-500/12 text-rose-700 dark:border-rose-400/35 dark:bg-rose-400/15 dark:text-rose-200";
}

function letterClassName(stable: boolean[], index: number): string {
  if (!stable[index]) return "inline-block px-1";

  const startsRun = !stable[index - 1];
  const endsRun = !stable[index + 1];

  return [
    "inline-block px-1 bg-current/10",
    startsRun ? "rounded-s" : "",
    endsRun ? "rounded-e" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function isEvenPermutationWord(word: string): boolean {
  let inversions = 0;
  const letters = Array.from(word);

  for (let i = 0; i < letters.length; i++) {
    for (let j = i + 1; j < letters.length; j++) {
      if (letters[i] > letters[j]) inversions++;
    }
  }

  return inversions % 2 === 0;
}

function displayWord(
  word: string,
  alphabet: Alphabet,
  hebrewLetters: readonly string[]
): string {
  return Array.from(word)
    .map((letter) => displayLetter(letter, alphabet, hebrewLetters))
    .join("");
}

function displayLetter(
  letter: string,
  alphabet: Alphabet,
  hebrewLetters: readonly string[]
): string {
  if (alphabet === "latin") return letter;
  return hebrewLetters[letter.charCodeAt(0) - 97] ?? letter;
}

function enumerationClipboardText(
  root: RecCell,
  alphabet: Alphabet,
  hebrewLetters: readonly string[]
): string {
  const collectWords = (cell: RecCell, out: string[]): void => {
    if (cell.kind === "pair") {
      for (const item of cell.words)
        out.push(displayWord(item.word, alphabet, hebrewLetters));
    } else {
      for (const child of cell.children) collectWords(child, out);
    }
  };

  const format = (cell: RecCell): string => {
    if (cell.kind === "pair") {
      return cell.words
        .map((w) => displayWord(w.word, alphabet, hebrewLetters))
        .join(" ");
    }
    if (cell.level <= 3) {
      const words: string[] = [];
      collectWords(cell, words);
      return words.join(" ");
    }
    const separator = "\n" + "\n".repeat(Math.min(cell.level - 3, 2));
    return cell.children.map(format).join(separator);
  };

  return format(root);
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("The browser blocked clipboard access.");
    }
  } finally {
    document.body.removeChild(textarea);
  }
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

function Stat({
  label,
  value,
  dir = "ltr",
  full,
}: {
  label: string;
  value: number | string | undefined;
  dir?: "ltr" | "rtl";
  full?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 ${full ? "col-span-2" : ""}`}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd dir={dir} className="truncate text-right font-mono text-xs">
        {value === undefined
          ? "-"
          : typeof value === "number"
            ? NUMBER_FORMAT.format(value)
            : value}
      </dd>
    </div>
  );
}
