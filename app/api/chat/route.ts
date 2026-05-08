import OpenAI from "openai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { WEAVIATE_COLLECTION_NAME } from "@/src/constants";
import { connectWeaviate } from "@/src/libs/weaviateClient";

const requestSchema = z.object({
  query: z.string().min(1),
});

type WeaviateObject<TProperties extends Record<string, unknown>> = {
  properties: TProperties;
};

type NearVectorResult<TProperties extends Record<string, unknown>> = {
  objects: Array<WeaviateObject<TProperties>>;
};

type OpinionChunk = {
  text: string;
  docket?: string;
  caseName?: string;
  date?: string;
  justice?: string;
  opinionType?: string;
  termYear?: number;
  chunkIndex?: number;
  totalChunks?: number;
};

function hasNonEmptyText(
  p: Record<string, unknown>,
): p is Record<string, unknown> & { text: string } {
  return typeof p.text === "string" && p.text.trim().length > 0;
}

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

export async function POST(req: Request) {
  try {
    const { query } = requestSchema.parse(await req.json());

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY" },
        { status: 500 },
      );
    }

    const openai = new OpenAI({ apiKey });
    const client = await connectWeaviate();

    let chunks: OpinionChunk[] = [];

    try {
      const embedding = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: query,
      });

      const vector = embedding.data[0]?.embedding;
      if (!vector) {
        return NextResponse.json(
          { error: "Failed to embed query" },
          { status: 500 },
        );
      }

      const collection = client.collections.get(
        WEAVIATE_COLLECTION_NAME,
      ) as unknown as {
        query: {
          nearVector: (
            vector: number[],
            options: {
              limit: number;
              returnProperties: string[];
            },
          ) => Promise<NearVectorResult<Record<string, unknown>>>;
        };
      };

      const result = await collection.query.nearVector(vector, {
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

      const objects = result.objects;

      chunks = objects
        .map((o) => o.properties)
        .filter(hasNonEmptyText)
        .map((p) => ({
          text: p.text,
          docket: typeof p.docket === "string" ? p.docket : undefined,
          caseName: typeof p.caseName === "string" ? p.caseName : undefined,
          date: typeof p.date === "string" ? p.date : undefined,
          justice: typeof p.justice === "string" ? p.justice : undefined,
          opinionType:
            typeof p.opinionType === "string" ? p.opinionType : undefined,
          termYear: typeof p.termYear === "number" ? p.termYear : undefined,
          chunkIndex:
            typeof p.chunkIndex === "number" ? p.chunkIndex : undefined,
          totalChunks:
            typeof p.totalChunks === "number" ? p.totalChunks : undefined,
        }));
    } finally {
      await client.close();
    }

    const context = buildContext(chunks);
    const encoder = new TextEncoder();

    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      stream: true,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are a careful legal research assistant. Use only the provided sources when answering. If the sources are insufficient, say what is missing.",
        },
        {
          role: "user",
          content: `Question: ${query}

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
