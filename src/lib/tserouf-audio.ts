// Plays a Tserouf (a sequence of letter-permutations) as music, in the spirit
// of Jerry Bergonzi's "Melodic Structures": a small set of pitches is run
// through every permutation, each permutation sounding as one melodic cell.
//
// Sound design goals:
//   * Classical (nylon-string) guitar timbre via Karplus-Strong synthesis,
//     a body-resonance filter and a touch of reverb.
//   * A two-part-invention dialog: even permutations are a warm low voice, odd
//     permutations answer an octave higher and brighter.
//   * Phrasing that breathes: deep structural changes (large Zaks "flips") are
//     phrase boundaries shaped as a V -> I cadence, with tension, a real
//     leading tone, a silence, then a resolution.
//
// The same synthesis powers both live playback (TseroufPlayer) and offline
// rendering to a downloadable WAV (renderTseroufWav).

// Minor-pentatonic degrees from the root (A C D E G A' C' ...), warm and
// consonant in any permutation order. Letter a -> degree 0, b -> 1, ...
const SCALE_OFFSETS = [0, 3, 5, 7, 10, 12, 15];
const ROOT_MIDI = 57; // A3 — a comfortable classical-guitar register.

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function letterToFreq(letter: string): number {
  const index = letter.charCodeAt(0) - 97;
  const offset = SCALE_OFFSETS[index] ?? index * 2;
  return midiToFreq(ROOT_MIDI + offset);
}

function isEvenPermutation(word: string): boolean {
  let inversions = 0;
  for (let i = 0; i < word.length; i++) {
    for (let j = i + 1; j < word.length; j++) {
      if (word[i] > word[j]) inversions++;
    }
  }
  return inversions % 2 === 0;
}

export interface TseroufNote {
  word: string;
  // Suffix-reversal length used to reach the *next* word. Larger = deeper
  // structural boundary = longer breath after this word.
  flip?: number;
}

export interface TseroufPlayOptions {
  stepSeconds?: number;
  loop?: boolean;
  onStep?: (wordIndex: number) => void;
  onEnd?: () => void;
}

export interface TseroufRenderOptions {
  stepSeconds?: number;
  // Cap the rendered content so files stay reasonable for large permutation
  // counts. The closing reverb tail is added on top.
  maxSeconds?: number;
}

interface Voice {
  in: GainNode;
  // Pitch ratio applied to every note this voice plays (octave placement).
  transpose: number;
}

// A self-contained synthesis graph bound to one audio context (real-time or
// offline). All scheduling helpers operate on a Synth, so both paths share the
// exact same sound.
interface Synth {
  ctx: BaseAudioContext;
  master: GainNode;
  even: Voice;
  odd: Voice;
  center: Voice;
  pluckCache: Map<number, AudioBuffer>;
}

function makeVoice(
  ctx: BaseAudioContext,
  master: GainNode,
  pan: number,
  cutoff: number,
  semitones: number
): Voice {
  const input = ctx.createGain();
  // The high voice sits an octave up; trim it a touch so it doesn't dominate.
  input.gain.value = semitones > 0 ? 0.82 : 1;

  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = cutoff;
  tone.Q.value = 0.3;

  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;

  input.connect(tone);
  tone.connect(panner);
  panner.connect(master);
  return { in: input, transpose: Math.pow(2, semitones / 12) };
}

function makeImpulseResponse(
  ctx: BaseAudioContext,
  seconds: number,
  decay: number
): AudioBuffer {
  const sr = ctx.sampleRate;
  const length = Math.floor(sr * seconds);
  const impulse = ctx.createBuffer(2, length, sr);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

function buildSynth(ctx: BaseAudioContext): Synth {
  const master = ctx.createGain();
  master.gain.value = 0.8;

  // Shared guitar body resonance sits on the master bus.
  const body = ctx.createBiquadFilter();
  body.type = "peaking";
  body.frequency.value = 120;
  body.Q.value = 0.8;
  body.gain.value = 4;

  // Glue the overlapping strings and keep peaks in check.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 24;
  comp.ratio.value = 3;
  comp.attack.value = 0.005;
  comp.release.value = 0.25;

  master.connect(body);
  body.connect(comp);

  // Shared room — kept fairly dry so notes stay articulate, not washed out.
  const reverb = ctx.createConvolver();
  reverb.buffer = makeImpulseResponse(ctx, 1.5, 3.0);
  const wet = ctx.createGain();
  wet.gain.value = 0.12;
  master.connect(reverb);
  reverb.connect(wet);
  wet.connect(comp);

  comp.connect(ctx.destination);

  // Two voices like a Bach two-part invention: a warm low voice that calls
  // (slightly left), and a bright voice an octave higher that answers (right).
  const even = makeVoice(ctx, master, -0.3, 3200, 0);
  const odd = makeVoice(ctx, master, 0.3, 4600, 12);
  // Cadences land in the centre, in the middle register, full and shared.
  const center = makeVoice(ctx, master, 0, 4000, 0);

  return { ctx, master, even, odd, center, pluckCache: new Map() };
}

// Karplus-Strong plucked-string synthesis, cached per pitch.
function pluckBuffer(synth: Synth, freq: number): AudioBuffer {
  const cacheKey = Math.round(freq * 50);
  const cached = synth.pluckCache.get(cacheKey);
  if (cached) return cached;

  const ctx = synth.ctx;
  const sr = ctx.sampleRate;
  const seconds = 3.2;
  const total = Math.floor(sr * seconds);
  const delay = Math.max(2, Math.round(sr / freq));
  const buffer = ctx.createBuffer(1, total, sr);
  const data = buffer.getChannelData(0);

  // Excitation: a short noise burst, low-passed so the attack is soft and
  // round like a nylon string plucked with the flesh of the finger.
  let lp = 0;
  for (let i = 0; i < delay; i++) {
    const white = Math.random() * 2 - 1;
    lp = 0.55 * white + 0.45 * lp;
    data[i] = lp;
  }

  // Feedback loop with an averaging low-pass = the vibrating, damping string.
  const decay = freq < 200 ? 0.9975 : 0.9965;
  for (let i = delay; i < total; i++) {
    const prev = data[i - delay];
    const prev2 = i - delay - 1 >= 0 ? data[i - delay - 1] : prev;
    data[i] = decay * 0.5 * (prev + prev2);
  }

  let peak = 0;
  for (let i = 0; i < total; i++) {
    const a = Math.abs(data[i]);
    if (a > peak) peak = a;
  }
  if (peak > 0) {
    const norm = 0.9 / peak;
    for (let i = 0; i < total; i++) data[i] *= norm;
  }

  synth.pluckCache.set(cacheKey, buffer);
  return buffer;
}

// Schedules one plucked note and returns the time it stops sounding.
function pluckNote(
  synth: Synth,
  voice: Voice,
  freq: number,
  time: number,
  velocity: number,
  ringSeconds: number,
  attack = 0.004
): number {
  const ctx = synth.ctx;
  const src = ctx.createBufferSource();
  src.buffer = pluckBuffer(synth, freq * voice.transpose);
  src.detune.value = (Math.random() - 0.5) * 8;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(velocity, time + attack);
  gain.gain.setTargetAtTime(0.0001, time + ringSeconds * 0.6, ringSeconds * 0.5);

  src.connect(gain);
  gain.connect(voice.in);
  src.start(time);
  const end = time + ringSeconds + 0.2;
  src.stop(end);
  return end;
}

interface WordTiming {
  len: number;
  beat: number;
  span: number;
  advance: number;
  isPhraseStart: boolean;
  isPhraseEnd: boolean;
}

// Pure timing for one word — shared by audio scheduling and the duration
// estimate used to size the offline render buffer.
function wordTiming(
  notes: TseroufNote[],
  idx: number,
  stepSeconds: number
): WordTiming {
  const note = notes[idx];
  const len = note.word.length;
  // Only the deepest reversal (the whole suffix = the full word) is a cadence,
  // so resolutions stay rare and meaningful instead of happening every bar.
  const threshold = len;
  const isCadence = (k?: number) => k !== undefined && k >= threshold;
  const prevFlip = idx > 0 ? notes[idx - 1].flip : undefined;
  const isPhraseEnd = isCadence(note.flip);
  const isPhraseStart = idx === 0 || isCadence(prevFlip);

  // Steady tempo across the line break so the cadence flows (no ritardando).
  const beat = stepSeconds;
  const span = len * beat;
  // The dominant lands on the last beat of a line and the tonic on the very
  // next beat that opens the following line — one steady beat apart, no pause —
  // so V -> I flows. The only real silence is the breath AFTER the resolution.
  let pauseBeats: number;
  if (isPhraseStart) pauseBeats = 2.6; // breathe after the resolution
  else if (isPhraseEnd) pauseBeats = 0; // flow straight into the next line
  else if (note.flip !== undefined && note.flip >= 3) pauseBeats = 0.6;
  else pauseBeats = 0.35;
  const pause = stepSeconds * pauseBeats;

  return { len, beat, span, advance: span + pause, isPhraseStart, isPhraseEnd };
}

// Schedules a single melodic cell and returns how far to advance and the time
// the last sound in it stops ringing.
function scheduleWord(
  synth: Synth,
  notes: TseroufNote[],
  idx: number,
  startTime: number,
  stepSeconds: number
): { advance: number; end: number } {
  const note = notes[idx];
  const letters = Array.from(note.word);
  const { len, beat, advance, isPhraseStart, isPhraseEnd } = wordTiming(
    notes,
    idx,
    stepSeconds
  );

  const voice = isEvenPermutation(note.word) ? synth.even : synth.odd;
  const center = synth.center;
  const root = ROOT_MIDI;
  const bassRoot = root - 12;
  let end = startTime;
  const mark = (t: number) => {
    if (t > end) end = t;
  };

  // Soft attack so the cadence stays inside the texture.
  const SOFT = 0.025;

  if (isPhraseStart) {
    // RESOLUTION: a single soft tonic bass (A). The falling-fifth E -> A lands
    // here as pure bass motion — no struck chord at all — so the arrival stays
    // completely inside the melodic texture. A slightly longer ring seats it.
    mark(pluckNote(synth, center, midiToFreq(bassRoot), startTime, 0.42, 2.6, SOFT));
  } else {
    // Ordinary cell: thumb bass an octave below the first melody note.
    mark(pluckNote(synth, voice, letterToFreq(letters[0]) / 2, startTime, 0.45, 1.3));
  }

  // A line break reverses the whole word, so the last letter of a line becomes
  // the first of the next (…adcb -> bcda…). Rather than restrike that repeated
  // note, tie it over: skip the new line's first note and let the previous
  // one ring through the downbeat where the resolution lands.
  const prevWord = idx > 0 ? notes[idx - 1].word : "";
  const tieFirst =
    isPhraseStart && prevWord.length > 0 && prevWord[prevWord.length - 1] === letters[0];

  // Melody. Rings stay close to one step so notes overlap only lightly (legato);
  // the last note of a cell sings a little longer.
  letters.forEach((letter, i) => {
    if (tieFirst && i === 0) return; // note carried over (tied) from prev line
    const t = startTime + i * beat + (Math.random() - 0.5) * 0.012;
    const arch = Math.sin((Math.PI * (i + 0.5)) / len);
    const velocity =
      (i === 0 ? 0.85 : 0.5 + 0.28 * arch) * (0.94 + Math.random() * 0.12);
    const ring = i === len - 1 ? 0.9 : beat * 1.5;
    mark(pluckNote(synth, voice, letterToFreq(letter), t, velocity, ring));
  });

  if (isPhraseEnd) {
    // TENSION closing the line: a soft dominant bass (E) only — a falling-fifth
    // E -> A into the next line's tonic. No raised leading tone (G#): it lives
    // outside the minor pentatonic and clashed with the natural melody notes,
    // which is what sounded out of tune. The bass motion carries the cadence.
    const tEnd = startTime + (len - 1) * beat;
    mark(pluckNote(synth, center, midiToFreq(bassRoot + 7), tEnd, 0.34, 1.2, SOFT));
  }

  return { advance, end };
}

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.3;

export class TseroufPlayer {
  private ctx: AudioContext | null = null;
  private synth: Synth | null = null;
  private timer: number | null = null;

  private notes: TseroufNote[] = [];
  private stepSeconds = 0.18;
  private loop = false;
  private onStep?: (wordIndex: number) => void;
  private onEnd?: () => void;

  private wordIdx = 0;
  private nextWordTime = 0;
  private lastVoiceEnd = 0;
  private finishedScheduling = false;
  private playing = false;
  private paused = false;

  private uiQueue: { time: number; wordIndex: number }[] = [];

  get isPlaying(): boolean {
    return this.playing;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  play(notes: TseroufNote[], options: TseroufPlayOptions = {}): void {
    this.stop();
    if (notes.length === 0) return;

    const ctx = this.ensureContext();
    void ctx.resume();

    this.notes = notes;
    this.stepSeconds = options.stepSeconds ?? 0.18;
    this.loop = options.loop ?? false;
    this.onStep = options.onStep;
    this.onEnd = options.onEnd;

    this.wordIdx = 0;
    this.nextWordTime = ctx.currentTime + 0.12;
    this.lastVoiceEnd = this.nextWordTime;
    this.finishedScheduling = false;
    this.uiQueue = [];
    this.playing = true;
    this.paused = false;

    this.timer = window.setInterval(() => this.tick(), LOOKAHEAD_MS);
    this.tick();
  }

  pause(): void {
    if (!this.playing) return;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.playing = false;
    this.paused = true;
    void this.ctx?.suspend();
  }

  resume(): void {
    if (!this.paused || !this.ctx) return;
    this.paused = false;
    this.playing = true;
    void this.ctx.resume();
    this.timer = window.setInterval(() => this.tick(), LOOKAHEAD_MS);
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.uiQueue = [];
    this.playing = false;
    this.paused = false;
    if (this.ctx) {
      void this.ctx.resume();
      if (this.synth) {
        const now = this.ctx.currentTime;
        const gain = this.synth.master.gain;
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(gain.value, now);
        gain.linearRampToValueAtTime(0.0001, now + 0.06);
      }
    }
  }

  dispose(): void {
    this.stop();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
      this.synth = null;
    }
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new Ctor();
    }
    if (!this.synth) {
      this.synth = buildSynth(this.ctx);
    } else {
      this.synth.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.synth.master.gain.value = 0.8;
    }
    return this.ctx;
  }

  private tick(): void {
    const ctx = this.ctx;
    const synth = this.synth;
    if (!ctx || !synth || !this.playing) return;

    while (
      !this.finishedScheduling &&
      this.nextWordTime < ctx.currentTime + SCHEDULE_AHEAD
    ) {
      const { advance, end } = scheduleWord(
        synth,
        this.notes,
        this.wordIdx,
        this.nextWordTime,
        this.stepSeconds
      );
      if (end > this.lastVoiceEnd) this.lastVoiceEnd = end;
      this.uiQueue.push({ time: this.nextWordTime, wordIndex: this.wordIdx });

      this.nextWordTime += advance;
      this.wordIdx += 1;
      if (this.wordIdx >= this.notes.length) this.finishedScheduling = true;
    }

    while (this.uiQueue.length > 0 && this.uiQueue[0].time <= ctx.currentTime) {
      const next = this.uiQueue.shift()!;
      this.onStep?.(next.wordIndex);
    }

    if (this.finishedScheduling && this.loop) {
      // Queue the next pass. nextWordTime already carries the closing breath,
      // so the loop seam keeps the rhythm; ringing tails overlap naturally.
      this.wordIdx = 0;
      this.finishedScheduling = false;
      return;
    }

    if (
      this.finishedScheduling &&
      this.uiQueue.length === 0 &&
      ctx.currentTime >= this.lastVoiceEnd
    ) {
      const onEnd = this.onEnd;
      this.stop();
      onEnd?.();
    }
  }
}

// Renders the whole piece (one pass, no loop) to a WAV Blob via an offline
// context, so it can be downloaded and listened to outside the browser.
export async function renderTseroufWav(
  notes: TseroufNote[],
  options: TseroufRenderOptions = {}
): Promise<Blob> {
  const stepSeconds = options.stepSeconds ?? 0.18;
  const maxSeconds = options.maxSeconds ?? 75;
  const sampleRate = 44100;

  const lead = 0.1;
  let cursor = lead;
  let count = 0;
  for (let i = 0; i < notes.length; i++) {
    cursor += wordTiming(notes, i, stepSeconds).advance;
    count++;
    if (cursor >= maxSeconds) break;
  }

  const tail = 2.5; // last ring + short reverb decay
  const totalSeconds = cursor + tail;
  const length = Math.max(1, Math.ceil(sampleRate * totalSeconds));

  const OfflineCtor =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  const offline = new OfflineCtor(2, length, sampleRate);
  const synth = buildSynth(offline);

  let startTime = lead;
  for (let i = 0; i < count; i++) {
    const { advance } = scheduleWord(synth, notes, i, startTime, stepSeconds);
    startTime += advance;
  }

  const rendered = await offline.startRendering();
  return encodeWav(rendered);
}

function encodeWav(buffer: AudioBuffer): Blob {
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = frames * blockAlign;

  const arr = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arr);
  let p = 0;
  const writeStr = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(p++, s.charCodeAt(i));
  };
  const writeU32 = (v: number) => {
    view.setUint32(p, v, true);
    p += 4;
  };
  const writeU16 = (v: number) => {
    view.setUint16(p, v, true);
    p += 2;
  };

  writeStr("RIFF");
  writeU32(36 + dataSize);
  writeStr("WAVE");
  writeStr("fmt ");
  writeU32(16);
  writeU16(1); // PCM
  writeU16(numCh);
  writeU32(sr);
  writeU32(sr * blockAlign);
  writeU16(blockAlign);
  writeU16(16);
  writeStr("data");
  writeU32(dataSize);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));
  for (let frame = 0; frame < frames; frame++) {
    for (let c = 0; c < numCh; c++) {
      let s = Math.max(-1, Math.min(1, channels[c][frame]));
      s = s < 0 ? s * 0x8000 : s * 0x7fff;
      view.setInt16(p, s, true);
      p += 2;
    }
  }

  return new Blob([view], { type: "audio/wav" });
}
