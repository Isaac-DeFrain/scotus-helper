/**
 * SCOTUS OPINION CHAT ENDPOINT
 *
 * This endpoint is used to chat with the SCOTUS opinion helper.
 * It uses the OpenAI API to generate a response based on the query and the context.
 * The context is the retrieved opinion chunks from Weaviate.
 */

import { NextResponse, NextRequest } from "next/server";

import { DB_PATH, EMBEDDING_MODEL } from "@/src/constants";
import { openReadOnlyDb } from "@/src/db";
import { connectWeaviate, searchDocuments } from "@/src/libs/weaviateClient";
import { OpinionChunk } from "@/src/libs/opinionUtils";
import { selectorRequestSchema, runSelector } from "@/src/libs/selector";
import {
  runSqlQueryGenerator,
  validateAndParseSqlQuery,
} from "@/src/libs/sqlQueryGenerator";
import { buildContext, getSources } from "@/src/libs/chat";
import { openaiClient } from "@/src/libs/openai";
import { rerank } from "@/src/libs/cohereRerank";

const CHAT_MODEL = "gpt-4o";

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
    const body = await req.json();
    const { query } = selectorRequestSchema.parse(body);
    const { normalizedQuery, isOnTopic, queryType, reason } =
      await runSelector(query);

    if (!isOnTopic) {
      return NextResponse.json(
        { error: `Query is not on topic: ${reason}` },
        { status: 400 },
      );
    }

    const openai = openaiClient();
    let chunks: OpinionChunk[] = [];
    let sqlRows: Record<string, unknown>[] = [];

    // Vector search
    if (queryType === "vector" || queryType === "both") {
      const client = await connectWeaviate();
      try {
        const queryEmbedding = await openai.embeddings.create({
          model: EMBEDDING_MODEL,
          input: normalizedQuery,
        });

        const queryVector = queryEmbedding.data[0]?.embedding;
        if (!queryVector) {
          return NextResponse.json(
            { error: "Failed to embed query" },
            { status: 500 },
          );
        }

        chunks = await searchDocuments(client, queryVector);
      } finally {
        await client.close();
      }
    }

    // SQL search
    if (queryType === "sql" || queryType === "both") {
      const { sqlQuery } = await runSqlQueryGenerator(normalizedQuery);
      const db = openReadOnlyDb(DB_PATH);

      try {
        const compiledQuery = validateAndParseSqlQuery(sqlQuery);
        const result = await db.executeQuery(compiledQuery);
        sqlRows = result.rows as Record<string, unknown>[];
      } finally {
        await db.destroy();
      }
    }

    // Fetch the sources from the SQLite database and build the context
    const sources = await getSources(
      chunks,
      sqlRows as Extract<typeof sqlRows, { case_name: string }>[],
    );
    const vectorContext = buildContext(chunks);
    const sqlContext =
      sqlRows.length > 0
        ? `<SQL_RESULTS>\n${JSON.stringify(sqlRows, null, 2)}\n</SQL_RESULTS>`
        : "";
    const documents = [vectorContext, sqlContext].filter(Boolean);
    const context = await rerank(normalizedQuery, documents);

    // Stream the response
    const stream = await openai.chat.completions.create({
      model: CHAT_MODEL,
      stream: true,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `Use ONLY the provided sources when answering the user's question and provide your reasoning.

You are a careful legal research assistant with the goal of helping users find and understand information about U.S. Supreme Court opinions.

When citing a source, NEVER use the source number (e.g. "Source 1", "Source 2", etc.), instead use the case name and docket number. If the sources are insufficient, say what is missing.`,
        },
        {
          role: "user",
          content: `${normalizedQuery}

Sources:
${context}`,
        },
      ],
    });

    const encoder = new TextEncoder();
    return new NextResponse(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            for await (const event of stream) {
              const token = event.choices[0]?.delta?.content ?? "";
              if (token) controller.enqueue(encoder.encode(token));
            }
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
