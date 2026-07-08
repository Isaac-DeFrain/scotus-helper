/**
 * LangSmith tracing helpers for the `/api/chat` pipeline.
 *
 * OpenAI calls are wrapped with `wrapOpenAI` in {@link ./openai.ts}.
 * Each wrapped call creates its own LangSmith run. This module adds a *root*
 * trace per chat request so selector, SQL, summary, and chat LLM runs appear
 * as children of one trace in the LangSmith UI, and exposes the root trace id
 * to clients (`X-LangSmith-Trace-Id`) and analytics (`chat_queries.langsmith_trace_id`).
 *
 * Tracing is controlled by LangSmith env vars (`LANGSMITH_TRACING`, etc.). When
 * tracing is off, runs are not sent to LangSmith but ids may still be generated
 * locally by the SDK.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import { traceable } from "langsmith/traceable";
import type { RunTree } from "langsmith";
import type { NextResponse } from "next/server";

import type { QueryStep } from "../queryCost";

/** Response header carrying the root LangSmith trace id for a chat request. */
export const LANGSMITH_TRACE_ID_HEADER = "X-LangSmith-Trace-Id";

type ChatTraceContext = {
  queryId: number;
};

/**
 * Holds the local `chat_queries.id` for the in-flight `/api/chat` request.
 *
 * Used so {@link langsmithCallOptions} can tag nested LLM runs without passing
 * `queryId` through every pipeline function signature. LangSmith's own run tree
 * uses a separate async-local store managed by `traceable`.
 */
const chatTraceContext = new AsyncLocalStorage<ChatTraceContext>();

/**
 * Optional second-argument options for `wrapOpenAI` completion calls.
 *
 * Spread into `openai.chat.completions.create(params, langsmithCallOptions("selector"))`
 * from selector, SQL generator, case summarizer, and chat. No-op outside a
 * {@link runWithLangSmithTrace} call (e.g. standalone `/api/selector`).
 *
 * @param step - Pipeline step name stored on the LangSmith run for history links
 */
export function langsmithCallOptions(step?: QueryStep): {
  langsmithExtra?: {
    name?: string;
    metadata: Record<string, string | number>;
  };
} {
  const ctx = chatTraceContext.getStore();
  if (!ctx) return {};

  return {
    langsmithExtra: {
      ...(step ? { name: step } : {}),
      metadata: {
        queryId: ctx.queryId,
        ...(step ? { step } : {}),
      },
    },
  };
}

/**
 * Runs `fn` inside a root LangSmith trace for one chat request.
 *
 * Nested `wrapOpenAI` calls made while `fn` executes become child runs because
 * `traceable` installs the root run in LangSmith's async-local context. The
 * returned `traceId` is the root trace id (same as the root run id for a new
 * trace); use it to open the full run tree in LangSmith or correlate with
 * `chat.db` via {@link persistLangSmithTraceId}.
 *
 * @param config.name         - Root run name shown in LangSmith (e.g. `"chat"`)
 * @param config.queryId      - Local analytics id; stored on root metadata and child runs
 * @param config.userId       - Optional client id stored on root metadata
 * @param config.onTraceStart - Called as soon as the root run is created; use to persist trace id
 * @param fn                  - The chat pipeline (selector → retrieval → stream)
 * @returns The pipeline result and root trace id (null if the SDK did not create a run)
 */
export async function runWithLangSmithTrace<T>(
  config: {
    name: string;
    queryId: number;
    userId?: string | null;
    onTraceStart?: (traceId: string) => void | Promise<void>;
  },
  fn: () => Promise<T>,
): Promise<{ result: T; traceId: string | null }> {
  let traceId: string | null = null;

  const traced = traceable(
    // chatTraceContext must wrap fn *inside* traceable so both stores are active.
    () => chatTraceContext.run({ queryId: config.queryId }, fn),
    {
      name: config.name,
      run_type: "chain",
      metadata: {
        queryId: config.queryId,
        ...(config.userId ? { userId: config.userId } : {}),
      },
      on_start: (runTree: RunTree | undefined) => {
        // Prefer trace_id so callers get the id shared by all runs in the tree.
        traceId = runTree?.trace_id ?? runTree?.id ?? null;

        if (traceId && config.onTraceStart) {
          // Fire-and-forget: persistence must not block the pipeline.
          void Promise.resolve(config.onTraceStart(traceId)).catch((error) => {
            console.error("Failed to handle LangSmith trace start:", error);
          });
        }
      },
    },
  );

  const result = (await traced()) as T;
  return { result, traceId };
}

/**
 * Sets {@link LANGSMITH_TRACE_ID_HEADER} on a chat HTTP response when tracing produced an id.
 */
export function withLangSmithTraceHeader(
  response: NextResponse,
  traceId: string | null,
): NextResponse {
  if (traceId) {
    response.headers.set(LANGSMITH_TRACE_ID_HEADER, traceId);
  }

  return response;
}
