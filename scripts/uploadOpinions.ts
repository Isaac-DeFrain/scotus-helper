/**
 * SCOTUS OPINION UPLOADER
 *
 * Reads all opinions from SQLite, chunks and embeds any that are not yet
 * cached in the `opinion_chunks` table, then uploads all chunks to Weaviate.
 * The OpenAI embeddings API is called at most once per chunk across runs.
 *
 * Usage:
 *   docker compose up -d weaviate  # start Weaviate
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
import { connectWeaviate } from "../src/libs/weaviateClient";
import {
  BATCH_SIZE,
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  DB_PATH,
  DELAY_MS,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  SQLITE_INSERT_BATCH_SIZE,
  WEAVIATE_COLLECTION_NAME,
} from "../src/constants";
import { delay } from "./scrape/utils";
import { OpinionChunk } from "@/src/libs/opinionUtils";

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

/**
 * For each opinion, check whether chunks are already cached in `opinion_chunks`.
 * If not, chunk the text, call OpenAI once per opinion, and persist the results.
 */
async function ensureChunksEmbedded(
  db: Kysely<AppDatabase>,
  openai: OpenAI,
): Promise<void> {
  const opinions = await db.selectFrom("opinions").selectAll().execute();

  if (opinions.length === 0) {
    console.log("No opinions in SQLite.");
    return;
  }

  console.log(`Checking embeddings for ${opinions.length} opinion(s)...`);

  for (const row of opinions) {
    const cached = await db
      .selectFrom("opinion_chunks")
      .select("id")
      .where("docket", "=", row.docket)
      .limit(1)
      .execute();

    if (cached.length > 0) {
      console.log(`  [cached] ${row.docket} — ${row.case_name}`);
      continue;
    }

    console.log(`  [embed]  ${row.docket} — ${row.case_name}`);
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

    const inserts = chunks.map((chunk, i) => ({
      docket: row.docket,
      chunk_index: chunk.metadata.chunkIndex,
      total_chunks: chunk.metadata.totalChunks,
      content: chunk.content,
      embedding: JSON.stringify(embeddingRes.data[i].embedding),
      start_char: chunk.metadata.startChar,
      end_char: chunk.metadata.endChar,
      case_name: row.case_name,
      opinion_type: row.opinion_type,
      date: row.date,
      justice: row.justice,
      term_year: row.term_year,
      created_at: new Date().toISOString(),
    }));

    // Batch insert into SQLite to avoid hitting the limit on the number of parameters.
    for (let i = 0; i < inserts.length; i += SQLITE_INSERT_BATCH_SIZE) {
      await db
        .insertInto("opinion_chunks")
        .values(inserts.slice(i, i + SQLITE_INSERT_BATCH_SIZE))
        .execute();
    }

    console.log(`    Cached ${chunks.length} chunks`);
  }
}

/**
 * Yields cached chunks from SQLite in pages of `pageSize` rows to avoid
 * loading the full table (with parsed embeddings) into memory at once.
 */
async function* streamChunksFromDb(
  db: Kysely<AppDatabase>,
  pageSize: number,
): AsyncGenerator<WeaviateChunkRow[]> {
  let offset = 0;

  while (true) {
    const page = await db
      .selectFrom("opinion_chunks")
      .selectAll()
      .orderBy("docket", "asc")
      .orderBy("chunk_index", "asc")
      .limit(pageSize)
      .offset(offset)
      .execute();

    if (page.length === 0) break;

    yield page.map((row) =>
      weaviateChunkRowSchema.parse({
        ...row,
        embedding: JSON.parse(row.embedding),
      }),
    );

    if (page.length < pageSize) break;
    offset += pageSize;
  }
}

  let client: Awaited<ReturnType<typeof weaviate.connectToLocal>>;
  try {
    client = await connectWeaviate();
  } catch (err) {
    console.error("Could not connect to Weaviate:", (err as Error).message);
    console.error("Run `docker compose up -d` to start Weaviate.");
    process.exit(1);
  }

  const db = openDb(DB_PATH);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    await ensureChunksEmbedded(db, openai);
    const sortedRows = await loadChunksFromDb(db);

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
