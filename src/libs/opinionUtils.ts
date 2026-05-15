/**
 * Opinion metadata utilities
 */

export type OpinionType = "merits" | "orders";

export type OpinionMetaData = {
  opinionNumber?: number;
  opinionType: OpinionType;
  termYear: number;
  date: number; // seconds since Unix epoch
  docket: string;
  caseName: string;
  justice: string;
  citation: string;
  pdfUrl: string;
};

/**
 * Shape of properties stored in Weaviate for each opinion chunk.
 * All fields are required because the uploader always writes them.
 */
export type OpinionChunk = {
  text: string;
  docket?: string;
  caseName: string;
  date: number; // seconds since Unix epoch
  justice: string;
  opinionType: string;
  termYear: number;
  chunkIndex: number;
  totalChunks: number;
};

/**
 * Build the backup JSON filename for an opinion.
 * Merits opinions are prefixed with their zero-padded number; all opinions
 * include the docket (slashes replaced with hyphens for filesystem safety).
 *
 * @param meta - The opinion metadata
 * @returns The filename, e.g. "0042-21-1234.json" or "24A123.json"
 */
export function buildFilename(meta: OpinionMetaData): string {
  const prefix =
    meta.opinionNumber != null
      ? `${String(meta.opinionNumber).padStart(4, "0")}-`
      : "";
  return `${prefix}${meta.docket.replace(/\//g, "-")}.json`;
}
