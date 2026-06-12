import { KaleidoscopeView } from "@/components/kaleidoscope/kaleidoscope-view";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Kaleidoscope",
  description:
    "A rank-2 Coxeter kaleidoscope for I2(m): one fundamental chamber reflected into 2m chambers.",
};

export default function KaleidoscopePage() {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6">
      <Suspense fallback={null}>
        <KaleidoscopeView />
      </Suspense>
    </div>
  );
}
