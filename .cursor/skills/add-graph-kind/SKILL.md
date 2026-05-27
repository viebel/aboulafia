---
name: add-graph-kind
description: Adds a new graph family or preset to the graph explorer page. Use when the user asks to add a graph kind, graph family, graph preset, Cayley graph generator set, vertex ordering, or another option to the Graph explorer in this repository.
---

# Add Graph Kind

## Start Here

This repo's graph explorer is centered on two files:

- `src/lib/pancake.ts`: graph data model, graph preset types, vertex ordering, generator sets, labels, descriptions, counts, and limits.
- `src/components/pancake/pancake-graph-view.tsx`: UI preset list, selected graph state, metrics, warnings, renderer selection, and export behavior.

Before editing, read both files. If the requested graph has unusual rendering needs, also read `src/lib/pancake-render.ts`.

## Implementation Checklist

1. Add the new preset id to `GraphPreset` in `src/lib/pancake.ts`.
2. Add or reuse a `GraphKind` value. Reuse an existing kind when behavior is identical; add a new kind only when metrics, rendering, or graph-specific logic needs to distinguish it.
3. Update `buildPancakeGraph` so the preset uses the right vertex ordering:
   - Use `prefixReversalCycle` only for pancake-style Hamiltonian cycle presets.
   - Use `johnsonTrotterOrder` for adjacent-transposition style permutation graphs.
   - Use `lexicographicOrder` for generic permutation graphs without a special cycle.
   - Add a dedicated async ordering helper when the graph is not permutation-based or needs a specific order.
4. Update `graphGenerators` with a complete generator set. Preserve the invariant that each generator is an involution, or adjust edge deduplication if the graph is directed or not symmetric.
5. Update `graphPresetLabel`, `graphPresetDescription`, `graphVertexCount`, `graphEdgeCount`, `graphMaxN`, and `graphKind`.
6. Add the preset to `GRAPH_PRESETS` in `src/components/pancake/pancake-graph-view.tsx`.
7. Update `N_OPTIONS` if the graph supports values outside the current `3..10` UI range.
8. Check graph-specific UI logic:
   - Metrics currently name `edges.length / 3` as Cayley edges for every graph.
   - `r_n edges` should only show for pancake graphs unless the new graph defines a meaningful equivalent.
   - SVG download is restricted for non-hypercube graphs at `n >= 9`; revisit this if the new graph has smaller or larger output.
   - Heavy graph warnings use `graphVertexCount` and `graphEdgeCount`, so keep those functions accurate.

## Data Model Notes

`PancakeGraph.path` is the display order for vertices. `PancakeGraph.edges` is a flat `Uint32Array` of triples:

```ts
srcIndex, dstIndex, generatorId
```

`buildPancakeGraph` indexes every vertex by `key(path[i])`, applies every generator to every vertex, and writes an edge only when `i < j`. This assumes every generated neighbor exists in `path`, every undirected edge appears from both endpoints, and generators have no fixed points. If a generator can map a vertex to itself, adjust edge counting and self-loop handling instead of using the default `generators.length * total / 2` allocation.

For permutation graphs, vertices are `Uint8Array` values containing `1..n`. For hypercube, vertices are `Uint8Array` bit strings. If adding another non-permutation graph, verify `key()` is still collision-free for that vertex representation.

## Validation

Run the tightest checks that fit the change:

```bash
npm run lint
npm run build
```

For new graph math, manually test a small `n` first and verify:

- vertex count equals the expected order;
- edge count matches the formula;
- the graph renders in SVG and Canvas;
- export filenames and disabled states still make sense;
- changing presets clamps `n` correctly through `graphMaxN`.
