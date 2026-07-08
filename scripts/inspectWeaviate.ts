/**
 * Inspect Weaviate: cluster health, collections, opinion chunk count, sample object.
 *
 * Usage:
 *   npm run inspect-weaviate
 */

import dotenv from "dotenv";

import {
  formatWeaviateInspection,
  inspectWeaviateClient,
} from "@/src/langsmith/inspectWeaviate";
import { connectWeaviate } from "@/src/weaviate";

dotenv.config();

async function inspectWeaviate(): Promise<void> {
  const client = await connectWeaviate();

  if (!client) {
    console.error("Could not connect to Weaviate.");
    console.error("Run `docker compose up -d` to start Weaviate.");
    process.exit(1);
  }

  try {
    const result = await inspectWeaviateClient(client);
    console.log(formatWeaviateInspection(result));
  } finally {
    await client.close();
  }
}

inspectWeaviate().catch((err) => {
  console.error("inspect-weaviate failed:", (err as Error).message);
  process.exit(1);
});
