/**
 * Map SCOTUS PDF URLs with #page= fragments to physical page ranges for extraction.
 */

import { type InfoResult } from "pdf-parse";

import { type OpinionMetaData } from "@/src/libs/opinionUtils";

export type PdfPageSlice = { first: number; last: number };

/**
 * Strip hash and search so all rows pointing at the same file share one key.
 * Use this value for HTTP downloads (fragments are not sent on the wire).
 */
export function pdfBaseUrl(urlStr: string): string {
  const u = new URL(urlStr);
  u.hash = "";
  u.search = "";
  return u.href;
}

/**
 * Parse the PDF viewer page index from `#page=N` (or `&page=N`) in hash or query.
 */
export function parsePdfViewerPage(urlStr: string): number | undefined {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    return undefined;
  }

  const fromSearch = u.searchParams.get("page");
  if (fromSearch != null && fromSearch !== "") {
    const n = Number.parseInt(fromSearch, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const hash = u.hash.startsWith("#") ? u.hash.slice(1) : u.hash;
  if (hash) {
    const params = new URLSearchParams(hash);
    const fromHash = params.get("page");

    if (fromHash != null && fromHash !== "") {
      const n = Number.parseInt(fromHash, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }

  return undefined;
}

/**
 * Normalize a numeric page label.
 *
 * @param label - The page label
 * @returns The normalized page number
 */
function normalizeNumericPageLabel(
  label: string | null | undefined,
): number | undefined {
  if (label == null || label === "") return undefined;

  const t = label.trim();
  if (t === "") return undefined;

  const n = Number.parseInt(t, 10);
  if (!Number.isFinite(n) || String(n) !== t) return undefined;

  return n;
}

/**
 * Map viewer/page URL number N to a physical 1-based page index using per-page
 * labels from getInfo({ parsePageInfo: true }), then physical fallback.
 */
export function urlPageToPhysicalPage(
  pageFromUrl: number,
  info: InfoResult,
  totalPages: number,
): number | undefined {
  if (pageFromUrl < 1 || !Number.isFinite(pageFromUrl)) return undefined;

  for (const p of info.pages) {
    const labelNum = normalizeNumericPageLabel(p.pageLabel ?? undefined);
    if (labelNum === pageFromUrl) return p.pageNumber;

    const raw = (p.pageLabel ?? "").trim();
    if (raw !== "" && raw === String(pageFromUrl)) return p.pageNumber;
  }

  if (pageFromUrl >= 1 && pageFromUrl <= totalPages) return pageFromUrl;
  return undefined;
}

/**
 * For each opinion row with a `#page=` URL, compute inclusive physical [first, last].
 * Rows are ordered by mapped physical start (PDF order), not HTML table order.
 * Duplicate starts (same phys for two rows) yield null for all but the first stable row.
 */
export function physicalPageRangesForSlicedRows(
  rowsWithFragment: OpinionMetaData[],
  totalPages: number,
  info: InfoResult,
): Map<OpinionMetaData, PdfPageSlice | null> {
  const out = new Map<OpinionMetaData, PdfPageSlice | null>();

  type Item = { meta: OpinionMetaData; phys: number };
  const items: Item[] = [];

  for (const meta of rowsWithFragment) {
    const n = parsePdfViewerPage(meta.pdfUrl);
    if (n === undefined) {
      out.set(meta, null);
      continue;
    }

    const phys = urlPageToPhysicalPage(n, info, totalPages);
    if (phys === undefined) {
      out.set(meta, null);
      continue;
    }

    items.push({ meta, phys });
  }

  // Sort the items by physical page number, then docket number, then opinion number.
  items.sort(
    (a, b) =>
      a.phys - b.phys ||
      a.meta.docket.localeCompare(b.meta.docket, "en") ||
      (a.meta.opinionNumber ?? 0) - (b.meta.opinionNumber ?? 0),
  );

  // Get the first opinion for each physical page, ignoring duplicates.
  const firstMetaByPhys = new Map<number, OpinionMetaData>();
  for (const it of items) {
    if (!firstMetaByPhys.has(it.phys)) firstMetaByPhys.set(it.phys, it.meta);
  }

  // Filter out opinions that are not the first for their physical page.
  const usable: Item[] = [];
  const seenPhysInUsable = new Set<number>();

  for (const it of items) {
    if (firstMetaByPhys.get(it.phys) !== it.meta) {
      out.set(it.meta, null);
      continue;
    }

    if (seenPhysInUsable.has(it.phys)) {
      out.set(it.meta, null);
      continue;
    }

    seenPhysInUsable.add(it.phys);
    usable.push(it);
  }

  // Compute the page ranges for the usable opinions.
  for (let i = 0; i < usable.length; i += 1) {
    const first = usable[i].phys;
    const last = i + 1 < usable.length ? usable[i + 1].phys - 1 : totalPages;

    if (last < first) {
      out.set(usable[i].meta, null);
      continue;
    }

    out.set(usable[i].meta, { first, last });
  }

  return out;
}
