import { StabilizationView } from "@/components/stabilization/stabilization-view";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Stabilization",
  description:
    "Harper's stabilization on the cycle Zₙ: folding a set across the Dₙ mirrors toward a Fricke–Klein point until it becomes the isoperimetric arc — the kaleidoscope at work.",
};

export default function StabilizationPage() {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6">
      <Suspense fallback={null}>
        <StabilizationView />
      </Suspense>
    </div>
  );
}
