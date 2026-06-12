---
name: latex-pdf-generation
description: Create, edit, and compile LaTeX documents into PDFs. Use when the user asks to generate a PDF, write a TeX note, compile .tex files, or troubleshoot LaTeX/PDF generation in this repository.
---

# LaTeX PDF Generation

## Workflow

1. Read nearby `.tex` files before writing, especially in `docs/`, to match the local note style.
2. Keep the document scoped to the user's requested content. Do not add surrounding theory, commentary, or synthesis unless asked.
3. Use a standalone `.tex` source in `docs/` unless the user names another path.
4. Prefer ASCII source. Use standard LaTeX commands for mathematical symbols.
5. Compile the source and leave the generated `.pdf` beside the `.tex` file.

## Compilation

Use Tectonic by default in this repo:

```bash
tectonic --outdir "docs" "docs/name.tex"
```

If the user asks for a specific engine, use that engine when available. If `pdflatex` is unavailable, do not stop; try `tectonic`, `xelatex`, or `lualatex` if present.

## Validation

After compiling:

- Confirm the command exited successfully.
- Confirm the output path shown by the compiler matches the expected PDF.
- Mention failures briefly and include the missing command or LaTeX error that blocks generation.

## Cleanup

Do not commit generated PDFs unless the user asks for a commit. Do not delete existing PDF or TeX files unless explicitly requested.
