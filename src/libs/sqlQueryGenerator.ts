import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";

import { DDL } from "../db";
import { CompiledQuery } from "kysely";
import { openaiClient } from "./openai";

export const sqlQueryGeneratorRequestSchema = z.object({
  normalizedQuery: z
    .string()
    .min(1)
    .describe("The normalized, on-topic user query that requires a SQL lookup"),
});

export const sqlQueryGeneratorResponseSchema = z.object({
  sqlQuery: z.string().describe("SQL query that answers the user's question"),
  reason: z
    .string()
    .describe("Reason why the SQL query is needed to answer the question"),
});

export type SqlQueryGeneratorResponse = z.infer<
  typeof sqlQueryGeneratorResponseSchema
>;

const SQL_QUERY_GENERATOR_MODEL = "gpt-4o";

const SYSTEM_PROMPT = `You are a SQL query-generation agent for a Supreme Court opinion research tool.

You have access to a SQLite database with the following schema:

\`\`\`sql
${DDL}
\`\`\`

To answer the user's question, generate a valid SQL query against the above database schema.

The query should ONLY ever read data from the database, i.e. it should ONLY ever be a SELECT statement.

If the question is about a specific date, make sure to use the \`date\` field (in seconds since Unix epoch) to filter the results.

Respond ONLY with a JSON object matching this schema exactly (no markdown, no extra keys):
{
  "sqlQuery": "<SQL query expression string>",
  "reason": "<concise explanation of why the SQL query is needed to answer the question>"
}`;

/**
 * Generates a SQL query for a normalized user question.
 *
 * @param normalizedQuery - The normalized, on-topic user query
 * @returns The generated SQL query and a brief explanation
 */
export async function runSqlQueryGenerator(
  normalizedQuery: string,
): Promise<SqlQueryGeneratorResponse> {
  const openai = openaiClient();
  const completion = await openai.chat.completions.create({
    model: SQL_QUERY_GENERATOR_MODEL,
    temperature: 0,
    response_format: zodResponseFormat(
      sqlQueryGeneratorResponseSchema,
      "sql_query_generator",
    ),
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: normalizedQuery },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  return sqlQueryGeneratorResponseSchema.parse(JSON.parse(raw));
}

/**
 * Validates and parses a raw SQL query into a compiled query.
 *
 * @param rawSqlQuery - The raw SQL query to validate and parse
 * @returns The compiled query
 */
export function validateAndParseSqlQuery(rawSqlQuery: string) {
  // Query must be a SELECT statement
  const sqlQuery = rawSqlQuery.trim();
  if (!sqlQuery.startsWith("SELECT")) {
    throw new Error("SQL query must start with SELECT");
  }

  // Query must not contain UPDATE, INSERT, DELETE, or PRAGMA statements
  const invalidKeywords = ["UPDATE", "INSERT", "DELETE", "PRAGMA"];
  if (invalidKeywords.some((keyword) => sqlQuery.includes(keyword))) {
    throw new Error(
      `SQL query must not contain ${invalidKeywords.join(", ")} statements`,
    );
  }

  try {
    return CompiledQuery.raw(sqlQuery);
  } catch (error) {
    throw new Error(`Invalid SQL query: ${sqlQuery}`, { cause: error });
  }
}
