/**
 * Cohere reranking utilities
 *
 * Wraps Cohere's /v2/rerank endpoint to score candidate chunks against a
 * query and return only the top-N most relevant results.
 */

import { CohereClientV2 } from "cohere-ai";

import { RERANK_MODEL, RERANK_TOP_N } from "@/src/constants";
import { OpinionChunk } from "@/src/libs/opinionUtils";

/**
 * Reranks opinion chunks using Cohere's rerank API, returning the top-N most
 * relevant chunks in descending relevance order.
 *
 * @param query - The user's normalized query
 * @param chunks - Candidate chunks retrieved from vector search
 * @returns Top-N chunks ordered by Cohere relevance score
 */
export async function rerankChunks(
  query: string,
  chunks: OpinionChunk[],
): Promise<OpinionChunk[]> {
  if (chunks.length === 0) return chunks;

  const cohere = new CohereClientV2({
    token: process.env.COHERE_API_KEY!.trim(),
  });

  const response = await cohere.rerank({
    model: RERANK_MODEL,
    query,
    documents: chunks.map((c) => c.text),
    topN: RERANK_TOP_N,
  });

  return response.results.map((r) => chunks[r.index]);
}
