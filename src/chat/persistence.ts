/**
 * Safe wrappers for writing chat analytics to {@link CHAT_DB_PATH}.
 *
 * Used by `/api/chat` so persistence failures never fail the user-facing
 * request. Each helper opens its own connection, logs errors, and always
 * closes the database in `finally`.
 */

import { CHAT_DB_PATH } from "@/src/constants";
import {
  insertChatQuery,
  insertChatResponse,
  openChatDb,
  updateChatQueryLangsmithTraceId,
  updateChatQueryNormalized,
  type InsertChatResponseInput,
} from "@/src/db/chatDb";

/**
 * Inserts the raw user message at the start of a chat request.
 *
 * @param content - Unmodified text from the client
 * @param userId  - Optional client id; stored as `null` when omitted
 * @returns The new `chat_queries.id`, or `null` on failure
 */
export async function persistChatQuery(
  content: string,
  userId?: string | null,
): Promise<number | null> {
  const db = openChatDb(CHAT_DB_PATH);

  try {
    return await insertChatQuery(db, { content, userId });
  } catch (error) {
    console.error("Failed to persist chat query:", error);
    return null;
  } finally {
    await db.destroy();
  }
}

/**
 * Stores the selector-normalized query on an existing query row.
 *
 * Called after the selector agent runs. When `userId` is provided, the update
 * is scoped to that user; otherwise any row with the given id is updated.
 *
 * @param queryId         - `chat_queries.id` from {@link persistChatQuery}
 * @param normalizedQuery - Text returned by the selector agent
 * @param userId          - Optional client id for row-level scoping
 */
export async function persistNormalizedQuery(
  queryId: number,
  normalizedQuery: string,
  userId?: string | null,
): Promise<void> {
  const db = openChatDb(CHAT_DB_PATH);

  try {
    await updateChatQueryNormalized(db, queryId, normalizedQuery, userId);
  } catch (error) {
    console.error("Failed to update normalized query:", error);
  } finally {
    await db.destroy();
  }
}

/**
 * Stores the root LangSmith trace id for a chat request.
 *
 * @param queryId - `chat_queries.id` from {@link persistChatQuery}
 * @param traceId - Root LangSmith trace id returned by the tracing wrapper
 * @param userId  - Optional client id for row-level scoping
 */
export async function persistLangSmithTraceId(
  queryId: number,
  traceId: string,
  userId?: string | null,
): Promise<void> {
  const db = openChatDb(CHAT_DB_PATH);

  try {
    await updateChatQueryLangsmithTraceId(db, queryId, traceId, userId);
  } catch (error) {
    console.error("Failed to persist LangSmith trace id:", error);
  } finally {
    await db.destroy();
  }
}

/**
 * Inserts an assistant response and its per-step cost breakdown.
 *
 * @param input - Response content, stats, sources, status, and optional step outputs
 */
export async function persistChatResponse(
  input: InsertChatResponseInput,
): Promise<void> {
  const db = openChatDb(CHAT_DB_PATH);

  try {
    await insertChatResponse(db, input);
  } catch (error) {
    console.error("Failed to persist chat response:", error);
  } finally {
    await db.destroy();
  }
}
