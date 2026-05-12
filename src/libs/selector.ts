import { z } from "zod";
import { wrapOpenAI } from "langsmith/wrappers/openai";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";

export const selectorRequestSchema = z.object({
  query: z.string().min(1).describe("The raw user query"),
});

export const QUERY_TYPES = ["sql", "vector", "both", "none"] as const;

export const selectorResponseSchema = z.object({
  normalizedQuery: z.string().min(1).describe("The normalized user query"),
  isOnTopic: z
    .boolean()
    .describe(
      "Whether the query is about a U.S. Supreme Court opinion, ruling, case, justice, or related legal topic",
    ),
  queryType: z
    .enum(QUERY_TYPES)
    .describe("The type of database query needed to answer the question"),
  reason: z
    .string()
    .describe(
      "Reasoning for the on-topic determination and, if on topic, the query type selection",
    ),
});

export type SelectorResponse = z.infer<typeof selectorResponseSchema>;

const SELECTOR_MODEL = "gpt-4o-mini";

const SELECTOR_SYSTEM_PROMPT = `You are a query pre-processor and routing agent for a Supreme Court opinion research tool.

Your task has three parts:
1. Normalize the user's query:
   - Fix spelling
   - Expand obvious abbreviations (e.g. "SCOTUS" → "Supreme Court")
   - Rephrase it as a clear, concise question while preserving the original intent
2. Determine whether the normalized query is about a U.S. Supreme Court opinion, ruling, case, justice, or related legal topic.
   - When a user asks about "cases", this means Supreme Court cases.
3. If the query is on topic, decide which retrieval strategy is needed to answer it, given these data sources:
   - A SQL database with structured opinion metadata (case name, docket number, term year, decision date, opinion type, URL, full text).
   - A vector store with semantically-indexed opinion text chunks for similarity search.

   Retrieval strategies:
   - "sql"    — structured lookups, filtering, counting, or sorting (e.g. "How many opinions were decided in 2023?")
   - "vector" — semantic or conceptual search across opinion text (e.g. "What did the Court say about religious liberty?")
   - "both"   — the question requires both structured metadata and semantic text retrieval
   - "none"   — the question is not about a U.S. Supreme Court opinion, ruling, case, justice, or related legal topic

Here are some examples of queries and the appropriate retrieval strategy:
- "How many opinions were decided in 2023?": "sql"
- "What did the Court say about religious liberty?": "vector"
- "What is the most recent opinion on abortion?": "both"
- "How many cases has a U.S. attorney general brought before the Supreme Court?": "both"
- "How many cases has a U.S. president brought before the Supreme Court?": "both"
- "What is the weather in Tokyo?": "none"
- "How to bake a cake?": "none"

Respond ONLY with a JSON object matching this schema exactly (no markdown, no extra keys):
{
  "normalizedQuery": "<normalized question>",
  "isOnTopic": true | false,
  "queryType": "sql" | "vector" | "both" | "none",
  "reason": "<concise explanation of the on-topic determination and, if on topic, the chosen retrieval strategy>"
}`;

/**
 * Normalizes the user query, determines whether it is about a Supreme Court
 * opinion, and selects the appropriate retrieval strategy.
 *
 * @param query - The raw user query
 * @returns The normalized query, on-topic flag, query type, and reasoning
 */
export async function runSelector(query: string): Promise<SelectorResponse> {
  const apiKey = process.env.OPENAI_API_KEY!.trim();
  const openai = wrapOpenAI(new OpenAI({ apiKey }));

  const completion = await openai.chat.completions.create({
    model: SELECTOR_MODEL,
    temperature: 0,
    response_format: zodResponseFormat(selectorResponseSchema, "selector"),
    messages: [
      { role: "system", content: SELECTOR_SYSTEM_PROMPT },
      { role: "user", content: query },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  return selectorResponseSchema.parse(JSON.parse(raw));
}
