/**
 * Cohere reranking utilities
 *
 * Wraps Cohere's /v2/rerank endpoint to score candidate chunks against a
 * query and return only the top-N most relevant results.
 */

import { CohereClientV2 } from "cohere-ai";

import { splitSourceDocuments } from "./chat";

const RERANK_MODEL = "rerank-v3.5";
const RERANK_TOP_N = 10;

const TIMEOUT_SECONDS = 30;
const MAX_RETRIES = 1;
const HEADERS = { "X-Custom-Header": "value" };

export type RerankResult = {
  results: string[];
  documentCount: number;
  searchUnits: number;
};

/**
 * Reranks tagged source documents using Cohere's rerank API, returning the
 * top-N most relevant documents in descending relevance order.
 *
 * Input documents are split on `<SOURCE_#>` and `<SQL_RESULTS>` tags before
 * reranking so each source block is scored independently.
 *
 * @param query - The user's normalized query
 * @param documents - Tagged context blocks from vector and/or SQL retrieval
 * @returns Top-N documents ordered by Cohere relevance score
 */
export async function rerank(
  query: string,
  documents: string[],
): Promise<RerankResult> {
  console.debug("Rerank query:", query);

  // No documents to rerank, return empty results.
  if (documents.length === 0) {
    return debugReturn("Rerank documents:", {
      results: [],
      documentCount: 0,
      searchUnits: 0,
    });
  }

  // Expand tagged documents into individual source documents.
  const taggedDocuments = expandTaggedDocuments(documents);
  if (taggedDocuments.length <= 1) {
    return debugReturn("Rerank documents:", {
      results: taggedDocuments,
      documentCount: taggedDocuments.length,
      searchUnits: 0,
    });
  }

  const abortController = new AbortController();

  // Call the Cohere rerank API.
  const cohereApiKey = process.env.COHERE_API_KEY?.trim();
  if (!cohereApiKey) {
    throw new Error("COHERE_API_KEY is not set");
  }

  const cohere = new CohereClientV2({
    token: cohereApiKey,
  });
  const response = await cohere.rerank(
    {
      model: RERANK_MODEL,
      query,
      documents: taggedDocuments,
      topN: RERANK_TOP_N,
    },
    {
      timeoutInSeconds: TIMEOUT_SECONDS,
      maxRetries: MAX_RETRIES,
      abortSignal: abortController.signal,
      headers: HEADERS,
    },
  );

  console.log("Rerank response:", Object.keys(response));
  return debugReturn("Rerank results:", {
    results: response.results.map((r) => taggedDocuments[r.index]),
    documentCount: response.results.length,
    searchUnits: response.meta?.billedUnits?.searchUnits ?? 1,
  });
}

// Debug helper to log the rerank results.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function debugReturn(message: string, data: any) {
  console.debug(message, JSON.stringify(data, null, 2));
  return data;
}

// Expand tagged documents into individual source documents.
function expandTaggedDocuments(documents: string[]): string[] {
  return documents.flatMap((document) => {
    const split = splitSourceDocuments(document);
    return split.length > 0 ? split : [document];
  });
}
