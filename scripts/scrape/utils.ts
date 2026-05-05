import * as fs from "fs";
import * as path from "path";

import { OPINIONS_DIR, BASE_URL } from "../../src/constants";
import { buildFilename, type OpinionMetaData } from "../../src/libs/opinionUtils";

export const ANSI = {
    cyan: "\x1b[36m",
    yellow: "\x1b[33m",
    reset: "\x1b[0m",
} as const;

export type OpinionType = OpinionMetaData["opinionType"];

export const TYPE_COLOR: Record<OpinionType, string> = {
    merits: ANSI.cyan,
    orders: ANSI.yellow,
};

export function colorLabel(type: OpinionType): string {
    return `${TYPE_COLOR[type]}[${type}]${ANSI.reset}`;
}

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
    const date = new Date(meta.date);
    const typeDir = path.join(OPINIONS_DIR, meta.opinionType, date.getFullYear().toString());

    fs.mkdirSync(typeDir, { recursive: true });
    fs.writeFileSync(path.join(typeDir, buildFilename(meta)), JSON.stringify(meta, null, 2));
}
