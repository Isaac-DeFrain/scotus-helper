/**
 * SCOTUS OPINION SCRAPER
 *
 * Fetches slip opinions from the SCOTUS listing pages, downloads each PDF,
 * extracts full text, and persists opinions to SQLite. Lightweight JSON
 * metadata backups are written to data/opinions/{opinionType}/{termYear}/.
 * Chunking and embeddings run in upload-opinions.
 *
 * Usage:
 *   npm run scrape-opinions                  # defaults to current year
 *   npm run scrape-opinions -- --term 24     # scrape October Term 2024
 *   npm run scrape-opinions -- --all         # scrape current term back to 18
 */

import axios from "axios";
import { PDFParse } from "pdf-parse";

import { BASE_URL, DELAY_MS, DB_PATH } from "../../src/constants";
import { openDb } from "../../src/db";
import { type OpinionType } from "../../src/libs/opinionUtils";
import { delay, saveJsonBackup } from "./utils";
import { parseMeritsListingPage } from "./merits";
import { parseOrdersListingPage } from "./orders";

function getCurrentTerm(): number {
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentTermYear =
    currentDate.getMonth() <= 10 ? currentYear - 1 : currentYear;
  return currentTermYear % 100;
}

function normalizeTerm(rawTerm: number): number {
  if (!Number.isFinite(rawTerm) || rawTerm < 0) return getCurrentTerm();
  if (rawTerm > 99) return rawTerm % 100;
  return rawTerm;
}

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

function getSourcesForTerm(
  term: number,
): { type: OpinionType; path: string }[] {
  return [
    { type: "merits", path: `/opinions/slipopinion/${term}` },
    { type: "orders", path: `/opinions/relatingtoorders/${term}` },
  ];
}

async function scrapeOpinionsForTerm(
  db: ReturnType<typeof openDb>,
  term: number,
): Promise<void> {
  const sources = getSourcesForTerm(term);

  for (const source of sources) {
    console.log(
      `\nFetching ${source.type} listing for term ${term}: ${BASE_URL}${source.path}`,
    );

    let listingHtml: string;
    try {
      const res = await axios.get<string>(`${BASE_URL}${source.path}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; research-bot/1.0)",
        },
      });
      listingHtml = res.data;
    } catch (err) {
      console.warn(
        `  Could not fetch ${source.type} listing:`,
        (err as Error).message,
      );
      continue;
    }

    const opinions =
      source.type === "merits"
        ? parseMeritsListingPage(listingHtml, term)
        : parseOrdersListingPage(listingHtml, term);
    console.log(`  Found ${opinions.length} ${source.type} opinions`);

    for (const meta of opinions) {
      const existing = await db
        .selectFrom("opinions")
        .select("id")
        .where("docket", "=", meta.docket)
        .where("justice", "=", meta.justice)
        .executeTakeFirst();

      if (existing) {
        console.log(
          `  [skip] already in DB: ${meta.docket} — ${meta.caseName}`,
        );
        continue;
      }

      const msg = `  [${meta.opinionType}] ${meta.opinionNumber ? `#${meta.opinionNumber}` : ""} ${meta.docket} — ${meta.caseName}`;
      console.log(msg);

      let pdfBuffer: Buffer;
      try {
        const pdfRes = await axios.get<ArrayBuffer>(meta.pdfUrl, {
          responseType: "arraybuffer",
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; research-bot/1.0)",
          },
        });
        pdfBuffer = Buffer.from(pdfRes.data);
      } catch (err) {
        console.warn(
          `    Skipping PDF download error:`,
          (err as Error).message,
        );
        await delay(DELAY_MS);
        continue;
      }

      let text: string;
      try {
        const parser = new PDFParse({ data: pdfBuffer });
        const result = await parser.getText();

        text = result.text;
        await parser.destroy();
      } catch (err) {
        console.warn(`    Skipping PDF parse error:`, (err as Error).message);
        await delay(DELAY_MS);
        continue;
      }

      try {
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
      } catch (err) {
        console.warn(
          `    Skipping DB insert error for ${meta.docket}:`,
          (err as Error).message,
        );
        await delay(DELAY_MS);
        continue;
      }

      try {
        saveJsonBackup(meta);
      } catch (err) {
        console.warn(
          `    Could not save JSON backup for ${meta.docket}:`,
          (err as Error).message,
        );
      }

      await delay(DELAY_MS);
    }
  }
}

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
