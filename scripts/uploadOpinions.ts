/**
 * SCOTUS OPINION UPLOADER
 *
 * Reads all opinions from SQLite, chunks text in memory, calls OpenAI for
 * embeddings, and upserts chunk vectors into a local Weaviate instance.
 *
 * Usage:
 *   docker compose up -d        # start Weaviate
 *   npm run upload-opinions
 *
 * Requires: OPENAI_API_KEY, WEAVIATE_URL in .env (defaults to http://localhost:8080)
 */

import * as fs from "fs";
import weaviate, { vectors } from "weaviate-client";
import OpenAI from "openai";
import dotenv from "dotenv";
import { Kysely } from "kysely";
import { z } from "zod";

import { openDb, type AppDatabase } from "../src/db";
import { chunkText } from "../src/libs/chunking";
import {
  BATCH_SIZE,
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  DB_PATH,
  DELAY_MS,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  WEAVIATE_COLLECTION_NAME,
} from "../src/constants";
import { delay } from "./scrape/utils";

dotenv.config();

const REQUIRED_ENV = ["OPENAI_API_KEY"];

const missing = REQUIRED_ENV.filter((v) => !process.env[v]);
if (missing.length > 0) {
  console.error("Missing required environment variables:", missing);
  process.exit(1);
}

const weaviateChunkRowSchema = z.object({
  docket: z.string(),
  chunk_index: z.number().int().nonnegative(),
  total_chunks: z.number().int().positive(),
  content: z.string(),
  embedding: z.array(z.number()).length(EMBEDDING_DIMENSIONS),
  start_char: z.number().int().nonnegative(),
  end_char: z.number().int().nonnegative(),
  case_name: z.string(),
  opinion_type: z.string(),
  date: z.string(),
  justice: z.string(),
  term_year: z.number().int(),
});

type WeaviateChunkRow = z.infer<typeof weaviateChunkRowSchema>;

async function chunkEmbedAllOpinions(
  db: Kysely<AppDatabase>,
  openai: OpenAI,
): Promise<WeaviateChunkRow[]> {
  const opinions = await db.selectFrom("opinions").selectAll().execute();
  const rows: WeaviateChunkRow[] = [];

  if (opinions.length === 0) {
    console.log("No opinions in SQLite.");
    return rows;
  }

  console.log(`Chunking and embedding ${opinions.length} opinion(s)...`);

  for (const row of opinions) {
    console.log(`  [embed] ${row.docket} — ${row.case_name}`);
    const sourceKey = `opinion:${row.docket}`;
    const chunks = chunkText(row.text, CHUNK_SIZE, CHUNK_OVERLAP, sourceKey);

    if (chunks.length === 0) {
      console.warn(
        `    No chunks produced (empty or unbroken text?) for ${row.docket}`,
      );
      await delay(DELAY_MS);
      continue;
    }

    let embeddingRes: Awaited<ReturnType<typeof openai.embeddings.create>>;
    try {
      embeddingRes = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
        input: chunks.map((c) => c.content),
      });
    } catch (err) {
      console.warn(
        `    Skipping embedding error for ${row.docket}:`,
        (err as Error).message,
      );
      await delay(DELAY_MS);
      continue;
    }

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = embeddingRes.data[i].embedding;

      rows.push(
        weaviateChunkRowSchema.parse({
          docket: row.docket,
          chunk_index: chunk.metadata.chunkIndex,
          total_chunks: chunk.metadata.totalChunks,
          content: chunk.content,
          start_char: chunk.metadata.startChar,
          end_char: chunk.metadata.endChar,
          case_name: row.case_name,
          opinion_type: row.opinion_type,
          date: row.date,
          justice: row.justice,
          term_year: row.term_year,
          embedding,
        }),
      );
    }

    console.log(`    Prepared ${chunks.length} chunks`);
    await delay(DELAY_MS);
  }

  return rows;
}

async function uploadOpinions(): Promise<void> {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`Database not found: ${DB_PATH}`);
    console.error("Run `npm run scrape-opinions` first.");
    process.exit(1);
  }

  let client: Awaited<ReturnType<typeof weaviate.connectToLocal>>;
  try {
    client = await weaviate.connectToLocal();
  } catch (err) {
    console.error("Could not connect to Weaviate:", (err as Error).message);
    console.error("Run `docker compose up -d` to start Weaviate.");
    process.exit(1);
  }

  const db = openDb(DB_PATH);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const rows = await chunkEmbedAllOpinions(db, openai);

    const sortedRows = [...rows].sort((a, b) => {
      const d = a.docket.localeCompare(b.docket);
      return d !== 0 ? d : a.chunk_index - b.chunk_index;
    });

    if (sortedRows.length === 0) {
      console.log(
        "No chunks to upload after embedding. Nothing to send to Weaviate.",
      );
      return;
    }

    console.log(`Uploading ${sortedRows.length} chunks to Weaviate...`);

    try {
      // Create collection if it doesn't exist
      let exists: boolean;
      try {
        exists = await client.collections.exists(WEAVIATE_COLLECTION_NAME);
      } catch (err) {
        console.error(
          "Could not check collection existence:",
          (err as Error).message,
        );
        process.exit(1);
      }

      if (!exists) {
        try {
          await client.collections.create({
            name: WEAVIATE_COLLECTION_NAME,
            vectorizers: vectors.selfProvided(),
          });

          console.log(`Created collection: ${WEAVIATE_COLLECTION_NAME}`);
        } catch (err) {
          console.error("Could not create collection:", (err as Error).message);
          process.exit(1);
        }
      }

      const collection = client.collections.get(WEAVIATE_COLLECTION_NAME);
      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < sortedRows.length; i += BATCH_SIZE) {
        const batch = sortedRows.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(sortedRows.length / BATCH_SIZE);

        console.log(`  Batch ${batchNum}/${totalBatches}...`);

        const objects = batch.map((row) => ({
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
          vectors: row.embedding,
        }));

        try {
          const batchResult = await collection.data.insertMany(objects);
          successCount += batch.length;
          console.debug(
            `  Results: ${JSON.stringify(batchResult.allResponses, null, 2)}`,
          );
        } catch (err) {
          errorCount += batch.length;
          console.warn(`  Batch ${batchNum} failed:`, (err as Error).message);
        }

        console.log(`  Uploaded ${successCount}/${sortedRows.length} chunks`);
      }

      console.log(
        `\nDone. ${successCount} uploaded, ${errorCount} failed. Collection: "${WEAVIATE_COLLECTION_NAME}".`,
      );
    } finally {
      await client.close();
    }
  } finally {
    await db.destroy();
  }
}

uploadOpinions().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
