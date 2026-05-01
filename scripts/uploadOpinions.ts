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

import * as path from "path";
import * as fs from "fs";
import weaviate from "weaviate-client";
import dotenv from "dotenv";
import { openDb } from "../src/db";

dotenv.config();

const DB_PATH = path.join(process.cwd(), "data", "opinions.db");
const COLLECTION_NAME = "SupremeCourtOpinions";
const BATCH_SIZE = 100;

async function uploadOpinions(): Promise<void> {
    if (!fs.existsSync(DB_PATH)) {
        console.error(`Database not found: ${DB_PATH}`);
        console.error("Run `npm run fetch-opinions` first.");
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
        .execute();

    await db.destroy();

    if (rows.length === 0) {
        console.log("No chunks found in database. Run fetch-opinions first.");
        return;
    }

    console.log(`Uploading ${rows.length} chunks to Weaviate...`);

    const client = await weaviate.connectToLocal();

    // Create collection if it doesn't exist
    const exists = await client.collections.exists(COLLECTION_NAME);
    if (!exists) {
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
    }

    const collection = client.collections.get(COLLECTION_NAME);
    let successCount = 0;

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

        await collection.data.insertMany(objects);
        successCount += batch.length;
        console.log(`  Uploaded ${successCount}/${rows.length} chunks`);
    }

    await client.close();
    console.log(`\nDone. ${successCount} chunks in Weaviate collection "${COLLECTION_NAME}".`);
}

uploadOpinions().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
