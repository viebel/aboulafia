---
name: analyze-pancake-caustics
description: >-
  Analyze the chord caustics (long-edge envelopes) of the pancake Cayley graph
  drawn in the Zaks / Williams Hamiltonian order, and test self-similarity /
  "new universe" (Mandelbrot-like) hypotheses. Use when investigating pancake
  graph caustics, long vs short edges, the rₙ full-reversal layer, fundamental
  dihedral wedge, density-field ridges (Yankelovich), comparing n to n+2,
  renormalization / self-similarity, or comparing Zaks vs Williams layouts.
---

# Analyzing Pancake Graph Caustics

Caustics = envelopes where the long chords of the pancake graph (laid on a
circle in a Hamiltonian order) pile up. The recurring research question: is the
Zaks caustic **self-similar with new structure appearing as n grows**
(Mandelbrot-like), or trivial?

Read `docs/pancake-aretes-longues.md` for the full write-up before deep work.

## Critical pitfalls — do NOT forget these

These are mistakes that are easy to repeat. Check every one before concluding.

1. **"Long edges" is layout-dependent — never equate `rₙ` with "long".**
   In **Zaks** the full reversal `rₙ` IS the long layer (inter-block, long
   chords). In **Williams** `rₙ` is the *short* layer (consecutive cycle steps →
   a thin rim ring); Williams' long edges are *other* generators. Define "long"
   **geometrically** (chord arc length), per layout — not by generator id.

2. **Short edges are hidden, so there is NO free block-renormalization copy.**
   `r₂…rₙ₋₁` are tiny chords (arc ≤ `k!/n!`) and are discarded. The embedded
   `Pₙ₋₁` copy inside a block is woven by exactly these hidden short edges.
   Therefore you may **not** claim "zoom into a block → see the `Pₙ₋₁` caustic":
   that copy is invisible in the long-edge-only picture, and `rₙ` is brand new at
   each level. The block-decomposition renormalization argument is **invalid**
   for the long-edge object.

3. **Dihedral symmetry `Dₙ` is trivial — quotient it first.**
   Work in the fundamental wedge of angle `π/n = 360/(2n)°` (`(n-1)!/2`
   vertices). Note `ρ: i ↦ i+(n-1)!` **is** the block shift = a symmetry axis, so
   cusps on block boundaries are symmetry artifacts, not novelty. Only
   **interior** cusps of the wedge count.

4. **The only legitimate self-similarity of the `rₙ` caustic is intrinsic to
   the map** `σₙ = rank ∘ reverse ∘ unrank` (recursive in `φ`-blocks), tested on
   the map `T(τ)=σₙ(⌊τ·n!⌋)/n!` directly — never via hidden short edges.

5. **High correlation can mean FROZEN, not interesting.**
   A caustic that is **n-invariant** (e.g. Williams long edges ≈ a single fixed
   epicycloid — the string-art null model) scores high `corr(Pₙ,Pₙ₊₂)` but has
   **no** new universes. The Mandelbrot signature is a caustic that **evolves
   with n in a structured way**. `corr` alone is a bad judge in both directions
   (it also punishes the trivial `Dₙ` symmetry-order change between n and n+2).

6. **Compare same parity** (`n` and `n+2`). Parity of `n` changes the reversal
   structure; cross-parity is a different class.

7. **Any novelty / self-similarity metric MUST pass the Sierpiński ≈ 0 control**
   (and noise ≈ ceiling). A self-affine object has zero novelty by construction;
   if the metric scores it high, the metric is bogus. **Image patch-matching
   (multiscale NCC) FAILS this** (aliasing, no rotation invariance, high floor on
   line art) — do not use it; all such "novelty" numbers are invalid. Use the
   **IFS-residual (fractal collage, `scratch/pifs-residual.mjs`)**: validated
   (Sierpiński → 0.007, noise → 0.56). Result: **Zaks ≈ 0.21, stable across `n`**
   = self-similar scaffold + ~21% non-self-affine = compatible with "attenuated
   Mandelbrot". Caveat: non-self-affine is necessary, not sufficient, for "new
   universes"; PIFS over-penalizes thin line art (Petrie > noise), so trust it
   only on smooth density fields (Zaks), anchored on Sierpiński = 0.

## Current conclusion (validated measures)

- **Self-similarity**: confirmed and strong, and **specific to the Zaks layout**
  (Williams, same edges, gives a *frozen/degenerate* `rₙ` caustic).
- **Mandelbrot-style "new universes"**: **NOT confirmed** by control-passing
  measures. Catastrophe spectrum (`catastrophe-spectrum.mjs`, validated by
  Williams = 0 cusps): cusps-per-fundamental-wedge is **invariant with `n`**
  (both sheets, ~29 outer / ~37 inner at matched 3M sampling, `n=10≈n=12`); no
  robust A₄. IFS residual ~0.21 = mild irregularity, not new structure.
- Verdict: Zaks = **richly self-similar** (unlike frozen Williams, far from
  Sierpiński's 0), but on the **"self-similar without new universes"** side.

## Definitions

- Vertex at cycle position `i` sits at angle `2πi/n!`. Chord = edge.
- `rₙ` matching (Zaks long layer): `i — σₙ(i)`, an involution.
  `σₙ(i) = zaksRank(n, reverse(zaksUnrank(n, i)))`, exact in `O(n²)`.
- Caustic = ridges of the chord **density field** (the Yankelovich render).

## Methodology

1. **Render density** of the long-edge layer; equalize histogram (scale-free).
2. **De-symmetrize**: fold into the `π/n` wedge; rectify to (angle × radius).
3. **Remove the radial profile** before correlating (the radial gradient
   inflates `corr`; subtract per-radius mean → residual = angular structure).
4. **Smooth** (Gaussian) before peak/correlation to wash out the discretization
   of sparse small-`n` fields.
5. **Decide regime**, not just `corr`:
   - frozen (n-invariant) → null, no novelty (Williams);
   - evolving but structured, with a renormalization fixed point on `T` →
     self-similar + new universes (Zaks candidate);
   - unstructured → no caustic.

## Sampling validity (for n ≳ 12)

- `σₙ` is exact; only *which* chords are drawn is sampled. Sample `i` uniformly
  on `[0,n!)`. Enumerate exactly up to `n=11` (`n!/2 ≈ 20M`) for ground truth.
- **Symmetry residual = free error gauge**: the true field is `Dₙ`-symmetric, so
  `‖field − ρ·field‖` measures noise without any ground truth (↓ as `1/√S`).
- **Multi-seed**: keep only features present across all seeds + above a noise
  floor. **Matched resolution + disattenuation**: divide `corr` by the self-
  ceiling `corr(Pₙ@K, Pₙ@K')` to correct for sampling noise.

## Code references (`src/lib/`)

- `zaksUnrank(n,i)` / `zaksRank(n,q)` — position ↔ permutation, `O(n²)`
  (`pancake.ts`).
- `suffixReversalCycle(n, order)` — `order="zaks"` = smallest flip, `"williams"`
  = largest flip (`pancake.ts`, ~L143).
- `materializedPancakeGeneratorIds` — **Williams materializes all `2..n`**;
  Zaks for `n>6` materializes **only `rₙ`** (`pancake.ts`).
- `forEachZaksFundamentalEdge`, `computeZaksOrbits` — `Cₙ` fundamental sector;
  fold by `ω` for the full `Dₙ` wedge.
- `yankelovichDihedralSectorVertexCount(n)` = `⌊(n-1)!/2⌋` (`pancake-render.ts`).
- `drawYankelovichToCanvas` — density field / caustics renderer.

## Analysis scripts (`scratch/`, standalone Node, self-contained)

Reuse or adapt these rather than rewriting; they reimplement `zaksUnrank`/
`zaksRank`/Williams cycle + a minimal PNG encoder.

- `caustic-rn.mjs` — full-disk `rₙ` density, equalized, n=7..10.
- `caustic-wedge.mjs` — `π/n` fundamental wedge, rectified, cusp detection,
  residual correlations.
- `caustic-8-10.mjs` — matched-resolution + self-ceiling + disattenuation.
- `caustic-long-baseline.mjs` — geometric long-edge layer, all generators, Zaks
  vs Williams, within-layout n=8 vs n=10.
- `williams-vs-zaks-disk.mjs` — side-by-side full disks (same edges, different
  layout).
- `pifs-residual.mjs` — **validated** self-similarity/novelty measure (IFS
  collage residual); passes Sierpiński ≈ 0 control.
- `catastrophe-linespace.mjs` — exact dual `(ψ,p)` support-function cloud of the
  chord family (Williams degenerate vs Zaks rich multi-sheet net).
- `catastrophe-spectrum.mjs` — **validated** cusp/A₄ spectrum via support
  function `ρ=H+H''` (passes Williams = 0). Cusps/wedge invariant with `n`.
- `controls-vs-zaks.mjs`, `novelty-n10.mjs`, `novelty-zoom.mjs` — the
  **abandoned** patch-NCC novelty attempts (kept as cautionary examples; they
  fail the Sierpiński control).
