/**
 * Single chat exchange detail endpoint
 *
 * Returns a full persisted query/response record (sources, stats, step breakdown)
 * for the history detail page when a sidebar item is selected.
 */

import { NextResponse } from "next/server";

import { CHAT_DB_PATH } from "@/src/constants";
import { getChatExchange, openChatDb } from "@/src/db/chatDb";
import {
  exchangeDetailQuerySchema,
  exchangeIdParamSchema,
  parseSearchParams,
} from "@/src/api/analytics";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * `GET /api/analytics/queries/[id]`
 *
 * Path param (see {@link exchangeIdParamSchema}):
 * - `id` — numeric exchange id from the list endpoint
 *
 * Query params (see {@link exchangeDetailQuerySchema}):
 * - `userId` — optional; when set, only returns the exchange if it belongs to that user
 *
 * @param req - Incoming request with optional `userId` query param
 * @param context - Route context; `params.id` is the exchange id
 * @returns JSON {@link ChatExchangeDetail}, 404 if not found, or 500 on failure
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
          { error: `Exchange not found (id: ${id})` },
          { status: 404 },
        );
      }
      return NextResponse.json(exchange);
    } finally {
      await db.destroy();
    }
  } catch (error) {
    console.error("Error in /api/analytics/queries/[id]:", error);
    return NextResponse.json(
      { error: "Failed to load chat exchange" },
      { status: 500 },
    );
  }
}
