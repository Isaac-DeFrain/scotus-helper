/**
 * SCOTUS OPINION CHAT ENDPOINT
 *
 * This endpoint is used to chat with the SCOTUS opinion helper.
 * It uses the OpenAI API to generate a response based on the query and the context.
 * The context is the retrieved opinion chunks from Weaviate.
 */

import { NextResponse, NextRequest } from "next/server";
import type OpenAI from "openai";

import { DB_PATH, EMBEDDING_MODEL } from "@/src/constants";
import { openReadOnlyDb } from "@/src/db";
import { connectWeaviate, searchDocuments } from "@/src/libs/weaviateClient";
import { OpinionChunk, toOpinionChunk } from "@/src/libs/opinionUtils";
import { selectorRequestSchema, runSelector } from "@/src/libs/selector";
import {
  runSqlQueryGenerator,
  validateAndParseSqlQuery,
} from "@/src/libs/sqlQueryGenerator";
import {
  buildVectorContext,
  buildSqlContext,
  getSources,
} from "@/src/libs/chat";
import { openaiClient } from "@/src/libs/openai";
import { rerank } from "@/src/libs/rerank";
import {
  buildQueryStats,
  chatStepCost,
  embeddingStepCost,
  rerankStepCost,
  selectorStepCost,
  sqlStepCost,
  type QueryStepCost,
} from "@/src/libs/queryCost";
import { encodeQueryStats } from "@/src/libs/utils";

const CHAT_MODEL = "gpt-4o";
const SYSTEM_PROMPT = `
You are a careful legal research assistant with the goal of helping users find and understand information about U.S. Supreme Court opinions.

Use ONLY the provided sources when answering the user's question and provide your reasoning.

NEVER comment on a date being in the future or about a case being outside the scope of your current data.

When citing a source, NEVER use the source number (e.g. "Source 1", "Source 2", etc.), instead use the case name and/or docket number.

Current date: ${new Date().toDateString()}
`;

/**
 * Chat endpoint
 *
 * Accepts a raw user query, runs it through the selector agent (normalize,
 * on-topic check, retrieval routing), fetches context via SQL and/or vector
 * search as needed, then streams a GPT-4o answer with source metadata in the
 * `X-Sources` response header.
 *
 * @param req - {@link selectorRequestSchema} - the raw user question
 * @returns A streaming plain-text response, or a JSON error on bad input
 */
export async function POST(req: NextRequest) {
  try {
    const stepCosts: QueryStepCost[] = [];

    const body = await req.json();
    const { query } = selectorRequestSchema.parse(body);

    // Run the selector
    const selectorStartedAt = performance.now();
    const { response: selectorResponse, usage: selectorUsage } =
      await runSelector(query);
    stepCosts.push(
      selectorStepCost(selectorUsage, performance.now() - selectorStartedAt),
    );

    const { normalizedQuery, isOnTopic, isSummary, queryType, dateRange } =
      selectorResponse;

    if (!isOnTopic) {
      return NextResponse.json(
        { error: `Query is not on topic: ${selectorResponse.reason}` },
        { status: 400 },
      );
    }

    const openai = openaiClient();

    // Vector search
    let chunks: OpinionChunk[] = [];

    if (queryType === "vector" || queryType === "both") {
      const vectorStartedAt = performance.now();
      const client = await connectWeaviate();
      try {
        const embedding = await openai.embeddings.create({
          model: EMBEDDING_MODEL,
          input: normalizedQuery,
        });

        const queryVector = embedding.data[0]?.embedding;
        if (!queryVector) {
          return NextResponse.json(
            { error: "Failed to embed query" },
            { status: 500 },
          );
        }

        chunks = await searchDocuments(client, queryVector);
        stepCosts.push(
          embeddingStepCost(
            embedding.usage,
            performance.now() - vectorStartedAt,
          ),
        );
      } finally {
        await client.close();
      }
    }

    // SQL search
    let sqlRows: Record<string, unknown>[] = [];

    if (queryType === "sql" || queryType === "both") {
      const sqlStartedAt = performance.now();
      const { response: sqlResponse, usage: sqlUsage } =
        await runSqlQueryGenerator(normalizedQuery);
      const db = openReadOnlyDb(DB_PATH);

      try {
        const compiledQuery = validateAndParseSqlQuery(sqlResponse.sqlQuery);
        const result = await db.executeQuery(compiledQuery);
        sqlRows = result.rows as Record<string, unknown>[];

        // get chunks for the sql results if no vector chunks are used and text is not in the sql results
        if (chunks.length === 0 && !isSummary && !hasText(sqlRows)) {
          console.debug("Fetching chunks for SQL results");

          const sqlChunksQuery = db
            .selectFrom("opinion_chunks")
            .selectAll()
            .where(
              "case_name",
              "in",
              sqlRows.map((r) => r.case_name as string),
            );

          if (dateRange) {
            sqlChunksQuery
              .where("date", ">=", dateRange[0].getUTCDate())
              .where("date", "<=", dateRange[1].getUTCDate());
          }

          const sqlChunks = await sqlChunksQuery.execute();
          chunks = sqlChunks.map(toOpinionChunk);
        }
      } finally {
        await db.destroy();
      }

      stepCosts.push(sqlStepCost(sqlUsage, performance.now() - sqlStartedAt));
    }

    // Fetch the sources from the SQLite database
    const sources = await getSources(
      chunks,
      sqlRows as Extract<typeof sqlRows, { case_name: string }>[],
    );

    // Rerank and build the context
    const vectorContext = buildVectorContext(chunks);
    const sqlContext = buildSqlContext(sqlRows);
    const rerankStartedAt = performance.now();
    const rerankResult = await rerank(
      normalizedQuery,
      [vectorContext, sqlContext].filter(Boolean),
    );

    if (rerankResult.documentCount > 0) {
      stepCosts.push(
        rerankStepCost(
          rerankResult.searchUnits,
          performance.now() - rerankStartedAt,
        ),
      );
    }

    const context = rerankResult.results;

    // Stream the response
    const chatStartedAt = performance.now();
    const stream = await openai.chat.completions.create({
      model: CHAT_MODEL,
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: userPrompt(normalizedQuery, context),
        },
      ],
    });

    const encoder = new TextEncoder();
    return new NextResponse(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            let chatUsage: OpenAI.Completions.CompletionUsage | undefined;

            for await (const event of stream) {
              if (event.usage) chatUsage = event.usage;

              const token = event.choices[0]?.delta?.content ?? "";
              if (token) controller.enqueue(encoder.encode(token));
            }

            stepCosts.push(
              chatStepCost(chatUsage, performance.now() - chatStartedAt),
            );
            const stats = buildQueryStats(stepCosts);

            controller.enqueue(encoder.encode(encodeQueryStats(stats)));
          } catch (err) {
            console.error("Streaming error:", err);
            controller.enqueue(encoder.encode("\n\n[Stream interrupted]\n"));
          } finally {
            controller.close();
          }
        },
      }),
      {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Sources": Buffer.from(JSON.stringify(sources)).toString("base64"),
        },
      },
    );
  } catch (error) {
    console.error("Error in /api/chat:", error);
    return NextResponse.json(
      { error: "Failed to process query" },
      { status: 500 },
    );
  }
}

function userPrompt(normalizedQuery: string, context: string[]): string {
  return `
  ${normalizedQuery}

  Sources:
  ${context.join("\n\n")}
  `;
}

function hasText(sqlRows: Record<string, unknown>[]): boolean {
  return sqlRows.length > 0 && "text" in sqlRows[0];
}
