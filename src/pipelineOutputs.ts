/**
 * Collects and sanitizes per-step pipeline outputs for chat.db persistence.
 *
 * Each `/api/chat` request runs several steps (selector, embedding, SQL, etc.).
 * This module defines the JSON shapes stored in `chat_step_costs.output`, trims
 * oversized fields so rows stay bounded, and provides helpers to serialize and
 * parse those values when reading analytics.
 */

import type { OpinionChunk } from "./opinion";
import type { QueryStep } from "./queryCost";
import type { CaseSummaryResult } from "./caseSummarizer";
import type { SelectorRunResult } from "./api/selector";
import type { SqlQueryGeneratorRunResult } from "./api/sqlQueryGenerator";
import type { RerankedDocument } from "./rerank";

/** Max length for individual string fields (opinion text, summaries, rerank snippets). */
const MAX_FIELD_CHARS = 2_000;

/** Max length for the full chat user prompt (includes all source context). */
const MAX_PROMPT_CHARS = 50_000;

/** Stored output from the selector LLM call. */
export type SelectorStepOutput = SelectorRunResult["response"];

/** Stored output from the SQL generator LLM call and query execution. */
export type SqlStepOutput = {
  sqlQuery: string;
  reason: string;
  rowCount: number;
  rows: Record<string, unknown>[];
};

/** Stored output from parallel case-summary LLM calls. */
export type SummaryStepOutput = {
  summaries: Pick<CaseSummaryResult, "caseName" | "summary">[];
};

/** Stored output from the final chat LLM call (prompt + streamed answer). */
export type ChatStepOutput = {
  model: string;
  userPrompt: string;
  response: string;
};

/** Stored metadata from the embedding + vector search step. */
export type EmbeddingStepOutput = {
  model: string;
  chunkCount: number;
  chunks: Pick<
    OpinionChunk,
    "caseName" | "docket" | "chunkIndex" | "totalChunks"
  >[];
};

/** Stored metadata from the Cohere rerank step. */
export type RerankStepOutput = {
  documentCount: number;
  resultCount: number;
  results: RerankedDocument[];
};

/**
 * Map of pipeline step name to its persisted output.
 *
 * Keys align with {@link QueryStep}; only steps that ran are present.
 */
export type StepOutputs = Partial<{
  selector: SelectorStepOutput;
  embedding: EmbeddingStepOutput;
  sql: SqlStepOutput;
  summary: SummaryStepOutput;
  rerank: RerankStepOutput;
  chat: ChatStepOutput;
}>;

/**
 * Accumulates step outputs as the chat pipeline runs.
 *
 * The chat route adds entries after each step completes, then passes a
 * {@link snapshot} to {@link persistChatResponse} on success, error, or
 * stream interruption.
 */
export class PipelineOutputCollector {
  private outputs: StepOutputs = {};

  /** Records output for a completed pipeline step. */
  set<K extends QueryStep>(step: K, output: StepOutputs[K]): void {
    this.outputs[step] = output;
  }

  /** Returns a shallow copy safe to pass into persistence helpers. */
  snapshot(): StepOutputs {
    return { ...this.outputs };
  }
}

/** Truncates long strings, appending an ellipsis when clipped. */
function truncateString(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen).trimEnd()}…`;
}

/** Column names whose string values are truncated before SQL row snapshots are stored. */
const BULK_TEXT_FIELDS = new Set(["text", "content", "embedding", "summary"]);

/**
 * Truncates large string fields before persisting SQL row snapshots.
 *
 * Opinion text and embeddings can be very large; only metadata-sized excerpts
 * are kept so `chat_step_costs.output` stays within reasonable bounds.
 *
 * @param rows - Raw rows returned from the read-only opinions database
 */
export function sanitizeSqlRows(
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  return rows.map((row) => {
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "string" && BULK_TEXT_FIELDS.has(key)) {
        sanitized[key] = truncateString(value, MAX_FIELD_CHARS);
        continue;
      }

      sanitized[key] = value;
    }

    return sanitized;
  });
}

/**
 * Builds the SQL step output from the generator response and executed rows.
 *
 * @param sqlResponse - Parsed LLM response containing the generated query
 * @param sqlRows     - Rows returned after executing that query
 */
export function buildSqlStepOutput(
  sqlResponse: SqlQueryGeneratorRunResult["response"],
  sqlRows: Record<string, unknown>[],
): SqlStepOutput {
  return {
    sqlQuery: sqlResponse.sqlQuery,
    reason: sqlResponse.reason,
    rowCount: sqlRows.length,
    rows: sanitizeSqlRows(sqlRows),
  };
}

/**
 * Builds the embedding step output from retrieved opinion chunks.
 *
 * Stores chunk identity metadata only — not full chunk text.
 *
 * @param model  - Embedding model name (e.g. `text-embedding-3-small`)
 * @param chunks - Opinion chunks returned by Weaviate vector search
 */
export function buildEmbeddingStepOutput(
  model: string,
  chunks: OpinionChunk[],
): EmbeddingStepOutput {
  return {
    model,
    chunkCount: chunks.length,
    chunks: chunks.map((chunk) => ({
      caseName: chunk.caseName,
      docket: chunk.docket,
      chunkIndex: chunk.chunkIndex,
      totalChunks: chunk.totalChunks,
    })),
  };
}

/**
 * Builds the summary step output from parallel case summarizer results.
 *
 * @param results - One summary per case from {@link summarizeCases}
 */
export function buildSummaryStepOutput(
  results: CaseSummaryResult[],
): SummaryStepOutput {
  return {
    summaries: results.map(({ caseName, summary }) => ({
      caseName,
      summary: truncateString(summary, MAX_FIELD_CHARS),
    })),
  };
}

/**
 * Builds the chat step output from the model prompt and streamed answer.
 *
 * The user prompt includes all reranked source context and is capped at
 * {@link MAX_PROMPT_CHARS}; the streamed response is stored in full.
 *
 * @param model      - Chat model name (e.g. `gpt-4o`)
 * @param userPrompt - Final prompt sent to the chat completion API
 * @param response   - Assembled assistant reply from the stream
 */
export function buildChatStepOutput(
  model: string,
  userPrompt: string,
  response: string,
): ChatStepOutput {
  return {
    model,
    userPrompt: truncateString(userPrompt, MAX_PROMPT_CHARS),
    response,
  };
}

/**
 * Builds the rerank step output, truncating each reranked document snippet.
 *
 * @param documentCount - Number of documents submitted to rerank
 * @param results       - Reranked documents with Cohere relevance scores
 */
export function buildRerankStepOutput(
  documentCount: number,
  results: RerankedDocument[],
): RerankStepOutput {
  return {
    documentCount,
    resultCount: results.length,
    results: results.map(({ document, score }) => ({
      document: truncateString(document, MAX_FIELD_CHARS),
      score,
    })),
  };
}

/**
 * Serializes a step output value for SQLite storage.
 *
 * @param output - Any JSON-serializable step output object
 */
export function serializeStepOutput(output: unknown): string {
  return JSON.stringify(output);
}

/**
 * Parses a step output column back into a JavaScript value.
 *
 * Returns `undefined` for null/empty columns. Falls back to the raw string
 * when the stored value is not valid JSON (legacy or corrupted rows).
 *
 * @param raw - Value from `chat_step_costs.output`
 */
export function parseStepOutput(raw: string | null): unknown | undefined {
  if (!raw) return undefined;

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}
