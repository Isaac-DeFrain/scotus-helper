/**
 * Analytics summary endpoint
 *
 * Returns aggregate cost, duration, and per-step totals for persisted chat
 * exchanges. Used by the history sidebar header ("N queries · time · cost").
 */

import { NextResponse } from "next/server";

import { CHAT_DB_PATH } from "@/src/constants";
import { getAnalyticsSummary, openChatDb } from "@/src/db/chatDb";
import { analyticsFilterSchema, parseSearchParams } from "@/src/api/analytics";

/**
 * `GET /api/analytics/summary`
 *
 * Query params (see {@link analyticsFilterSchema}):
 * - `userId` — scope totals to one client; omit for all users
 * - `since`, `until` — optional Unix-epoch-second bounds on `created_at`
 *
 * @param req - Incoming request with optional filter query params
 * @returns JSON {@link AnalyticsSummary} or 500 on failure
 */
export async function GET(req: Request) {
  try {
    const params = parseSearchParams(new URL(req.url).searchParams);
    const filter = analyticsFilterSchema.parse(params);

    const db = openChatDb(CHAT_DB_PATH);
    try {
      const summary = await getAnalyticsSummary(db, filter);
      return NextResponse.json(summary);
    } finally {
      await db.destroy();
    }
  } catch (error) {
    console.error("Error in /api/analytics/summary:", error);
    return NextResponse.json(
      { error: "Failed to load analytics summary" },
      { status: 500 },
    );
  }
}
