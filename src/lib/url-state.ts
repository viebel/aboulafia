/**
 * Tiny helpers for "deep linking": reflecting a client component's controls in
 * the URL query string so a given view can be shared/bookmarked and restored.
 *
 * Reads are done from a `URLSearchParams` (typically from `useSearchParams`) in
 * a lazy `useState` initializer. Writes go through `window.history.replaceState`
 * so updating a control neither adds history entries nor triggers a Next.js
 * navigation/re-render (which keeps slider drags cheap).
 */

export function readEnumParam<T extends string>(
  params: URLSearchParams | null | undefined,
  key: string,
  allowed: readonly T[],
  fallback: T
): T {
  const value = params?.get(key);
  return value !== null && value !== undefined && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function readIntParam(
  params: URLSearchParams | null | undefined,
  key: string,
  allowed: readonly number[],
  fallback: number
): number {
  const value = params?.get(key);
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && allowed.includes(parsed) ? parsed : fallback;
}

/**
 * Read a non-negative integer with no fixed allow-list (for values whose range
 * depends on runtime state, e.g. a vertex index in 0…n!−1). Returns `fallback`
 * when the param is missing or not a non-negative integer; callers should clamp
 * to the currently valid range at use.
 */
export function readNonNegIntParam(
  params: URLSearchParams | null | undefined,
  key: string,
  fallback = 0
): number {
  const value = params?.get(key);
  if (value === null || value === undefined || !/^\d+$/.test(value)) return fallback;
  return Number(value);
}

/**
 * Replace the current URL's query string with `entries`, omitting any entry
 * whose value is `null`, `undefined`, or empty. A no-op on the server.
 */
export function writeUrlParams(
  entries: Record<string, string | null | undefined>
): void {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) {
    if (value !== null && value !== undefined && value !== "") {
      params.set(key, value);
    }
  }

  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ""}`;
  window.history.replaceState(window.history.state, "", url);
}
