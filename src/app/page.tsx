import { PancakeGraphView } from "@/components/pancake/pancake-graph-view";
import { Suspense } from "react";

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-4 sm:px-6">
      <Suspense fallback={null}>
        <PancakeGraphView />
      </Suspense>
    </div>
  );
}
