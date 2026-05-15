import { Source } from "./chat";

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
 * Delay for a given number of milliseconds.
 *
 * @param ms - The number of milliseconds to delay
 * @returns A promise that resolves after the given number of milliseconds
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
