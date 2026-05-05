/**
 * SCOTUS OPINION SCRAPER
 *
 * Fetches slip opinions from all three SCOTUS listing pages, downloads
 * each PDF, extracts the full text, chunks it, generates OpenAI embeddings,
 * and persists everything to SQLite. Lightweight JSON metadata backups are
 * also written to data/opinions/{opinionType}/{termYear}/
 *
 * Usage:
 *   npm run scrape-opinions                  # defaults to current year
 *   npm run scrape-opinions -- --term 24     # scrape October Term 2024
 *
 * Requires: OPENAI_API_KEY in .env
 */

import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import * as cheerio from "cheerio";
import { PDFParse } from "pdf-parse";
import OpenAI from "openai";
import dotenv from "dotenv";
import { chunkText } from "../src/libs/chunking";
import {
    BASE_URL,
    CHUNK_OVERLAP,
    CHUNK_SIZE,
    DELAY_MS,
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
    OPINIONS_DIR,
    DB_PATH,
} from "../src/constants";
import { openDb } from "../src/db";
import { buildFilename, type OpinionMetaData } from "../src/libs/opinionUtils";

dotenv.config();

const REQUIRED_ENV = ["OPENAI_API_KEY"];

const missing = REQUIRED_ENV.filter((v) => !process.env[v]);
if (missing.length > 0) {
    console.error("Missing required environment variables:", missing);
    process.exit(1);
}

// Parse command line arguments
const termArg = process.argv.indexOf("--term");
const TERM_YEAR: number = (() => {
    if (termArg !== -1 && process.argv[termArg + 1]) {
        const val = parseInt(process.argv[termArg + 1], 10);
        if (!isNaN(val)) return val;
    }

    // default to current 2-digit term year
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentTermYear = currentDate.getMonth() <= 10 ? currentYear - 1 : currentYear;
    return currentTermYear % 100;
})();

// SCOTUS opinion sources
const SOURCES: { type: OpinionMetaData["opinionType"]; path: string }[] = [
    { type: "merits", path: `/opinions/slipopinion/${TERM_YEAR}` },
    { type: "orders", path: `/opinions/relatingtoorders/${TERM_YEAR}` },
];

const MERITS_NUM_COLS = 6;
const ORDERS_NUM_COLS = 5;

const ANSI = {
    cyan: "\x1b[36m",
    yellow: "\x1b[33m",
    reset: "\x1b[0m",
} as const;

type OpinionType = OpinionMetaData["opinionType"];

const TYPE_COLOR: Record<OpinionType, string> = {
    merits: ANSI.cyan,
    orders: ANSI.yellow,
};

function colorLabel(type: OpinionType): string {
    return `${TYPE_COLOR[type]}[${type}]${ANSI.reset}`;
}

function buildPdfUrl(relativeUrl: string): string {
    return relativeUrl.startsWith("http")
        ? relativeUrl
        : `${BASE_URL}${relativeUrl.startsWith("/") ? "" : "/"}${relativeUrl}`;
}

/**
 * Parse the merits opinion listing page (6-column table).
 * Columns: #, Date, Docket, Case Name (PDF link), Justice, Citation
 *
 * @param html - The HTML of the listing page
 * @returns An array of merits opinion metadata
 */
function parseMeritsListingPage(html: string): OpinionMetaData[] {
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
            termYear: TERM_YEAR,
            date,
            docket,
            caseName,
            justice,
            citation,
            pdfUrl: buildPdfUrl(relativeUrl),
        });
    });

    return opinions;
}

/**
 * Parse the orders opinion listing page (5-column table).
 * Columns: Date, Docket, Case Name (PDF link), Justice, Citation
 *
 * @param html - The HTML of the listing page
 * @returns An array of orders opinion metadata
 */
function parseOrdersListingPage(html: string): OpinionMetaData[] {
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
            termYear: TERM_YEAR,
            date,
            docket,
            caseName,
            justice,
            citation,
            pdfUrl: buildPdfUrl(relativeUrl),
        });
    });

    return opinions;
}

/**
 * Save the opinion metadata to a JSON file under
 * {OPINIONS_DIR}/{opinionType}/{termYear}/
 *
 * @param meta - The opinion metadata
 */
function saveJsonBackup(meta: OpinionMetaData): void {
    const date = new Date(meta.date);
    const typeDir = path.join(OPINIONS_DIR, meta.opinionType, date.getFullYear().toString());

    fs.mkdirSync(typeDir, { recursive: true });
    fs.writeFileSync(path.join(typeDir, buildFilename(meta)), JSON.stringify(meta, null, 2));
}

/**
 * Delay for a given number of milliseconds
 *
 * @param ms - The number of milliseconds to delay
 * @returns A promise that resolves after the delay
 */
function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Scrape the opinions from the SCOTUS website
 *
 * @returns A promise that resolves when the opinions are scraped
 */
async function scrapeOpinions(): Promise<void> {
    const db = openDb(DB_PATH);
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    try {
        for (const source of SOURCES) {
            console.log(
                `\nFetching ${source.type} listing for term ${TERM_YEAR}: ${BASE_URL}${source.path}`,
            );

            let listingHtml: string;
            try {
                const res = await axios.get<string>(`${BASE_URL}${source.path}`, {
                    headers: { "User-Agent": "Mozilla/5.0 (compatible; research-bot/1.0)" },
                });
                listingHtml = res.data;
            } catch (err) {
                console.warn(`  Could not fetch ${source.type} listing:`, (err as Error).message);
                continue;
            }

            const opinions =
                source.type === "merits"
                    ? parseMeritsListingPage(listingHtml)
                    : parseOrdersListingPage(listingHtml);
            console.log(`  Found ${opinions.length} ${source.type} opinions`);

            for (const meta of opinions) {
                const msg = `  ${colorLabel(meta.opinionType)} ${meta.opinionNumber ? `#${meta.opinionNumber}` : ""} ${meta.docket} — ${meta.caseName}`;
                console.log(msg);

                // Download PDF
                let pdfBuffer: Buffer;
                try {
                    const pdfRes = await axios.get<ArrayBuffer>(meta.pdfUrl, {
                        responseType: "arraybuffer",
                        headers: { "User-Agent": "Mozilla/5.0 (compatible; research-bot/1.0)" },
                    });
                    pdfBuffer = Buffer.from(pdfRes.data);
                } catch (err) {
                    console.warn(`    Skipping PDF download error:`, (err as Error).message);
                    await delay(DELAY_MS);
                    continue;
                }

                // Extract text
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

                // Persist raw opinion
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

                const opinionRow = await db
                    .selectFrom("opinions")
                    .select("id")
                    .where("docket", "=", meta.docket)
                    .executeTakeFirst();

                if (!opinionRow) {
                    console.warn(`    Could not retrieve opinion id for ${meta.docket}`);
                    await delay(DELAY_MS);
                    continue;
                }

                // Chunk + embed
                const sourceKey = `opinion:${meta.docket}`;
                const chunks = chunkText(text, CHUNK_SIZE, CHUNK_OVERLAP, sourceKey);

                let embeddingRes: Awaited<ReturnType<typeof openai.embeddings.create>>;
                try {
                    embeddingRes = await openai.embeddings.create({
                        model: EMBEDDING_MODEL,
                        dimensions: EMBEDDING_DIMENSIONS,
                        input: chunks.map((c) => c.content),
                    });
                } catch (err) {
                    console.warn(
                        `    Skipping embedding error for ${meta.docket}:`,
                        (err as Error).message,
                    );
                    await delay(DELAY_MS);
                    continue;
                }

                // Persist chunks
                let chunkErrors = 0;
                for (let i = 0; i < chunks.length; i++) {
                    const chunk = chunks[i];
                    const vector = embeddingRes.data[i].embedding;

                    try {
                        await db
                            .insertInto("opinion_chunks")
                            .values({
                                id: `opinion:${meta.docket}:chunk:${i}`,
                                opinion_id: opinionRow.id,
                                docket: meta.docket,
                                chunk_index: chunk.metadata.chunkIndex,
                                total_chunks: chunk.metadata.totalChunks,
                                content: chunk.content,
                                embedding: JSON.stringify(vector),
                                start_char: chunk.metadata.startChar,
                                end_char: chunk.metadata.endChar,
                            })
                            .onConflict((oc) => oc.doNothing())
                            .execute();
                    } catch (err) {
                        chunkErrors++;
                        console.warn(
                            `    Chunk ${i} insert error for ${meta.docket}:`,
                            (err as Error).message,
                        );
                    }
                }

                const stored = chunks.length - chunkErrors;
                console.log(`    Stored ${stored}/${chunks.length} chunks`);
                await delay(DELAY_MS);
            }
        }
    } finally {
        await db.destroy();
    }

    console.log("\nDone. Database written to", DB_PATH);
}

scrapeOpinions().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
