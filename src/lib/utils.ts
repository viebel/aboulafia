import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

const STANDARD_NUMBER_FORMAT = new Intl.NumberFormat("en-US")
const SCIENTIFIC_NUMBER_FORMAT = new Intl.NumberFormat("en-US", {
  notation: "scientific",
  maximumFractionDigits: 2,
})
const SCIENTIFIC_NUMBER_THRESHOLD = 1_000_000_000

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatUiNumber(value: number): string {
  return Math.abs(value) > SCIENTIFIC_NUMBER_THRESHOLD
    ? SCIENTIFIC_NUMBER_FORMAT.format(value)
    : STANDARD_NUMBER_FORMAT.format(value)
}
