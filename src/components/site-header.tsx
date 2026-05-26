import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span
            aria-hidden
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-base"
            dir="rtl"
          >
            א
          </span>
          <span className="tracking-tight">Aboulafia</span>
          <span className="hidden text-xs font-normal text-muted-foreground sm:inline">
            · the path through the pancake graph
          </span>
        </Link>
        <nav className="flex items-center gap-4 text-sm text-muted-foreground">
          <a
            href="https://en.wikipedia.org/wiki/Pancake_graph"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-foreground"
          >
            Pancake graph
          </a>
          <a
            href="https://en.wikipedia.org/wiki/Abraham_Abulafia"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-foreground"
          >
            R. Abulafia
          </a>
        </nav>
      </div>
    </header>
  );
}
