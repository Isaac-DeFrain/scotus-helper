/**
 * SCOTUS OPINION SCRAPER
 *
 * Fetches slip opinions from the SCOTUS listing pages, downloads each PDF,
 * extracts full text, and persists opinions to SQLite. Lightweight JSON
 * metadata backups are written to data/opinions/{opinionType}/{termYear}/.
 * Chunking and embeddings run in upload-opinions.
 *
 * For each term, after both merits and orders listings load successfully, if
 * the database already has at least as many opinions as rows on those
 * listings, PDF download and parsing for that term are skipped.
 *
 * Rows whose `pdfUrl` includes `#page=N` are extracted from that physical or
 * labeled page through the page before the next row’s start in the same file
 * (PDF order), or through the document end if there is no later slice. Rows
 * without `#page=` use the full PDF. Rows sharing the same file (same URL
 * without hash/query) batch one download when any row uses `#page=`.
 *
 * Usage:
 *   npm run scrape-opinions                # defaults to current year
 *   npm run scrape-opinions -- --term 24   # scrape October Term 2024
 *   npm run scrape-opinions -- --term 2024 # scrape October Term 2024
 *   npm run scrape-opinions -- --all       # scrape all terms back to 18
 */

import axios from "axios";
import { PDFParse } from "pdf-parse";

import { BASE_URL, DELAY_MS, DB_PATH } from "@/src/constants";
import { countOpinionsForTermYear, openDb } from "@/src/db/db";
import { type OpinionMetaData, type OpinionType } from "@/src/opinion";
import { delay } from "@/src/utils";
import { parseMeritsListingPage } from "./merits";
import { parseOrdersListingPage } from "./orders";
import {
  parsePdfViewerPage,
  pdfBaseUrl,
  physicalPageRangesForSlicedRows,
} from "./pdfPageRange";

/**
 * Get the current term
 *
 * Terms begin in October.
 *
 * @returns The current (two-digit) term
 */
function getCurrentTerm(): number {
  const date = new Date();
  if (date.getMonth() < 10) {
    return (date.getFullYear() - 1) % 100;
  } else {
    return date.getFullYear() % 100;
  }
}

/**
 * Normalize a term
 *
 * @param rawTerm - The term (two-digit) or year (four-digit)
 * @returns The normalized term (two-digit)
 */
function normalizeTerm(rawTerm: number): number {
  if (!Number.isFinite(rawTerm) || rawTerm < 0) return getCurrentTerm();
  if (rawTerm > 99) return rawTerm % 100;
  return rawTerm;
}

/**
 * Get the requested terms from the command line arguments
 *
 * @param argv - The command line arguments
 * @returns The requested terms
 */
function getRequestedTerms(argv: string[]): number[] {
  const all = argv.includes("--all");
  const termArg = argv.indexOf("--term");
  const currentTerm = getCurrentTerm();

  if (all) {
    const start = normalizeTerm(currentTerm);
    const terms: number[] = [];

    for (let t = start; t >= 18; t -= 1) terms.push(t);
    return terms;
  }

  if (termArg !== -1 && argv[termArg + 1]) {
    const val = parseInt(argv[termArg + 1], 10);
    if (!Number.isNaN(val)) return [normalizeTerm(val)];
  }

  return [normalizeTerm(currentTerm)];
}

/**
 * Get the sources for a term
 *
 * @param term - The term to get the sources for
 * @returns The sources
 */
function getSourcesForTerm(
  term: number,
): { type: OpinionType; path: string }[] {
  return [
    { type: "merits", path: `/opinions/slipopinion/${term}` },
    { type: "orders", path: `/opinions/relatingtoorders/${term}` },
  ];
}

type Db = ReturnType<typeof openDb>;

/**
 * Check if an opinion already exists in the database
 *
 * @param db - The database connection
 * @param meta - The opinion metadata
 * @returns True if the opinion exists, false otherwise
 */
async function opinionExists(db: Db, meta: OpinionMetaData): Promise<boolean> {
  const existing = await db
    .selectFrom("opinions")
    .select("id")
    .where("docket", "=", meta.docket)
    .where("justice", "=", meta.justice)
    .executeTakeFirst();
  return existing != null;
}

/**
 * Insert an opinion into the database
 *
 * @param db - The database connection
 * @param meta - The opinion metadata
 * @param text - The opinion text
 */
async function insertOpinionRow(
  db: Db,
  meta: OpinionMetaData,
  text: string,
): Promise<void> {
  await db
    .insertInto("opinions")
    .values({
      opinion_number: meta.opinionNumber,
      opinion_type: meta.opinionType,
      term_year: meta.termYear,
      date: meta.date,
      docket: meta.docket,
      case_name: meta.caseName,
      justice: meta.justice,
      citation: meta.citation,
      pdf_url: meta.pdfUrl,
      text,
    })
    .onConflict((oc) => oc.doNothing())
    .execute();
}

/**
 * Scrape a single-opinion PDF
 *
 * @param db - The database connection
 * @param meta - The opinion metadata
 */
async function scrapeSingleOpinionPdf(
  db: Db,
  meta: OpinionMetaData,
): Promise<void> {
  const msg = `  [${meta.opinionType}] ${meta.opinionNumber ? `#${meta.opinionNumber}` : ""} ${meta.docket} — ${meta.caseName}`;
  console.log(msg);

  // Check if the opinion already exists in the database
  if (await opinionExists(db, meta)) {
    console.log(`  [skip] already in DB: ${meta.docket} — ${meta.caseName}`);
    return;
  }

  // Download the PDF from the URL
  let pdfBuffer: Buffer;
  try {
    const pdfRes = await axios.get<ArrayBuffer>(pdfBaseUrl(meta.pdfUrl), {
      responseType: "arraybuffer",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; research-bot/1.0)",
      },
    });

    pdfBuffer = Buffer.from(pdfRes.data);
  } catch (err) {
    console.warn(`    Skipping PDF download error:`, (err as Error).message);
    await delay(DELAY_MS);
    return;
  }

  // Parse the PDF and extract the text
  let text: string;
  try {
    const parser = new PDFParse({ data: pdfBuffer });
    const result = await parser.getText();

    text = result.text;
    await parser.destroy();
  } catch (err) {
    console.warn(`    Skipping PDF parse error:`, (err as Error).message);

    await delay(DELAY_MS);
    return;
  }

  // Insert the opinion into the database
  try {
    await insertOpinionRow(db, meta, text);
  } catch (err) {
    console.warn(
      `    Skipping DB insert error for ${meta.docket}:`,
      (err as Error).message,
    );
    await delay(DELAY_MS);
    return;
  }
}

/**
 * Scrape a group of opinions from a single PDF with page fragments
 *
 * @param db - The database connection
 * @param groupWithFragment - The group of opinions with page fragments
 */
async function scrapePdfPageFragmentGroup(
  db: Db,
  groupWithFragment: OpinionMetaData[],
): Promise<void> {
  if (groupWithFragment.length === 0) return;

  const downloadUrl = pdfBaseUrl(groupWithFragment[0].pdfUrl);
  const pending: OpinionMetaData[] = [];

  // Filter out opinions that already exist in the database
  for (const meta of groupWithFragment) {
    if (await opinionExists(db, meta)) {
      console.log(`  [skip] already in DB: ${meta.docket} — ${meta.caseName}`);
    } else {
      pending.push(meta);
    }
  }

  if (pending.length === 0) return;

  // Download the PDF from the URL
  let pdfBuffer: Buffer;
  try {
    const pdfRes = await axios.get<ArrayBuffer>(downloadUrl, {
      responseType: "arraybuffer",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; research-bot/1.0)",
      },
    });
    pdfBuffer = Buffer.from(pdfRes.data);
  } catch (err) {
    console.warn(`    Skipping PDF download error:`, (err as Error).message);
    await delay(DELAY_MS);
    return;
  }

  let parser: PDFParse | undefined;
  try {
    parser = new PDFParse({ data: pdfBuffer });

    // Get the PDF info and extract the page ranges for each opinion
    const info = await parser.getInfo({ parsePageInfo: true });
    const rangeMap = physicalPageRangesForSlicedRows(
      groupWithFragment,
      info.total,
      info,
    );

    // Scrape each pending opinion in the group
    for (const meta of pending) {
      const msg = `  [${meta.opinionType}] ${meta.opinionNumber ? `#${meta.opinionNumber}` : ""} ${meta.docket} — ${meta.caseName}`;
      console.log(msg);

      const slice = rangeMap.get(meta);
      if (slice == null) {
        console.warn(
          `    Skipping: could not map #page= to a page range for ${meta.docket}`,
        );
        await delay(DELAY_MS);
        continue;
      }

      // Get the text for the opinion
      let text: string;
      try {
        const result = await parser.getText({
          first: slice.first,
          last: slice.last,
        });

        text = result.text;
      } catch (err) {
        console.warn(`    Skipping PDF parse error:`, (err as Error).message);

        await delay(DELAY_MS);
        continue;
      }

      // Insert the opinion into the database
      try {
        await insertOpinionRow(db, meta, text);
      } catch (err) {
        console.warn(
          `    Skipping DB insert error for ${meta.docket}:`,
          (err as Error).message,
        );

        await delay(DELAY_MS);
        continue;
      }
    }
  } catch (err) {
    console.warn(`    Skipping PDF info/parse error:`, (err as Error).message);
    await delay(DELAY_MS);
  } finally {
    if (parser) await parser.destroy();
  }
}

/**
 * Scrape all opinions for a single term
 *
 * @param db - The SQLite database connection
 * @param term - The term to scrape
 */
async function scrapeOpinionsForTerm(
  db: ReturnType<typeof openDb>,
  term: number,
): Promise<void> {
  const termYear = 2000 + term;
  const sources = getSourcesForTerm(term);
  const listings: Record<
    OpinionType,
    { fetched: boolean; opinions: OpinionMetaData[] }
  > = {
    merits: { fetched: false, opinions: [] },
    orders: { fetched: false, opinions: [] },
  };

  for (const source of sources) {
    console.log(
      `\nFetching ${source.type} listing for term ${term}: ${BASE_URL}${source.path}`,
    );

    try {
      const res = await axios.get<string>(`${BASE_URL}${source.path}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; research-bot/1.0)",
        },
      });

      const opinions =
        source.type === "merits"
          ? parseMeritsListingPage(res.data, term)
          : parseOrdersListingPage(res.data, term);

      listings[source.type] = { fetched: true, opinions };
      console.log(`  Found ${opinions.length} ${source.type} opinions`);
    } catch (err) {
      console.warn(
        `  Could not fetch ${source.type} listing:`,
        (err as Error).message,
      );
    }
  }

  // If the term is already in the database, skip parsing the PDFs.
  if (listings.merits.fetched && listings.orders.fetched) {
    const expected =
      listings.merits.opinions.length + listings.orders.opinions.length;
    const dbCount = await countOpinionsForTermYear(db, termYear);

    if (dbCount >= expected) {
      console.log(
        `\nTerm ${term} (${termYear}): ${dbCount} opinions in DB, ${expected} on listings. Skipping PDF work for this term.`,
      );
      return;
    }
  }

  for (const source of sources) {
    const { fetched, opinions } = listings[source.type];
    if (!fetched) continue;

    // Group opinions by PDF base URL.
    const byBase = new Map<string, OpinionMetaData[]>();
    for (const meta of opinions) {
      const base = pdfBaseUrl(meta.pdfUrl);
      if (!byBase.has(base)) byBase.set(base, []);

      byBase.get(base)!.push(meta);
    }

    // Scrape each group of opinions.
    for (const group of byBase.values()) {
      const withoutFragment = group.filter(
        (m) => parsePdfViewerPage(m.pdfUrl) === undefined,
      );
      const withFragment = group.filter(
        (m) => parsePdfViewerPage(m.pdfUrl) !== undefined,
      );

      for (const meta of withoutFragment) {
        await scrapeSingleOpinionPdf(db, meta);
      }

      await scrapePdfPageFragmentGroup(db, withFragment);
    }
  }
}

/**
 * Scrape all opinions for the requested terms.
 */
async function scrapeOpinions(): Promise<void> {
  const db = openDb(DB_PATH);

  try {
    const terms = getRequestedTerms(process.argv);
    for (const term of terms) await scrapeOpinionsForTerm(db, term);
  } finally {
    await db.destroy();
  }

  console.log("\nDone. Database written to", DB_PATH);
}

scrapeOpinions().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
