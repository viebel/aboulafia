---
name: add-deep-link-param
description: Wire a graph-explorer UI control into the shareable URL query string (deep linking) in this repo. Use when the user asks to make a selector/toggle/slider part of deep linking, persist a control in the URL, add a query param, or says a control "should be in the URL / shareable / bookmarkable" like the other selectors.
---

# Add a Deep-Link Param

Every persisted control in the graph explorer is mirrored in the URL query
string so a view can be shared and restored. New controls must follow the same
five-step pattern or they silently won't round-trip.

## Files

- `src/lib/url-state.ts`: the read/write helpers (`readEnumParam`,
  `readIntParam`, `writeUrlParams`). Reads come from `useSearchParams`; writes
  go through `history.replaceState` (no navigation, cheap on every change).
- `src/components/pancake/pancake-graph-view.tsx`: where state is declared,
  seeded from the URL, and written back. All edits below are in this file
  unless a new kind of value needs a new helper in `url-state.ts`.

## The five steps

For a control whose value is `V` under a short, unique query key `KEY`:

1. **`GraphState` interface** — add the field with its type.
2. **`readGraphState(params)`** — read it back with the matching helper and a
   fallback (see "Param encodings"). This is the single source of `initial`.
3. **Seed the control's state** — initialize the relevant `useState` /
   `RenderSettings` field from `initial.<field>` (do NOT hard-code a default
   there anymore; the URL reader owns the default).
4. **`writeUrlParams({ ... })` effect** — add `KEY: <encoded value>`.
5. **That same effect's dependency array** — add the field. Omitting it is the
   most common bug: the control changes but the URL never updates.

## Param encodings

`writeUrlParams` drops any entry that is `null`, `undefined`, or `""`, so an
omitted key means "default".

| Value kind | Read | Write |
|---|---|---|
| enum (union of strings) | `readEnumParam(params, "KEY", ALLOWED, fallback)` | `KEY: value` |
| boolean | `readEnumParam(params, "KEY", ["0","1"], "0") === "1"` | `KEY: value ? "1" : null` |
| number from a fixed list | `readIntParam(params, "KEY", ALLOWED, fallback)` | `KEY: String(value)` |

For booleans, write `null` when false so the default state keeps the URL clean.
`ALLOWED` for enums is the existing `*_MODES` / preset arrays; reuse them.

## Key registry (keep keys short and unique)

`g` preset · `n` order · `r` renderer · `parity` parity mode ·
`sc` symmetry coloring · `ax` Dₙ axes · `lbl` index labels ·
`alpha` edge strength · `width` edge width · `depth` quotient depth.

Pick a new 1–4 char key not already in this list.

## Worked example: a boolean toggle `showLabels` (key `lbl`)

```ts
// 1. GraphState
showLabels: boolean;

// 2. readGraphState
showLabels: readEnumParam(params, "lbl", ["0", "1"], "0") === "1",

// 3. seed RenderSettings useState
showLabels: initial.showLabels,

// 4. writeUrlParams entry
lbl: settings.showLabels ? "1" : null,

// 5. effect dependency array
settings.showLabels,
```

## Verify

```bash
# node is not on PATH; use the Cursor helper
export PATH="/Applications/Cursor.app/Contents/Resources/app/resources/helpers:$PATH"
./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint src/components/pancake/pancake-graph-view.tsx
```

Then confirm in the browser: changing the control updates the query string, and
reloading that URL restores the control.
