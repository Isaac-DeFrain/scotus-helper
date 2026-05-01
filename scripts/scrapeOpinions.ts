/**
 * SCOTUS OPINION SCRAPER
 *
 * Fetches slip opinions from all three SCOTUS listing pages, downloads
 * each PDF, extracts the full text, chunks it, generates OpenAI embeddings,
 * and persists everything to SQLite. Lightweight JSON metadata backups are
 * also written to data/opinions/{termYear}/.
 *
 * Usage:
 *   npm run fetch-opinions                  # defaults to current year
 *   npm run fetch-opinions -- --term 24     # scrape October Term 2024
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
} from "../src/constants";
import { openDb, type OpinionType } from "../src/db";

dotenv.config();

const REQUIRED_ENV = ["OPENAI_API_KEY"];
const missing = REQUIRED_ENV.filter((v) => !process.env[v]);
if (missing.length > 0) {
    console.error("Missing required environment variables:", missing);
    process.exit(1);
}

const termArg = process.argv.indexOf("--term");
const TERM_YEAR: number = (() => {
    if (termArg !== -1 && process.argv[termArg + 1]) {
        const val = parseInt(process.argv[termArg + 1], 10);
        if (!isNaN(val)) return val;
    }

    // default to current 2-digit year
    const currentYear = new Date().getFullYear();
    return currentYear % 100;
})();

const SOURCES: { type: OpinionType; path: string }[] = [
    { type: "merits", path: `/opinions/slipopinion/${TERM_YEAR}` },
    { type: "orders", path: `/opinions/relatingtoorders/${TERM_YEAR}` },
    { type: "in-chambers", path: `/opinions/in-chambers/${TERM_YEAR}` },
];

type OpinionMetaData = {
    opinionNumber: number;
    opinionType: OpinionType;
    termYear: number;
    date: string;
    docket: string;
    caseName: string;
    justice: string;
    citation: string;
    pdfUrl: string;
};

const DB_PATH = path.join(process.cwd(), "data", "opinions.db");
const OPINIONS_DIR = path.join(process.cwd(), "data", "opinions");

function parseListingPage(
    html: string,
    opinionType: OpinionType,
    termYear: number,
): OpinionMetaData[] {
    const $ = cheerio.load(html);
    const opinions: OpinionMetaData[] = [];

    $("table tr").each((_i, row) => {
        const cells = $(row).find("td");
        if (cells.length < 6) return;

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

        const pdfUrl = relativeUrl.startsWith("http")
            ? relativeUrl
            : `${BASE_URL}${relativeUrl.startsWith("/") ? "" : "/"}${relativeUrl}`;

        opinions.push({
            opinionNumber,
            opinionType,
            termYear,
            date,
            docket,
            caseName,
            justice,
            citation,
            pdfUrl,
        });
    });

    return opinions;
}

function saveJsonBackup(meta: OpinionMetaData): void {
    const yearDir = path.join(OPINIONS_DIR, String(meta.termYear + 2000));
    fs.mkdirSync(yearDir, { recursive: true });

    const filename = `opinion-${String(meta.opinionNumber).padStart(4, "0")}-${meta.opinionType}.json`;
    fs.writeFileSync(path.join(yearDir, filename), JSON.stringify(meta, null, 2));
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scrapeOpinions(): Promise<void> {
    const db = openDb(DB_PATH);
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    for (const source of SOURCES) {
        console.log(`\nFetching ${source.type} listing: ${BASE_URL}${source.path}`);

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

        const opinions = parseListingPage(listingHtml, source.type, TERM_YEAR);
        console.log(`  Found ${opinions.length} opinions`);

        for (const meta of opinions) {
            console.log(
                `  [${meta.opinionType}] #${meta.opinionNumber} ${meta.docket} — ${meta.caseName}`,
            );

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

            saveJsonBackup(meta);

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

            const embeddingRes = await openai.embeddings.create({
                model: EMBEDDING_MODEL,
                dimensions: EMBEDDING_DIMENSIONS,
                input: chunks.map((c) => c.content),
            });

            // Persist chunks
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                const vector = embeddingRes.data[i].embedding;

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
            }

            console.log(`    Stored ${chunks.length} chunks`);
            await delay(DELAY_MS);
        }
    }

    await db.destroy();
    console.log("\nDone. Database written to", DB_PATH);
}

scrapeOpinions().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
