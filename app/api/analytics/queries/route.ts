/**
 * Paginated chat-exchange list endpoint
 *
 * Returns persisted query/response pairs with cost and duration metadata.
 * Used by the history sidebar to browse past exchanges.
 */

import { NextResponse } from "next/server";

import { CHAT_DB_PATH } from "@/src/constants";
import { listChatExchanges, openChatDb } from "@/src/db/chatDb";
import {
  listExchangesQuerySchema,
  parseSearchParams,
} from "@/src/api/analytics";

/**
 * `GET /api/analytics/queries`
 *
 * Query params (see {@link listExchangesQuerySchema}):
 * - `userId` — scope results to one client; omit for all users
 * - `since`, `until` — optional Unix-epoch-second bounds on `created_at`
 * - `limit` — page size (1–200, default 50)
 * - `offset` — number of rows to skip (default 0)
 *
 * @param req - Incoming request with optional filter and pagination params
 * @returns JSON {@link ListExchangesResult} or 500 on failure
 */
export async function GET(req: Request) {
  try {
    const params = parseSearchParams(new URL(req.url).searchParams);
    const options = listExchangesQuerySchema.parse(params);

    const db = openChatDb(CHAT_DB_PATH);
    try {
      const result = await listChatExchanges(db, options);
      return NextResponse.json(result);
    } finally {
      await db.destroy();
    }
  } catch (error) {
    console.error("Error in /api/analytics/queries:", error);
    return NextResponse.json(
      { error: "Failed to load chat exchanges" },
      { status: 500 },
    );
  }
}
