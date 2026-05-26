# Aboulafia — pancake graph visualization

An interactive web app for exploring the pancake graph `Pₙ` and Zaks'
Hamiltonian cycle, interpreted here as Aboulafia's path through the world
of permutations.

## Features

- Draw `P3` through `P10`.
- Place permutations on a circle in the order of Zaks' Hamiltonian cycle.
- Toggle Cayley edges, the Zaks cycle, full-reversal `rₙ` markers, vertices,
  and small-graph labels.
- Choose either SVG rendering (crisp vector zoom) or Canvas rendering
  (better for large `n`).
- Export the current graph as SVG for supported sizes.

## Stack

- [Next.js 16](https://nextjs.org) — App Router, Server Components,
  React 19.
- [TypeScript](https://www.typescriptlang.org) — strict.
- [Tailwind CSS v4](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com)
  for the design system.
- [`@vercel/config`](https://vercel.com/docs/project-configuration/vercel-ts)
  for typed `vercel.ts` project configuration.

## Getting started

```bash
npm install
npm run dev
```

Then open <http://localhost:3000>.

```bash
npm run build   # production build
npm run start   # serve the production build
npm run lint    # eslint
```

## Project layout

```
src/
  app/                 # App Router entrypoints (layout.tsx, page.tsx)
  components/
    site-header.tsx
    pancake/
      pancake-graph-view.tsx
    ui/                # shadcn-generated primitives
  lib/
    pancake.ts         # Zaks cycle + pancake graph construction
    pancake-render.ts  # SVG and Canvas renderers
vercel.ts              # typed Vercel project config
```

## Deploy to Vercel

This is a zero-config Vercel deployment. With the Vercel CLI:

```bash
npx vercel
```

Or push to GitHub and click *Import Project* on
[vercel.com/new](https://vercel.com/new). The framework will be detected
as Next.js automatically.

## Credits

Inspired by the pancake graph, Zaks' Hamiltonian cycle, and Aboulafia's
permutation-oriented imagination.
