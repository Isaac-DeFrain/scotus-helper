import { z } from "zod";
import { wrapOpenAI } from "langsmith/wrappers/openai";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";

export const selectorRequestSchema = z.object({
  normalizedQuery: z
    .string()
    .min(1)
    .describe("The normalized, on-topic user query"),
});

export const QUERY_TYPES = ["sql", "vector", "both"] as const;

export const selectorResponseSchema = z.object({
  queryType: z
    .enum(QUERY_TYPES)
    .describe("The type of query to use to answer the question")
    .default("vector"),
  reason: z
    .string()
    .describe("Reason why the query type is needed to answer the question"),
});

export type SelectorResponse = z.infer<typeof selectorResponseSchema>;

const SELECTOR_MODEL = "gpt-4o-mini";

const SELECTOR_SYSTEM_PROMPT = `You are a query-routing agent for a Supreme Court opinion research tool.

You will receive a normalized user question and the system prompt that describes the available data sources:
- A SQL database containing structured opinion metadata (case name, docket number, term year, decision date, opinion type, URL, full text).
- A vector store containing semantically-indexed opinion text chunks for similarity search.

Decide which retrieval strategy is needed to answer the question:
- "sql"    — structured lookups, filtering, counting, or sorting (e.g. "How many opinions were decided in 2023?")
- "vector" — semantic or conceptual search across opinion text (e.g. "What did the Court say about religious liberty?")
- "both"   — the question requires both structured metadata and semantic text retrieval

Respond ONLY with a JSON object matching this schema exactly (no markdown, no extra keys):
{
  "queryType": "sql" | "vector" | "both",
  "reason": "<concise explanation of why the query type is needed to answer the question>"
}`;

/**
 * Determines the retrieval strategy for a normalized query.
 *
 * @param normalizedQuery - The normalized, on-topic user query
 * @returns The queryType and reason
 */
export async function runSelector(
  normalizedQuery: string,
): Promise<SelectorResponse> {
  const apiKey = process.env.OPENAI_API_KEY!.trim();
  const openai = wrapOpenAI(new OpenAI({ apiKey }));

  const completion = await openai.chat.completions.create({
    model: SELECTOR_MODEL,
    temperature: 0,
    response_format: zodResponseFormat(selectorResponseSchema, "selector"),
    messages: [
      { role: "system", content: SELECTOR_SYSTEM_PROMPT },
      { role: "user", content: normalizedQuery },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  return selectorResponseSchema.parse(JSON.parse(raw));
}
