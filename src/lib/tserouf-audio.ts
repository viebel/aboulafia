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
export const TSEROUF_SCALE_OFFSETS = [0, 3, 5, 7, 10, 12, 15] as const;
export const TSEROUF_ROOT_MIDI = 57; // A3 — a comfortable classical-guitar register.
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export interface TseroufMelodicTone {
  letterIndex: number;
  semitone: number;
  midi: number;
  frequency: number;
  label: string;
}

export function tseroufMelodicTone(letter: string): TseroufMelodicTone {
  const letterIndex = letter.charCodeAt(0) - 97;
  const semitone = TSEROUF_SCALE_OFFSETS[letterIndex] ?? letterIndex * 2;
  const midi = TSEROUF_ROOT_MIDI + semitone;
  const octave = Math.floor(midi / 12) - 1;
  return {
    letterIndex,
    semitone,
    midi,
    frequency: midiToFreq(midi),
    label: `${NOTE_NAMES[((midi % 12) + 12) % 12]}${octave}`,
  };
}

// Keeps a requested start index inside the sequence (and defaults to 0), so the
// UI can ask playback to begin at an arbitrary clicked word safely.
export function clampStartIndex(index: number | undefined, length: number): number {
  if (index === undefined || !Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(Math.floor(index), length - 1));
}

function letterToFreq(letter: string): number {
  return tseroufMelodicTone(letter).frequency;
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

export type InstrumentId =
  | "guitar"
  | "piano"
  | "harpsichord"
  | "saxophone"
  | "clarinet"
  | "marimba"
  | "vibraphone"
  | "musicbox";

// Instruments offered in the UI. All are synthesized (no samples). Plucked and
// mallet/bell timbres suit permutation music well — every note is a clear,
// discrete point (think Reich/Glass minimalism, or Bach on harpsichord).
export const INSTRUMENTS: { id: InstrumentId; label: string }[] = [
  { id: "guitar", label: "Classical guitar" },
  { id: "piano", label: "Piano" },
  { id: "harpsichord", label: "Harpsichord" },
  { id: "saxophone", label: "Saxophone" },
  { id: "clarinet", label: "Clarinet (klezmer)" },
  { id: "marimba", label: "Marimba" },
  { id: "vibraphone", label: "Vibraphone" },
  { id: "musicbox", label: "Music box" },
];

export interface TseroufNote {
  word: string;
  // Suffix-reversal length used to reach the *next* word. Larger = deeper
  // structural boundary = longer breath after this word.
  flip?: number;
  durationRatio?: number;
}

export interface TseroufPlayOptions {
  stepSeconds?: number;
  // Seconds per sung letter for the chant/meditation engine (ignored by the
  // melodic invention engine, which uses stepSeconds).
  noteSeconds?: number;
  loop?: boolean;
  instrument?: InstrumentId;
  playbackStyle?: TseroufPlaybackStyle;
  // Index of the word to start playback from (defaults to 0). Lets the UI
  // jump into the piece at a clicked word.
  startIndex?: number;
  // When looping, restart from this index instead of always replaying index 0.
  // Useful when the final cell is already the visual/musical return home.
  loopStartIndex?: number;
  onStep?: (wordIndex: number, letterIndex?: number) => void;
  onEnd?: () => void;
}

export interface TseroufRenderOptions {
  stepSeconds?: number;
  instrument?: InstrumentId;
  playbackStyle?: TseroufPlaybackStyle;
  // Cap the rendered content so files stay reasonable for large permutation
  // counts. The closing reverb tail is added on top.
  maxSeconds?: number;
}

export type TseroufPlaybackStyle = "strict" | "guitar-impro";

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
  instrument: InstrumentId;
  // Per-note buffers, cached by instrument + pitch (only a few distinct pitches).
  bufferCache: Map<string, AudioBuffer>;
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

  // A gentle shared low-mid warmth on the master bus. (The guitar now carries
  // its own wooden-body resonances baked into each string buffer, so this stays
  // light to avoid doubling up into a boomy low end.)
  const body = ctx.createBiquadFilter();
  body.type = "peaking";
  body.frequency.value = 120;
  body.Q.value = 0.8;
  body.gain.value = 2.5;

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

  return {
    ctx,
    master,
    even,
    odd,
    center,
    instrument: "guitar",
    bufferCache: new Map(),
  };
}

function normalize(data: Float32Array, target = 0.9): void {
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]);
    if (a > peak) peak = a;
  }
  if (peak > 0) {
    const g = target / peak;
    for (let i = 0; i < data.length; i++) data[i] *= g;
  }
}

// Karplus-Strong plucked string (guitar, harpsichord). A noise burst feeds a
// damped feedback delay line = a vibrating string. `smooth` controls how dark
// the pluck is; `decay*` how long it sustains. `damp` adds a one-pole low-pass
// inside the feedback loop: a real nylon string sheds its high partials far
// faster than its fundamental, so more damping turns the bright, metallic KS
// "sproing" into a warm, woody, human-sounding decay (0 = the crisp original).
// `pickPos` (0 = off) combs the excitation to model WHERE the string is plucked:
// a real player picks a fraction of the way along the string, which silences the
// harmonics that have a node there — this comb is a big part of why a guitar
// sounds like a guitar and not a buzzy synth string.
function karplusBuffer(
  ctx: BaseAudioContext,
  freq: number,
  decayLow: number,
  decayHigh: number,
  smooth: number,
  seconds: number,
  damp = 0,
  pickPos = 0
): AudioBuffer {
  const sr = ctx.sampleRate;
  const total = Math.floor(sr * seconds);
  const delay = Math.max(2, Math.round(sr / freq));
  const buffer = ctx.createBuffer(1, total, sr);
  const d = buffer.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < delay; i++) {
    const w = Math.random() * 2 - 1;
    lp = smooth * w + (1 - smooth) * lp;
    d[i] = lp;
  }
  // Pick-position comb: subtract a delayed copy of the excitation (a notch comb),
  // so the harmonics with a node at the pluck point vanish — the characteristic
  // hollow colour of a plucked acoustic string.
  if (pickPos > 0) {
    const p = Math.max(1, Math.round(delay * pickPos));
    for (let i = delay - 1; i >= p; i--) d[i] -= d[i - p];
  }
  const decay = freq < 200 ? decayLow : decayHigh;
  // Feedback-loop low-pass state: each round trip darkens the tone a little
  // more, so the aggressive top partials die away first and leave a warm body.
  // The damping RAMPS IN over the first ~120 ms: the pluck keeps its bright,
  // lively attack (the string's initial sparkle) and only then mellows into the
  // warm body — a real string sheds its highs fast, but not instantly.
  let loopLp = 0;
  const rampSamples = Math.max(1, Math.floor(sr * 0.12));
  for (let i = delay; i < total; i++) {
    const prog = Math.min(1, (i - delay) / rampSamples);
    const dampNow = damp * (0.35 + 0.65 * prog);
    const prev = d[i - delay];
    const prev2 = i - delay - 1 >= 0 ? d[i - delay - 1] : prev;
    const avg = 0.5 * (prev + prev2);
    loopLp = avg + dampNow * (loopLp - avg);
    d[i] = decay * loopLp;
  }
  normalize(d);
  return buffer;
}

// One RBJ peaking-EQ biquad, run in place over a sample buffer. Used to BAKE the
// resonant peaks of a guitar body (the air/Helmholtz "boom" + the wood-top
// resonances) into the bare string tone — the hollow wooden "box" that the ear
// hears as an acoustic guitar rather than a synthetic string.
function peakingEq(
  d: Float32Array,
  sr: number,
  f0: number,
  q: number,
  dbGain: number
): void {
  const A = Math.pow(10, dbGain / 40);
  const w0 = (2 * Math.PI * f0) / sr;
  const cw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha / A;
  const b0 = (1 + alpha * A) / a0;
  const b1 = (-2 * cw) / a0;
  const b2 = (1 - alpha * A) / a0;
  const a1 = (-2 * cw) / a0;
  const a2 = (1 - alpha / A) / a0;
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < d.length; i++) {
    const x0 = d[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    d[i] = y0;
  }
}

// Turns a bare Karplus-Strong string into an acoustic guitar: it bakes in the
// resonances of a wooden body and a soft finger attack. The body peaks are the
// measured resonances of a real classical guitar — the Helmholtz air mode near
// 100 Hz, the main top (wood) mode near 200 Hz, and an upper wood formant around
// 430 Hz — which together give the warm, hollow, woody "box" of the instrument.
function shapeGuitarBody(buffer: AudioBuffer, sr: number): void {
  const d = buffer.getChannelData(0);
  // A short, soft finger/nail transient at the very onset: the gentle "chiff" of
  // flesh and nail releasing the string, low-passed so it stays warm, not clicky.
  const aN = Math.floor(sr * 0.008);
  let nlp = 0;
  for (let i = 0; i < aN && i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    nlp = 0.5 * w + 0.5 * nlp; // low-pass the noise → soft, fleshy, not clicky
    d[i] += 0.18 * nlp * (1 - i / aN);
  }
  // The wooden body resonances — peaks at the measured modes, with an
  // anti-resonance (a real body has dips between its modes) and an upper
  // "presence/brilliance" peak that gives the box its woody air and definition.
  peakingEq(d, sr, 100, 1.1, 4); //  air / Helmholtz "boom"
  peakingEq(d, sr, 200, 1.4, 3); //  main top (wood) resonance
  peakingEq(d, sr, 280, 2.0, -3); // anti-resonance dip between the modes
  peakingEq(d, sr, 430, 1.2, 2); //  upper wood formant — the "woody" colour
  peakingEq(d, sr, 2600, 1.4, 2.5); // brilliance — the air/definition of the box
  normalize(d);
}

interface Harmonic {
  ratio: number;
  gain: number;
  decay: number;
}

// Struck/mallet/bell tones (piano, marimba, vibraphone, music box) as a sum of
// decaying partials, with optional inharmonicity, a hammer transient and a
// tremolo (vibraphone).
function additiveBuffer(
  ctx: BaseAudioContext,
  freq: number,
  seconds: number,
  partials: Harmonic[],
  inharm: number,
  tremoloHz: number,
  tremoloDepth: number,
  hammer: number
): AudioBuffer {
  const sr = ctx.sampleRate;
  const total = Math.floor(sr * seconds);
  const buffer = ctx.createBuffer(1, total, sr);
  const d = buffer.getChannelData(0);
  const nyq = sr * 0.45;
  for (let i = 0; i < total; i++) {
    const t = i / sr;
    let s = 0;
    for (const p of partials) {
      const f = freq * p.ratio * Math.sqrt(1 + inharm * p.ratio * p.ratio);
      if (f >= nyq) continue;
      s += p.gain * Math.exp(-t * p.decay) * Math.sin(2 * Math.PI * f * t);
    }
    if (tremoloDepth > 0) {
      s *= 1 - tremoloDepth + tremoloDepth * 0.5 * (1 + Math.sin(2 * Math.PI * tremoloHz * t));
    }
    d[i] = s;
  }
  if (hammer > 0) {
    const aN = Math.floor(sr * 0.006);
    for (let i = 0; i < aN && i < total; i++) {
      d[i] += hammer * (Math.random() * 2 - 1) * (1 - i / aN);
    }
  }
  normalize(d);
  return buffer;
}

// Adds one sinusoidal partial with a two-stage exponential decay, computed by
// recurrence (rotating phasor + per-sample decay multiply) so we can stack many
// partials and strings cheaply — no per-sample sin()/exp().
function addPartial(
  d: Float32Array,
  sr: number,
  freq: number,
  amp: number,
  decayFast: number,
  decaySlow: number,
  mixFast: number
): void {
  const dphi = (2 * Math.PI * freq) / sr;
  const cw = Math.cos(dphi);
  const sw = Math.sin(dphi);
  // Random initial phase so partials/strings don't all align into a click.
  const ph0 = Math.random() * 2 * Math.PI;
  let x = Math.cos(ph0);
  let y = Math.sin(ph0);
  const rF = Math.exp(-decayFast / sr);
  const rS = Math.exp(-decaySlow / sr);
  let eF = mixFast;
  let eS = 1 - mixFast;
  for (let i = 0; i < d.length; i++) {
    d[i] += amp * (eF + eS) * x;
    const nx = x * cw - y * sw;
    y = x * sw + y * cw;
    x = nx;
    eF *= rF;
    eS *= rS;
  }
}

// Acoustic grand piano (Keith Jarrett-ish): warm, singing, percussive but
// round. The realism comes from (1) inharmonicity (stiff strings stretch the
// partials sharp), (2) THREE slightly detuned strings per note beating into a
// living chorus, (3) a TWO-STAGE decay — a quick thud over a long singing
// aftersound — with treble dying faster than the fundamental, and (4) a soft,
// rounded hammer instead of a sharp click.
function pianoBuffer(ctx: BaseAudioContext, freq: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const seconds = Math.max(2.6, Math.min(5.0, 1100 / freq));
  const total = Math.floor(sr * seconds);
  const buffer = ctx.createBuffer(1, total, sr);
  const d = buffer.getChannelData(0);
  const nyq = sr * 0.45;
  const N = Math.max(1, Math.min(16, Math.floor(nyq / freq)));
  // More inharmonicity in the bass, like a real soundboard.
  const B = freq < 160 ? 0.0011 : freq < 320 ? 0.0006 : 0.0003;
  const detunesCents = [-0.7, 0, 0.8]; // three strings -> gentle beating

  for (const cents of detunesCents) {
    const f0 = freq * Math.pow(2, cents / 1200);
    for (let k = 1; k <= N; k++) {
      const fk = f0 * k * Math.sqrt(1 + B * k * k);
      if (fk >= nyq) break;
      const amp = Math.pow(k, -0.85); // warm, gentle rolloff
      const dFast = 3.0 + k * 1.2; // quick initial transient, brighter on top
      const dSlow = 0.32 + k * 0.26; // long singing tail, treble fades first
      addPartial(d, sr, fk, amp, dFast, dSlow, 0.45);
    }
  }

  // Rounded hammer: a short, heavily low-passed noise thud (felt, not click).
  const aN = Math.floor(sr * 0.011);
  let lp = 0;
  for (let i = 0; i < aN && i < total; i++) {
    const noise = Math.random() * 2 - 1;
    lp = 0.2 * noise + 0.8 * lp;
    d[i] += 0.3 * lp * Math.pow(1 - i / aN, 2);
  }

  normalize(d);
  return buffer;
}

// Tenor saxophone (Coltrane-ish): warm and vocal, not a buzzy sawtooth. The
// spectrum is shaped by reed/bore formant resonances (so low and mid partials
// dominate and the top rolls off), with an expressive vibrato that swells in
// over the note, plus a little breath. Steady amplitude — the note envelope
// shapes its length.
function reedBuffer(ctx: BaseAudioContext, freq: number, seconds: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const total = Math.floor(sr * seconds);
  const buffer = ctx.createBuffer(1, total, sr);
  const d = buffer.getChannelData(0);
  const nyq = sr * 0.45;
  const maxK = Math.max(1, Math.min(20, Math.floor(nyq / freq)));

  // Tenor-sax formant regions: a strong low body, a mid "honk", an upper edge.
  const formants = [
    { f: 600, bw: 130, g: 1.0 },
    { f: 1100, bw: 220, g: 0.65 },
    { f: 2700, bw: 500, g: 0.3 },
  ];
  const amps = new Float32Array(maxK + 1);
  for (let k = 1; k <= maxK; k++) {
    const fk = freq * k;
    let r = 0;
    for (const F of formants) {
      const x = (fk - F.f) / F.bw;
      r += F.g / (1 + x * x);
    }
    amps[k] = r * Math.pow(220 / Math.max(fk, 110), 0.22); // gentle warm tilt
  }

  const vibHz = 5.5;
  const vibMax = Math.pow(2, 22 / 1200) - 1; // up to ~22 cents, jazz-expressive
  let phase = 0;
  let bn = 0;
  for (let i = 0; i < total; i++) {
    const t = i / sr;
    const onset = Math.min(1, t / 0.35); // vibrato swells in, vocal/Coltrane
    const vib = 1 + vibMax * onset * Math.sin(2 * Math.PI * vibHz * t);
    phase += (2 * Math.PI * freq * vib) / sr;
    let s = 0;
    for (let k = 1; k <= maxK; k++) s += amps[k] * Math.sin(k * phase);
    const w = Math.random() * 2 - 1;
    bn = 0.07 * w + 0.93 * bn;
    s += 0.16 * bn;
    d[i] = s;
  }
  normalize(d, 0.9);
  return buffer;
}

// Klezmer clarinet (Yom-ish): a cylindrical bore closed at the reed favours
// ODD harmonics, giving the hollow, woody, "vocal" clarinet tone. Plus the
// expressive touches of klezmer playing: a quick pitch bend up into each note
// (the "krekhts" sob) and a vibrato that swells in. Sustained — the note
// envelope shapes its length.
function clarinetBuffer(ctx: BaseAudioContext, freq: number, seconds: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const total = Math.floor(sr * seconds);
  const buffer = ctx.createBuffer(1, total, sr);
  const d = buffer.getChannelData(0);
  const nyq = sr * 0.45;
  const maxK = Math.max(1, Math.min(20, Math.floor(nyq / freq)));

  const amps = new Float32Array(maxK + 1);
  for (let k = 1; k <= maxK; k++) {
    const odd = k % 2 === 1;
    // Odd partials strong; even partials much weaker -> hollow clarinet colour.
    const base = odd ? Math.pow(k, -0.8) : 0.12 * Math.pow(k, -1);
    const fk = freq * k;
    const ring = 1 + 0.5 * Math.exp(-Math.pow((fk - 1800) / 900, 2)); // reedy ring
    amps[k] = base * ring;
  }

  const vibHz = 5;
  const vibMax = Math.pow(2, 18 / 1200) - 1; // ~18 cents
  const scoopCents = 35;
  const scoopSec = 0.05;
  let phase = 0;
  let bn = 0;
  for (let i = 0; i < total; i++) {
    const t = i / sr;
    const onset = Math.min(1, t / 0.3);
    // Klezmer bend-in: start ~35 cents flat and slide up to pitch.
    const scoop =
      t < scoopSec ? Math.pow(2, (-scoopCents * (1 - t / scoopSec)) / 1200) : 1;
    const vib = 1 + vibMax * onset * Math.sin(2 * Math.PI * vibHz * t);
    phase += (2 * Math.PI * freq * vib * scoop) / sr;
    let s = 0;
    for (let k = 1; k <= maxK; k++) s += amps[k] * Math.sin(k * phase);
    const w = Math.random() * 2 - 1;
    bn = 0.06 * w + 0.94 * bn;
    s += 0.08 * bn; // a little reed air, cleaner than the sax
    d[i] = s;
  }
  normalize(d, 0.9);
  return buffer;
}

const MARIMBA: Harmonic[] = [
  { ratio: 1, gain: 1, decay: 5 },
  { ratio: 3.9, gain: 0.4, decay: 9 },
  { ratio: 9.2, gain: 0.12, decay: 13 },
];
const VIBES: Harmonic[] = [
  { ratio: 1, gain: 1, decay: 0.8 },
  { ratio: 4, gain: 0.5, decay: 1.4 },
  { ratio: 9.4, gain: 0.18, decay: 2.2 },
];
const MUSICBOX: Harmonic[] = [
  { ratio: 1, gain: 1, decay: 2.4 },
  { ratio: 2, gain: 0.5, decay: 3.2 },
  { ratio: 3.01, gain: 0.35, decay: 4.0 },
  { ratio: 4.2, gain: 0.22, decay: 5.2 },
  { ratio: 5.4, gain: 0.15, decay: 6.5 },
];

function makeInstrumentBuffer(
  ctx: BaseAudioContext,
  id: InstrumentId,
  freq: number,
  variant = 0
): AudioBuffer {
  switch (id) {
    case "guitar": {
      // A real nylon/acoustic guitar: a darker, fleshier pluck (low `smooth`)
      // with a damped feedback loop (highs decay fast), combed for the pluck
      // position, then shaped by the resonances of a wooden body + a soft finger
      // attack — a warm acoustic voice instead of a bright, metallic ring.
      //
      // Round-robin: each variant is a fresh excitation burst (the noise is
      // random every call) with the pluck point nudged a little, so repeated
      // notes never sound identical — no "machine-gun" giveaway of a sampler.
      const pickPos = 0.18 + ((variant * 0.37) % 1 - 0.5) * 0.07;
      const buf = karplusBuffer(ctx, freq, 0.9975, 0.9965, 0.46, 3.6, 0.5, pickPos);
      shapeGuitarBody(buf, ctx.sampleRate);
      return buf;
    }
    case "harpsichord":
      return karplusBuffer(ctx, freq, 0.994, 0.991, 0.12, 2.4);
    case "piano":
      return pianoBuffer(ctx, freq);
    case "marimba":
      return additiveBuffer(ctx, freq, 1.4, MARIMBA, 0, 0, 0, 0.25);
    case "vibraphone":
      return additiveBuffer(ctx, freq, 4.0, VIBES, 0, 5, 0.3, 0.05);
    case "musicbox":
      return additiveBuffer(ctx, freq, 2.2, MUSICBOX, 0.0012, 0, 0, 0.08);
    case "saxophone":
      return reedBuffer(ctx, freq, 4.0);
    case "clarinet":
      return clarinetBuffer(ctx, freq, 4.0);
  }
}

function instrumentBuffer(synth: Synth, freq: number, variant = 0): AudioBuffer {
  const key = `${synth.instrument}:${Math.round(freq * 50)}:${variant}`;
  const cached = synth.bufferCache.get(key);
  if (cached) return cached;
  const buffer = makeInstrumentBuffer(synth.ctx, synth.instrument, freq, variant);
  synth.bufferCache.set(key, buffer);
  return buffer;
}

// How many round-robin string variants the guitar cycles through. Each is a
// distinct cached buffer (different excitation + pluck point); a note picks one
// at random so consecutive strikes of the same pitch differ subtly, the way a
// real player never plucks a string exactly the same way twice.
const GUITAR_ROUND_ROBIN = 4;

const SUSTAINED: Partial<Record<InstrumentId, boolean>> = {
  saxophone: true,
  clarinet: true,
};
const DEFAULT_ATTACK: Record<InstrumentId, number> = {
  guitar: 0.004,
  harpsichord: 0.003,
  piano: 0.003,
  saxophone: 0.04,
  clarinet: 0.03,
  marimba: 0.002,
  vibraphone: 0.004,
  musicbox: 0.003,
};

// A tiny, human timing offset. Even a steady player never lands a note exactly
// on the grid: there is always a few-millisecond push or drag. Summing three
// random values gives a near-Gaussian jitter clustered around zero (mostly
// ~±4 ms, rarely up to ~±12 ms) — enough to feel played by a person rather than
// a sequencer, without ever sounding sloppy. It is applied per note, around the
// grid position (never accumulated), so the tempo never drifts.
function humanizeTime(time: number): number {
  const jitter = ((Math.random() + Math.random() + Math.random()) / 3 - 0.5) * 0.024;
  return Math.max(0, time + jitter);
}

// Schedules one note and returns the time it stops sounding.
function pluckNote(
  synth: Synth,
  voice: Voice,
  freq: number,
  time: number,
  velocity: number,
  ringSeconds: number,
  attack?: number,
  detuneCents = 0
): number {
  const ctx = synth.ctx;
  time = humanizeTime(time);
  const isGuitar = synth.instrument === "guitar";
  const src = ctx.createBufferSource();
  // Round-robin: pick one of the guitar's string variants at random per note.
  const variant = isGuitar ? Math.floor(Math.random() * GUITAR_ROUND_ROBIN) : 0;
  src.buffer = instrumentBuffer(synth, freq * voice.transpose, variant);
  src.detune.value = detuneCents + (Math.random() - 0.5) * 8;

  const atk = attack ?? DEFAULT_ATTACK[synth.instrument];
  const gain = ctx.createGain();
  let end: number;

  if (SUSTAINED[synth.instrument]) {
    // Hold at full level for the note's length, then release — a sustained reed.
    const hold = time + Math.max(ringSeconds, atk + 0.05);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(velocity, time + atk);
    gain.gain.setValueAtTime(velocity, hold);
    gain.gain.linearRampToValueAtTime(0.0001, hold + 0.1);
    end = hold + 0.14;
  } else {
    // Struck/plucked: quick attack, then a gentle decay/release.
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(velocity, time + atk);
    gain.gain.setTargetAtTime(0.0001, time + ringSeconds * 0.6, ringSeconds * 0.5);
    // Let the exponential release get very quiet before stopping the buffer.
    // Stopping too soon chops the tail, especially on the final arrival.
    end = time + ringSeconds * 1.8 + 0.45;
  }

  src.connect(gain);
  if (isGuitar) {
    // Velocity → brightness (the EKS "dynamic-level" filter): a soft pluck is
    // round and dark, a hard pluck is bright and present. We open a per-note
    // low-pass as the velocity rises, so dynamics change the TONE, not just the
    // volume — the difference between "typed in" and "played".
    const v = Math.max(0, Math.min(1, (velocity - 0.25) / 0.55));
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 1200 + v * v * 4300; // ~1.2 kHz (soft) .. ~5.5 kHz (hard)
    tone.Q.value = 0.4;
    gain.connect(tone);
    tone.connect(voice.in);
  } else {
    gain.connect(voice.in);
  }
  src.start(time);
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
  // No rests between words. Line shape is carried by ties and accents, not by
  // stopping the flow.
  const pause = 0;

  return { len, beat, span, advance: span + pause, isPhraseStart, isPhraseEnd };
}

interface WordGrooveStep {
  velocity: number;
  ring: number;
  bass: number;
  time: number;
}

// Gives every permutation a real word-level rhythmic shape, not just a stream
// of equal notes. The visual parity colours become MUSICAL colours:
//   * blue/even words are grounded: stronger downbeat, longer tail, steadier.
//   * rose/odd words are lifted: syncopated inner accents and a slight forward
//     lean on offbeats, like an answer pushing back.
function wordGrooveStep(
  i: number,
  len: number,
  isBlue: boolean,
  wordIndex: number
): WordGrooveStep {
  const pos = len <= 1 ? 0 : i / (len - 1);
  const phrase = wordIndex % 4;
  if (isBlue) {
    const downbeat = i === 0 ? 1.18 : 1;
    const tail = i === len - 1 ? 1.1 : 1;
    const wave = 1 + 0.06 * Math.cos(2 * Math.PI * (pos + phrase * 0.08));
    return {
      velocity: downbeat * tail * wave,
      ring: i === 0 ? 1.12 : i === len - 1 ? 1.18 : 0.95,
      bass: i === 0 ? 1.18 : i === len - 1 ? 1.08 : 0.96,
      time: i === 0 ? -0.01 : 0,
    };
  }

  const upbeat = i === 1 || i === len - 1 ? 1.16 : 1;
  const firstLight = i === 0 ? 0.9 : 1;
  const wave = 1 + 0.07 * Math.sin(2 * Math.PI * (pos + 0.22 + phrase * 0.07));
  return {
    velocity: firstLight * upbeat * wave,
    ring: i === 0 ? 0.9 : i === len - 1 ? 1.22 : 1.02,
    bass: i === 0 ? 0.88 : i === len - 1 ? 1.12 : 1,
    time: i % 2 === 1 ? 0.018 : -0.004,
  };
}

function smallFactorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

interface LineGroove {
  velocity: number;
  ring: number;
  bass: number;
  resolution: number;
  tension: number;
  wordInLine: number;
  lineWords: number;
}

// The next musical level above the word: one visible Tserouf line is (n-1)!
// words — for abcd, 6 words. Give that whole line an audible arc:
// arrival -> relaxation -> build -> crest -> tension into the next line.
function lineGroove(wordIndex: number, wordLength: number): LineGroove {
  const lineWords = Math.max(1, smallFactorial(Math.max(1, wordLength - 1)));
  const wordInLine = wordIndex % lineWords;
  const pos = lineWords <= 1 ? 0 : wordInLine / (lineWords - 1);
  const arc = Math.sin(Math.PI * pos); // broad phrase swell, peak mid/late line
  const arrival = wordInLine === 0 ? 1 : 0;
  const launch = wordInLine === 1 ? 1 : 0;
  const ending = wordInLine === lineWords - 1 ? 1 : 0;
  const crest = wordInLine === Math.max(0, lineWords - 2) ? 1 : 0;

  return {
    velocity:
      0.96 + 0.16 * arc + 0.08 * arrival + 0.95 * launch + 0.08 * crest - 0.06 * ending,
    ring: 0.96 + 0.12 * arc + 0.2 * arrival + 0.36 * launch + 0.08 * crest - 0.08 * ending,
    bass: 0.92 + 0.14 * arc + 0.2 * arrival + 0.82 * launch + 0.1 * crest - 0.12 * ending,
    resolution: 1 + 0.35 * arrival,
    tension: 1 + 0.28 * ending,
    wordInLine,
    lineWords,
  };
}

// Schedules a single melodic cell and returns how far to advance and the time
// the last sound in it stops ringing.
function scheduleWord(
  synth: Synth,
  notes: TseroufNote[],
  idx: number,
  startTime: number,
  stepSeconds: number,
  options: { previousWord?: string; wrapsToStart?: boolean } = {}
): { advance: number; end: number } {
  const note = notes[idx];
  const letters = Array.from(note.word);
  const previousWord = options.previousWord ?? "";
  const wrapsToStart = options.wrapsToStart ?? false;
  const { len, beat, advance, isPhraseStart, isPhraseEnd } = wordTiming(
    notes,
    idx,
    stepSeconds
  );

  const isBlueWord = isEvenPermutation(note.word);
  const voice = isBlueWord ? synth.even : synth.odd;
  const center = synth.center;
  const bassRoot = TSEROUF_ROOT_MIDI - 12;
  const line = lineGroove(idx, len);
  let end = startTime;
  const mark = (t: number) => {
    if (t > end) end = t;
  };

  // Soft attack so the cadence stays inside the texture.
  const SOFT = 0.025;

  // Follow the tabla — and respect its two drums. Lay the steady note stream
  // onto TEENTAL (16 matras, four vibhags of four), so a four-note word is
  // exactly one vibhag and four cells complete one cycle. Each matra carries a
  // bol that is routed to the two hands:
  //   * baya  (bass / left hand)  -> a low tonic pulse on synth.center,
  //   * dayan (treble / right hand) -> the pitched melody note (parity voice).
  // Resonant bols (Dha, Dhin) strike BOTH drums; the khali bols (Na, Tin, Ta)
  // are dayan-only — the left hand lifts, opening the cycle. Straight matras,
  // strongest on sam, then the vibhag heads. The grid is global so the tala
  // carries across cells.
  //   Dha Dhin Dhin Dha | Dha Dhin Dhin Dha | Na Tin Tin Ta | Ta Dhin Dhin Dha
  const THEKA: { baya: boolean; stress: number }[] = [
    { baya: true, stress: 1.0 }, // 1  Dha  (SAM — both hands)
    { baya: true, stress: 0.5 }, // 2  Dhin
    { baya: true, stress: 0.5 }, // 3  Dhin
    { baya: true, stress: 0.58 }, // 4  Dha
    { baya: true, stress: 0.8 }, // 5  Dha  (vibhag head)
    { baya: true, stress: 0.5 }, // 6  Dhin
    { baya: true, stress: 0.5 }, // 7  Dhin
    { baya: true, stress: 0.58 }, // 8  Dha
    { baya: false, stress: 0.72 }, // 9  Na   (KHALI — baya lifts)
    { baya: false, stress: 0.46 }, // 10 Tin
    { baya: false, stress: 0.46 }, // 11 Tin
    { baya: false, stress: 0.52 }, // 12 Ta
    { baya: false, stress: 0.74 }, // 13 Ta   (vibhag head, still baya-less)
    { baya: true, stress: 0.5 }, // 14 Dhin (baya returns)
    { baya: true, stress: 0.5 }, // 15 Dhin
    { baya: true, stress: 0.58 }, // 16 Dha
  ];
  const CYCLE = THEKA.length; // 16 matras
  const matra = (g: number) => ((g % CYCLE) + CYCLE) % CYCLE;

  if (isPhraseStart) {
    // RESOLUTION: a single soft tonic bass (A). The falling-fifth E -> A lands
    // here as pure bass motion — no struck chord at all — so the arrival stays
    // completely inside the melodic texture. A slightly longer ring seats it.
    // (This also serves as the baya stroke on this downbeat.)
    mark(
      pluckNote(
        synth,
        center,
        midiToFreq(bassRoot),
        startTime,
        0.55 * line.resolution,
        3.4 * line.ring,
        SOFT
      )
    );
  }

  // A line break reverses the whole word, so the last letter of a line becomes
  // the first of the next (…adcb -> bcda…). Rather than restrike that repeated
  // note, tie it over: skip the new line's first note and let the previous
  // one ring through the downbeat where the resolution lands.
  const prevWord = idx > 0 ? notes[idx - 1].word : previousWord;
  const tieFirst =
    isPhraseStart && prevWord.length > 0 && prevWord[prevWord.length - 1] === letters[0];

  // Strike the theka: straight (un-swung) matras, with each bol routed to its
  // hand. The global matra index is idx*len + i (words share one length, so
  // each cell sits squarely on the tala grid).
  letters.forEach((letter, i) => {
    const m = matra(idx * len + i);
    const bol = THEKA[m];
    const isAccent = bol.stress >= 0.7; // sam + vibhag heads
    const groove = wordGrooveStep(i, len, isBlueWord, idx);
    // Straight subdivisions on the grid; the human micro-timing is added
    // per-strike inside pluckNote, so both the bass and the melody breathe.
    const t = startTime + i * beat + groove.time * beat;

    // BAYA (left hand / bass): a low tonic pulse on every resonant bol, silent
    // on the khali bols so the open half breathes. Skipped on a resolution
    // downbeat where the cadence bass already covers it.
    if (bol.baya && !(isPhraseStart && i === 0)) {
      mark(
        pluckNote(
          synth,
          center,
          midiToFreq(bassRoot),
          t,
          (0.3 + 0.12 * bol.stress) *
            groove.bass *
            line.bass *
            (line.wordInLine === 1 && i === 0 ? 1.7 : 1),
          beat * (isAccent ? 1.3 : 0.9) * line.ring,
          SOFT
        )
      );
    }

    // DAYAN (right hand / treble): a CONTINUOUS singing voice. The tala's punch
    // lives in the baya, so the melody itself keeps its dynamics gentle and is
    // bound legato — notes overlap their neighbours, and the last note of a cell
    // rings well into the next word so the previous sound is still alive when the
    // next word eases in. The first note of each word also gets a softer,
    // rounded attack so the seam between cells is inaudible (the pentatonic keeps
    // every overlap consonant).
    if (tieFirst && i === 0) return;
    const isWordStart = i === 0;
    // Gentle dynamics: only a small lift on the tala accents, so the line sings
    // evenly across word boundaries instead of punching each vibhag head.
    // On top of that, a player leans into the odd note for expression: a random
    // dynamic accent that does NOT follow the metric grid (~14% of notes get a
    // gentle push), so the line has living, unpredictable emphasis. Since
    // velocity also drives the guitar's brightness, an accent rings a touch
    // brighter as well as louder — exactly like a stronger pluck.
    const accent = Math.random() < 0.14 ? 1.22 + Math.random() * 0.16 : 1;
    const isLineLaunch = isWordStart && line.wordInLine === 1;
    const launchAttack = isLineLaunch ? 2.2 : 1;
    const velocity = Math.min(
      0.98,
      (0.52 + 0.2 * bol.stress) *
        groove.velocity *
        line.velocity *
        launchAttack *
        (0.94 + Math.random() * 0.1) *
        accent
    );
    // Round the attack at the seam so the new word swells in under the still-
    // ringing previous note (legato), rather than re-articulating.
    const attack =
      isLineLaunch ? 0.001 : isWordStart ? 0.022 : undefined;
    // Long, overlapping rings; the cell's last note bridges into the next word.
    const boundaryTail = (isPhraseEnd || wrapsToStart) && i === len - 1 ? 1.75 : 1;
    const resolutionTrace = isPhraseStart && i === len - 1 ? 1.65 : 1;
    const ring =
      (i === len - 1 ? beat * 2.4 : beat * 1.7) *
      groove.ring *
      line.ring *
      boundaryTail *
      resolutionTrace;
    mark(
      pluckNote(
        synth,
        voice,
        letterToFreq(letter),
        t,
        velocity,
        ring,
        attack,
        isLineLaunch ? 28 : 0
      )
    );
  });

  if (isPhraseEnd || wrapsToStart) {
    // TENSION closing the line: a soft dominant bass (E) only — a falling-fifth
    // E -> A into the next line's tonic. No raised leading tone (G#): it lives
    // outside the minor pentatonic and clashed with the natural melody notes,
    // which is what sounded out of tune. The bass motion carries the cadence.
    const tEnd = startTime + (len - 1) * beat;
    mark(
      pluckNote(
        synth,
        center,
        midiToFreq(bassRoot + 7),
        tEnd,
        0.46 * line.tension,
        1.7 * line.ring,
        SOFT
      )
    );
  }

  return { advance, end };
}

function wordUiEvents(
  notes: TseroufNote[],
  idx: number,
  startTime: number,
  stepSeconds: number
): { time: number; wordIndex: number; letterIndex: number }[] {
  const word = notes[idx]?.word ?? "";
  const letters = Array.from(word);
  const isBlueWord = isEvenPermutation(word);
  const { len, beat } = wordTiming(notes, idx, stepSeconds);

  return letters.map((_, letterIndex) => {
    const groove = wordGrooveStep(letterIndex, len, isBlueWord, idx);
    return {
      time: Math.max(startTime, startTime + letterIndex * beat + groove.time * beat),
      wordIndex: idx,
      letterIndex,
    };
  });
}

interface GuitarImproTiming {
  beat: number;
  phraseEnd: number;
  fragmentBeats: number;
  advance: number;
  phase: number;
}

function guitarImproTiming(
  notes: TseroufNote[],
  idx: number,
  stepSeconds: number
): GuitarImproTiming {
  const len = Math.max(1, notes[idx]?.word.length ?? 1);
  const last = Math.max(1, notes.length - 1);
  const phase = idx / last;
  const ratio = notes[idx]?.durationRatio ?? 1;
  // The tempo sets the underlying pulse. The ratio controls the cell's total
  // span on that pulse grid, not the per-letter tempo; otherwise high BPM still
  // feels slow whenever a cell has a long duration mark.
  const beat = stepSeconds;
  const phraseEnd = len * beat * ratio;
  const hasRepeat = ratio >= 1.5 && len >= 3;
  const fragmentBeats = hasRepeat ? Math.min(beat * 1.2, phraseEnd * 0.22) : 0;
  const breath =
    ratio >= 2 ? beat * 0.35 : ratio <= 0.5 ? 0 : idx % 3 === 0 ? beat * 0.18 : 0;
  return { beat, phraseEnd, fragmentBeats, advance: phraseEnd + breath, phase };
}

function scheduleGuitarImproWord(
  synth: Synth,
  notes: TseroufNote[],
  idx: number,
  startTime: number,
  stepSeconds: number,
  options: { wrapsToStart?: boolean } = {}
): { advance: number; end: number } {
  const note = notes[idx];
  const letters = Array.from(note.word);
  const len = Math.max(1, letters.length);
  const { beat, phraseEnd, fragmentBeats, advance, phase } = guitarImproTiming(
    notes,
    idx,
    stepSeconds
  );
  const isBlueWord = isEvenPermutation(note.word);
  const voice = isBlueWord ? synth.even : synth.odd;
  const center = synth.center;
  const bassRoot = TSEROUF_ROOT_MIDI - 12; // open A, one octave below the melody root.
  const density = Math.sin(Math.PI * Math.min(1, phase));
  const finalReturn = phase >= 0.84 || options.wrapsToStart;
  let end = startTime;
  const mark = (t: number) => {
    if (t > end) end = t;
  };

  // Continuous/semi-continuous open-string ground: A and E, with rare D colour.
  mark(pluckNote(synth, center, midiToFreq(bassRoot), startTime, 0.2 + 0.11 * density, beat * 5.2, 0.035));
  if (idx % 2 === 0 || phase < 0.2) {
    mark(
      pluckNote(
        synth,
        center,
        midiToFreq(bassRoot + 7),
        startTime + beat * 1.7,
        0.12 + 0.07 * density,
        beat * 4.2,
        0.04
      )
    );
  }
  if (phase > 0.45 && phase < 0.82 && idx % 4 === 1) {
    mark(
      pluckNote(
        synth,
        center,
        midiToFreq(bassRoot + 5),
        startTime + beat * 2.45,
        0.08,
        beat * 3.2,
        0.045
      )
    );
  }

  const baseVelocity =
    phase < 0.18 ? 0.34 : phase < 0.55 ? 0.5 : phase < 0.84 ? 0.64 : 0.42;
  const melodicSpan = Math.max(beat * 0.75, phraseEnd - fragmentBeats);
  const letterStep = len <= 1 ? melodicSpan : melodicSpan / len;
  letters.forEach((letter, i) => {
    const pos = len <= 1 ? 0 : i / (len - 1);
    const t = startTime + i * letterStep;
    const swell = 0.92 + 0.16 * Math.sin(Math.PI * pos);
    const velocity = Math.min(0.88, baseVelocity * swell * (0.94 + Math.random() * 0.1));
    const ring =
      letterStep *
      (phase < 0.18 ? 3.3 : phase < 0.55 ? 2.15 : phase < 0.84 ? 1.55 : 2.45);
    mark(
      pluckNote(
        synth,
        voice,
        letterToFreq(letter),
        t,
        velocity,
        ring,
        i === 0 ? 0.028 : undefined,
        phase < 0.18 && i === 0 ? 16 : 0
      )
    );

    const next = letters[i + 1];
    // Guitaristic comments on the cell, kept inside A C D E, with rare G colour.
    if (letter === "b" && (next === "c" || phase > 0.55)) {
      mark(pluckNote(synth, voice, letterToFreq("c"), t + letterStep * 0.42, velocity * 0.42, letterStep * 0.9, 0.018));
    }
    if (letter === "d" && (next === "c" || phase > 0.5)) {
      mark(pluckNote(synth, voice, letterToFreq("c"), t + letterStep * 0.36, velocity * 0.36, letterStep * 0.75, 0.015));
    }
    if (phase > 0.58 && phase < 0.78 && i === 1 && idx % 4 === 1) {
      mark(pluckNote(synth, voice, letterToFreq("e"), t + letterStep * 0.55, velocity * 0.26, letterStep * 1.2, 0.02));
    }
  });

  if (phase >= 0.55 && phase < 0.84 && len >= 3) {
    const fragment = idx % 2 === 0 ? letters.slice(-2) : letters.slice(0, 2);
    fragment.forEach((letter, j) => {
      const t = startTime + melodicSpan + j * Math.min(beat * 0.6, fragmentBeats / Math.max(1, fragment.length));
      mark(
        pluckNote(
          synth,
          voice,
          letterToFreq(letter),
          t,
          0.46 + 0.08 * j,
          beat * 1.35,
          0.012
        )
      );
    });
  }

  if (finalReturn) {
    const cadenceTime = startTime + phraseEnd - beat * 0.45;
    mark(pluckNote(synth, center, midiToFreq(bassRoot + 7), cadenceTime, 0.26, beat * 2.4, 0.04));
    mark(pluckNote(synth, center, midiToFreq(bassRoot), cadenceTime + beat * 0.95, 0.42, beat * 4.6, 0.04));
  }

  return { advance, end };
}

function guitarImproUiEvents(
  notes: TseroufNote[],
  idx: number,
  startTime: number,
  stepSeconds: number
): { time: number; wordIndex: number; letterIndex: number }[] {
  const word = notes[idx]?.word ?? "";
  const letters = Array.from(word);
  const { beat } = guitarImproTiming(notes, idx, stepSeconds);
  const ratio = notes[idx]?.durationRatio ?? 1;
  const cellSpan = letters.length * beat * ratio;
  const letterStep = letters.length <= 1 ? cellSpan : cellSpan / letters.length;
  return letters.map((_, letterIndex) => ({
    time: startTime + letterIndex * letterStep,
    wordIndex: idx,
    letterIndex,
  }));
}

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.3;
const FINAL_TAIL_SECONDS = 0.9;

export class TseroufPlayer {
  private ctx: AudioContext | null = null;
  private synth: Synth | null = null;
  private timer: number | null = null;

  private notes: TseroufNote[] = [];
  private stepSeconds = 0.18;
  private loop = false;
  private instrument: InstrumentId = "guitar";
  private playbackStyle: TseroufPlaybackStyle = "strict";
  private onStep?: (wordIndex: number, letterIndex?: number) => void;
  private onEnd?: () => void;

  private wordIdx = 0;
  private loopStartIndex = 0;
  private nextWordTime = 0;
  private lastVoiceEnd = 0;
  private finishedScheduling = false;
  private hasLoopedToStart = false;
  private playing = false;
  private paused = false;

  private uiQueue: { time: number; wordIndex: number; letterIndex: number }[] = [];

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
    if (options.instrument) this.instrument = options.instrument;
    this.playbackStyle = options.playbackStyle ?? "strict";
    this.synth!.instrument = this.instrument;
    this.onStep = options.onStep;
    this.onEnd = options.onEnd;

    this.wordIdx = clampStartIndex(options.startIndex, notes.length);
    this.loopStartIndex = clampStartIndex(options.loopStartIndex, notes.length);
    this.nextWordTime = ctx.currentTime + 0.12;
    this.lastVoiceEnd = this.nextWordTime;
    this.finishedScheduling = false;
    this.hasLoopedToStart = false;
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

  // Switches the instrument; takes effect on subsequently scheduled notes.
  setInstrument(instrument: InstrumentId): void {
    this.instrument = instrument;
    if (this.synth) this.synth.instrument = instrument;
  }

  // Changes the tempo (seconds per note); takes effect on the next scheduled
  // words, so it can be adjusted live during playback.
  setStepSeconds(stepSeconds: number): void {
    this.stepSeconds = stepSeconds;
  }

  // Toggles looping for the current playback and future starts.
  setLoop(loop: boolean): void {
    this.loop = loop;
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
        gain.linearRampToValueAtTime(0.0001, now + 0.25);
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
      const wrapsToStart = this.loop && this.wordIdx === this.notes.length - 1;
      const { advance, end } =
        this.playbackStyle === "guitar-impro"
          ? scheduleGuitarImproWord(
              synth,
              this.notes,
              this.wordIdx,
              this.nextWordTime,
              this.stepSeconds,
              { wrapsToStart }
            )
          : scheduleWord(
              synth,
              this.notes,
              this.wordIdx,
              this.nextWordTime,
              this.stepSeconds,
              {
                previousWord:
                  this.wordIdx === 0 && this.hasLoopedToStart
                    ? this.notes[this.notes.length - 1]?.word
                    : undefined,
                wrapsToStart,
              }
            );
      if (end > this.lastVoiceEnd) this.lastVoiceEnd = end;
      this.uiQueue.push(
        ...(this.playbackStyle === "guitar-impro"
          ? guitarImproUiEvents(
              this.notes,
              this.wordIdx,
              this.nextWordTime,
              this.stepSeconds
            )
          : wordUiEvents(this.notes, this.wordIdx, this.nextWordTime, this.stepSeconds))
      );

      this.nextWordTime += advance;
      this.wordIdx += 1;
      if (this.wordIdx >= this.notes.length) this.finishedScheduling = true;
    }

    while (this.uiQueue.length > 0 && this.uiQueue[0].time <= ctx.currentTime) {
      const next = this.uiQueue.shift()!;
      this.onStep?.(next.wordIndex, next.letterIndex);
    }

    if (this.finishedScheduling && this.loop) {
      // Queue the next pass on the structural grid. The boundary note is tied
      // instead of being repeated, just like any other line transition.
      this.wordIdx = this.loopStartIndex;
      this.hasLoopedToStart = true;
      this.finishedScheduling = false;
      return;
    }

    if (
      this.finishedScheduling &&
      this.uiQueue.length === 0 &&
      ctx.currentTime >= this.lastVoiceEnd + FINAL_TAIL_SECONDS
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
  const playbackStyle = options.playbackStyle ?? "strict";
  const maxSeconds = options.maxSeconds ?? 75;
  const sampleRate = 44100;

  const lead = 0.1;
  let cursor = lead;
  let count = 0;
  for (let i = 0; i < notes.length; i++) {
    cursor +=
      playbackStyle === "guitar-impro"
        ? guitarImproTiming(notes, i, stepSeconds).advance
        : wordTiming(notes, i, stepSeconds).advance;
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
  synth.instrument = options.instrument ?? "guitar";

  let startTime = lead;
  for (let i = 0; i < count; i++) {
    const { advance } =
      playbackStyle === "guitar-impro"
        ? scheduleGuitarImproWord(synth, notes, i, startTime, stepSeconds)
        : scheduleWord(synth, notes, i, startTime, stepSeconds);
    startTime += advance;
  }

  const rendered = await offline.startRendering();
  return encodeWav(rendered);
}

export function encodeWav(buffer: AudioBuffer): Blob {
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
