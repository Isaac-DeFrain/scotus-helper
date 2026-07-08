/**
 * Weaviate inspection helpers
 *
 * Core logic for `npm run inspect-weaviate`: cluster health, collection
 * inventory, and a quick sanity check on the opinion-chunk collection.
 * The script in scripts/inspectWeaviate.ts connects and prints; this module
 * holds the gather/format steps so they can be unit-tested without Docker.
 */

import { WEAVIATE_COLLECTION_NAME } from "../constants";

/** One Weaviate object returned by fetchObjects (uuid + stored properties). */
export type WeaviateInspectionSample = {
  uuid: string;
  properties: unknown;
};

/** Structured output from inspectWeaviateClient. */
export type WeaviateInspectionResult = {
  /** Process is up (HTTP liveness probe). */
  isLive: boolean;
  /** Process can serve requests (readiness probe; may lag isLive on startup). */
  isReady: boolean;
  version: string;
  /** All collection names, sorted alphabetically for stable output. */
  collections: string[];
  opinionCollection: {
    exists: boolean;
    /** Present only when the collection exists. */
    objectCount?: number;
    /** Present when objectCount > 0 and fetchObjects returns a row. */
    sample?: WeaviateInspectionSample;
  };
};

/**
 * Minimal collection surface used by inspection.
 * Narrower than WeaviateClient so tests can pass plain mocks.
 */
export type InspectWeaviateCollection = {
  length: () => Promise<number>;
  query: {
    fetchObjects: (opts: {
      limit: number;
    }) => Promise<{ objects: WeaviateInspectionSample[] }>;
  };
};

/**
 * Minimal client surface used by inspection.
 * Mirrors the Weaviate v3 client methods the script calls.
 */
export type InspectWeaviateClient = {
  isLive: () => Promise<boolean>;
  isReady: () => Promise<boolean>;
  getWeaviateVersion: () => Promise<{ show: () => string }>;
  collections: {
    listAll: () => Promise<Array<{ name: string }>>;
    exists: (name: string) => Promise<boolean>;
    get: (name: string) => InspectWeaviateCollection;
  };
  close: () => Promise<void>;
};

/**
 * Gather Weaviate health, collection list, and opinion chunk stats.
 *
 * Does not connect or close the client — callers own the lifecycle.
 *
 * @param client - An open Weaviate client (or test double)
 * @returns Inspection snapshot for formatting or assertions
 */
export async function inspectWeaviateClient(
  client: InspectWeaviateClient,
): Promise<WeaviateInspectionResult> {
  const isLive = await client.isLive();
  const isReady = await client.isReady();
  const version = (await client.getWeaviateVersion()).show();

  const collectionConfigs = await client.collections.listAll();
  const collections = collectionConfigs.map((c) => c.name).sort();

  const exists = await client.collections.exists(WEAVIATE_COLLECTION_NAME);
  const opinionCollection: WeaviateInspectionResult["opinionCollection"] = {
    exists,
  };

  if (exists) {
    const collection = client.collections.get(WEAVIATE_COLLECTION_NAME);
    const objectCount = await collection.length();
    opinionCollection.objectCount = objectCount;

    // One object is enough to confirm schema/shape after upload-opinions.
    if (objectCount > 0) {
      const { objects } = await collection.query.fetchObjects({ limit: 1 });
      const sample = objects[0];
      if (sample) {
        opinionCollection.sample = sample;
      }
    }
  }

  return {
    isLive,
    isReady,
    version,
    collections,
    opinionCollection,
  };
}

/**
 * Format inspection results for console output.
 *
 * Layout matches the historical inspect-weaviate script so `make inspect`
 * output stays familiar.
 *
 * @param result - Output from inspectWeaviateClient
 * @returns Multi-line string suitable for console.log
 */
export function formatWeaviateInspection(
  result: WeaviateInspectionResult,
): string {
  const lines: string[] = [
    "",
    "Weaviate:",
    `  isLive:  ${result.isLive}`,
    `  isReady: ${result.isReady}`,
    `  version: ${result.version}`,
    "",
    `Collections (${result.collections.length}): ${
      result.collections.length > 0
        ? result.collections.join(", ")
        : "(none)"
    }`,
    "",
    `"${WEAVIATE_COLLECTION_NAME}" exists: ${result.opinionCollection.exists}`,
  ];

  if (result.opinionCollection.exists) {
    lines.push(`  object count: ${result.opinionCollection.objectCount ?? 0}`);
  }

  if (result.opinionCollection.sample) {
    lines.push(
      "",
      "Sample object:",
      `  uuid: ${result.opinionCollection.sample.uuid}`,
      `  properties: ${inspectPropertyValue(result.opinionCollection.sample.properties)}`,
    );
  } else if (
    result.opinionCollection.exists &&
    (result.opinionCollection.objectCount ?? 0) > 0
  ) {
    // length() can be positive while fetchObjects returns nothing (race/replication).
    lines.push("", "Sample object:", "  (no rows returned)");
  }

  return lines.join("\n");
}

/** Render property payloads readably in the terminal (objects as JSON). */
function inspectPropertyValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}
