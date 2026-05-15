import { DB_PATH } from "../constants";
import { openDb } from "../db";
import { OpinionChunk } from "./opinionUtils";
import { formatDate } from "./utils";

/**
 * A source returned alongside chat responses, linking to the original PDF
 */
export type Source = {
  caseName: string;
  docket: string;
  pdfUrl: string;
};

function formatSourceHeader(chunk: OpinionChunk, index: number): string {
  const headerParts = [
    chunk.caseName,
    chunk.docket ? `No. ${chunk.docket}` : undefined,
    chunk.opinionType,
    formatDate(chunk.date),
    `Justice: ${chunk.justice}`,
    `Chunk ${chunk.chunkIndex + 1}/${chunk.totalChunks}`,
  ].filter(Boolean);

  return `<SOURCE_${index + 1}>
${headerParts.join(" | ")}

${chunk.text}
</SOURCE_${index + 1}>`;
}

/**
 * Builds the context for the chat agent
 *
 * @param chunks - The chunks to build the context from
 * @returns The context
 */
export function buildContext(chunks: OpinionChunk[]): string {
  return chunks.map(formatSourceHeader).join("\n\n");
}

/**
 * Fetch the sources from the SQLite database
 *
 * @param dockets - The dockets to fetch the sources for
 * @returns The sources
 */
export async function getSources(dockets: string[]): Promise<Source[]> {
  let sources: Source[] = [];
  if (dockets.length > 0) {
    const db = openDb(DB_PATH);
    try {
      const rows = await db
        .selectFrom("opinions")
        .select(["docket", "case_name", "pdf_url"])
        .where("docket", "in", dockets)
        .execute();

      sources = rows.map((r) => ({
        caseName: r.case_name,
        docket: r.docket,
        pdfUrl: r.pdf_url,
      }));
    } finally {
      await db.destroy();
    }
  }

  return sources;
}
