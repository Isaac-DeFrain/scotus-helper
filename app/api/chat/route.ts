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

import {
  DB_PATH,
  EMBEDDING_MODEL,
  WEAVIATE_COLLECTION_NAME,
} from "@/src/constants";
import { openDb } from "@/src/db";
import { connectWeaviate } from "@/src/libs/weaviateClient";
import { OpinionChunk } from "@/src/libs/opinionUtils";
import {
  POST as guardrails,
  guardrailsResponseSchema,
} from "@/app/api/guardrails/route";

const CHAT_MODEL = "gpt-4o-mini";

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
 * @param req - The request object
 * @returns The response object
 */
export async function POST(req: NextRequest) {
  try {
    const guardrailsResponse = await guardrails(req);
    const { normalizedQuery, isOnTopic } = guardrailsResponseSchema.parse(
      await guardrailsResponse.json(),
    );

    if (!isOnTopic) {
      return NextResponse.json(
        {
          error:
            "Query is not on topic. Please ask a question about U.S. Supreme Court opinions, rulings, cases, justices, or related legal topics.",
        },
        { status: 400 },
      );
    }

    const apiKey = process.env.OPENAI_API_KEY!.trim();
    const openai = wrapOpenAI(new OpenAI({ apiKey }));
    const client = await connectWeaviate();

    let chunks: OpinionChunk[] = [];

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

      const collection = client.collections.get<OpinionChunk>(
        WEAVIATE_COLLECTION_NAME,
      );

      const result = await collection.query.nearVector(queryVector, {
        limit: 8,
        returnProperties: [
          "text",
          "docket",
          "caseName",
          "opinionType",
          "date",
          "justice",
          "termYear",
          "chunkIndex",
          "totalChunks",
        ],
      });

      chunks = result.objects.map((o) => o.properties).filter(hasNonEmptyText);
    } finally {
      await client.close();
    }

    const dockets = [
      ...new Set(chunks.map((c) => c.docket).filter(Boolean) as string[]),
    ];

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

    const context = buildContext(chunks);
    const encoder = new TextEncoder();

    const stream = await openai.chat.completions.create({
      model: CHAT_MODEL,
      stream: true,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `You are a careful legal research assistant with the goal of helping users find information about U.S. Supreme Court opinions.
			Use ONLY the provided sources when answering. If the sources are insufficient, say what is missing.`,
        },
        {
          role: "user",
          content: `My question about the U.S. Supreme Court is: "${normalizedQuery}"

			Sources:
			${context}`,
        },
      ],
    });

    return new Response(
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

function hasNonEmptyText(p: OpinionChunk): boolean {
  return p.text.trim().length > 0;
}
