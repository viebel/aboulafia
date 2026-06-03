// An alternative "music of Tserouf": instead of the melodic two-part invention
// (see tserouf-audio.ts), this plays the permutations as a hypnotic zikr loop —
// a warm low C drone, a soft wordless "houm/mmm" hum pulsing through the
// letters at ≈108 BPM, and a muffled frame drum with a subtle accent every
// fourth beat. The aesthetic is deliberately dark, matte and bodily: no bright
// highs, no clicks, no realistic voice, no complex melody — the ecstatic state
// comes from the breathing repetition, not from an ambient wash or a tune.
//
// Design goals:
//   * Each letter is a soft hum-pulse, dark and low, never a bright or
//     identifiable voice.
//   * NO melodic narrative: no cadence, no two-voice dialog, nothing "resolves".
//     The order of the letters is the only thing that changes; the loop and the
//     breath do the hypnotic work.
//   * Just intonation: letters map to exact harmonics of the drone, so the sung
//     notes are perfectly consonant with the ground tone, with no beating.
//   * A soft, continuous drone underneath (like a tanpura under a raga, or the
//     ison under Byzantine chant) anchors everything; the voice stays dry and
//     present on top so the notes never smear.
//
// The Zaks "flip" depth only lengthens the breath between permutations (a
// deeper reversal = a longer pause), never a resolution.

import {
  encodeWav,
  type TseroufNote,
  type TseroufPlayOptions,
  type TseroufRenderOptions,
} from "./tserouf-audio";

// The drone fundamental: a warm, low C2 (≈65 Hz, "do grave"). Dark and bodily,
// the ground of the whole loop.
const DRONE_FREQ = 65.41; // C2

// Letters map to harmonics of the drone (just intonation). Letter a -> 2nd
// harmonic, b -> 3rd, ... All are perfectly consonant with the ground tone.
const HARMONICS = [2, 3, 4, 5, 6, 7, 8];

// The hum sings these harmonics an octave below the drone's, so it sits very
// low and dark (≈65–262 Hz) — a wordless "houm/mmm" pulse, not a melody in a
// bright register. Still exact harmonics of the drone (just intonation intact).
const VOICE_ROOT = DRONE_FREQ / 2; // ≈32.7 Hz; letters = its 2nd..8th harmonics

// ≈108 BPM (one pulse ≈0.556 s) — the steady, hypnotic breathing pulse.
const DEFAULT_NOTE_SECONDS = 60 / 108;

// The hum is closed-mouth ("mmm/oum"): almost all the energy is in the
// fundamental, low-passed hard so there is nothing bright. This is the matte,
// dark, bodily timbre the loop is after.
const HUM_LOWPASS_HZ = 760;

function letterToOvertone(letter: string): number {
  const index = letter.charCodeAt(0) - 97;
  const harmonic = HARMONICS[index] ?? index + 2;
  return VOICE_ROOT * harmonic;
}

// A closed "mmm/oum" hum: mostly the fundamental, a touch of the low harmonics,
// nothing high — soft and dark, never reedy or bright.
function makeHumWave(ctx: BaseAudioContext): PeriodicWave {
  const n = 8;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) {
    imag[k] = 1 / Math.pow(k, 2.0);
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

// A reusable white-noise buffer, used for the background breath and the soft
// skin transient of the frame drum.
function makeNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

interface ChantSynth {
  ctx: BaseAudioContext;
  master: GainNode;
  // The sung voice flows here (dry, present, centred).
  voiceBus: GainNode;
  // The muffled frame drum flows here (low, dampened, centred).
  percBus: GainNode;
  noteSeconds: number;
  // A shared, slow LFO output (in cents) wired into every hum's detune for
  // organic micro-variations of pitch.
  vibrato: GainNode;
  voiceWave: PeriodicWave;
  noise: AudioBuffer;
  // Global count of eighth-note steps, driving the drum groove pattern.
  beatCount: number;
  // The Shepard drone: an octave stack of oscillators (one pitch class) whose
  // amplitudes follow a circular Gaussian window. Moving the window up makes the
  // drone seem to rise forever and wrap seamlessly (the "endlessly rising"
  // illusion). `rise` is the accumulated ascent in octaves (one whole tone per
  // line); the window centre = baseCenter + rise, taken modulo `n`.
  shepard: { gains: GainNode[]; n: number; sigma: number; baseCenter: number };
  rise: number;
  // Long-lived nodes that run for the whole piece and must be stopped on teardown.
  running: { stop: (when: number) => void }[];
}

// Circular Gaussian over octave index (period n) — the Shepard amplitude window.
function shepardGain(i: number, center: number, n: number, sigma: number): number {
  let d = Math.abs(((i - center) % n + n) % n);
  if (d > n / 2) d = n - d;
  return Math.exp(-(d * d) / (2 * sigma * sigma));
}

function makeReverbIR(
  ctx: BaseAudioContext,
  seconds: number,
  decay: number
): AudioBuffer {
  const sr = ctx.sampleRate;
  const length = Math.max(1, Math.floor(sr * seconds));
  const ir = ctx.createBuffer(2, length, sr);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return ir;
}

// A slow sine LFO added onto an AudioParam; returned so it can be stopped.
function startLfo(
  ctx: BaseAudioContext,
  param: AudioParam,
  freq: number,
  depth: number,
  center: number,
  startTime: number
): { stop: (when: number) => void } {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.value = depth;
  param.value = center;
  osc.connect(gain);
  gain.connect(param);
  osc.start(startTime);
  return { stop: (when) => osc.stop(when) };
}

function buildChantSynth(
  ctx: BaseAudioContext,
  noteSeconds: number,
  startTime: number
): ChantSynth {
  const master = ctx.createGain();
  master.gain.value = 1.6;

  // A global low-pass keeps the WHOLE mix dark and matte — no bright highs
  // anywhere, as the brief asks.
  const darken = ctx.createBiquadFilter();
  darken.type = "lowpass";
  darken.frequency.value = 2400;
  darken.Q.value = 0.4;

  // A gentle limiter so peaks stay controlled without squashing the body.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -6;
  comp.knee.value = 18;
  comp.ratio.value = 3;
  comp.attack.value = 0.01;
  comp.release.value = 0.3;

  master.connect(darken);
  darken.connect(comp);

  // A short, dark room — just enough to glue everything, never a bright wash.
  const reverb = ctx.createConvolver();
  reverb.buffer = makeReverbIR(ctx, 1.8, 3.0);
  const wet = ctx.createGain();
  wet.gain.value = 0.12;
  darken.connect(reverb);
  reverb.connect(wet);
  wet.connect(comp);

  comp.connect(ctx.destination);

  const running: { stop: (when: number) => void }[] = [];

  // The hum bus: a hard low-pass so the "houm/mmm" stays closed, dark and
  // matte, with nothing bright. Centred and forward but soft.
  const voiceTone = ctx.createBiquadFilter();
  voiceTone.type = "lowpass";
  voiceTone.frequency.value = HUM_LOWPASS_HZ;
  voiceTone.Q.value = 0.7;
  const voiceBus = ctx.createGain();
  voiceBus.gain.value = 1.5;
  voiceBus.connect(voiceTone);
  voiceTone.connect(master);

  // The frame drum: low-passed and dampened, but with enough of the skin attack
  // (up to ~1.1 kHz) to be clearly heard as a "tap/doum" — not buried sub-bass.
  const percTone = ctx.createBiquadFilter();
  percTone.type = "lowpass";
  percTone.frequency.value = 1100;
  percTone.Q.value = 0.6;
  const percBus = ctx.createGain();
  percBus.gain.value = 1.15;
  percBus.connect(percTone);
  percTone.connect(master);

  // A shared, slow, irregular-ish pitch drift (≈0.8 Hz, ±5 cents) wired into
  // every hum's detune — organic micro-variation, not a mechanical vibrato.
  const vibrato = ctx.createGain();
  vibrato.gain.value = 5;
  const vibOsc = ctx.createOscillator();
  vibOsc.type = "sine";
  vibOsc.frequency.value = 0.8;
  vibOsc.connect(vibrato);
  vibOsc.start(startTime);
  running.push({ stop: (when) => vibOsc.stop(when) });

  // A discreet breath in the background: a continuous, very soft band of dark
  // noise that slowly swells and recedes, like quiet breathing under the loop.
  const breath = ctx.createBufferSource();
  breath.buffer = makeNoiseBuffer(ctx);
  breath.loop = true;
  const breathBp = ctx.createBiquadFilter();
  breathBp.type = "bandpass";
  breathBp.frequency.value = 500;
  breathBp.Q.value = 0.6;
  const breathGain = ctx.createGain();
  breathGain.gain.value = 0.0001;
  breath.connect(breathBp);
  breathBp.connect(breathGain);
  breathGain.connect(master);
  breath.start(startTime);
  running.push({ stop: (when) => breath.stop(when) });
  running.push(startLfo(ctx, breathGain.gain, 0.13, 0.01, 0.014, startTime));

  const droneBus = ctx.createGain();
  droneBus.gain.value = 0.0001;
  droneBus.connect(master);
  running.push(startLfo(ctx, droneBus.gain, 0.06, 0.02, 0.085, startTime));

  // A quiet, fixed pure fifth for warmth under the rising tonic.
  for (const detune of [-1.5, 1.5]) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = (DRONE_FREQ * 3) / 2;
    osc.detune.value = detune;
    const g = ctx.createGain();
    g.gain.value = 0.12;
    osc.connect(g);
    g.connect(droneBus);
    osc.start(startTime);
    running.push({ stop: (when) => osc.stop(when) });
  }

  // The Shepard tonic: an octave stack (one pitch class, the tonic) whose
  // amplitudes are a circular Gaussian window. Sliding the window up = the
  // drone seems to climb forever and wraps seamlessly — the engine of the
  // "endlessly rising" GEB illusion.
  const shepN = 6;
  const shepSigma = 1.25;
  const shepBaseCenter = 2.4; // sits the loudest octaves in the mid register
  const shepBase = DRONE_FREQ / 4; // ≈16.35 Hz → stack 32.7,65,131,262,524,1048
  const shepGains: GainNode[] = [];
  for (let i = 0; i < shepN; i++) {
    const freq = shepBase * Math.pow(2, i + 1);
    const g = ctx.createGain();
    g.gain.value = shepardGain(i, shepBaseCenter, shepN, shepSigma);
    g.connect(droneBus);
    for (const detune of [-1.5, 1.5]) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const og = ctx.createGain();
      og.gain.value = 0.5;
      osc.connect(og);
      og.connect(g);
      osc.start(startTime);
      running.push({ stop: (when) => osc.stop(when) });
    }
    shepGains.push(g);
  }

  return {
    ctx,
    master,
    voiceBus,
    percBus,
    noteSeconds,
    vibrato,
    voiceWave: makeHumWave(ctx),
    noise: makeNoiseBuffer(ctx),
    beatCount: 0,
    shepard: { gains: shepGains, n: shepN, sigma: shepSigma, baseCenter: shepBaseCenter },
    rise: 0,
    running,
  };
}

// One whole tone (1/6 octave) of ascent per line — Bach's "Canon per Tonos":
// after six lines the rise is a full octave and the Shepard window has wrapped,
// so the loop returns to its start invisibly.
const RISE_PER_LINE = 1 / 6;

// Slides the Shepard window to match the current rise, ramped smoothly so the
// "level change" at a line boundary is a gentle glide, not a jump.
function applyShepardRise(synth: ChantSynth, time: number, rampSec: number): void {
  const { gains, n, sigma, baseCenter } = synth.shepard;
  const center = baseCenter + synth.rise;
  for (let i = 0; i < gains.length; i++) {
    const target = shepardGain(i, center, n, sigma);
    const p = gains[i].gain;
    p.cancelScheduledValues(time);
    p.setValueAtTime(p.value, time);
    p.linearRampToValueAtTime(target, time + rampSec);
  }
}

// Plays one letter as a soft, wordless "houm/mmm" hum: a couple of detuned dark
// oscillators (slight roughness from the beating) through a very smooth swell —
// no clicks, no brightness, mostly the low fundamental. Distinct as a pulse but
// legato, breathing into the next. Returns when it has faded.
function singNote(
  synth: ChantSynth,
  freq: number,
  start: number,
  sound: number,
  peak: number,
  pan: number
): number {
  const ctx = synth.ctx;
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;
  panner.connect(synth.voiceBus);

  // Envelope: a slow, soft swell in and out (no attack transient => no click),
  // mostly sustained so the hums breathe into each other.
  const env = ctx.createGain();
  const attack = Math.min(0.14, sound * 0.4);
  const release = Math.min(0.18, sound * 0.45);
  const hold = start + sound - release;
  // Organic micro-variation of intensity, hum to hum.
  const level = peak * (0.85 + Math.random() * 0.3);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.linearRampToValueAtTime(level, start + attack);
  env.gain.setValueAtTime(level, Math.max(start + attack, hold));
  env.gain.exponentialRampToValueAtTime(0.0001, hold + release);
  env.connect(panner);

  // Two dark oscillators detuned a few cents = a slightly rough, bodily hum
  // (the "légèrement rugueux" beating), plus organic per-note pitch offset.
  const end = hold + release;
  const drift = (Math.random() - 0.5) * 6;
  for (const cents of [-5, 5]) {
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(synth.voiceWave);
    osc.frequency.value = freq;
    osc.detune.setValueAtTime(cents + drift, start);
    synth.vibrato.connect(osc.detune);
    osc.connect(env);
    osc.start(start);
    osc.stop(end + 0.05);
  }

  return end;
}

// A frame-drum hit (bendir/daf-like). Two kinds:
//   * "dum": a low, full membrane tone in the centre — the deep accent.
//   * "tek": a higher, shorter, lighter tap off to the side — the fill.
// Both are tamed by the perc-bus low-pass, so there is body and a "tap" but no
// sharp click. `accent` carries the dynamics of the pattern.
function frameDrum(
  synth: ChantSynth,
  time: number,
  kind: "dum" | "tek",
  accent: number
): void {
  const ctx = synth.ctx;
  const dum = kind === "dum";

  const panner = ctx.createStereoPanner();
  // Dum sits centred; teks alternate slightly left/right for a livelier groove.
  panner.pan.value = dum ? 0 : synth.beatCount % 4 < 2 ? -0.16 : 0.16;
  panner.connect(synth.percBus);

  // The membrane: low + long for the dum, higher + short for the tek.
  const f0 = dum ? 120 : 250;
  const f1 = dum ? 60 : 185;
  const sweep = dum ? 0.06 : 0.03;
  const decay = dum ? 0.24 : 0.09;
  const level = (dum ? 1.1 : 0.55) * accent;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(f0, time);
  osc.frequency.exponentialRampToValueAtTime(f1, time + sweep);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, time);
  og.gain.linearRampToValueAtTime(level, time + 0.006);
  og.gain.exponentialRampToValueAtTime(0.0001, time + decay);
  osc.connect(og);
  og.connect(panner);
  osc.start(time);
  osc.stop(time + decay + 0.06);

  // The skin: a short noise body — gives the hit its "tap". The tek leans a bit
  // more on this (a drier, snappier sound) than the dum.
  const skin = ctx.createBufferSource();
  skin.buffer = synth.noise;
  const skinGain = ctx.createGain();
  const skinLevel = (dum ? 0.5 : 0.6) * accent;
  skinGain.gain.setValueAtTime(0.0001, time);
  skinGain.gain.linearRampToValueAtTime(skinLevel, time + 0.005);
  skinGain.gain.exponentialRampToValueAtTime(0.0001, time + (dum ? 0.07 : 0.045));
  skin.connect(skinGain);
  skinGain.connect(panner);
  skin.start(time);
  skin.stop(time + 0.1);
}

interface ChantTiming {
  advance: number;
  beat: number;
  sound: number;
  totalBeats: number;
}

// Pure timing for one permutation, shared by playback and offline-render sizing.
function chantTiming(
  notes: TseroufNote[],
  idx: number,
  noteSeconds: number
): ChantTiming {
  const note = notes[idx];
  const len = Math.max(1, note.word.length);

  const beat = noteSeconds;
  // Hums nearly fill the beat and overlap a touch, so they breathe into one
  // another (continuous pulse) rather than sounding like separate blips.
  const sound = beat * 1.05;
  // STRICTLY continuous: no pause anywhere — not even at line boundaries. The
  // hum runs one-per-beat without a single break, so the loop feels infinite.
  // (The "resolution" at a line start is an arrival, not a rest.) Each word is
  // a whole number of beats, keeping the drum groove phase-locked.
  const totalBeats = len;
  const advance = totalBeats * beat;
  return { advance, beat, sound, totalBeats };
}

// The frame-drum groove: one bar = 4 beats = 8 eighth-note slots. A rolling
// bendir/daf pattern — two DUMs (beats 1 and 3) with TEK fills — instead of a
// flat pulse. `null` = a rest. The downbeat DUM is the every-fourth accent.
const DRUM_PATTERN: ({ kind: "dum" | "tek"; vel: number } | null)[] = [
  { kind: "dum", vel: 1.0 }, // beat 1 (accent)
  null, //                      &
  { kind: "tek", vel: 0.5 }, //  beat 2
  { kind: "tek", vel: 0.42 }, // &
  { kind: "dum", vel: 0.78 }, // beat 3
  null, //                      &
  { kind: "tek", vel: 0.55 }, // beat 4
  { kind: "tek", vel: 0.4 }, //  & (pickup into the next bar)
];

// Schedules one permutation as a sung phrase; returns how far to advance and
// when the last note has faded.
function scheduleChant(
  synth: ChantSynth,
  notes: TseroufNote[],
  idx: number,
  startTime: number
): { advance: number; end: number } {
  const note = notes[idx];
  const letters = Array.from(note.word);
  const len = letters.length;
  const { advance, beat, sound, totalBeats } = chantTiming(
    notes,
    idx,
    synth.noteSeconds
  );

  // A line boundary = the first word of a new line: the previous word was a
  // full-word reversal (the deepest Zaks flip), or this is the very first word.
  // There, the music RESOLVES and steps up one level — the strange loop.
  const prev = idx > 0 ? notes[idx - 1] : undefined;
  const prevLen = prev ? prev.word.length : 0;
  const isLineStart =
    idx === 0 || (prev?.flip !== undefined && prev.flip >= prevLen);

  if (isLineStart) {
    if (idx > 0) synth.rise += RISE_PER_LINE; // climb to the next level
    applyShepardRise(synth, startTime, beat * 1.5); // a gentle glide, not a jump
  }

  // The hum climbs with the drone: a fractional-octave Shepard rise (kept within
  // one octave) so it ascends each line and wraps invisibly — endlessly rising.
  const fracRise = synth.rise - Math.floor(synth.rise);
  const riseFactor = Math.pow(2, fracRise);

  let end = startTime;
  letters.forEach((letter, i) => {
    const base = letterToOvertone(letter);
    const harmonic = base / VOICE_ROOT; // 2..8
    // The higher overtones are softened so the low hums dominate (dark/bodily).
    const peak = 0.4 * (1 - 0.28 * (harmonic / 8));
    const t = startTime + i * beat;
    // A small, organic pan per hum for width without swirling.
    const pan = (Math.random() - 0.5) * 0.24;
    const noteEnd = singNote(synth, base * riseFactor, t, sound, peak, pan);
    if (noteEnd > end) end = noteEnd;
  });

  // The RESOLUTION: on a line's first word, a soft, sustained tonic underneath —
  // the arrival that grounds the line just as the drone rises to the next level.
  if (isLineStart) {
    const tonic = DRONE_FREQ * riseFactor;
    const resoEnd = singNote(synth, tonic, startTime, beat * Math.max(2, len), 0.32, 0);
    if (resoEnd > end) end = resoEnd;
  }

  // The frame-drum groove: an eighth-note pattern (DRUM_PATTERN), phase-locked
  // to a global eighth counter so the bar stays steady across word boundaries.
  const eighths = totalBeats * 2;
  for (let s = 0; s < eighths; s++) {
    const slot = DRUM_PATTERN[synth.beatCount % DRUM_PATTERN.length];
    synth.beatCount += 1;
    if (!slot) continue;
    const jitter = (Math.random() - 0.5) * 0.012;
    const vel = slot.vel * (0.9 + Math.random() * 0.2);
    frameDrum(synth, startTime + s * 0.5 * beat + jitter, slot.kind, vel);
  }

  return { advance, end };
}

const LOOKAHEAD_MS = 50;
const SCHEDULE_AHEAD = 0.8;

export class TseroufDronePlayer {
  private ctx: AudioContext | null = null;
  private synth: ChantSynth | null = null;
  private timer: number | null = null;

  private notes: TseroufNote[] = [];
  private noteSeconds = DEFAULT_NOTE_SECONDS;
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

  play(
    notes: TseroufNote[],
    options: TseroufPlayOptions & { noteSeconds?: number } = {}
  ): void {
    this.stop();
    if (notes.length === 0) return;

    const ctx = this.ensureContext();
    void ctx.resume();

    this.notes = notes;
    this.loop = options.loop ?? false;
    if (options.noteSeconds) this.noteSeconds = options.noteSeconds;
    this.onStep = options.onStep;
    this.onEnd = options.onEnd;

    const startTime = ctx.currentTime + 0.15;
    this.synth = buildChantSynth(ctx, this.noteSeconds, startTime);

    this.wordIdx = 0;
    this.nextWordTime = startTime;
    this.lastVoiceEnd = startTime;
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

  // Changes the chant tempo (seconds per sung letter); takes effect on the next
  // scheduled breaths, so it can be adjusted live during playback.
  setNoteSeconds(noteSeconds: number): void {
    this.noteSeconds = noteSeconds;
    if (this.synth) this.synth.noteSeconds = noteSeconds;
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.uiQueue = [];
    this.playing = false;
    this.paused = false;
    if (this.ctx && this.synth) {
      void this.ctx.resume();
      const now = this.ctx.currentTime;
      const gain = this.synth.master.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(0.0001, now + 0.3);
      // Let the long-lived drone/LFO oscillators stop once the fade is done.
      for (const node of this.synth.running) node.stop(now + 0.4);
      this.synth = null;
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
      const { advance, end } = scheduleChant(
        synth,
        this.notes,
        this.wordIdx,
        this.nextWordTime
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
      // Seamless loop: the drone never stops, so the chant simply begins again
      // over the same continuous ground tone.
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
export async function renderTseroufDroneWav(
  notes: TseroufNote[],
  options: TseroufRenderOptions & { noteSeconds?: number } = {}
): Promise<Blob> {
  const noteSeconds = options.noteSeconds ?? DEFAULT_NOTE_SECONDS;
  const maxSeconds = options.maxSeconds ?? 150;
  const sampleRate = 44100;

  const lead = 0.15;
  let cursor = lead;
  let count = 0;
  for (let i = 0; i < notes.length; i++) {
    cursor += chantTiming(notes, i, noteSeconds).advance;
    count++;
    if (cursor >= maxSeconds) break;
  }

  const tail = 2; // last note + short reverb decay
  const totalSeconds = cursor + tail;
  const length = Math.max(1, Math.ceil(sampleRate * totalSeconds));

  const OfflineCtor =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  const offline = new OfflineCtor(2, length, sampleRate);
  const synth = buildChantSynth(offline, noteSeconds, lead);

  let startTime = lead;
  for (let i = 0; i < count; i++) {
    const { advance } = scheduleChant(synth, notes, i, startTime);
    startTime += advance;
  }
  // Stop the long-lived drone/LFO oscillators at the very end of the buffer.
  for (const node of synth.running) node.stop(totalSeconds);

  const rendered = await offline.startRendering();
  return encodeWav(rendered);
}
