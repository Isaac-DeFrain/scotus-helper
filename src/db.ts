/**
 * SCOTUS Opinion Helper
 *
 * Database schema for storing SCOTUS opinions (full text in SQLite).
 */

import BetterSqlite3 from "better-sqlite3";
import { ColumnType, Generated, Kysely, SqliteDialect } from "kysely";
import { OpinionType } from "./libs/opinionUtils";
import fs from "fs";
import path from "path";

/**
 * Opinions table schema
 */
export interface OpinionsTable {
  id: Generated<number>;
  opinion_number: number | null; // absent for orders opinions
  opinion_type: OpinionType;
  term_year: number;
  date: number;
  docket: string;
  case_name: string;
  justice: string;
  citation: string;
  pdf_url: string;
  text: string;
  created_at: ColumnType<number, number | undefined, never>;
}

/**
 * Opinion chunks table schema — caches chunked text and embeddings so the
 * OpenAI API is only called once per chunk across multiple upload runs.
 */
export interface OpinionChunksTable {
  id: Generated<number>;
  docket: string;
  chunk_index: number;
  total_chunks: number;
  content: string;
  embedding: string; // JSON-serialized number[]
  start_char: number;
  end_char: number;
  case_name: string;
  opinion_type: string;
  date: number;
  justice: string;
  term_year: number;
  created_at: ColumnType<number, number | undefined, never>;
}

/**
 * App database schema
 */
export interface AppDatabase {
  opinions: OpinionsTable;
  opinion_chunks: OpinionChunksTable;
}

/**
 * SQL DDL for the database schema
 */
export const DDL = `
  CREATE TABLE IF NOT EXISTS opinions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    opinion_number INTEGER,
    opinion_type   TEXT    NOT NULL,
    term_year      INTEGER NOT NULL,
    date           INTEGER NOT NULL,
    docket         TEXT    NOT NULL UNIQUE,
    case_name      TEXT    NOT NULL,
    justice        TEXT    NOT NULL,
    citation       TEXT    NOT NULL,
    pdf_url        TEXT    NOT NULL,
    text           TEXT    NOT NULL,
    created_at     INTEGER NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS opinion_chunks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    docket       TEXT    NOT NULL,
    chunk_index  INTEGER NOT NULL,
    total_chunks INTEGER NOT NULL,
    content      TEXT    NOT NULL,
    embedding    TEXT    NOT NULL,
    start_char   INTEGER NOT NULL,
    end_char     INTEGER NOT NULL,
    case_name    TEXT    NOT NULL,
    opinion_type TEXT    NOT NULL,
    date         INTEGER NOT NULL,
    justice      TEXT    NOT NULL,
    term_year    INTEGER NOT NULL,
    created_at   INTEGER NOT NULL DEFAULT (datetime('now')),
    UNIQUE (docket, chunk_index)
  );
`;

/**
 * Opinion text row schema
 */
export interface OpinionTextRow {
  id: number;
  docket: string;
  case_name: string;
  opinion_type: OpinionType;
  term_year: number;
  date: number;
  justice: string;
  text: string;
}

/**
 * Opinion filter schema
 */
export interface OpinionFilter {
  opinionType?: OpinionType;
  termYear?: number;
  docket?: string;
}

/**
 * Open the database connection
 *
 * @param dbPath - Path to the database file, or `:memory:` for an in-memory DB (no file on disk)
 * @returns A Kysely database connection
 */
export function openDb(dbPath: string): Kysely<AppDatabase> {
  const isInMemoryDb =
    dbPath === ":memory:" || dbPath.startsWith("file::memory:");

  if (!isInMemoryDb && !fs.existsSync(dbPath)) {
    console.debug("Database file does not exist. Creating:", dbPath);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, "");
  }

  const sqlite = new BetterSqlite3(dbPath);
  sqlite.exec(DDL);

  return new Kysely<AppDatabase>({
    dialect: new SqliteDialect({ database: sqlite }),
  });
}

/**
 * Query opinions from the database.
 *
 * All filter fields are optional and combinable.
 *
 * @param db     - Open Kysely database connection
 * @param filter - Opinion filters: opinionType, termYear, docket
 * @returns Rows with opinion metadata and full text
 */
export async function queryOpinions(
  db: Kysely<AppDatabase>,
  filter: OpinionFilter = {},
): Promise<OpinionTextRow[]> {
  let query = db
    .selectFrom("opinions")
    .select([
      "id",
      "docket",
      "case_name",
      "opinion_type",
      "term_year",
      "date",
      "justice",
      "text",
    ]);

  if (filter.opinionType !== undefined) {
    query = query.where("opinion_type", "=", filter.opinionType);
  }

  if (filter.termYear !== undefined) {
    query = query.where("term_year", "=", filter.termYear);
  }

  if (filter.docket !== undefined) {
    query = query.where("docket", "=", filter.docket);
  }

  return query.orderBy("date", "desc").execute() as Promise<OpinionTextRow[]>;
}

/**
 * Count the number of chunks in the database.
 *
 * @param db - Open Kysely database connection
 * @returns The number of chunks
 */
export async function countChunks(db: Kysely<AppDatabase>): Promise<number> {
  return db
    .selectFrom("opinion_chunks")
    .select(({ fn }) => fn.count<number>("id").as("count"))
    .executeTakeFirstOrThrow()
    .then((result) => result.count ?? 0);
}

/**
 * Count opinions stored for a given term year.
 *
 * @param db       - Open Kysely database connection
 * @param termYear - Calendar year of the term (e.g. 2024 for OT24)
 * @returns Row count in `opinions` for that term
 */
export async function countOpinionsForTermYear(
  db: Kysely<AppDatabase>,
  termYear: number,
): Promise<number> {
  return db
    .selectFrom("opinions")
    .select(({ fn }) => fn.count<number>("id").as("count"))
    .where("term_year", "=", termYear)
    .executeTakeFirstOrThrow()
    .then((result) => Number(result.count ?? 0));
}
