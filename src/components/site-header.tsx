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
          <Link href="/" className="transition-colors hover:text-foreground">
            Graph
          </Link>
          <Link
            href="/tserouf"
            className="transition-colors hover:text-foreground"
          >
            Tserouf
          </Link>
          <Link
            href="/analysis"
            className="transition-colors hover:text-foreground"
          >
            Analysis
          </Link>
          <Link
            href="/dihedral"
            className="transition-colors hover:text-foreground"
          >
            Dihedral
          </Link>
        </nav>
      </div>
    </header>
  );
}
