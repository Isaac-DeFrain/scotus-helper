import { z } from "zod";
import { wrapOpenAI } from "langsmith/wrappers/openai";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";

import { DDL } from "@/src/db";

export const sqlQueryGeneratorRequestSchema = z.object({
  normalizedQuery: z
    .string()
    .min(1)
    .describe("The normalized, on-topic user query that requires a SQL lookup"),
});

export const sqlQueryGeneratorResponseSchema = z.object({
  kyselyQuery: z
    .string()
    .describe(
      "Type-safe Kysely query builder code (TypeScript) that answers the question",
    ),
  reason: z
    .string()
    .describe("Reason why the SQL query is needed to answer the question"),
});

export type SqlQueryGeneratorResponse = z.infer<
  typeof sqlQueryGeneratorResponseSchema
>;

const SQL_QUERY_GENERATOR_MODEL = "gpt-4o";

const SYSTEM_PROMPT = `You are a SQL query-generation agent for a Supreme Court opinion research tool.

You have access to a SQLite database via the Kysely type-safe query builder. The database schema is:

\`\`\`sql
${DDL}
\`\`\`

The corresponding TypeScript interfaces used with Kysely are:

\`\`\`typescript
interface OpinionsTable {
  id: Generated<number>;
  opinion_number: number | null;
  opinion_type: "majority" | "concurrence" | "dissent" | "per_curiam" | "orders";
  term_year: number;
  date: string;           // ISO date string, e.g. "2023-06-30"
  docket: string;         // UNIQUE, e.g. "22-1008"
  case_name: string;
  justice: string;
  citation: string;
  pdf_url: string;
  text: string;
  created_at: string;
}

interface OpinionChunksTable {
  id: Generated<number>;
  docket: string;
  chunk_index: number;
  total_chunks: number;
  content: string;
  embedding: string;      // JSON-serialized number[]
  start_char: number;
  end_char: number;
  case_name: string;
  opinion_type: string;
  date: string;
  justice: string;
  term_year: number;
  created_at: string;
}

interface AppDatabase {
  opinions: OpinionsTable;
  opinion_chunks: OpinionChunksTable;
}
\`\`\`

Given the user's question, generate a type-safe Kysely query using \`db\` as the pre-existing \`Kysely<AppDatabase>\` instance. Return only the query expression — no imports, no variable declarations for \`db\`, and no \`await\` — so the caller can \`await\` it directly.

Respond ONLY with a JSON object matching this schema exactly (no markdown, no extra keys):
{
  "kyselyQuery": "<Kysely query expression string>",
  "reason": "<concise explanation of why the SQL query is needed to answer the question>"
}`;

/**
 * Generates a type-safe Kysely query for a normalized user question.
 *
 * @param normalizedQuery - The normalized, on-topic user query
 * @returns The generated Kysely query code and a brief explanation
 */
export async function runSqlQueryGenerator(
  normalizedQuery: string,
): Promise<SqlQueryGeneratorResponse> {
  const apiKey = process.env.OPENAI_API_KEY!.trim();
  const openai = wrapOpenAI(new OpenAI({ apiKey }));

  const completion = await openai.chat.completions.create({
    model: SQL_QUERY_GENERATOR_MODEL,
    temperature: 0,
    response_format: zodResponseFormat(sqlQueryGeneratorResponseSchema, "sql_query_generator"),
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: normalizedQuery },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  return sqlQueryGeneratorResponseSchema.parse(JSON.parse(raw));
}
