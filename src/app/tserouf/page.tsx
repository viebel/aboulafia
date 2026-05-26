import { TseroufView } from "@/components/tserouf/tserouf-view";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tsérouf",
  description:
    "Display all permutations of an n-letter word in Zaks prefix-reversal order.",
};

export default function TseroufPage() {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-4 sm:px-6">
      <TseroufView />
    </div>
  );
}
