---
name: pancake-radon-edge-scope
description: Applies the correct pancake graph edge scope for Radon, caustic, and line-space analyses. Use when editing pancake Radon fields, chord caustics, long-edge density, Zaks or Williams pancake order analysis, or code that decides whether to include only full-reversal edges or all suffix-reversal edges.
---

# Pancake Radon Edge Scope

## Rule

For Radon, caustic, or line-space analysis of pancake orders:

- Pancake Zaks may use only the full-reversal matching `r_n`.
- Pancake Williams must use all pancake graph edges, i.e. every suffix reversal `r_k` for `2 <= k <= n`.

Do not apply Zaks wedge or full-reversal shortcuts to Williams. Williams has no symmetry wedge for these analyses.

## Implementation Notes

- In a cycle-order view, an edge for generator `r_k` connects cycle position `i` to the cycle position of `r_k(path[i])`.
- Count each undirected generator edge once, for example only when `i < j`.
- For Williams, expected full edge count is `n! * (n - 1) / 2`.
- For Zaks `r_n`-only analysis, expected edge count is `n! / 2`.
