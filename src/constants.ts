/**
 * Constants for the SCOTUS Opinion Helper.
 */

import path from "path";

export const GITHUB_REPO_URL = "https://github.com/Isaac-DeFrain/scotus-helper";
export const BASE_URL = "https://www.supremecourt.gov";
export const DELAY_MS = 300;

export const DB_PATH = path.join(process.cwd(), "data", "opinions.db");
export const OPINIONS_DIR = path.join(process.cwd(), "data", "opinions");

export const CHUNK_SIZE = 500;
export const CHUNK_OVERLAP = 50;
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
export const BATCH_SIZE = 500;
// SQLite default SQLITE_LIMIT_VARIABLE_NUMBER is 999; each chunk row has 13
// columns, so cap bulk inserts at 76 rows (76 * 13 = 988 < 999).
export const SQLITE_INSERT_BATCH_SIZE = 76;

// OpenAI embeddings API hard limits per request
export const MAX_EMBEDDING_INPUTS = 2048;
export const MAX_EMBEDDING_TOKENS = 250_000; // actual limit is 300k; conservative buffer
// Conservative chars-per-token estimate; legal/citation-heavy text can be
// denser than general English (~4), so we use 3 to avoid exceeding the
// 300k-token-per-request limit.
export const CHARS_PER_TOKEN = 3;

export const WEAVIATE_COLLECTION_NAME = "SupremeCourtOpinions";
