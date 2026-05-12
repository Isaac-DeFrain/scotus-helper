import * as cheerio from "cheerio";

import { type OpinionMetaData } from "../../src/libs/opinionUtils";
import { buildPdfUrl } from "./utils";

const MERITS_NUM_COLS = 6;

/**
 * Parse the merits opinion listing page (6-column table).
 * Columns: #, Date, Docket, Case Name (PDF link), Justice, Citation
 */
export function parseMeritsListingPage(
  html: string,
  term: number,
): OpinionMetaData[] {
  const $ = cheerio.load(html);
  const opinions: OpinionMetaData[] = [];

  $("table tr").each((_i, row) => {
    const cells = $(row).find("td");
    if (cells.length !== MERITS_NUM_COLS) return;

    const opinionNumber = parseInt($(cells[0]).text().trim(), 10);
    if (isNaN(opinionNumber)) return;

    const date = $(cells[1]).text().trim();
    const docket = $(cells[2]).text().trim();
    const nameCell = $(cells[3]);
    const caseName = nameCell.find("a").first().text().trim();
    const relativeUrl = nameCell.find("a").first().attr("href") ?? "";
    const justice = $(cells[4]).text().trim();
    const citation = $(cells[5]).text().trim();

    if (!caseName || !relativeUrl || !docket) return;

    opinions.push({
      opinionNumber,
      opinionType: "merits",
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
