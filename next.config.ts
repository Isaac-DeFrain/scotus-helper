import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["weaviate-client", "@grpc/grpc-js", "protobufjs"],
};

export default nextConfig;
