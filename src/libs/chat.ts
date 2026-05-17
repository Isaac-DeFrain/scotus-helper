import { DB_PATH } from "../constants";
import { openReadOnlyDb } from "../db";
import { OpinionChunk } from "./opinionUtils";
import { formatDate } from "./utils";

/**
 * A source returned alongside chat responses, linking to the original PDF
 */
export type Source = {
  caseName: string;
  docket?: string;
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
 * Builds the vector context for the chat agent
 *
 * @param chunks - The chunks to build the context from
 * @returns The context
 */
export function buildVectorContext(chunks: OpinionChunk[]): string {
  return chunks.map(formatSourceHeader).join("\n\n");
}

/**
 * Builds the SQL context for the chat agent
 *
 * @param sqlRows - The SQL rows to build the context from
 * @returns The context
 */
export function buildSqlContext(sqlRows: Record<string, unknown>[]): string {
  const rows = sqlRows.map((r) =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => [
        k,
        /date/i.test(k) && typeof v === "number" ? formatDate(v) : v,
      ]),
    ),
  );
  return `<SQL_RESULTS>\n${JSON.stringify(rows, null, 2)}\n</SQL_RESULTS>`;
}

/**
 * Fetch the sources from the SQLite database
 *
 * @param dockets - The dockets to fetch the sources for
 * @returns The sources
 */
export async function getSources<
  T extends { caseName: string },
  R extends { case_name: string },
>(chunks: T[], sqlRows: R[]): Promise<Source[]> {
  const chunkCaseNames = chunks
    .map((c) => c.caseName)
    .filter(Boolean) as string[];
  const sqlCaseNames = sqlRows
    .map((r) => r.case_name)
    .filter(Boolean) as string[];
  const caseNames = [...new Set([...chunkCaseNames, ...sqlCaseNames])];

  let sources: Source[] = [];
  if (caseNames.length > 0) {
    const db = openReadOnlyDb(DB_PATH);
    try {
      const rows = await db
        .selectFrom("opinions")
        .select(["docket", "case_name", "pdf_url"])
        .where("case_name", "in", caseNames)
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

  console.log("Sources:", JSON.stringify(sources, null, 2));
  return sources;
}
