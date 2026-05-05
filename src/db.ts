/**
 * SCOTUS Opinion Helper
 *
 * Database schema for storing SCOTUS opinions and their chunks.
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
    date: string;
    docket: string;
    case_name: string;
    justice: string;
    citation: string;
    pdf_url: string;
    text: string;
    created_at: ColumnType<string, string | undefined, never>;
}

/**
 * Opinion chunks table schema
 */
export interface OpinionChunksTable {
    id: string;
    opinion_id: number;
    docket: string;
    chunk_index: number;
    total_chunks: number;
    content: string;
    embedding: string;
    start_char: number;
    end_char: number;
    created_at: ColumnType<string, string | undefined, never>;
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
const DDL = `
  CREATE TABLE IF NOT EXISTS opinions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    opinion_number INTEGER,
    opinion_type   TEXT    NOT NULL,
    term_year      INTEGER NOT NULL,
    date           TEXT    NOT NULL,
    docket         TEXT    NOT NULL UNIQUE,
    case_name      TEXT    NOT NULL,
    justice        TEXT    NOT NULL,
    citation       TEXT    NOT NULL,
    pdf_url        TEXT    NOT NULL,
    text           TEXT    NOT NULL,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS opinion_chunks (
    id           TEXT    PRIMARY KEY,
    opinion_id   INTEGER NOT NULL REFERENCES opinions(id),
    docket       TEXT    NOT NULL,
    chunk_index  INTEGER NOT NULL,
    total_chunks INTEGER NOT NULL,
    content      TEXT    NOT NULL,
    embedding    TEXT    NOT NULL,
    start_char   INTEGER NOT NULL,
    end_char     INTEGER NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
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
    date: string;
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
 * @param dbPath - The path to the database file
 * @returns A Kysely database connection
 */
export function openDb(dbPath: string): Kysely<AppDatabase> {
    console.debug("Opening database connection to:", dbPath);

    if (!fs.existsSync(dbPath)) {
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
