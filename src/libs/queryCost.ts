/**
 * Query cost estimation for the chat pipeline.
 *
 * Pricing is approximate list-rate; update when vendor rates change.
 */

import type OpenAI from "openai";

export type QueryStep = "selector" | "embedding" | "sql" | "rerank" | "chat";

export type QueryStepCost = {
  step: QueryStep;
  label: string;
  description: string;
  costUsd: number;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  searchUnits?: number;
};

export type QueryStats = {
  costUsd: number;
  durationMs: number;
  breakdown: QueryStepCost[];
};

// USD per 1M tokens (input / output). Update when OpenAI pricing changes.
const OPENAI_PRICING = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
} as const;

// USD per rerank search unit. Update when Cohere pricing changes.
const COHERE_RERANK_COST_USD = 2 / 1000;

type OpenAIModel = keyof typeof OPENAI_PRICING;

/**
 * Converts a token count to USD at a given per-million rate.
 *
 * @param tokens - Number of tokens consumed
 * @param ratePerMillion - Price in USD per 1M tokens
 * @returns Estimated cost in USD
 */
function tokensToUsd(tokens: number, ratePerMillion: number): number {
  return (tokens / 1_000_000) * ratePerMillion;
}

/**
 * Estimates OpenAI API cost from reported token usage.
 *
 * @param model - OpenAI model whose pricing table entry to apply
 * @param usage - Token counts returned by the API, if available
 * @returns Estimated cost in USD
 */
export function costFromOpenAIUsage(
  model: OpenAIModel,
  usage: OpenAI.Completions.CompletionUsage | undefined,
): number {
  if (!usage) return 0;

  const rates = OPENAI_PRICING[model];
  return (
    tokensToUsd(usage.prompt_tokens, rates.input) +
    tokensToUsd(usage.completion_tokens, rates.output)
  );
}

/**
 * Estimates Cohere rerank cost from billed search units.
 *
 * @param searchUnits - Units reported in `meta.billed_units.search_units`
 * @returns Estimated cost in USD
 */
export function costFromRerank(searchUnits = 1): number {
  return searchUnits * COHERE_RERANK_COST_USD;
}

/**
 * Builds aggregate query stats from per-step cost records.
 *
 * @param steps - Costs for each pipeline step that ran
 * @returns Total cost and the step breakdown
 */
export function buildQueryStats(steps: QueryStepCost[]): QueryStats {
  const costUsd = steps.reduce((sum, step) => sum + step.costUsd, 0);
  const durationMs = steps.reduce((sum, step) => sum + step.durationMs, 0);
  return { costUsd, durationMs, breakdown: steps };
}

/**
 * Builds the cost record for the selector step (`gpt-4o-mini`).
 *
 * @param usage - Token usage from the selector completion
 * @returns Step cost for display and aggregation
 */
export function selectorStepCost(
  usage: OpenAI.Completions.CompletionUsage | undefined,
  durationMs: number,
): QueryStepCost {
  return {
    step: "selector",
    label: "Selector",
    description:
      "Normalizes the query, checks whether it is on topic, and chooses vector, SQL, or both retrieval paths.",
    costUsd: costFromOpenAIUsage("gpt-4o-mini", usage),
    durationMs,
    inputTokens: usage?.prompt_tokens,
    outputTokens: usage?.completion_tokens,
  };
}

/**
 * Builds the cost record for the query-embedding step (`text-embedding-3-small`).
 *
 * @param usage - Token usage from the embeddings API
 * @returns Step cost for display and aggregation
 */
export function embeddingStepCost(
  usage: { prompt_tokens?: number; total_tokens?: number } | undefined,
  durationMs: number,
): QueryStepCost {
  return {
    step: "embedding",
    label: "Embedding",
    description:
      "Embeds the query and searches Weaviate for semantically similar opinion chunks.",
    costUsd: costFromOpenAIUsage("text-embedding-3-small", {
      prompt_tokens: usage?.prompt_tokens ?? 0,
      completion_tokens: 0,
      total_tokens: usage?.total_tokens ?? usage?.prompt_tokens ?? 0,
    }),
    durationMs,
    inputTokens: usage?.prompt_tokens,
  };
}

/**
 * Builds the cost record for the SQL generator step (`gpt-4o`).
 *
 * @param usage - Token usage from the SQL generator completion
 * @returns Step cost for display and aggregation
 */
export function sqlStepCost(
  usage: OpenAI.Completions.CompletionUsage | undefined,
  durationMs: number,
): QueryStepCost {
  return {
    step: "sql",
    label: "SQL",
    description:
      "Generates SQL from the query and runs it against the opinion metadata database.",
    costUsd: costFromOpenAIUsage("gpt-4o", usage),
    durationMs,
    inputTokens: usage?.prompt_tokens,
    outputTokens: usage?.completion_tokens,
  };
}

/**
 * Builds the cost record for a Cohere rerank request.
 *
 * @param searchUnits - Billed search units from the rerank response
 * @returns Step cost for display and aggregation
 */
export function rerankStepCost(
  searchUnits: number,
  durationMs: number,
): QueryStepCost {
  return {
    step: "rerank",
    label: "Rerank",
    description:
      "Reranks retrieved context so the most relevant passages are sent to the model.",
    costUsd: costFromRerank(searchUnits),
    durationMs,
    searchUnits,
  };
}

/**
 * Builds the cost record for the final chat completion step (`gpt-4o`).
 *
 * @param usage - Token usage from the streamed chat completion
 * @returns Step cost for display and aggregation
 */
export function chatStepCost(
  usage: OpenAI.Completions.CompletionUsage | undefined,
  durationMs: number,
): QueryStepCost {
  return {
    step: "chat",
    label: "Chat",
    description:
      "Streams the final answer from GPT-4o using the retrieved sources as context.",
    costUsd: costFromOpenAIUsage("gpt-4o", usage),
    durationMs,
    inputTokens: usage?.prompt_tokens,
    outputTokens: usage?.completion_tokens,
  };
}

/**
 * Formats a USD amount for compact UI display.
 *
 * Uses three decimal places for amounts ≥ $0.001 and five for smaller values.
 *
 * @param costUsd - Cost in US dollars
 * @returns Formatted string such as `$0.012` or `$0.00012`
 */
export function formatCost(costUsd: number): string {
  if (costUsd >= 0.001) return `$${costUsd.toFixed(3)}`;
  if (costUsd > 0) return `$${costUsd.toFixed(5)}`;
  return "$0.000";
}

/**
 * Formats a duration in milliseconds for compact UI display.
 *
 * @param durationMs - Elapsed time in milliseconds
 * @returns Formatted string such as `4.2s` or `1m 04s`
 */
export function formatDuration(durationMs: number): string {
  if (durationMs < 60_000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}
