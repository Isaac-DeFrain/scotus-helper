/**
 * SCOTUS OPINION UPLOADER
 *
 * Reads pre-computed opinion chunks and embeddings from SQLite and upserts
 * them into a local Weaviate instance. No re-embedding; OpenAI is not called.
 *
 * Usage:
 *   docker compose up -d        # start Weaviate
 *   npm run upload-opinions
 *
 * Requires: WEAVIATE_URL in .env (defaults to http://localhost:8080)
 */

import * as fs from "fs";
import weaviate from "weaviate-client";
import dotenv from "dotenv";
import { openDb } from "../src/db";
import { BATCH_SIZE, DB_PATH } from "../src/constants";

dotenv.config();

const REQUIRED_ENV = ["WEAVIATE_URL"];

const missing = REQUIRED_ENV.filter((v) => !process.env[v]);
if (missing.length > 0) {
    console.error("Missing required environment variables:", missing);
    process.exit(1);
}

const COLLECTION_NAME = "SupremeCourtOpinions";

async function uploadOpinions(): Promise<void> {
    if (!fs.existsSync(DB_PATH)) {
        console.error(`Database not found: ${DB_PATH}`);
        console.error("Run `npm run scrape-opinions` first.");
        process.exit(1);
    }

    const db = openDb(DB_PATH);
    const rows = await db
        .selectFrom("opinion_chunks as oc")
        .innerJoin("opinions as o", "o.id", "oc.opinion_id")
        .select([
            "oc.id",
            "oc.docket",
            "oc.chunk_index",
            "oc.total_chunks",
            "oc.content",
            "oc.embedding",
            "oc.start_char",
            "oc.end_char",
            "o.case_name",
            "o.opinion_type",
            "o.date",
            "o.justice",
            "o.term_year",
        ])
        .orderBy("oc.docket")
        .orderBy("oc.chunk_index")
        .execute()
        .finally(() => db.destroy());

    if (rows.length === 0) {
        console.log("No chunks found in database. Run scrape-opinions first.");
        return;
    }

    console.log(`Uploading ${rows.length} chunks to Weaviate...`);

    let client: Awaited<ReturnType<typeof weaviate.connectToLocal>>;
    try {
        client = await weaviate.connectToLocal();
    } catch (err) {
        console.error("Could not connect to Weaviate:", (err as Error).message);
        process.exit(1);
    }

    try {
        // Create collection if it doesn't exist
        let exists: boolean;
        try {
            exists = await client.collections.exists(COLLECTION_NAME);
        } catch (err) {
            console.error("Could not check collection existence:", (err as Error).message);
            process.exit(1);
        }

        if (!exists) {
            try {
                await client.collections.create({
                    name: COLLECTION_NAME,
                    properties: [
                        { name: "text", dataType: "text" as const },
                        { name: "docket", dataType: "text" as const },
                        { name: "caseName", dataType: "text" as const },
                        { name: "opinionType", dataType: "text" as const },
                        { name: "date", dataType: "text" as const },
                        { name: "justice", dataType: "text" as const },
                        { name: "termYear", dataType: "int" as const },
                        { name: "chunkIndex", dataType: "int" as const },
                        { name: "totalChunks", dataType: "int" as const },
                    ],
                });
                console.log(`Created collection: ${COLLECTION_NAME}`);
            } catch (err) {
                console.error("Could not create collection:", (err as Error).message);
                process.exit(1);
            }
        }

        const collection = client.collections.get(COLLECTION_NAME);
        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            const batch = rows.slice(i, i + BATCH_SIZE);
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            const totalBatches = Math.ceil(rows.length / BATCH_SIZE);

            console.log(`  Batch ${batchNum}/${totalBatches}...`);

            const objects = batch.map((row) => ({
                id: row.id ?? undefined,
                properties: {
                    text: row.content,
                    docket: row.docket,
                    caseName: row.case_name,
                    opinionType: row.opinion_type,
                    date: row.date,
                    justice: row.justice,
                    termYear: row.term_year,
                    chunkIndex: row.chunk_index,
                    totalChunks: row.total_chunks,
                },
                vectors: {
                    default: JSON.parse(row.embedding ?? "[]") as number[],
                },
            }));

            try {
                await collection.data.insertMany(objects);
                successCount += batch.length;
            } catch (err) {
                errorCount += batch.length;
                console.warn(`  Batch ${batchNum} failed:`, (err as Error).message);
            }

            console.log(`  Uploaded ${successCount}/${rows.length} chunks`);
        }

        console.log(
            `\nDone. ${successCount} uploaded, ${errorCount} failed. Collection: "${COLLECTION_NAME}".`,
        );
    } finally {
        await client.close();
    }
}

uploadOpinions().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
