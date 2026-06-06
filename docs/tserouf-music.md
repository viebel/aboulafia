# The music of Tserouf

This document describes how the Tserouf page turns a sequence of
letter-permutations into music. The implementation lives in
[`src/lib/tserouf-audio.ts`](../src/lib/tserouf-audio.ts) (synthesis +
scheduling) and is wired into the UI in
[`src/components/tserouf/tserouf-view.tsx`](../src/components/tserouf/tserouf-view.tsx).

Everything is synthesized live in the browser with the Web Audio API — no
samples, no dependencies. The same engine powers both real-time playback and
the offline render to a downloadable WAV.

## 1. The core idea — Bergonzi's "Melodic Structures"

Jerry Bergonzi's *Melodic Structures* method takes a small set of pitches and
runs it through **every permutation**, each permutation sounding as one short
melodic cell. That is exactly what a Tserouf does with letters. So the musical
mapping is direct:

> **One permutation = one melodic cell.** The piece is the whole Zaks
> suffix-reversal order played cell after cell.

## 2. Pitch mapping (the alphabet → notes)

Each letter is a scale degree, in order. Letter `a → degree 0`, `b → 1`, …

- **Scale:** A-minor pentatonic, degrees `[0, 3, 5, 7, 10, 12, 15]` semitones
  above the root.
- **Root:** `A3` (MIDI 57) — a comfortable classical-guitar register.

So for the first letters:

| letter | degree | note |
|--------|--------|------|
| `a` | 0  | **La** (A) |
| `b` | 3  | **Do** (C) |
| `c` | 5  | **Ré** (D) |
| `d` | 7  | **Mi** (E) |
| `e` | 10 | **Sol** (G) |
| `f` | 12 | La (A, octave) |
| `g` | 15 | Do (C, octave) |

**Why a pentatonic?** It is the central *constraint* of the whole design: any
subset of a pentatonic, in any order, is consonant. Since the music plays every
possible permutation, the harmony must never depend on order — the pentatonic
guarantees that no permutation can sound "wrong."

## 3. Timbre — selectable synthesized instruments

An **Instrument** selector in the sidebar switches the per-note sound (all
synthesized, no samples). Plucked and mallet/bell timbres suit permutation
music especially well — every note is a clear, discrete point (Reich/Glass
minimalism; Bach on the harpsichord):

| instrument | synthesis | character |
|------------|-----------|-----------|
| **Classical guitar** | Karplus–Strong, soft (dark) excitation, long sustain | warm nylon pluck (default) |
| **Harpsichord** | Karplus–Strong, bright excitation, fast decay | crisp baroque pluck |
| **Piano** | additive, 3 detuned strings, inharmonicity, two-stage decay, soft hammer | warm singing grand (Jarrett-ish) |
| **Marimba** | additive (inharmonic 1 : 3.9 : 9.2), fast decay + mallet click | woody, dry |
| **Vibraphone** | additive (1 : 4 : 9.4), long decay + 5 Hz tremolo | shimmering metal |
| **Music box** | additive (bright inharmonic partials) | crystalline bell |
| **Saxophone** | formant-shaped harmonics + swelling vibrato + breath | warm vocal tenor (Coltrane-ish) |
| **Clarinet** | odd-harmonic (cylindrical bore) + attack bend + vibrato | hollow woody klezmer (Yom-ish) |

Decaying instruments bake their timbre into a cached buffer per pitch and are
shaped by a quick-attack / gentle-release envelope. The **saxophone** is the one
*sustained* voice: a steady tone held for the note's length, then released.

The default classical-guitar sound is synthesized with **Karplus–Strong**:

- A short noise burst, **low-passed** so the attack is soft and round like a
  nylon string plucked with the flesh of the finger (not a bright steel string).
- A feedback delay line with an averaging low-pass = the vibrating, damping
  string. Lower strings get slightly more feedback (longer sustain).
- One string buffer is computed **per pitch and cached** (only a handful of
  distinct pitches exist), then replayed with per-note gain envelopes.

Shared processing on the master bus:

- a **body-resonance** peaking filter (~120 Hz) for guitar "wood",
- a **gentle, fairly dry reverb** (kept low so notes stay articulate),
- a **compressor** to glue overlapping strings and tame peaks.

Each note also gets a tiny random **detune** and **velocity** variation so it
never sounds mechanical.

## 4. Two voices — the dialog (Bach two-part invention)

The Tserouf view already colours permutations by **parity** (even = sky,
odd = rose). That parity drives a two-voice dialog:

| permutation | voice | register | pan | tone |
|-------------|-------|----------|-----|------|
| **even** | the "call"   | base register | slightly **left**  | warmer / darker |
| **odd**  | the "answer" | **an octave higher** | slightly **right** | brighter |

- **Register** does most of the separating (one octave apart), like the two
  voices of a Bach invention; the gentle pan (±0.3) just helps the ear place
  each speaker.
- A separate **centre voice** (no pan, middle register) is used only for the
  cadence bass, so resolutions feel shared between the two speakers.

Because a single suffix reversal flips parity often at the fine level, the
voices trade phrases constantly — a genuine call-and-response.

## 5. Phrasing — breathing with the structure

Each permutation stores the **Zaks "flip"** `k`: how many trailing letters are
reversed to reach the *next* permutation. The flip depth is the musical phrase
structure:

- Small flip (`k = 2, 3`) → a small step *inside* a line → a small lift.
- The **deepest flip** (`k =` word length = a full-word reversal) → a **line
  boundary**. These, and only these, are treated as cadences.

> **Constraint:** a cadence happens **only** on the deepest reversal, so
> resolutions stay rare and meaningful instead of firing every bar.

### Timing per cell

- One note per beat (`stepSeconds ≈ 0.18 s`), steady tempo (no ritardando) so
  the line flows.
- Notes ring just over one beat (light legato); the last note of a cell sings a
  little longer.
- Pauses: tiny lifts inside a line; **the one real silence is the breath after
  a resolution.**

### Following the tabla (Teental)

The pitches change every cell (one permutation each), but the *rhythm* would
stay flat if every note were stressed the same way. So the engine lays the
steady note stream onto **Teental** — the classic 16-matra tala of **four
vibhags of four** — and strikes it like a tabla **theka**. A four-note word is
exactly **one vibhag**, so four cells complete one full cycle and the tala
returns to **sam**.

The theka, with each bol routed to one of the **two drums** — the **baya**
(bass, left hand) and the **dayan** (treble, right hand):

```
matra:  1    2    3    4  | 5    6    7    8  | 9   10   11  12 | 13  14   15   16
bol:    Dha  Dhin Dhin Dha| Dha  Dhin Dhin Dha| Na  Tin  Tin Ta | Ta  Dhin Dhin Dha
baya:   ●    ●    ●    ●  | ●    ●    ●    ●  | ·   ·    ·   ·  | ·   ●    ●    ●
dayan:  ●    ●    ●    ●  | ●    ●    ●    ●  | ●   ●    ●   ●  | ●   ●    ●    ●
stress: SAM  .    .    .  | >    .    .    .  | ○   .    .   .  | >   .    .    .
                                               khali (baya lifts → open)
```

- **Two-drum roles.** Resonant bols (`Dha`, `Dhin`) strike **both** hands; the
  khali bols (`Na`, `Tin`, `Ta`) are **dayan-only** — the left hand lifts. In
  the engine the **dayan** is the pitched melody note (in the parity voice) and
  the **baya** is a low tonic pulse on the centre voice, struck on every
  resonant matra and silent through the khali half.
- **Straight, not swung.** Subdivisions are even and crisp (tabla, not jazz);
  only a hair of human jitter remains.
- **Sam** (matra 1) is the strongest stress; the vibhag heads (matras 5, 13)
  are also accented and ring a touch longer.
- **Khali** (matras 9–13) is the "empty" wave: the **baya drops out**, so that
  stretch of the cycle feels open, exactly as the open hand marks khali on the
  tabla. (The dayan keeps singing — see the continuous voice below — so the
  openness is carried by the *bass* lifting, not by clipping the melody.)
- **Global tala.** Because cells run back-to-back with no pause, the matra grid
  is **global** (`idx*len + i`), so the tala carries across cell boundaries and
  cycles continuously rather than resetting every word.

### A continuous melodic voice over the tabla

With `len = 4`, every word begins exactly on a vibhag head (matra 1, 5, 9, 13),
so without care each word boundary would *pop* on an accent and the line would
sound chopped into cells. To make the melody sing as **one continuous voice**
over the tabla accompaniment:

- **The punch lives in the baya, not the melody.** The dayan keeps gentle, even
  dynamics (only a small lift on the tala accents), so the line flows across
  word boundaries instead of restriking each vibhag head. The *rhythmic* accent
  is still felt — it's carried by the baya pulse and the stress grid.
- **Legato overlap.** Notes ring well past their beat and the **last note of a
  cell bridges into the next word**, so the previous sound is still alive as the
  next word enters — there is never a gap or a clean hand-off at the seam.
- **Rounded seam attack.** The first note of each word swells in with a softer
  attack, easing in under the still-ringing previous note rather than
  re-articulating.
- The **pentatonic** is what makes this safe: every overlapping pair of notes is
  consonant, so generous legato never muddies into dissonance.

The two-part-invention dialog still stands (even = low/left, odd = high/right),
but the voices now *hand off legato* — the line crosses the octave/pan between
speakers as a bound phrase, not a series of separate plucks.

## 6. The cadence — how a line resolves

The hard-won rules (each fixes a specific artifact heard during development):

1. **The resolution lands on the first beat of a line.** A line break reverses
   the whole word, so the structure rotates (`abcd → bcda → cdab → dabc`). The
   arrival belongs to the *first* word of each line.
2. **V → I as pure bass motion.** The cadence is a falling fifth in the bass:
   **`Mi → La`** (dominant → tonic). The `Mi` lights up softly on the last beat
   of a line; the `La` lands on the first beat of the next line.
3. **No chords.** Earlier versions struck tonic/dominant chords; they sounded
   *violent* against the light melodic texture. The cadence is now a single
   soft bass note, fully inside the texture.
4. **Stay in the scale — no leading tone.** An earlier dominant used the leading
   tone `Sol#`, which is outside the A-minor pentatonic and clashed with the
   natural melody notes (it sounded *out of tune*). Removed: the falling-fifth
   bass alone carries the cadence.
5. **No silence between V and I.** V (end of line) flows straight into I (start
   of next line) with no gap, so the dominant never sits before a silence (which
   would make it sound like a rest). **The breath comes *after* the
   resolution.**
6. **Tie the repeated boundary note.** Because the line break reverses the word,
   the last letter of a line equals the first letter of the next
   (`adc**b** → **b**cda`). Re-striking that note sounded odd, so it is **tied**:
   the previous note rings through the downbeat instead of being replayed; the
   melody resumes on the second letter.

### Worked example: `adcb → bcda`

- `adcb` = La–Mi–Ré–Do, `bcda` = Do–Ré–Mi–La (the reversal).
- Both are odd permutations (a full-word reversal preserves parity), so both
  are sung by the **same** (high/answer) voice — no left/right switch here.
- On `adcb`'s last beat (the `Do`), a soft **`Mi`** bass appears.
- With no pause, the next beat opens `bcda` with a soft **`La`** bass = the
  resolution (falling fifth `Mi → La`).
- `bcda`'s first note would be `Do` — the same `Do` that just ended `adcb` — so
  it is **tied** (not replayed); the melody continues with `Ré`, `Mi`, `La`.
- The line continues from the arrival on the same beat grid.

## 7. Playback & export

- **Play / Pause / Reset**, with seamless **looping**: the last word of the last
  line transitions to the first word of the first line like any other line
  boundary.
- The currently sounding permutation is **highlighted** in sync (ring colour
  matches the speaking voice: sky for even, rose for odd).
- **Click any word to start from there.** Each word tile is a play button:
  clicking (or pressing it with the keyboard) restarts playback at that
  permutation — a quick way to jump straight into any point of the piece. Both
  engines accept a `startIndex`, so this works for the melodic invention and
  the zikr drone alike.
- **Download audio (WAV):** renders the whole piece offline (one pass, no loop)
  through the same synthesis graph, capped to keep files reasonable for large
  permutation counts.

## 8. Summary of constraints

- **Stay in the A-minor pentatonic** — guarantees consonance for *every*
  permutation; never use out-of-scale notes (no raised leading tone).
- **One permutation = one melodic cell**, played in Zaks order.
- **Tabla / Teental**: the note stream is struck as a 16-matra theka (four
  cells = one cycle), strong on sam, with each bol routed to the two drums —
  **dayan** (treble melody) + **baya** (bass pulse) — and the baya lifting
  through the khali half; global across cells so the tala cycles rather than
  resetting every word.
- **Continuous voice over the tabla**: the dayan sings legato with gentle,
  even dynamics and overlapping rings (last note bridges into the next word,
  soft seam attack), so word boundaries are inaudible while the baya carries
  the rhythmic punch.
- **Parity = voice**; register (an octave) separates the dialog, pan only
  assists.
- **Cadence only on the deepest flip** (line boundaries), as a falling-fifth
  **bass** motion, never a struck chord.
- **Resolution on the line's first beat; V→I never split by silence.**
- **Tie the repeated note** at every line boundary.
- **Articulate, not washed out** — short rings + dry reverb so the dialog and
  the cadences stay legible.
