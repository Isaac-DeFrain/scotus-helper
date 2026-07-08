/**
 * Recursive UI for a LangSmith trace tree on the exchange detail page.
 *
 * Consumes {@link TraceRunNode} data from `/api/analytics/queries/[id]/trace`
 * and renders each run as a collapsible row with latency, token usage, and
 * serialized inputs/outputs. Child runs mirror LangSmith's nested span hierarchy.
 */

"use client";

import styles from "./history.module.css";
import type { TraceRunNode } from "@/src/chat/analytics";
import { formatDuration } from "@/src/queryCost";

/** Pretty-print LangSmith payloads; fall back to String when JSON serialization fails. */
function formatJson(value: unknown): string {
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** One node in the trace tree; renders itself and recurses into `childRuns`. */
function RunNode({ run, depth }: { run: TraceRunNode; depth: number }) {
  // Prefer aggregate token count; some runs only report prompt/completion separately.
  const tokenSummary =
    run.totalTokens != null
      ? `${run.totalTokens} tokens`
      : run.promptTokens != null || run.completionTokens != null
        ? `${run.promptTokens ?? 0} in / ${run.completionTokens ?? 0} out`
        : null;

  return (
    <details
      className={[styles.traceRun, depth > 0 ? styles.traceRunNested : ""].join(
        " ",
      )}
      // Keep the root span open; nested spans start collapsed to limit noise.
      open={depth === 0}
    >
      <summary className={styles.traceRunSummary}>
        <span className={styles.traceRunName}>{run.name}</span>
        <span className={styles.traceRunMeta}>
          {run.runType}
          {run.latencyMs != null && (
            <>
              {" · "}
              {formatDuration(run.latencyMs)}
            </>
          )}
          {tokenSummary && (
            <>
              {" · "}
              {tokenSummary}
            </>
          )}
          {/* "success" and "unknown" are the normal cases; surface failures inline. */}
          {run.status !== "success" && run.status !== "unknown" && (
            <>
              {" · "}
              <span className={styles.traceRunStatus}>{run.status}</span>
            </>
          )}
        </span>
      </summary>

      <div className={styles.traceRunBody}>
        {run.error && <p className={styles.traceRunError}>{run.error}</p>}

        {run.inputs !== undefined && run.inputs !== null && (
          <details className={styles.traceBlock}>
            <summary className={styles.traceBlockSummary}>Inputs</summary>
            <pre className={styles.tracePre}>{formatJson(run.inputs)}</pre>
          </details>
        )}

        {run.outputs !== undefined && run.outputs !== null && (
          // Auto-expand outputs for the root span and its direct children.
          <details className={styles.traceBlock} open={depth < 2}>
            <summary className={styles.traceBlockSummary}>Outputs</summary>
            <pre className={styles.tracePre}>{formatJson(run.outputs)}</pre>
          </details>
        )}

        {run.childRuns.map((child) => (
          <RunNode key={child.id} run={child} depth={depth + 1} />
        ))}
      </div>
    </details>
  );
}

export function LangSmithRunTree({ trace }: { trace: TraceRunNode }) {
  // `trace` is the root run returned by LangSmith (`loadChildRuns: true`).
  return (
    <div className={styles.traceTree}>
      <RunNode run={trace} depth={0} />
    </div>
  );
}
