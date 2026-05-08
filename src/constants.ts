/**
 * Constants for the SCOTUS Opinion Helper.
 */

import path from "path";

export const BASE_URL = "https://www.supremecourt.gov";
export const DELAY_MS = 300;
export const DB_PATH = path.join(process.cwd(), "data", "opinions.db");
export const OPINIONS_DIR = path.join(process.cwd(), "data", "opinions");

export const CHUNK_SIZE = 500;
export const CHUNK_OVERLAP = 50;
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
export const BATCH_SIZE = 100;
export const WEAVIATE_COLLECTION_NAME = "SupremeCourtOpinions";
