import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@remotion/lambda",
    "@remotion/cli",
    "@remotion/bundler",
    "@remotion/renderer",
    "@rspack/core",
  ],
};

export default nextConfig;
