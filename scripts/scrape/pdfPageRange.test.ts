import type { InfoResult, PageLinkResult } from "pdf-parse";

import type { OpinionMetaData } from "@/src/libs/opinionUtils";
import {
  parsePdfViewerPage,
  pdfBaseUrl,
  physicalPageRangesForSlicedRows,
  urlPageToPhysicalPage,
} from "./pdfPageRange";

function makePageLink(
  pageNumber: number,
  pageLabel: string | null,
): PageLinkResult {
  return {
    pageNumber,
    pageLabel,
    links: [],
    width: 612,
    height: 792,
  };
}

/** Labels equal physical indices (simple PDF). */
function makeInfoLabelsMatchPhysical(total: number): InfoResult {
  const pages: PageLinkResult[] = [];
  for (let i = 1; i <= total; i += 1) {
    pages.push(makePageLink(i, String(i)));
  }
  return { total, pages } as unknown as InfoResult;
}

/** Printed labels differ from physical (e.g. bound volume). */
function makeInfoWithLabelOffset(): InfoResult {
  const pages: PageLinkResult[] = [
    makePageLink(1, "i"),
    makePageLink(2, "ii"),
    makePageLink(3, "100"),
    makePageLink(4, "101"),
    makePageLink(5, "102"),
  ];

  return { total: pages.length, pages } as unknown as InfoResult;
}

const BASE_META: Omit<OpinionMetaData, "pdfUrl" | "docket" | "opinionNumber"> =
  {
    opinionType: "merits",
    termYear: 2020,
    date: 0,
    caseName: "Test",
    justice: "J",
    citation: "1 U.S. 1",
  };

function metaForPage(
  page: number,
  docket: string,
  opinionNumber?: number,
): OpinionMetaData {
  return {
    ...BASE_META,
    docket,
    opinionNumber,
    pdfUrl: `https://example.com/shared.pdf#page=${page}`,
  };
}

describe("pdfBaseUrl", () => {
  it("strips hash and query", () => {
    const baseUrl = "https://example.com/a/b.pdf";
    expect(pdfBaseUrl(`${baseUrl}?page=1#page=4`)).toBe(baseUrl);
  });
});

describe("parsePdfViewerPage", () => {
  const baseUrl = "https://x/y.pdf";

  it("reads page number from hash", () => {
    const pageNumber = 4;
    const url = `${baseUrl}#page=${pageNumber}`;
    expect(parsePdfViewerPage(url)).toBe(pageNumber);
  });

  it("reads page number from query string", () => {
    const pageNumber = 7;
    const url = `${baseUrl}?page=${pageNumber}`;
    expect(parsePdfViewerPage(url)).toBe(pageNumber);
  });

  it("returns undefined when absent", () => {
    expect(parsePdfViewerPage(baseUrl)).toBeUndefined();
  });
});

describe("urlPageToPhysicalPage", () => {
  it("matches numeric pageLabel before physical fallback", () => {
    const info = makeInfoWithLabelOffset();
    expect(urlPageToPhysicalPage(100, info, 5)).toBe(3);
    expect(urlPageToPhysicalPage(101, info, 5)).toBe(4);
  });

  it("falls back to physical index when labels do not match", () => {
    const info = makeInfoLabelsMatchPhysical(10);
    expect(urlPageToPhysicalPage(4, info, 10)).toBe(4);
  });

  it("returns undefined when out of range and no label match", () => {
    const info = makeInfoLabelsMatchPhysical(5);
    expect(urlPageToPhysicalPage(99, info, 5)).toBeUndefined();
  });
});

describe("physicalPageRangesForSlicedRows", () => {
  it("orders slices by PDF order when listing rows are shuffled (merits-style)", () => {
    const totalPages = 20;
    const info = makeInfoLabelsMatchPhysical(totalPages);

    const lowPageStart = 5;
    const midPageStart = 12;
    const highPageStart = 18;

    const metaHigh = metaForPage(highPageStart, "docket-c", 3);
    const metaLow = metaForPage(lowPageStart, "docket-a", 1);
    const metaMid = metaForPage(midPageStart, "docket-b", 2);

    const shuffled = [metaHigh, metaLow, metaMid];
    const map = physicalPageRangesForSlicedRows(shuffled, totalPages, info);

    expect(map.get(metaLow)).toEqual({
      first: lowPageStart,
      last: midPageStart - 1,
    });
    expect(map.get(metaMid)).toEqual({
      first: midPageStart,
      last: highPageStart - 1,
    });
    expect(map.get(metaHigh)).toEqual({
      first: highPageStart,
      last: totalPages,
    });
  });

  it("single orders row with #page= runs through last document page", () => {
    const info = makeInfoLabelsMatchPhysical(10);
    const row: OpinionMetaData = {
      ...BASE_META,
      opinionType: "orders",
      docket: "20-1063",
      pdfUrl:
        "https://www.supremecourt.gov/opinions/20pdf/20-1063_new_gfbi.pdf#page=4",
    };

    const map = physicalPageRangesForSlicedRows([row], 10, info);
    expect(map.get(row)).toEqual({ first: 4, last: 10 });
  });

  it("resolves duplicate physical starts: only first stable row keeps a slice", () => {
    const totalPages = 15;
    const info = makeInfoLabelsMatchPhysical(totalPages);

    const aPageStart = 3;
    const a = metaForPage(aPageStart, "aaa", 1);
    const b = {
      ...metaForPage(aPageStart, "bbb", 2),
      caseName: "Other",
    } as OpinionMetaData;

    const map = physicalPageRangesForSlicedRows([a, b], totalPages, info);
    expect(map.get(a)).toEqual({ first: aPageStart, last: totalPages });
    expect(map.get(b)).toBeNull();
  });
});
