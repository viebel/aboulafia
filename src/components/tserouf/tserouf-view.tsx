"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
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
type Layout = "flat" | "hamilton";
type LetterSet = "sequence" | "elohim" | "amash" | "yhw";

const DEFAULT_N: NValue = 3;
const ALPHABETS: readonly Alphabet[] = ["latin", "hebrew"];
const URL_LAYOUTS = ["flat", "tree", "hamilton"] as const;
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

const TEMPO_OPTIONS = [60, 72, 88, 108, 128, 152, 176, 208, 240] as const;
const DEFAULT_TEMPO = 128;
const secondsPerBeat = (tempo: number) => 60 / tempo;
const RHYTHM_VOLUME_OPTIONS = Array.from({ length: 21 }, (_, i) => i * 10);
const DEFAULT_RHYTHM_VOLUME = 100;
const WAV_LOOP_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const WAV_LOOP_PARAM_OPTIONS = [
  ...WAV_LOOP_OPTIONS.map(String),
  "infinite",
] as const;
const DEFAULT_WAV_LOOPS = 1;
type WavLoops = (typeof WAV_LOOP_OPTIONS)[number] | "infinite";
const wavLoopRenderCount = (loops: WavLoops) => (loops === "infinite" ? 10 : loops);
function previousWavLoops(current: WavLoops): WavLoops {
  if (current === "infinite") return WAV_LOOP_OPTIONS[WAV_LOOP_OPTIONS.length - 1];
  const index = WAV_LOOP_OPTIONS.indexOf(current);
  return WAV_LOOP_OPTIONS[Math.max(0, index - 1)];
}
function nextWavLoops(current: WavLoops): WavLoops {
  if (current === "infinite") return WAV_LOOP_OPTIONS[WAV_LOOP_OPTIONS.length - 1];
  const index = WAV_LOOP_OPTIONS.indexOf(current);
  return WAV_LOOP_OPTIONS[Math.min(WAV_LOOP_OPTIONS.length - 1, index + 1)];
}

interface TseroufState {
  n: NValue;
  alphabet: Alphabet;
  layout: Layout;
  letterSet: LetterSet;
  instrument: SoundChoice;
  tempo: number;
  rhythmVolume: number;
  wavLoops: WavLoops;
  loop: boolean;
}

function readTseroufState(params: URLSearchParams | null): TseroufState {
  const letterSet = readEnumParam(params, "set", LETTER_SETS, "sequence");
  const layoutParam = readEnumParam(params, "layout", URL_LAYOUTS, "flat");
  const layout: Layout = layoutParam === "tree" ? "hamilton" : layoutParam;
  const instrument = readEnumParam(
    params,
    "instrument",
    SOUND_IDS,
    DEFAULT_INSTRUMENT
  );
  const tempo = readIntParam(params, "tempo", TEMPO_OPTIONS, DEFAULT_TEMPO);
  const rhythmVolume = readIntParam(
    params,
    "rhythm",
    RHYTHM_VOLUME_OPTIONS,
    DEFAULT_RHYTHM_VOLUME
  );
  const wavLoopParam = readEnumParam(
    params,
    "wavLoops",
    WAV_LOOP_PARAM_OPTIONS,
    String(DEFAULT_WAV_LOOPS)
  );
  const wavLoops: WavLoops =
    wavLoopParam === "infinite" ? "infinite" : (Number(wavLoopParam) as WavLoops);
  const loop = readEnumParam(params, "loop", ["0", "1"], "0") === "1";

  // The "elohim" set is a fixed 5-letter Hebrew word, so it pins n and alphabet.
  if (letterSet === "elohim") {
    return { n: ELOHIM_N, alphabet: "hebrew", layout, letterSet, instrument, tempo, rhythmVolume, wavLoops, loop };
  }

  // The "amash" set is the three mother letters, a fixed 3-letter Hebrew word.
  if (letterSet === "amash") {
    return { n: AMASH_N, alphabet: "hebrew", layout, letterSet, instrument, tempo, rhythmVolume, wavLoops, loop };
  }

  // The "yhw" set is a fixed 3-letter Hebrew word.
  if (letterSet === "yhw") {
    return { n: YHW_N, alphabet: "hebrew", layout, letterSet, instrument, tempo, rhythmVolume, wavLoops, loop };
  }

  return {
    n: readIntParam(params, "n", N_OPTIONS, DEFAULT_N) as NValue,
    alphabet: readEnumParam(params, "alphabet", ALPHABETS, "latin"),
    layout,
    letterSet,
    instrument,
    tempo,
    rhythmVolume,
    wavLoops,
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

interface PlaybackFocus {
  word: string;
  wordIndex: number;
  sequenceIndex: number;
  sequenceLength: number;
  letterIndex: number;
  mode: PlaybackMode;
}

// The permutation and letter currently sounding during playback.
const PlayingFocusContext = createContext<PlaybackFocus | null>(null);

// Clicking a word starts playback from it; tiles call this with their word.
const PlayWordContext = createContext<((word: string) => void) | null>(null);

interface TonePreviewSettings {
  kind: SoundKind;
}

const TonePreviewContext = createContext<TonePreviewSettings>({
  kind: "invention",
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

type PlaybackMode = "impro" | "zaks";

interface ImproPathStep {
  word: string;
  sourceIndex: number;
  note: ZaksWord;
  role: string;
  duration: string;
  durationRatio: number;
}

export function TseroufView() {
  const searchParams = useSearchParams();
  const initial = useMemo(() => readTseroufState(searchParams), [searchParams]);
  const [n, setN] = useState<NValue>(initial.n);
  const [alphabet, setAlphabet] = useState<Alphabet>(initial.alphabet);
  const [layout, setLayout] = useState<Layout>(initial.layout);
  const [letterSet, setLetterSet] = useState<LetterSet>(initial.letterSet);
  const [instrument, setInstrument] = useState<SoundChoice>(initial.instrument);
  const [tempo, setTempo] = useState<number>(initial.tempo);
  const [rhythmVolume, setRhythmVolume] = useState<number>(
    initial.rhythmVolume
  );
  const [wavLoops, setWavLoops] = useState<WavLoops>(initial.wavLoops);
  const [loopPlayback] = useState<boolean>(initial.loop);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>("impro");
  const [words, setWords] = useState<ZaksWord[]>([]);
  const [status, setStatus] = useState("Ready.");
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [playState, setPlayState] = useState<"stopped" | "playing" | "paused">(
    "stopped"
  );
  const [playingFocus, setPlayingFocus] = useState<PlaybackFocus | null>(null);
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
  const improPath = useMemo(
    () => buildImprovisationPath(words, baseWord),
    [baseWord, words]
  );
  const improEnabled = n === 4 && improPath.length > 0;
  const effectivePlaybackMode: PlaybackMode =
    playbackMode === "impro" && !improEnabled ? "zaks" : playbackMode;
  const playbackSteps = useMemo(
    () => (effectivePlaybackMode === "impro" ? improPath : null),
    [effectivePlaybackMode, improPath]
  );
  const playbackNotes = useMemo(
    () => (playbackSteps ? playbackSteps.map((step) => step.note) : words),
    [playbackSteps, words]
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
      tempo: String(tempo),
      rhythm:
        rhythmVolume === DEFAULT_RHYTHM_VOLUME ? null : String(rhythmVolume),
      wavLoops: wavLoops === DEFAULT_WAV_LOOPS ? null : String(wavLoops),
      loop: loopPlayback ? "1" : null,
    });
  }, [
    n,
    alphabet,
    layout,
    letterSet,
    instrument,
    tempo,
    rhythmVolume,
    wavLoops,
    loopPlayback,
  ]);

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
    setPlayingFocus(null);
  }, []);

  const startPlayback = (
    startIndex = 0,
    mode: PlaybackMode = effectivePlaybackMode
  ) => {
    const activeSteps = mode === "impro" ? improPath : null;
    const activeNotes = activeSteps ? activeSteps.map((step) => step.note) : words;
    if (activeNotes.length === 0) return;
    const kind = mode === "impro" ? "invention" : soundKindFor(instrument);
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
      mode === "impro"
        ? "Playing the guitar improvisation path…"
        : kind === "drone"
        ? "Playing the zikr drone of Tserouf…"
        : "Playing the music of Tserouf…"
    );
    playerRef.current.play(activeNotes, {
      loop: loopPlayback,
      startIndex,
      loopStartIndex:
        mode === "impro" &&
        activeNotes.length > 1 &&
        activeNotes[0]?.word === activeNotes[activeNotes.length - 1]?.word
          ? 1
          : 0,
      instrument:
        kind === "invention"
          ? mode === "impro"
            ? "guitar"
            : (instrument as InstrumentId)
          : undefined,
      playbackStyle: mode === "impro" ? "guitar-impro" : "strict",
      rhythmVolume: rhythmVolume / 100,
      stepSeconds: secondsPerBeat(tempo),
      noteSeconds: secondsPerBeat(tempo),
      onStep: (index, letterIndex = 0) => {
        const note = activeNotes[index];
        const pathStep = activeSteps?.[index];
        const sourceIndex = pathStep?.sourceIndex ?? index;
        const word = note?.word;
        setPlayingFocus(
          word === undefined
            ? null
            : {
                word,
                wordIndex: sourceIndex,
                sequenceIndex: index,
                sequenceLength: activeNotes.length,
                letterIndex,
                mode,
              }
        );
      },
      onEnd: () => {
        setPlayState("stopped");
        setPlayingFocus(null);
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
      const pathIndex = playbackSteps?.findIndex((step) => step.word === word);
      if (improEnabled && pathIndex !== undefined && pathIndex >= 0) {
        playerRef.current?.stop();
        startPlayback(pathIndex, "impro");
        return;
      }
      const index = wordIndexMap.get(word);
      if (index === undefined) return;
      playerRef.current?.stop();
      setPlaybackMode("zaks");
      startPlayback(index, "zaks");
    },
    // startPlayback closes over current controls but is stable enough here;
    // wordIndexMap changes whenever the sequence does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      effectivePlaybackMode,
      improEnabled,
      wordIndexMap,
      instrument,
      loopPlayback,
      playbackMode,
      tempo,
      rhythmVolume,
      words,
    ]
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
      setStatus(
        effectivePlaybackMode === "impro"
          ? "Playing the guitar improvisation path…"
          : "Playing the music of Tserouf…"
      );
      return;
    }
    startPlayback();
  };

  const handlePlaybackModeChange = (mode: PlaybackMode) => {
    if (mode === "impro" && !improEnabled) return;
    setPlaybackMode(mode);
    if (playState !== "stopped") stopPlayback();
  };

  const resetPlayback = () => {
    stopPlayback();
    setStatus("Ready.");
  };

  const handleTempoChange = (value: number) => {
    setTempo(value);
    const player = playerRef.current;
    if (player instanceof TseroufPlayer) {
      player.setStepSeconds(secondsPerBeat(value));
    } else if (player instanceof TseroufDronePlayer) {
      player.setNoteSeconds(secondsPerBeat(value));
    }
  };

  const handleRhythmVolumeChange = (value: number) => {
    setRhythmVolume(value);
    if (playerRef.current instanceof TseroufPlayer) {
      playerRef.current.setRhythmVolume(value / 100);
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

  const downloadAudio = async () => {
    if (words.length === 0) return;
    setRenderingAudio(true);
    setStatus("Rendering audio…");
    const exportLoopCount = wavLoopRenderCount(wavLoops);
    try {
      const blob =
        effectivePlaybackMode !== "impro" && soundKindFor(instrument) === "drone"
          ? await renderTseroufDroneWav(playbackNotes, {
              noteSeconds: secondsPerBeat(tempo),
              loopCount: exportLoopCount,
              maxSeconds: 150 * exportLoopCount,
            })
          : await renderTseroufWav(playbackNotes, {
              instrument:
                effectivePlaybackMode === "impro"
                  ? "guitar"
                  : (instrument as InstrumentId),
              playbackStyle:
                effectivePlaybackMode === "impro" ? "guitar-impro" : "strict",
              rhythmVolume: rhythmVolume / 100,
              loopCount: exportLoopCount,
              loopStartIndex:
                effectivePlaybackMode === "impro" &&
                playbackNotes.length > 1 &&
                playbackNotes[0]?.word === playbackNotes[playbackNotes.length - 1]?.word
                  ? 1
                  : 0,
              maxSeconds: 75 * exportLoopCount,
              stepSeconds: secondsPerBeat(tempo),
            });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tserouf_${baseWord}_${effectivePlaybackMode}_${instrument}${
        exportLoopCount > 1 ? `_x${exportLoopCount}` : ""
      }.wav`;
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

          <div className="flex gap-2">
            <Button
              type="button"
              variant={playState !== "stopped" ? "default" : "outline"}
              size="icon"
              className="h-11 w-11"
              aria-label={
                playState === "playing"
                  ? "Pause playback"
                  : playState === "paused"
                  ? "Resume playback"
                  : "Start playback"
              }
              title={
                playState === "playing"
                  ? "Pause"
                  : playState === "paused"
                  ? "Resume"
                  : "Play"
              }
              onClick={togglePlay}
              disabled={running || words.length === 0}
            >
              {playState === "playing" ? (
                <Pause className="h-5 w-5" />
              ) : (
                <Play className="h-5 w-5" />
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-11 w-11"
              aria-label="Reset playback"
              title="Reset"
              onClick={resetPlayback}
              disabled={running || playState === "stopped"}
            >
              <RotateCcw className="h-5 w-5" />
            </Button>
            <div className="ml-auto flex h-11 items-center rounded-md border">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 w-7 rounded-none px-0"
                onClick={() =>
                  setWavLoops((current) => previousWavLoops(current))
                }
                disabled={wavLoops !== "infinite" && wavLoops <= WAV_LOOP_OPTIONS[0]}
                aria-label="Decrease WAV loops"
              >
                −
              </Button>
              <div
                className="flex h-9 min-w-7 items-center justify-center border-x font-mono text-sm tabular-nums"
                aria-live="polite"
              >
                {wavLoops === "infinite" ? "∞" : wavLoops}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 w-7 rounded-none px-0"
                onClick={() =>
                  setWavLoops((current) => nextWavLoops(current))
                }
                disabled={
                  wavLoops !== "infinite" &&
                  wavLoops >= WAV_LOOP_OPTIONS[WAV_LOOP_OPTIONS.length - 1]
                }
                aria-label="Increase WAV loops"
              >
                +
              </Button>
              <Button
                type="button"
                variant={wavLoops === "infinite" ? "secondary" : "ghost"}
                size="sm"
                className="h-9 w-8 rounded-l-none border-l px-0"
                onClick={() =>
                  setWavLoops((current) =>
                    current === "infinite" ? DEFAULT_WAV_LOOPS : "infinite"
                  )
                }
                aria-label="Infinite WAV loops"
                title="Infinite"
              >
                ∞
              </Button>
            </div>
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
                variant={layout === "hamilton" ? "default" : "ghost"}
                className="h-8"
                onClick={() => setLayout("hamilton")}
              >
                Hamilton
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
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Tempo
            </Label>
            <TempoKnob tempo={tempo} onChange={handleTempoChange} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label
                htmlFor="tserouf-rhythm-volume"
                className="text-xs uppercase tracking-wider text-muted-foreground"
              >
                Rhythm
              </Label>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {rhythmVolume}%
              </span>
            </div>
            <input
              id="tserouf-rhythm-volume"
              type="range"
              min={0}
              max={200}
              step={10}
              value={rhythmVolume}
              onChange={(event) =>
                handleRhythmVolumeChange(Number(event.currentTarget.value))
              }
              className="w-full accent-primary"
              aria-label="Rhythm volume"
            />
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
              value={layout === "hamilton" ? "Hamilton" : "Flat"}
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
              <PlayingFocusContext.Provider value={playingFocus}>
                <PlayWordContext.Provider value={playFromWord}>
                  <TonePreviewContext.Provider
                    value={{
                      kind: soundKindFor(instrument),
                    }}
                  >
                    <div className="mb-4 flex justify-end">
                      <div className="grid grid-cols-2 gap-1 rounded-md border p-1">
                        <Button
                          type="button"
                          size="sm"
                          variant={
                            effectivePlaybackMode === "impro" ? "default" : "ghost"
                          }
                          className="h-8"
                          onClick={() => handlePlaybackModeChange("impro")}
                          disabled={!improEnabled}
                        >
                          {alphabet === "hebrew" ? "שירה" : "Shira"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={
                            effectivePlaybackMode === "zaks" ? "default" : "ghost"
                          }
                          className="h-8"
                          onClick={() => handlePlaybackModeChange("zaks")}
                        >
                          {alphabet === "hebrew" ? "ישרה" : "Yeshara"}
                        </Button>
                      </div>
                    </div>
                    <div ref={renderRef} className="p-2 font-mono text-sm">
                      {effectivePlaybackMode === "impro" ? (
                        <ImproPathView
                          path={improPath}
                          activeIndex={
                            playingFocus?.mode === "impro"
                              ? playingFocus.sequenceIndex
                              : null
                          }
                          alphabet={alphabet}
                          kind={soundKindFor(instrument)}
                          onStepClick={(index) => {
                            playerRef.current?.stop();
                            setPlaybackMode("impro");
                            startPlayback(index, "impro");
                          }}
                        />
                      ) : layout === "hamilton" ? (
                        <HamiltonWordsView words={words} alphabet={alphabet} n={n} />
                      ) : (
                        <FlatWordsView words={words} alphabet={alphabet} n={n} />
                      )}
                    </div>
                  </TonePreviewContext.Provider>
                </PlayWordContext.Provider>
              </PlayingFocusContext.Provider>
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

function TempoKnob({
  tempo,
  onChange,
}: {
  tempo: number;
  onChange: (tempo: number) => void;
}) {
  const optionIndex = Math.max(
    0,
    TEMPO_OPTIONS.findIndex((option) => option === tempo)
  );
  const option = TEMPO_OPTIONS[optionIndex] ?? TEMPO_OPTIONS[0];
  const pct = optionIndex / Math.max(1, TEMPO_OPTIONS.length - 1);
  const angle = -135 + pct * 270;
  const progressDeg = pct * 270;

  const setFromPointer = (event: PointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let degrees =
      (Math.atan2(event.clientY - cy, event.clientX - cx) * 180) / Math.PI + 90;
    if (degrees > 180) degrees -= 360;
    const clamped = Math.max(-135, Math.min(135, degrees));
    const nextPct = (clamped + 135) / 270;
    const nextIndex = Math.round(nextPct * (TEMPO_OPTIONS.length - 1));
    onChange(TEMPO_OPTIONS[nextIndex]);
  };

  const setByStep = (delta: number) => {
    const nextIndex = Math.max(
      0,
      Math.min(TEMPO_OPTIONS.length - 1, optionIndex + delta)
    );
    onChange(TEMPO_OPTIONS[nextIndex]);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      setByStep(1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      setByStep(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      onChange(TEMPO_OPTIONS[0]);
    } else if (event.key === "End") {
      event.preventDefault();
      onChange(TEMPO_OPTIONS[TEMPO_OPTIONS.length - 1]);
    }
  };

  return (
    <button
      type="button"
      role="slider"
      aria-label="Tempo"
      aria-valuemin={TEMPO_OPTIONS[0]}
      aria-valuemax={TEMPO_OPTIONS[TEMPO_OPTIONS.length - 1]}
      aria-valuenow={option}
      aria-valuetext={`${option} BPM`}
      title={`${option} BPM`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          setFromPointer(event);
        }
      }}
      onKeyDown={handleKeyDown}
      className="group flex w-full items-center justify-center rounded-md border bg-card/50 py-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <span
        className="relative flex h-28 w-28 items-center justify-center rounded-full border bg-background shadow-inner"
        aria-hidden
        style={{
          backgroundImage: `conic-gradient(from 225deg, var(--primary) 0deg, var(--primary) ${progressDeg}deg, transparent ${progressDeg}deg)`,
        }}
      >
        <span className="absolute inset-3 rounded-full bg-card" />
        <span
          className="absolute left-1/2 top-1/2 h-10 w-1 origin-bottom rounded-full bg-primary"
          style={{
            transform: `translate(-50%, -100%) rotate(${angle}deg)`,
          }}
        />
        <span className="relative flex flex-col items-center leading-none">
          <span className="font-mono text-2xl tabular-nums">{option}</span>
          <span className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            BPM
          </span>
        </span>
      </span>
    </button>
  );
}

function ImproPathView({
  path,
  activeIndex,
  alphabet,
  kind,
  onStepClick,
}: {
  path: ImproPathStep[];
  activeIndex: number | null;
  alphabet: Alphabet;
  kind: SoundKind;
  onStepClick: (index: number) => void;
}) {
  const stable = stablePositions(path.map((step) => step.note));
  const containerRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef<(HTMLElement | null)[]>([]);
  const [edges, setEdges] = useState<EdgeSpec[]>([]);
  const [overlaySize, setOverlaySize] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });
  const grid = useMemo(() => improTimeGrid(path), [path]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const cRect = container.getBoundingClientRect();
      setOverlaySize({ w: cRect.width, h: cRect.height });
      const specs: EdgeSpec[] = [];
      for (const row of grid.rows) {
        for (let i = 0; i < row.cells.length - 1; i++) {
          const current = row.cells[i];
          const next = row.cells[i + 1];
          const aEl = tileRefs.current[current.index];
          const bEl = tileRefs.current[next.index];
          if (!aEl || !bEl) continue;
          specs.push(
            buildEdge(
              relRect(aEl, cRect),
              relRect(bEl, cRect),
              current.step.note.flip
            )
          );
        }
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
  }, [alphabet, grid, path]);

  return (
    <section
      className="block max-w-full rounded-xl p-4"
      style={{
        backgroundColor: tintFor(0, 0.035),
      }}
    >
      <div
        ref={containerRef}
        className="relative flex w-full flex-col gap-8 font-mono text-sm"
      >
        {grid.rows.map((row, rowIndex) => (
          <div
            key={rowIndex}
            className="grid w-full items-start"
            style={{
              gridTemplateColumns: `repeat(${grid.unitsPerRow}, minmax(22px, 1fr))`,
              backgroundImage:
                "linear-gradient(to right, rgba(217,119,6,0.18) 1px, transparent 1px)",
              backgroundSize: `${100 / grid.unitsPerRow}% 100%`,
              paddingTop: 8,
              paddingBottom: 8,
            }}
          >
            {row.cells.map(({ step, index, start, span }) => (
              <ImproPathTile
                key={`${index}-${step.word}`}
                step={step}
                index={index}
                active={activeIndex === index}
                stable={stable}
                alphabet={alphabet}
                kind={kind}
                register={(el) => {
                  tileRefs.current[index] = el;
                }}
                onClick={() => onStepClick(index)}
                style={{
                  gridColumn: `${start + 1} / span ${span}`,
                }}
              />
            ))}
          </div>
        ))}
        <EdgeOverlay
          edges={edges}
          width={overlaySize.w}
          height={overlaySize.h}
        />
      </div>
    </section>
  );
}

function ImproPathTile({
  step,
  index,
  active,
  stable,
  alphabet,
  kind,
  register,
  onClick,
  style,
}: {
  step: ImproPathStep;
  index: number;
  active: boolean;
  stable: boolean[];
  alphabet: Alphabet;
  kind: SoundKind;
  register: (el: HTMLButtonElement | null) => void;
  onClick: () => void;
  style?: CSSProperties;
}) {
  const isHebrew = alphabet === "hebrew";
  const hebrewLetters = useHebrewLetters();
  const playingFocus = useContext(PlayingFocusContext);
  const letters = Array.from(step.word);

  return (
    <button
      ref={register}
      type="button"
      dir={isHebrew ? "rtl" : "ltr"}
      onClick={onClick}
      title={`${index + 1}. ${step.role} · ${tonePreviewTitle(step.word, kind)}`}
      style={style}
      className={`mx-2 flex min-w-0 flex-col items-stretch rounded-md border px-1.5 py-1 text-2xl leading-8 transition-shadow [unicode-bidi:isolate] cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-offset-background focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-background ${parityClassName(
        step.word
      )} ${
        active
          ? `ring-2 ring-offset-1 ring-offset-background ${
              isEvenPermutationWord(step.word)
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
      <span className="mb-0.5 flex items-center justify-between gap-3 font-mono text-[10px] leading-none opacity-70">
        <span dir="ltr">{index + 1}</span>
        <span dir="ltr">{step.duration}</span>
      </span>
      <span
        className="grid w-full"
        style={{
          gridTemplateColumns: `repeat(${letters.length}, minmax(0, 1fr))`,
        }}
      >
        {letters.map((letter, letterIndex) => (
          <span
            key={letterIndex}
            className={`${letterClassName(
              stable,
              letterIndex,
              active && playingFocus?.letterIndex === letterIndex
            )} justify-self-center`}
          >
            {displayLetter(letter, alphabet, hebrewLetters)}
          </span>
        ))}
      </span>
      <AlignedTonalPreview word={step.word} kind={kind} />
    </button>
  );
}

function AlignedTonalPreview({
  word,
  kind,
}: {
  word: string;
  kind: SoundKind;
}) {
  const tones = tonePreviewTones(word, kind);
  if (tones.length === 0) return null;

  const width = 100;
  const height = 30;
  const xFor = (index: number) => ((index + 0.5) * width) / tones.length;
  const points = tones.map((tone, index) => `${xFor(index)},${tone.y}`).join(" ");

  return (
    <span
      dir="ltr"
      aria-hidden
      className="relative mt-0.5 block w-full overflow-hidden rounded-sm bg-background/35"
      style={{ height } as CSSProperties}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="absolute inset-0 h-full w-full overflow-visible"
        preserveAspectRatio="none"
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
            r={1.7}
            fill="currentColor"
            opacity={0.55}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </span>
  );
}

function improTimeGrid(path: ImproPathStep[]): {
  unitsPerRow: number;
  rows: {
    cells: { step: ImproPathStep; index: number; start: number; span: number }[];
  }[];
} {
  const unitsPerRow = 24;
  const rows: {
    cells: { step: ImproPathStep; index: number; start: number; span: number }[];
  }[] = [];
  let currentRow: {
    cells: { step: ImproPathStep; index: number; start: number; span: number }[];
  } = { cells: [] };
  let cursor = 0;
  for (const [index, step] of path.entries()) {
    const span = Math.max(1, Math.round(step.durationRatio * 4));
    if (currentRow.cells.length > 0 && cursor + span > unitsPerRow) {
      rows.push(currentRow);
      currentRow = { cells: [] };
      cursor = 0;
    }
    currentRow.cells.push({ step, index, start: cursor, span });
    cursor += span;
  }
  if (currentRow.cells.length > 0) rows.push(currentRow);
  return { unitsPerRow, rows };
}

function buildImprovisationPath(
  words: ZaksWord[],
  baseWord: string
): ImproPathStep[] {
  if (words.length === 0) return [];

  const sourceByWord = new Map(words.map((item, index) => [item.word, index]));
  const letters = Array.from(baseWord);
  const candidates =
    letters.length === 4
      ? fourLetterImproTargets(letters)
      : fallbackImproTargets(words);

  const selected = candidates
    .map(({ word, role, duration }) => {
      const sourceIndex = sourceByWord.get(word);
      if (sourceIndex === undefined) return null;
      return { word, role, duration, durationRatio: durationRatioValue(duration), sourceIndex };
    })
    .filter(
      (
        step
      ): step is {
        word: string;
        role: string;
        duration: string;
        durationRatio: number;
        sourceIndex: number;
      } => step !== null
    );

  return selected.map((step, index) => {
    const next = selected[index + 1];
    return {
      ...step,
      note: {
        word: step.word,
        flip: next ? suffixFlipBetween(step.word, next.word) : undefined,
        durationRatio: step.durationRatio,
      },
    };
  });
}

function fourLetterImproTargets(
  letters: string[]
): { word: string; role: string; duration: string }[] {
  const [a, b, c, d] = letters;
  return [
    { word: `${a}${b}${c}${d}`, role: "home", duration: "2" },
    { word: `${a}${b}${d}${c}`, role: "first turn", duration: "1" },
    { word: `${a}${c}${d}${b}`, role: "open fifth", duration: "1" },
    { word: `${a}${c}${b}${d}`, role: "descent", duration: "1/2" },
    { word: `${d}${b}${c}${a}`, role: "answer", duration: "3/2" },
    { word: `${d}${b}${a}${c}`, role: "detour", duration: "1" },
    { word: `${d}${c}${a}${b}`, role: "far mirror", duration: "1" },
    { word: `${d}${c}${b}${a}`, role: "release", duration: "3/2" },
    { word: `${a}${b}${c}${d}`, role: "home", duration: "2" },
  ];
}

function fallbackImproTargets(
  words: ZaksWord[]
): { word: string; role: string; duration: string }[] {
  const roles = [
    "home",
    "turn",
    "departure",
    "answer",
    "detour",
    "far",
    "release",
    "return",
    "home",
  ];
  return words
    .slice(0, Math.min(roles.length, words.length))
    .map((word, i) => ({ word: word.word, role: roles[i] ?? "path", duration: "1" }))
    .filter(
      (item): item is { word: string; role: string; duration: string } =>
        item.word !== undefined
    );
}

function durationRatioValue(duration: string): number {
  if (duration === "1/2") return 0.5;
  if (duration === "3/2") return 1.5;
  return Number(duration) || 1;
}

function suffixFlipBetween(from: string, to: string): number | undefined {
  if (from.length !== to.length) return undefined;
  for (let k = 2; k <= from.length; k++) {
    if (reverseWordSuffix(from, k) === to) return k;
  }
  return undefined;
}

function reverseWordSuffix(word: string, k: number): string {
  const split = word.length - k;
  return word.slice(0, split) + Array.from(word.slice(split)).reverse().join("");
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

function HamiltonWordsView({
  words,
  alphabet,
  n,
}: {
  words: ZaksWord[];
  alphabet: Alphabet;
  n: number;
}) {
  const { resolvedTheme } = useTheme();
  const hebrewLetters = useHebrewLetters();
  const playingFocus = useContext(PlayingFocusContext);
  const playWord = useContext(PlayWordContext);
  const tonePreview = useContext(TonePreviewContext);
  const isHebrew = alphabet === "hebrew";
  const total = words.length;
  const showLabels = total <= 120;
  const size = n <= 4 ? 720 : n === 5 ? 980 : n === 6 ? 1180 : 1400;
  const center = size / 2;
  const radius = size * (showLabels ? 0.36 : 0.43);
  const labelRadius = size * 0.44;
  const dotRadius = showLabels ? 2.6 : Math.max(1.2, Math.min(2.2, 90 / total));
  const isDark = resolvedTheme === "dark";
  const cycleStroke = isDark ? "rgba(252, 211, 77, 0.34)" : "rgba(217, 119, 6, 0.38)";
  const pointFill = isDark ? "rgba(252, 211, 77, 0.72)" : "rgba(180, 83, 9, 0.68)";
  const activeFill = isDark ? "#fef3c7" : "#92400e";
  const graphStroke = cycleStroke;

  const points = useMemo(
    () =>
      words.map((item, index) => {
        const angle = (2 * Math.PI * index) / total;
        return {
          item,
          index,
          x: center + radius * Math.cos(angle),
          y: center + radius * Math.sin(angle),
          labelX: center + labelRadius * Math.cos(angle),
          labelY: center + labelRadius * Math.sin(angle),
          display: displayWord(item.word, alphabet, hebrewLetters),
        };
      }),
    [alphabet, center, hebrewLetters, labelRadius, radius, total, words]
  );
  const pancakeEdgePath = useMemo(() => {
    const indexByWord = new Map(words.map((item, index) => [item.word, index]));
    const segments: string[] = [];

    for (let i = 0; i < words.length; i++) {
      const word = words[i].word;
      for (let k = 2; k <= n; k++) {
        const j = indexByWord.get(reverseWordSuffix(word, k));
        if (j === undefined || j <= i) continue;
        segments.push(
          `M ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)} L ${points[j].x.toFixed(2)} ${points[j].y.toFixed(2)}`
        );
      }
    }

    return segments.join(" ");
  }, [n, points, words]);

  if (total === 0) return null;

  const play = (word: string) => {
    playWord?.(word);
  };

  return (
    <div className="w-full overflow-auto pb-4">
      <div
        className="relative mx-auto"
        style={{ width: size, height: size } as CSSProperties}
      >
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="absolute inset-0 h-full w-full"
          aria-hidden={showLabels}
        >
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={cycleStroke}
            strokeWidth={Math.max(2, size / 360)}
          />
          {pancakeEdgePath ? (
            <path
              d={pancakeEdgePath}
              fill="none"
              stroke={graphStroke}
              strokeWidth={Math.max(2, size / 360)}
              strokeLinecap="round"
            />
          ) : null}
          {points.map(({ item, index, x, y, display }) => {
            const isActive = playingFocus?.word === item.word;
            const title = `${display} · ${tonePreviewTitle(item.word, tonePreview.kind)}`;
            return (
              <circle
                key={`${index}-${item.word}`}
                cx={x}
                cy={y}
                r={isActive ? dotRadius * 2.3 : dotRadius}
                fill={isActive ? activeFill : pointFill}
                stroke={isActive ? activeFill : "none"}
                strokeWidth={isActive ? 2 : 0}
                role={!showLabels && playWord ? "button" : undefined}
                tabIndex={!showLabels && playWord ? 0 : undefined}
                aria-label={!showLabels ? title : undefined}
                className={!showLabels && playWord ? "cursor-pointer" : undefined}
                onClick={!showLabels && playWord ? () => play(item.word) : undefined}
                onKeyDown={
                  !showLabels && playWord
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          play(item.word);
                        }
                      }
                    : undefined
                }
              >
                <title>{title}</title>
              </circle>
            );
          })}
        </svg>
        {showLabels
          ? points.map(({ item, index, labelX, labelY, display }) => {
              const isActive = playingFocus?.word === item.word;
              return (
                <button
                  key={`${index}-${item.word}`}
                  type="button"
                  dir={isHebrew ? "rtl" : "ltr"}
                  title={`${display} · ${tonePreviewTitle(item.word, tonePreview.kind)}`}
                  onClick={() => play(item.word)}
                  className={`absolute rounded-md border bg-background/90 px-1.5 py-0.5 text-lg leading-6 shadow-sm [unicode-bidi:isolate] ${
                    playWord
                      ? "cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-offset-background focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                      : ""
                  } ${parityClassName(item.word)} ${
                    isActive ? "ring-2 ring-amber-500 ring-offset-1 ring-offset-background" : ""
                  } ${
                    isHebrew
                      ? "font-[family-name:var(--font-hebrew)] font-medium"
                      : "font-[family-name:var(--font-mystic)]"
                  }`}
                  style={{
                    left: labelX,
                    top: labelY,
                    transform: "translate(-50%, -50%)",
                  }}
                >
                  {display}
                </button>
              );
            })
          : null}
      </div>
    </div>
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
  const playingFocus = useContext(PlayingFocusContext);
  const playWord = useContext(PlayWordContext);
  const tonePreview = useContext(TonePreviewContext);
  const word = item.word;
  const isActive = playingFocus?.word === word;
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
          <span
            key={index}
            className={letterClassName(
              stable,
              index,
              isActive && playingFocus?.letterIndex === index
            )}
          >
            {displayLetter(letter, alphabet, hebrewLetters)}
          </span>
        ))}
      </span>
      <TonalPreview
        word={word}
        kind={tonePreview.kind}
      />
    </span>
  );
}

function TonalPreview({
  word,
  kind,
  stretch = false,
  alignToLetters = false,
}: {
  word: string;
  kind: SoundKind;
  stretch?: boolean;
  alignToLetters?: boolean;
}) {
  const tones = tonePreviewTones(word, kind);
  if (tones.length === 0) return null;

  const width = stretch ? 100 : Math.max(42, tones.length * 13);
  const height = 30;
  const xFor = (index: number) =>
    alignToLetters
      ? ((index + 0.5) * width) / tones.length
      : tones.length === 1
      ? width / 2
      : 5 + (index * (width - 10)) / (tones.length - 1);
  const points = tones.map((tone, index) => `${xFor(index)},${tone.y}`).join(" ");

  return (
    <span
      dir="ltr"
      aria-hidden
      className="relative mx-auto mt-0.5 block overflow-hidden rounded-sm bg-background/35"
      style={
        {
          width: stretch ? "100%" : width,
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
            r={1.7}
            fill="currentColor"
            opacity={0.55}
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

function parityClassName(word: string): string {
  return isEvenPermutationWord(word)
    ? "border-sky-300/50 bg-sky-500/12 text-sky-700 dark:border-sky-400/35 dark:bg-sky-400/15 dark:text-sky-200"
    : "border-rose-300/50 bg-rose-500/12 text-rose-700 dark:border-rose-400/35 dark:bg-rose-400/15 dark:text-rose-200";
}

function letterClassName(
  stable: boolean[],
  index: number,
  active = false
): string {
  const activeClass = active
    ? "rounded-sm bg-current/20 ring-1 ring-current/70"
    : "";

  if (!stable[index]) return ["inline-block px-1", activeClass].filter(Boolean).join(" ");

  const startsRun = !stable[index - 1];
  const endsRun = !stable[index + 1];

  return [
    "inline-block px-1 bg-current/10",
    startsRun ? "rounded-s" : "",
    endsRun ? "rounded-e" : "",
    activeClass,
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
