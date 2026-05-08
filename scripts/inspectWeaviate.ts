/**
 * Inspect Weaviate: cluster health, collections, opinion chunk count, sample object.
 *
 * Usage:
 *   npm run inspect-weaviate
 */

import dotenv from "dotenv";
import weaviate from "weaviate-client";

import { WEAVIATE_COLLECTION_NAME } from "../src/constants";

dotenv.config();

async function inspectWeaviate(): Promise<void> {
  const client = await weaviate.connectToLocal();

  if (!client) {
    console.error("Could not connect to Weaviate.");
    console.error("Run `docker compose up -d` to start Weaviate.");
    process.exit(1);
  }

  try {
    const isLive = await client.isLive();
    const isReady = await client.isReady();
    const version = await client.getWeaviateVersion();

    console.log("\nWeaviate:");
    console.log("  isLive: ", isLive);
    console.log("  isReady:", isReady);
    console.log("  version:", version.show());

    const collectionConfigs = await client.collections.listAll();
    const collectionNames = collectionConfigs.map((c) => c.name).sort();
    console.log(
      `\nCollections (${collectionNames.length}):`,
      collectionNames.length > 0 ? collectionNames.join(", ") : "(none)",
    );

    const exists = await client.collections.exists(WEAVIATE_COLLECTION_NAME);
    console.log(`\n"${WEAVIATE_COLLECTION_NAME}" exists:`, exists);

    if (!exists) {
      return;
    }

    const collection = client.collections.get(WEAVIATE_COLLECTION_NAME);
    const total = await collection.length();
    console.log("  object count:", total);

    if (total === 0) {
      return;
    }

    const { objects } = await collection.query.fetchObjects({
      limit: 1,
    });

    const sample = objects[0];
    console.log("\nSample object:");
    if (!sample) {
      console.log("  (no rows returned)");
      return;
    }

    console.log("  uuid:", sample.uuid);
    console.log("  properties:", sample.properties);
  } finally {
    await client.close();
  }
}

inspectWeaviate().catch((err) => {
  console.error("inspect-weaviate failed:", (err as Error).message);
  process.exit(1);
});
