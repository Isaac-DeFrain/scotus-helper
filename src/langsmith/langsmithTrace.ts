/**
 * LangSmith trace loading for analytics
 *
 * Read-side companion to {@link ./langsmithTracing.ts}: that module *writes*
 * traces during `/api/chat`; this one *reads* them back for the exchange detail
 * page and `/api/analytics/queries/[id]/trace`.
 *
 * Flow:
 * 1. `fetchLangSmithTrace(traceId)` loads the root run plus all child runs.
 * 2. `runToNode` maps LangSmith's `Run` schema into our `TraceRunNode` tree.
 * 3. `buildStepRunUrls` walks descendants and links each pipeline step to its
 *    LangSmith UI URL (via metadata written by {@link langsmithCallOptions}).
 *
 * Requires `LANGSMITH_API_KEY`. When the key is missing or the trace cannot be
 * loaded, callers receive `null` trace data and a human-readable reason.
 */

import { Client } from "langsmith/client";
import type { Run } from "langsmith/schemas";

import type { LangSmithTraceResult, TraceRunNode } from "../chat/analytics";
import type { QueryStep } from "../queryCost";

/** Re-exported for API routes and UI components that consume trace payloads. */
export type { LangSmithTraceResult, TraceRunNode };

/** Pipeline steps that may appear as LangSmith child runs under a chat trace. */
const QUERY_STEPS: QueryStep[] = [
  "selector",
  "embedding",
  "sql",
  "summary",
  "rerank",
  "chat",
];

function isQueryStep(value: string): value is QueryStep {
  return QUERY_STEPS.includes(value as QueryStep);
}

/**
 * Normalizes LangSmith timestamps to ISO strings for JSON responses.
 *
 * LangSmith may return epoch ms (number) or an ISO string depending on SDK version.
 */
function formatRunTime(value: number | string | undefined): string | null {
  if (value === undefined) return null;
  if (typeof value === "string") return value;
  return new Date(value).toISOString();
}

/** Wall-clock duration between run start and end, or null when either is missing. */
function runLatencyMs(run: Run): number | null {
  const { start_time: start, end_time: end } = run;
  if (start == null || end == null) return null;

  const startMs = typeof start === "number" ? start : Date.parse(start);
  const endMs = typeof end === "number" ? end : Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;

  return Math.max(0, Math.round(endMs - startMs));
}

/**
 * Recursively maps a LangSmith `Run` into our analytics-friendly tree shape.
 *
 * Child runs are included so the UI can expand the full pipeline hierarchy
 * (root chain → selector/sql/chat LLM runs, etc.).
 */
function runToNode(run: Run): TraceRunNode {
  return {
    id: run.id,
    traceId: run.trace_id ?? run.id,
    name: run.name,
    runType: run.run_type,
    status: run.status ?? "unknown",
    startTime: formatRunTime(run.start_time),
    endTime: formatRunTime(run.end_time),
    latencyMs: runLatencyMs(run),
    totalTokens: run.total_tokens ?? null,
    promptTokens: run.prompt_tokens ?? null,
    completionTokens: run.completion_tokens ?? null,
    error: run.error ?? null,
    inputs: run.inputs,
    outputs: run.outputs,
    childRuns: (run.child_runs ?? []).map(runToNode),
  };
}

/**
 * Resolves which pipeline step a LangSmith run belongs to.
 *
 * Lookup order:
 * 1. `extra.metadata.step` — set by {@link langsmithCallOptions} on wrapped OpenAI calls.
 * 2. `run.name` — fallback when the run was named directly after the step.
 *
 * Returns null for framework runs (e.g. bare `ChatOpenAI`) that are not tagged.
 */
export function stepFromRun(run: Run): QueryStep | null {
  const metadata = run.extra?.metadata;
  if (metadata && typeof metadata === "object" && "step" in metadata) {
    const step = metadata.step;
    if (typeof step === "string" && isQueryStep(step)) return step;
  }

  if (isQueryStep(run.name)) return run.name;
  return null;
}

/** Depth-first walk over a run tree, visiting every node including the root. */
function walkRuns(run: Run, visitor: (run: Run) => void): void {
  visitor(run);
  for (const child of run.child_runs ?? []) {
    walkRuns(child, visitor);
  }
}

/**
 * Builds LangSmith UI links for each pipeline step in a trace.
 *
 * Skips the root run (the outer `chat` chain) and only indexes descendants.
 * A step may map to multiple URLs when it ran more than once (e.g. summary
 * batches or retried LLM calls).
 */
async function buildStepRunUrls(
  client: Client,
  root: Run,
): Promise<Partial<Record<QueryStep, string[]>>> {
  const runs: Run[] = [];
  walkRuns(root, (run) => {
    if (run.id !== root.id) runs.push(run);
  });

  const stepRunUrls: Partial<Record<QueryStep, string[]>> = {};
  for (const run of runs) {
    const step = stepFromRun(run);
    if (!step) continue;

    try {
      const url = await client.getRunUrl({ run });
      const urls = stepRunUrls[step] ?? [];

      urls.push(url);
      stepRunUrls[step] = urls;
    } catch (error) {
      // One bad URL must not fail the entire trace response.
      console.error(`Failed to build LangSmith URL for ${step} run:`, error);
    }
  }

  return stepRunUrls;
}

/**
 * Loads a trace tree from LangSmith by root trace id.
 *
 * The id is the value stored on `chat_queries.langsmith_trace_id` and sent in
 * `X-LangSmith-Trace-Id` during streaming. Never throws — failures are
 * returned as `unavailableReason` so the analytics API can respond with 200.
 *
 * @param traceId - Root trace id from a completed chat exchange
 * @returns Trace tree, UI URLs, and an optional unavailable reason
 */
export async function fetchLangSmithTrace(
  traceId: string,
): Promise<LangSmithTraceResult> {
  if (!process.env.LANGSMITH_API_KEY?.trim()) {
    return {
      trace: null,
      traceUrl: null,
      stepRunUrls: {},
      unavailableReason: "LangSmith API key is not configured.",
    };
  }

  try {
    const client = new Client();
    const run = await client.readRun(traceId, { loadChildRuns: true });
    const traceUrl = await client.getRunUrl({ run });
    const stepRunUrls = await buildStepRunUrls(client, run);

    return {
      trace: runToNode(run),
      traceUrl,
      stepRunUrls,
      unavailableReason: null,
    };
  } catch (error) {
    console.error("Failed to fetch LangSmith trace:", error);
    return {
      trace: null,
      traceUrl: null,
      stepRunUrls: {},
      unavailableReason: "Trace could not be loaded from LangSmith.",
    };
  }
}
