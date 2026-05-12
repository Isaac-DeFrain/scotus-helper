/**
 * SELECTOR ENDPOINT
 *
 * Normalizes the incoming query, determines whether it is about a Supreme
 * Court opinion, and decides whether answering requires a SQL query, a vector
 * (semantic) query, or both. Uses a LangSmith-wrapped gpt-4o-mini model so
 * that every call is captured in LangSmith traces alongside the main chat
 * endpoint.
 *
 * Request shape:  `selectorRequestSchema`
 * Response shape: `selectorResponseSchema`
 */

import { NextResponse, NextRequest } from "next/server";

import { selectorRequestSchema, runSelector } from "@/src/libs/selector";

/**
 * Selector endpoint
 *
 * @param req - The request object containing the raw user query
 * @returns The normalizedQuery, isOnTopic, queryType, and reason
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { query } = selectorRequestSchema.parse(body);
    const parsed = await runSelector(query);
    return NextResponse.json(parsed);
  } catch (error) {
    console.error("Error in /api/selector:", error);
    return NextResponse.json(
      { error: "Failed to process query" },
      { status: 500 },
    );
  }
}
