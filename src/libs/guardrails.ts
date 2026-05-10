import { z } from "zod";
import { wrapOpenAI } from "langsmith/wrappers/openai";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";

export const guardrailsRequestSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe("The user query to normalize and check if it is on topic"),
});

export const guardrailsAgentResponseSchema = z.object({
  normalizedQuery: z.string().min(1).describe("The normalized user query"),
  isOnTopic: z
    .boolean()
    .describe("Whether the normalized user query is on topic"),
  reason: z
    .string()
    .describe("Reason why the normalized user query is on topic or not"),
});

export const guardrailsResponseSchema = z.object({
  normalizedQuery: z.string().min(1),
});

type GuardrailsAgentResponse = z.infer<typeof guardrailsAgentResponseSchema>;

const GUARDRAILS_MODEL = "gpt-4o-mini";

const GUARDRAILS_SYSTEM_PROMPT = `You are a query pre-processor for a Supreme Court opinion research tool.

Your task has two parts:
1. Normalize the user's query: fix spelling, expand obvious abbreviations (e.g. "SCOTUS" → "Supreme Court"), and rephrase it as a clear, concise question while preserving the original intent.
2. Determine whether the normalized query is about a U.S. Supreme Court opinion, ruling, case, justice, or related legal topic.

Respond ONLY with a JSON object matching this schema exactly (no markdown, no extra keys):
{
  "normalizedQuery": "<normalized question>",
  "isOnTopic": true | false,
  "reason": "<concise explanation of why the normalized query is on topic or not>"
}`;

/**
 * Normalizes the query and determines whether it is about a Supreme Court opinion.
 *
 * @param query - The raw user query
 * @returns The normalized query, whether it is on topic, and the reason
 */
export async function runGuardrails(
  query: string,
): Promise<GuardrailsAgentResponse> {
  const apiKey = process.env.OPENAI_API_KEY!.trim();
  const openai = wrapOpenAI(new OpenAI({ apiKey }));

  const completion = await openai.chat.completions.create({
    model: GUARDRAILS_MODEL,
    temperature: 0,
    response_format: zodResponseFormat(guardrailsAgentResponseSchema, "guardrails"),
    messages: [
      { role: "system", content: GUARDRAILS_SYSTEM_PROMPT },
      { role: "user", content: query },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  return guardrailsAgentResponseSchema.parse(JSON.parse(raw));
}
