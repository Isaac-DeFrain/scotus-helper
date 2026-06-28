import { Source } from "./chat";
import type { QueryStats } from "./queryCost";

export const QUERY_STATS_META_PREFIX = "\n\n<!--SCOTUS_QUERY_META:";
export const QUERY_STATS_META_SUFFIX = "-->";

/**
 * Format a date in seconds since Unix epoch to YYYY-MM-DD.
 *
 * @param seconds - The date in seconds since Unix epoch
 * @returns The date in YYYY-MM-DD
 */
export function formatDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().split("T")[0];
}

/**
 * Convert a base64-encoded JSON string to a Source array.
 *
 * @param b64 - The base64-encoded JSON string
 * @returns The Source array
 */
export function base64JsonToSources(b64: string): Source[] {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json);
}

/**
 * Appends encoded query stats to a streamed chat response.
 *
 * @param stats - Aggregated query cost breakdown
 * @returns Stream suffix containing base64-encoded JSON stats
 */
export function encodeQueryStats(stats: QueryStats): string {
  const json = JSON.stringify(stats);
  const b64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(json, "utf8").toString("base64")
      : btoa(json);
  return `${QUERY_STATS_META_PREFIX}${b64}${QUERY_STATS_META_SUFFIX}`;
}

/**
 * Separates streamed answer text from an appended query-stats suffix.
 *
 * @param text - Accumulated stream text, possibly including a partial or full suffix
 * @returns Display content and parsed stats when the suffix is complete
 */
export function splitStreamContentAndStats(text: string): {
  content: string;
  stats?: QueryStats;
} {
  const prefixIndex = text.indexOf(QUERY_STATS_META_PREFIX);
  if (prefixIndex === -1) {
    const partialStart = text.lastIndexOf("\n\n<!--");
    if (partialStart !== -1) {
      const tail = text.slice(partialStart);
      if (
        QUERY_STATS_META_PREFIX.startsWith(tail) ||
        tail.startsWith("\n\n<!--SCOTUS")
      ) {
        return { content: text.slice(0, partialStart) };
      }
    }

    return { content: text };
  }

  const content = text.slice(0, prefixIndex);
  const metaPart = text.slice(prefixIndex + QUERY_STATS_META_PREFIX.length);
  const suffixIndex = metaPart.indexOf(QUERY_STATS_META_SUFFIX);
  if (suffixIndex === -1) return { content };

  const b64 = metaPart.slice(0, suffixIndex);
  try {
    const stats = JSON.parse(atob(b64)) as QueryStats;
    return { content, stats };
  } catch {
    return { content };
  }
}

/**
 * Delay for a given number of milliseconds.
 *
 * @param ms - The number of milliseconds to delay
 * @returns A promise that resolves after the given number of milliseconds
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
