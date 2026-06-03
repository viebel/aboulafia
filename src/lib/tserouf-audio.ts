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
}

export interface TseroufPlayOptions {
  stepSeconds?: number;
  // Seconds per sung letter for the chant/meditation engine (ignored by the
  // melodic invention engine, which uses stepSeconds).
  noteSeconds?: number;
  loop?: boolean;
  instrument?: InstrumentId;
  onStep?: (wordIndex: number) => void;
  onEnd?: () => void;
}

export interface TseroufRenderOptions {
  stepSeconds?: number;
  instrument?: InstrumentId;
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
// the pluck is; `decay*` how long it sustains.
function karplusBuffer(
  ctx: BaseAudioContext,
  freq: number,
  decayLow: number,
  decayHigh: number,
  smooth: number,
  seconds: number
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
  const decay = freq < 200 ? decayLow : decayHigh;
  for (let i = delay; i < total; i++) {
    const prev = d[i - delay];
    const prev2 = i - delay - 1 >= 0 ? d[i - delay - 1] : prev;
    d[i] = decay * 0.5 * (prev + prev2);
  }
  normalize(d);
  return buffer;
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
  freq: number
): AudioBuffer {
  switch (id) {
    case "guitar":
      return karplusBuffer(ctx, freq, 0.9975, 0.9965, 0.55, 3.2);
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

function instrumentBuffer(synth: Synth, freq: number): AudioBuffer {
  const key = `${synth.instrument}:${Math.round(freq * 50)}`;
  const cached = synth.bufferCache.get(key);
  if (cached) return cached;
  const buffer = makeInstrumentBuffer(synth.ctx, synth.instrument, freq);
  synth.bufferCache.set(key, buffer);
  return buffer;
}

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

// Schedules one note and returns the time it stops sounding.
function pluckNote(
  synth: Synth,
  voice: Voice,
  freq: number,
  time: number,
  velocity: number,
  ringSeconds: number,
  attack?: number
): number {
  const ctx = synth.ctx;
  const src = ctx.createBufferSource();
  src.buffer = instrumentBuffer(synth, freq * voice.transpose);
  src.detune.value = (Math.random() - 0.5) * 8;

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
    end = time + ringSeconds + 0.2;
  }

  src.connect(gain);
  gain.connect(voice.in);
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
  private instrument: InstrumentId = "guitar";
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
    if (options.instrument) this.instrument = options.instrument;
    this.synth!.instrument = this.instrument;
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
  synth.instrument = options.instrument ?? "guitar";

  let startTime = lead;
  for (let i = 0; i < count; i++) {
    const { advance } = scheduleWord(synth, notes, i, startTime, stepSeconds);
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
