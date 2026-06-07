import { AnalysisView } from "@/components/analysis/analysis-view";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Analysis",
  description:
    "Self-similarity of the Zaks pancake graph: the σₙ = rank ∘ reverse ∘ unrank map and its finite differences.",
};

export default function AnalysisPage() {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-4 sm:px-6">
      <Suspense fallback={null}>
        <AnalysisView />
      </Suspense>
    </div>
  );
}
