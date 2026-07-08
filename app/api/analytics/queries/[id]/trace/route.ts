/**
 * LangSmith trace endpoint for a single chat exchange
 *
 * Loads the persisted `langsmithTraceId` for an exchange, then fetches the
 * full run tree from LangSmith for the history detail page (run tree + step URLs).
 */

import { NextResponse } from "next/server";

import { CHAT_DB_PATH } from "@/src/constants";
import { getChatExchange, openChatDb } from "@/src/db/chatDb";
import {
  exchangeDetailQuerySchema,
  exchangeIdParamSchema,
  parseSearchParams,
} from "@/src/api/analytics";
import { fetchLangSmithTrace } from "@/src/langsmith/langsmithTrace";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * `GET /api/analytics/queries/[id]/trace`
 *
 * Path param (see {@link exchangeIdParamSchema}):
 * - `id` — numeric exchange id from the list endpoint
 *
 * Query params (see {@link exchangeDetailQuerySchema}):
 * - `userId` — optional; when set, only returns the trace if the exchange belongs to that user
 *
 * @param req - Incoming request with optional `userId` query param
 * @param context - Route context; `params.id` is the exchange id
 * @returns JSON {@link LangSmithTraceResult}, 404 if the exchange is not found, or 500 on failure.
 *   When the exchange exists but has no trace id, returns 200 with `trace: null` and `unavailableReason`.
 */
export async function GET(req: Request, context: RouteContext) {
  try {
    const rawParams = await context.params;
    const { id } = exchangeIdParamSchema.parse(rawParams);
    const { userId } = exchangeDetailQuerySchema.parse(
      parseSearchParams(new URL(req.url).searchParams),
    );

    const db = openChatDb(CHAT_DB_PATH);
    try {
      const exchange = await getChatExchange(db, id, userId);
      if (!exchange) {
        return NextResponse.json(
          { error: "Exchange not found" },
          { status: 404 },
        );
      }

      if (!exchange.langsmithTraceId) {
        return NextResponse.json({
          trace: null,
          traceUrl: null,
          stepRunUrls: {},
          unavailableReason: "No LangSmith trace was recorded for this query.",
        });
      }

      const result = await fetchLangSmithTrace(exchange.langsmithTraceId);
      return NextResponse.json(result);
    } finally {
      await db.destroy();
    }
  } catch (error) {
    console.error("Error in /api/analytics/queries/[id]/trace:", error);
    return NextResponse.json(
      { error: "Failed to load LangSmith trace" },
      { status: 500 },
    );
  }
}
