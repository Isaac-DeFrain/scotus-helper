import * as cheerio from "cheerio";

import { type OpinionMetaData } from "@/src/opinion";
import { buildPdfUrl } from "./utils";

const ORDERS_NUM_COLS = 5;

/**
 * Parse the orders opinion listing page (5-column table).
 * Columns: Date, Docket, Case Name (PDF link), Justice, Citation
 */
export function parseOrdersListingPage(
  html: string,
  term: number,
): OpinionMetaData[] {
  const $ = cheerio.load(html);
  const opinions: OpinionMetaData[] = [];

  $("table tr").each((_i, row) => {
    const cells = $(row).find("td");
    if (cells.length !== ORDERS_NUM_COLS) return;

    const date = $(cells[0]).text().trim();
    const docket = $(cells[1]).text().trim();
    const nameCell = $(cells[2]);
    const caseName = nameCell.find("a").first().text().trim();
    const relativeUrl = nameCell.find("a").first().attr("href") ?? "";
    const justice = $(cells[3]).text().trim();
    const citation = $(cells[4]).text().trim();

    if (!caseName || !relativeUrl || !docket) return;

    opinions.push({
      opinionType: "orders",
      termYear: 2000 + term,
      date: new Date(date).getTime() / 1000,
      docket,
      caseName,
      justice,
      citation,
      pdfUrl: buildPdfUrl(relativeUrl),
    });
  });

  return opinions;
}
