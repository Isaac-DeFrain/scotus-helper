import * as fs from "fs";
import * as path from "path";

import { OPINIONS_DIR, BASE_URL } from "../../src/constants";
import {
  buildFilename,
  type OpinionMetaData,
} from "../../src/libs/opinionUtils";

export type OpinionType = OpinionMetaData["opinionType"];

export function buildPdfUrl(relativeUrl: string): string {
  return relativeUrl.startsWith("http")
    ? relativeUrl
    : `${BASE_URL}${relativeUrl.startsWith("/") ? "" : "/"}${relativeUrl}`;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Save the opinion metadata to a JSON file under
 * {OPINIONS_DIR}/{opinionType}/{termYear}/
 */
export function saveJsonBackup(meta: OpinionMetaData): void {
  const typeDir = path.join(
    OPINIONS_DIR,
    meta.opinionType,
    meta.termYear.toString(),
  );
  const metadataJson = {
    ...meta,
    date: new Date(meta.date * 1000).toISOString().split("T")[0], // YYYY-MM-DD
  };

  fs.mkdirSync(typeDir, { recursive: true });
  fs.writeFileSync(
    path.join(typeDir, buildFilename(meta)),
    JSON.stringify(metadataJson, null, 2),
  );
}
