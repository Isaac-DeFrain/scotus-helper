/**
 * SCOTUS Opinion Helper
 *
 * Database schema for storing SCOTUS opinions and their chunks.
 */

import BetterSqlite3 from "better-sqlite3";
import { ColumnType, Generated, Kysely, SqliteDialect } from "kysely";

export type OpinionType = "merits" | "orders" | "in-chambers";

export interface OpinionsTable {
    id: Generated<number>;
    opinion_number: number | null;
    opinion_type: OpinionType | null;
    term_year: number | null;
    date: string | null;
    docket: string;
    case_name: string | null;
    justice: string | null;
    citation: string | null;
    pdf_url: string | null;
    text: string | null;
    created_at: ColumnType<string, string | undefined, never>;
}

export interface OpinionChunksTable {
    id: string;
    opinion_id: number | null;
    docket: string | null;
    chunk_index: number | null;
    total_chunks: number | null;
    content: string | null;
    embedding: string | null;
    start_char: number | null;
    end_char: number | null;
    created_at: ColumnType<string, string | undefined, never>;
}

export interface AppDatabase {
    opinions: OpinionsTable;
    opinion_chunks: OpinionChunksTable;
}

const DDL = `
  CREATE TABLE IF NOT EXISTS opinions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    opinion_number INTEGER,
    opinion_type   TEXT,
    term_year      INTEGER,
    date           TEXT,
    docket         TEXT UNIQUE,
    case_name      TEXT,
    justice        TEXT,
    citation       TEXT,
    pdf_url        TEXT,
    text           TEXT,
    created_at     TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS opinion_chunks (
    id           TEXT PRIMARY KEY,
    opinion_id   INTEGER REFERENCES opinions(id),
    docket       TEXT,
    chunk_index  INTEGER,
    total_chunks INTEGER,
    content      TEXT,
    embedding    TEXT,
    start_char   INTEGER,
    end_char     INTEGER,
    created_at   TEXT DEFAULT (datetime('now'))
  );
`;

export function openDb(dbPath: string): Kysely<AppDatabase> {
    const sqlite = new BetterSqlite3(dbPath);
    sqlite.exec(DDL);

    return new Kysely<AppDatabase>({
        dialect: new SqliteDialect({ database: sqlite }),
    });
}
