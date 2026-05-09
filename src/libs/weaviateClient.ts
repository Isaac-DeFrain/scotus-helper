/**
 * Weaviate client
 *
 * This file contains the functions to connect to the Weaviate instance.
 */

import weaviate, { WeaviateClient } from "weaviate-client";

/**
 * Parse the Weaviate URL
 *
 * @param raw - The raw Weaviate URL
 * @returns The parsed Weaviate URL
 */
function parseWeaviateUrl(raw: string): {
  httpHost: string;
  httpPort: number;
  httpSecure: boolean;
  grpcHost: string;
  grpcPort: number;
  grpcSecure: boolean;
} {
  const url = new URL(raw);

  const httpHost = url.hostname;
  const httpPort = url.port
    ? Number(url.port)
    : url.protocol === "https:"
      ? 443
      : 80;
  const httpSecure = url.protocol === "https:";

  // Default gRPC port for Weaviate is 50051 in our compose.
  const grpcHost = httpHost;
  const grpcPort = 50051;
  const grpcSecure = httpSecure;

  return { httpHost, httpPort, httpSecure, grpcHost, grpcPort, grpcSecure };
}

const CONNECT_RETRIES = 15;
const CONNECT_RETRY_DELAY_MS = 5000;

/**
 * Connect to the Weaviate instance, retrying on transient startup failures.
 * The Docker healthcheck gates on HTTP readiness, but the gRPC port may take
 * a moment longer — retries cover that gap.
 *
 * @returns The Weaviate client
 */
export async function connectWeaviate(): Promise<
  Awaited<ReturnType<typeof weaviate.connectToLocal>>
> {
  const raw = process.env.WEAVIATE_URL?.trim() || "http://localhost:8080";

  const connect = () => {
    if (raw === "http://localhost:8080") {
      return weaviate.connectToLocal();
    }

    const { httpHost, httpPort, httpSecure, grpcHost, grpcPort, grpcSecure } =
      parseWeaviateUrl(raw);

    return weaviate.connectToCustom({
      httpHost,
      httpPort,
      httpSecure,
      grpcHost,
      grpcPort,
      grpcSecure,
    });
  };

  for (let attempt = 1; attempt <= CONNECT_RETRIES; attempt++) {
    try {
      return await connect();
    } catch (err) {
      if (attempt === CONNECT_RETRIES) throw err;
      console.warn(
        `Weaviate connection attempt ${attempt}/${CONNECT_RETRIES} failed, retrying in ${CONNECT_RETRY_DELAY_MS}ms…`,
      );
      await new Promise((res) => setTimeout(res, CONNECT_RETRY_DELAY_MS));
    }
  }

  throw new Error("Unreachable");
}

/**
 * Connects to Weaviate client, exiting the process with an error message on failure.
 */
export async function connectWeaviateOrExit(): Promise<WeaviateClient> {
  try {
    return await connectWeaviate();
  } catch (err) {
    console.error("Could not connect to Weaviate:", (err as Error).message);
    console.error("Run `docker compose up -d` to start Weaviate.");
    process.exit(1);
  }
}
