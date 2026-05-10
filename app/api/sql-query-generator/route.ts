/**
 * SQL QUERY GENERATOR ENDPOINT
 *
 * Takes a normalized, on-topic user query and generates the appropriate
 * type-safe Kysely query builder code using the database DDL as context.
 * Uses a LangSmith-wrapped gpt-4o model so that every call is captured in
 * LangSmith traces alongside the main chat endpoint.
 *
 * Request shape: `SqlQueryGeneratorRequestSchema`
 * Response shape: `SqlQueryGeneratorResponseSchema`
 */

import { NextResponse, NextRequest } from "next/server";

import {
  sqlQueryGeneratorRequestSchema,
  runSqlQueryGenerator,
} from "@/src/libs/sqlQueryGenerator";

/**
 * SQL query generator endpoint
 *
 * @param req - The request object containing the normalized query
 * @returns The generated Kysely query code and a brief explanation
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { normalizedQuery } = sqlQueryGeneratorRequestSchema.parse(body);
    const parsed = await runSqlQueryGenerator(normalizedQuery);
    return NextResponse.json(parsed);
  } catch (error) {
    console.error("Error in /api/sql-query-generator:", error);
    return NextResponse.json(
      { error: "Failed to generate SQL query" },
      { status: 500 },
    );
  }
}
