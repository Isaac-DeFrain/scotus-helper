/**
 * SCOTUS OPINION CHAT ENDPOINT
 *
 * This endpoint is used to chat with the SCOTUS opinion helper.
 * It uses the OpenAI API to generate a response based on the query and the context.
 * The context is the retrieved opinion chunks from Weaviate.
 */

import { wrapOpenAI } from "langsmith/wrappers/openai";
import OpenAI from "openai";
import { NextResponse, NextRequest } from "next/server";

import { DB_PATH, EMBEDDING_MODEL } from "@/src/constants";
import { openDb } from "@/src/db";
import { connectWeaviate, searchDocuments } from "@/src/libs/weaviateClient";
import { OpinionChunk } from "@/src/libs/opinionUtils";
import { selectorRequestSchema, runSelector } from "@/src/libs/selector";
import { runSqlQueryGenerator } from "@/src/libs/sqlQueryGenerator";
import { CompiledQuery } from "kysely";

const CHAT_MODEL = "gpt-4o";

/**
 * A source returned alongside chat responses, linking to the original PDF.
 */
export type Source = {
  caseName: string;
  docket: string;
  pdfUrl: string;
};

/**
 * Builds the context for the chat endpoint.
 *
 * @param chunks - The chunks to build the context from
 * @returns The context
 */
function buildContext(chunks: OpinionChunk[]): string {
  return chunks
    .map((c, i) => {
      const headerParts = [
        c.caseName,
        c.docket ? `No. ${c.docket}` : undefined,
        c.opinionType,
        c.date,
        c.justice ? `Justice: ${c.justice}` : undefined,
        typeof c.chunkIndex === "number" && typeof c.totalChunks === "number"
          ? `Chunk ${c.chunkIndex + 1}/${c.totalChunks}`
          : undefined,
      ].filter(Boolean);

      return `<SOURCE_${i + 1}>
${headerParts.join(" | ")}

${c.text}
</SOURCE_${i + 1}>`;
    })
    .join("\n\n");
}

/**
 * Chat endpoint
 *
 * Accepts a raw user query, runs it through the selector agent (normalize,
 * on-topic check, retrieval routing), fetches context via SQL and/or vector
 * search as needed, then streams a GPT-4o answer with source metadata in the
 * `X-Sources` response header.
 *
 * @param req - `{ query: string }` — the raw user question
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

    const apiKey = process.env.OPENAI_API_KEY!.trim();
    const openai = wrapOpenAI(new OpenAI({ apiKey }));

    let chunks: OpinionChunk[] = [];
    let sqlRows: Record<string, unknown>[] = [];

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

    if (queryType === "sql" || queryType === "both") {
      const { sqlQuery } = await runSqlQueryGenerator(normalizedQuery);
      const db = openDb(DB_PATH);

      try {
        sqlRows = (await db.executeQuery(CompiledQuery.raw(sqlQuery)))
          .rows as Record<string, unknown>[];
      } finally {
        await db.destroy();
      }
    }

    const chunkDockets = chunks
      .map((c) => c.docket)
      .filter(Boolean) as string[];
    const sqlDockets = sqlRows
      .map((r) => r.docket)
      .filter((d): d is string => typeof d === "string");
    const dockets = [...new Set([...chunkDockets, ...sqlDockets])];

    // Fetch the sources from the SQLite database.
    let sources: Source[] = [];
    if (dockets.length > 0) {
      const db = openDb(DB_PATH);
      try {
        const rows = await db
          .selectFrom("opinions")
          .select(["docket", "case_name", "pdf_url"])
          .where("docket", "in", dockets)
          .execute();

        sources = rows.map((r) => ({
          caseName: r.case_name,
          docket: r.docket,
          pdfUrl: r.pdf_url,
        }));
      } finally {
        await db.destroy();
      }
    }

    const vectorContext = buildContext(chunks);
    const sqlContext =
      sqlRows.length > 0
        ? `<SQL_RESULTS>\n${JSON.stringify(sqlRows, null, 2)}\n</SQL_RESULTS>`
        : "";
    const context = [vectorContext, sqlContext].filter(Boolean).join("\n\n");
    const encoder = new TextEncoder();

    const stream = await openai.chat.completions.create({
      model: CHAT_MODEL,
      stream: true,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `You are a careful legal research assistant with the goal of helping users find and understand information about U.S. Supreme Court opinions.
Use ONLY the provided sources when answering. When citing a source, NEVER use the source number (e.g. "Source 1", "Source 2", etc.), instead use the case name and docket number. If the sources are insufficient, say what is missing.`,
        },
        {
          role: "user",
          content: `${normalizedQuery}

Sources:
${context}`,
        },
      ],
    });

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
          "X-Sources": JSON.stringify(sources),
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
