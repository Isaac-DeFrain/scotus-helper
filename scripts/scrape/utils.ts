import { BASE_URL } from "@/src/constants";

export function buildPdfUrl(relativeUrl: string): string {
  return relativeUrl.startsWith("http")
    ? relativeUrl
    : `${BASE_URL}${relativeUrl.startsWith("/") ? "" : "/"}${relativeUrl}`;
}
