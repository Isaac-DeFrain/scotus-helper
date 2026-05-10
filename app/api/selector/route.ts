/**
 * SELECTOR ENDPOINT
 *
 * Given a normalized, on-topic user query and a system prompt, determines
 * whether answering the question requires a SQL query, a vector (semantic)
 * query, or both. Uses a LangSmith-wrapped gpt-4o-mini model so that every
 * call is captured in LangSmith traces alongside the main chat endpoint.
 *
 * Request shape: `SelectorRequestSchema`
 * Response shape: `SelectorResponseSchema`
 */

import { NextResponse, NextRequest } from "next/server";

import { selectorRequestSchema, runSelector } from "@/src/libs/selector";

/**
 * Selector endpoint
 *
 * @param req - The request object containing the normalized query
 * @returns The queryType: "sql", "vector", or "both"
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { normalizedQuery } = selectorRequestSchema.parse(body);
    const parsed = await runSelector(normalizedQuery);
    return NextResponse.json(parsed);
  } catch (error) {
    console.error("Error in /api/selector:", error);
    return NextResponse.json(
      { error: "Failed to determine query type" },
      { status: 500 },
    );
  }
}
