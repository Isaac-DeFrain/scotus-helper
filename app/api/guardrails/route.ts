/**
 * GUARDRAILS ENDPOINT
 *
 * Normalizes the incoming query and determines whether it is about a
 * Supreme Court opinion. Uses a LangSmith-wrapped gpt-4o-mini model so
 * that every call is captured in LangSmith traces alongside the main
 * chat endpoint.
 *
 * Response shape:
 *   { normalizedQuery: string; isOnTopic: boolean }
 */

import { wrapOpenAI } from "langsmith/wrappers/openai";
import OpenAI from "openai";
import { NextResponse, NextRequest } from "next/server";
import { z } from "zod";

const GUARDRAILS_MODEL = "gpt-4o-mini";

const guardrailsRequestSchema = z.object({
  query: z.string().min(1),
});

export const guardrailsResponseSchema = z.object({
  normalizedQuery: z.string(),
  isOnTopic: z.boolean(),
});

const SYSTEM_PROMPT = `You are a query pre-processor for a Supreme Court opinion research tool.

Your task has two parts:
1. Normalize the user's query: fix spelling, expand obvious abbreviations (e.g. "SCOTUS" → "Supreme Court"), and rephrase it as a clear, concise question while preserving the original intent.
2. Determine whether the normalized query is about a U.S. Supreme Court opinion, ruling, case, justice, or related legal topic.

Respond ONLY with a JSON object matching this schema exactly (no markdown, no extra keys):
{
  "normalizedQuery": "<normalized question>",
  "isOnTopic": true | false
}`;

/**
 * Guardrails endpoint
 *
 * @param req - The request object
 * @returns The normalized query and whether it is on topic
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { query } = guardrailsRequestSchema.parse(body);
    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY" },
        { status: 500 },
      );
    }

    const openai = wrapOpenAI(new OpenAI({ apiKey }));

    const completion = await openai.chat.completions.create({
      model: GUARDRAILS_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: query },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = z
      .object({
        normalizedQuery: z.string(),
        isOnTopic: z.boolean(),
      })
      .parse(JSON.parse(raw));

    return NextResponse.json(parsed);
  } catch (error) {
    console.error("Error in /api/guardrails:", error);
    return NextResponse.json(
      { error: "Failed to process query" },
      { status: 500 },
    );
  }
}
