import { TseroufView } from "@/components/tserouf/tserouf-view";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Tserouf",
  description:
    "Display all permutations of an n-letter word in Zaks suffix-reversal order.",
};

export default function TseroufPage() {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-4 sm:px-6">
      <Suspense fallback={null}>
        <TseroufView />
      </Suspense>
    </div>
  );
}
