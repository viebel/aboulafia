import { DihedralView } from "@/components/dihedral/dihedral-view";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Dihedral",
  description:
    "How a circular graph is generated from a fundamental wedge of 360/(2n)° by reflection and n rotations — the Dₙ kaleidoscope.",
};

export default function DihedralPage() {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6">
      <Suspense fallback={null}>
        <DihedralView />
      </Suspense>
    </div>
  );
}
