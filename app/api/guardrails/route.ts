/**
 * GUARDRAILS ENDPOINT
 *
 * Normalizes the incoming query and determines whether it is about a
 * Supreme Court opinion. Uses a LangSmith-wrapped gpt-4o-mini model so
 * that every call is captured in LangSmith traces alongside the main
 * chat endpoint.
 *
 * Request shape: `GuardrailsRequestSchema`
 * Response shape: `GuardrailsResponseSchema`
 */

import { NextResponse, NextRequest } from "next/server";

import { guardrailsRequestSchema, runGuardrails } from "@/src/libs/guardrails";

/**
 * Guardrails endpoint
 *
 * @param req - The request object
 * @returns The normalized query if it is on topic, otherwise an error
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { query } = guardrailsRequestSchema.parse(body);
    const { normalizedQuery, isOnTopic, reason } = await runGuardrails(query);

    if (!isOnTopic) {
      return NextResponse.json(
        { error: `Query is not on topic: ${reason}` },
        { status: 400 },
      );
    }

    return NextResponse.json({ normalizedQuery });
  } catch (error) {
    console.error("Error in /api/guardrails:", error);
    return NextResponse.json(
      { error: "Failed to process query" },
      { status: 500 },
    );
  }
}
