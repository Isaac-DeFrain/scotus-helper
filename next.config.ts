import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["weaviate-client", "@grpc/grpc-js", "protobufjs"],
  // Expose at build time so client components (e.g. FooterBar) match SSR.
  env: {
    GIT_COMMIT: process.env.GIT_COMMIT ?? "unknown",
  },
};

export default nextConfig;
