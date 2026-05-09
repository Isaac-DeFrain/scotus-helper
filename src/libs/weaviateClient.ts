/**
 * Weaviate client
 *
 * This file contains the functions to connect to the Weaviate instance.
 */

import weaviate from "weaviate-client";

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

/**
 * Connect to the Weaviate instance
 *
 * @returns The Weaviate client
 */
export async function connectWeaviate(): Promise<
  Awaited<ReturnType<typeof weaviate.connectToLocal>>
> {
  const raw = process.env.WEAVIATE_URL?.trim() || "http://localhost:8080";

  if (raw === "http://localhost:8080") {
    return await weaviate.connectToLocal();
  }

  const { httpHost, httpPort, httpSecure, grpcHost, grpcPort, grpcSecure } =
    parseWeaviateUrl(raw);

  return await weaviate.connectToCustom({
    httpHost,
    httpPort,
    httpSecure,
    grpcHost,
    grpcPort,
    grpcSecure,
  });
}
