/**
 * Cohere reranking utilities
 *
 * Wraps Cohere's /v2/rerank endpoint to score candidate chunks against a
 * query and return only the top-N most relevant results.
 */

import { CohereClientV2 } from "cohere-ai";

const RERANK_MODEL = "rerank-v3.5";
const RERANK_TOP_N = 10;

/**
 * Reranks opinion chunks using Cohere's rerank API, returning the top-N most
 * relevant chunks in descending relevance order.
 *
 * @param query - The user's normalized query
 * @param chunks - Candidate chunks retrieved from vector search
 * @returns Top-N chunks ordered by Cohere relevance score
 */
export async function rerank(
  query: string,
  documents: string[],
): Promise<string[]> {
  if (documents.length === 0) return documents;

  const cohereApiKey = process.env.COHERE_API_KEY?.trim();
  if (!cohereApiKey) {
    throw new Error("COHERE_API_KEY is not set");
  }

  const cohere = new CohereClientV2({
    token: cohereApiKey,
  });
  const response = await cohere.rerank({
    model: RERANK_MODEL,
    query,
    documents,
    topN: RERANK_TOP_N,
  });

  return response.results.map((r) => documents[r.index]);
}
