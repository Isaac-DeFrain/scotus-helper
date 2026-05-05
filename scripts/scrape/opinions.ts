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

import axios from "axios";
import { PDFParse } from "pdf-parse";
import OpenAI from "openai";
import dotenv from "dotenv";

import { chunkText } from "../../src/libs/chunking";
import {
    BASE_URL,
    CHUNK_OVERLAP,
    CHUNK_SIZE,
    DELAY_MS,
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
    DB_PATH,
} from "../../src/constants";
import { openDb } from "../../src/db";
import { type OpinionMetaData } from "../../src/libs/opinionUtils";
import { colorLabel, delay, saveJsonBackup } from "./utils";
import { parseMeritsListingPage } from "./merits";
import { parseOrdersListingPage } from "./orders";

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

    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentTermYear = currentDate.getMonth() <= 10 ? currentYear - 1 : currentYear;
    return currentTermYear % 100;
})();

const SOURCES: { type: OpinionMetaData["opinionType"]; path: string }[] = [
    { type: "merits", path: `/opinions/slipopinion/${TERM_YEAR}` },
    { type: "orders", path: `/opinions/relatingtoorders/${TERM_YEAR}` },
];

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
                    ? parseMeritsListingPage(listingHtml, TERM_YEAR)
                    : parseOrdersListingPage(listingHtml, TERM_YEAR);
            console.log(`  Found ${opinions.length} ${source.type} opinions`);

            for (const meta of opinions) {
                const msg = `  ${colorLabel(meta.opinionType)} ${meta.opinionNumber ? `#${meta.opinionNumber}` : ""} ${meta.docket} — ${meta.caseName}`;
                console.log(msg);

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
