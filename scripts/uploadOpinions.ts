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
import {
  Collection,
  vectors,
  type WeaviateClient,
  ErrorObject,
} from "weaviate-client";
import OpenAI, { APIError } from "openai";
import dotenv from "dotenv";
import { Kysely } from "kysely";
import { z } from "zod";

import { openDb, type AppDatabase, countChunks } from "../src/db";
import { Chunk, chunkText } from "../src/libs/chunking";
import { connectWeaviateOrExit } from "../src/libs/weaviateClient";
import {
  BATCH_SIZE,
  CHARS_PER_TOKEN,
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  DB_PATH,
  DELAY_MS,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  MAX_EMBEDDING_INPUTS,
  MAX_EMBEDDING_TOKENS,
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

const RETRY_AFTER_PATTERN = /try again in ([\d.]+)s/i;
const RETRY_BUFFER_MS = 500;

/**
 * Calls `openai.embeddings.create` and automatically retries once on a 429
 * rate-limit response, waiting the duration suggested in the error message
 * (plus a small buffer) before retrying.
 */
async function createEmbeddingWithRetry(
  openai: OpenAI,
  params: Parameters<typeof openai.embeddings.create>[0],
): Promise<ReturnType<typeof openai.embeddings.create>> {
  try {
    return await openai.embeddings.create(params);
  } catch (err) {
    if (err instanceof APIError && err.status === 429) {
      const match = RETRY_AFTER_PATTERN.exec(err.message);
      const waitMs = match
        ? Math.ceil(parseFloat(match[1]) * 1000) + RETRY_BUFFER_MS
        : 3_000;

      console.warn(`    Rate limited — waiting ${waitMs} ms before retry...`);

      await delay(waitMs);
      return openai.embeddings.create(params);
    }

    throw err;
  }
}

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

    // Split into sub-batches respecting both the input-count and token-count limits.
    const subBatches: Chunk[][] = [];
    let current: Chunk[] = [];
    let currentTokens = 0;

    for (const chunk of chunks) {
      const estimated = Math.ceil(chunk.content.length / CHARS_PER_TOKEN);
      const wouldExceedInputs = current.length >= MAX_EMBEDDING_INPUTS;
      const wouldExceedTokens =
        currentTokens + estimated > MAX_EMBEDDING_TOKENS;

      if (current.length > 0 && (wouldExceedInputs || wouldExceedTokens)) {
        subBatches.push(current);
        current = [];
        currentTokens = 0;
      }

      current.push(chunk);
      currentTokens += estimated;
    }

    if (current.length > 0) subBatches.push(current);

    const allEmbeddings: number[][] = [];
    let embeddingFailed = false;

    // Embed each sub-batch in turn.
    for (const batch of subBatches) {
      try {
        const embeddingRes = await createEmbeddingWithRetry(openai, {
          model: EMBEDDING_MODEL,
          dimensions: EMBEDDING_DIMENSIONS,
          input: batch.map((c) => c.content),
        });

        allEmbeddings.push(...embeddingRes.data.map((d) => d.embedding));
      } catch (err) {
        console.warn(
          `    Skipping embedding error for ${row.docket}:`,
          (err as Error).message,
        );

        embeddingFailed = true;
        break;
      }

      await delay(DELAY_MS);
    }

    if (embeddingFailed) {
      await delay(DELAY_MS);
      continue;
    }

    const inserts = chunks.map((chunk, i) => ({
      docket: row.docket,
      chunk_index: chunk.metadata.chunkIndex,
      total_chunks: chunk.metadata.totalChunks,
      content: chunk.content,
      embedding: JSON.stringify(allEmbeddings[i]),
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

/**
 * Ensures the Weaviate collection exists, creating it with self-provided
 * vectors if it does not.
 */
async function ensureCollection(
  client: WeaviateClient,
): Promise<Collection<OpinionChunk>> {
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

  return client.collections.get(WEAVIATE_COLLECTION_NAME);
}

/**
 * Returns the total number of objects currently stored in the Weaviate collection,
 * or 0 if the collection does not yet exist.
 */
async function countWeaviateObjects(
  collection: Collection<OpinionChunk>,
): Promise<number> {
  const result = await collection.aggregate.overAll();
  return result.totalCount ?? 0;
}

/**
 * Builds a set of "docket::chunkIndex" keys for every object already present
 * in the Weaviate collection. Used to skip chunks that were uploaded in a
 * previous run so we only send the missing ones.
 */
async function fetchExistingWeaviateKeys(
  collection: Collection<OpinionChunk>,
): Promise<Set<string>> {
  const keys = new Set<string>();

  for await (const obj of collection.iterator()) {
    const { docket, chunkIndex } = obj.properties as {
      docket: string;
      chunkIndex: number;
    };

    keys.add(`${docket}::${chunkIndex}`);
  }

  return keys;
}

/**
 * Orchestrates the full upload pipeline:
 *   1. Ensures the SQLite database exists.
 *   2. Calls `ensureChunksEmbedded` to chunk and embed any opinions not yet cached.
 *   3. Ensures the Weaviate collection exists.
 *   4. Fast-path: if Weaviate object count equals SQLite chunk count, skips upload.
 *   5. Otherwise builds a skip-set of existing Weaviate keys and streams only
 *      missing chunks from SQLite into Weaviate.
 */
async function uploadOpinions(): Promise<void> {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`Database not found: ${DB_PATH}`);
    console.error("Run `npm run scrape-opinions` first.");
    process.exit(1);
  }

  const client = await connectWeaviateOrExit();
  const db = openDb(DB_PATH);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    await ensureChunksEmbedded(db, openai);

    try {
      const collection = await ensureCollection(client);
      const totalChunks = await countChunks(db);
      const weaviateCount = await countWeaviateObjects(collection);

      if (weaviateCount === totalChunks) {
        console.log(
          `Weaviate is up to date (${weaviateCount} chunks). Nothing to upload.`,
        );
        return;
      }

      if (weaviateCount > totalChunks) {
        console.error(
          `Weaviate has more chunks than SQLite (${weaviateCount} > ${totalChunks}). Please delete the Weaviate collection and try again.`,
        );
        process.exit(1);
      }

      console.log(
        `Weaviate has ${weaviateCount} of ${totalChunks} chunks. Building skip-set...`,
      );

      const existingKeys = await fetchExistingWeaviateKeys(collection);
      console.log(`Skip-set ready (${existingKeys.size} existing keys).`);

      let successCount = 0;
      let errorCount = 0;
      let batchNum = 0;

      for await (const page of streamChunksFromDb(db, BATCH_SIZE)) {
        const missing = page.filter(
          (row) => !existingKeys.has(`${row.docket}::${row.chunk_index}`),
        );

        if (missing.length === 0) continue;

        batchNum += 1;

        const objects = missing.map((row) => ({
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
          const errors: ErrorObject<OpinionChunk>[] = [];

          if (batchResult.hasErrors) {
            errors.push(...Object.values(batchResult.errors));
            console.warn(
              `  Batch ${batchNum} failed:`,
              errors.map((e) => e.message).join(", "),
            );
          }

          successCount += missing.length - errors.length;
        } catch (err) {
          errorCount += missing.length;
          console.warn(`  Batch ${batchNum} failed:`, (err as Error).message);
        }

        const uploaded = weaviateCount + successCount;
        console.log(
          `  Uploaded ${uploaded} of ${totalChunks - weaviateCount} chunks so far...`,
        );
      }

      if (successCount === 0 && errorCount === 0) {
        console.log("No missing chunks found. Nothing to send to Weaviate.");
        return;
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
